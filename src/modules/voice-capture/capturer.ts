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
    console.log(`[Capturer ${this.id}] Gravando...`);
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

  async flush(): Promise<{ data: Uint8Array; durationMs: number }> {
    this._state = "flushing";

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

    this.chunks = [];
    this._state = "idle";

    console.log(`[Capturer ${this.id}] Flush: ${durationMs}ms, ${data.length} bytes`);

    // notifica que está livre para capturar de novo
    this.onReady?.();

    return { data, durationMs };
  }

  onBecomeReady(cb: () => void): void {
    this.onReady = cb;
  }

  get state(): CaptureState {
    return this._state;
  }

  get durationMs(): number {
    if (this._state !== "recording") return 0;
    return Date.now() - this.startTime;
  }
}
