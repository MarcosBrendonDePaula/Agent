import { spawn, type Subprocess } from "bun";
import type { VoiceCaptureConfig } from "./types.ts";

type CaptureState = "idle" | "recording" | "flushing";

export class Capturer {
  readonly id: number;
  private process: Subprocess | null = null;
  private chunks: Uint8Array[] = [];
  private startTime = 0;
  private _state: CaptureState = "idle";
  private config: VoiceCaptureConfig;
  private audioDevice: string;
  private onReady: (() => void) | null = null;

  // VAD em tempo real
  private _hasSpeech = false;
  private speechChecks = 0;
  private silenceStartMs = 0;
  private onSpeechEnd: (() => void) | null = null;
  private vadCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(id: number, config: VoiceCaptureConfig, audioDevice: string) {
    this.id = id;
    this.config = config;
    this.audioDevice = audioDevice;
  }

  async startRecording(): Promise<void> {
    if (this._state !== "idle") return;

    this.chunks = [];
    this.startTime = Date.now();
    this._state = "recording";
    this._hasSpeech = false;
    this.speechChecks = 0;
    this.silenceStartMs = 0;

    const ffmpeg = this.config.ffmpegPath ?? "ffmpeg";

    this.process = spawn({
      cmd: [
        ffmpeg,
        "-f", "dshow",
        "-i", `audio=${this.audioDevice}`,
        "-ar", String(this.config.sampleRate),
        "-ac", "1",
        "-f", "wav",
        "-acodec", "pcm_s16le",
        "pipe:1",
      ],
      stdout: "pipe",
      stderr: "ignore",
    });

    this.readStream();

    // checa VAD a cada 500ms nos chunks recentes
    this.vadCheckTimer = setInterval(() => this.checkVAD(), 500);
  }

  private async readStream(): Promise<void> {
    if (!this.process?.stdout) return;

    const reader = this.process.stdout.getReader();
    try {
      while (this._state === "recording") {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) this.chunks.push(value);
      }
    } catch {
      // stream closed
    } finally {
      reader.releaseLock();
    }
  }

  private checkVAD(): void {
    if (this._state !== "recording" || this.chunks.length === 0) return;

    // analisa os últimos ~500ms de áudio (16000 samples/s * 0.5s * 2 bytes = 16000 bytes)
    const recentBytes = 16000;
    let collected = 0;
    const recentChunks: Uint8Array[] = [];

    for (let i = this.chunks.length - 1; i >= 0 && collected < recentBytes; i--) {
      recentChunks.unshift(this.chunks[i]!);
      collected += this.chunks[i]!.length;
    }

    const total = recentChunks.reduce((s, c) => s + c.length, 0);
    const recent = new Uint8Array(total);
    let off = 0;
    for (const c of recentChunks) {
      recent.set(c, off);
      off += c.length;
    }

    const energy = this.rmsEnergy(recent);
    // threshold para detecção em tempo real: 3x o vadThreshold pra não pegar chiado
    const threshold = (this.config.vadThreshold ?? 0.02) * 3;
    const isSpeech = energy > threshold;

    if (isSpeech) {
      this.speechChecks++;
      this.silenceStartMs = 0;
      // precisa de 3 checks seguidos (~1.5s) pra confirmar que é fala real
      if (this.speechChecks >= 3) {
        this._hasSpeech = true;
      }
    } else {
      this.speechChecks = 0;
      if (this._hasSpeech) {
        // fala confirmada e agora silêncio
        if (this.silenceStartMs === 0) {
          this.silenceStartMs = Date.now();
        } else {
          const silenceDuration = Date.now() - this.silenceStartMs;
          if (silenceDuration >= this.config.silenceThresholdMs) {
            this.onSpeechEnd?.();
          }
        }
      }
    }
  }

  private rmsEnergy(pcm: Uint8Array): number {
    if (pcm.length < 2) return 0;
    const view = new DataView(pcm.buffer, pcm.byteOffset);
    const count = Math.floor(pcm.length / 2);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const s = view.getInt16(i * 2, true) / 32768;
      sum += s * s;
    }
    return Math.sqrt(sum / count);
  }

  async flush(): Promise<{ data: Uint8Array; durationMs: number; hasSpeech: boolean }> {
    this._state = "flushing";

    if (this.vadCheckTimer) {
      clearInterval(this.vadCheckTimer);
      this.vadCheckTimer = null;
    }

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    const durationMs = Date.now() - this.startTime;
    const totalLength = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }

    const hasSpeech = this._hasSpeech;
    this.chunks = [];
    this._state = "idle";
    this._hasSpeech = false;
    this.speechChecks = 0;
    this.silenceStartMs = 0;

    console.log(`[Capturer ${this.id}] Flush: ${durationMs}ms, ${data.length} bytes${hasSpeech ? "" : " (silêncio)"}`);

    this.onReady?.();

    return { data, durationMs, hasSpeech };
  }

  onBecomeReady(cb: () => void): void {
    this.onReady = cb;
  }

  onSpeechEnded(cb: () => void): void {
    this.onSpeechEnd = cb;
  }

  get state(): CaptureState {
    return this._state;
  }

  get hasSpeech(): boolean {
    return this._hasSpeech;
  }

  get durationMs(): number {
    if (this._state !== "recording") return 0;
    return Date.now() - this.startTime;
  }
}
