import { Capturer } from "./capturer.ts";
import { TranscriptionPipeline } from "./pipeline.ts";
import { detectAudioDevice } from "./audio-utils.ts";
import { autoTune } from "./auto-tuner.ts";
import {
  DEFAULT_CONFIG,
  type VoiceCaptureConfig,
  type VoiceCaptureEvents,
} from "./types.ts";

export class VoiceCapture {
  private capturers: Capturer[] = [];
  private pipeline!: TranscriptionPipeline;
  private config: VoiceCaptureConfig;
  private events: Partial<VoiceCaptureEvents>;
  private running = false;
  private activeCapturer = 0;
  private maxTimer: ReturnType<typeof setInterval> | null = null;
  private device = "";

  constructor(
    config: Partial<VoiceCaptureConfig> & { openaiApiKey: string },
    events: Partial<VoiceCaptureEvents> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.device = this.config.audioDevice ?? await detectAudioDevice(this.config.ffmpegPath);
    const { capturerCount, pipelineConcurrency } = this.config;

    console.log(`[VoiceCapture] Dispositivo: ${this.device}`);

    // Auto-tune: calibra VAD com ruído ambiente
    try {
      const tune = await autoTune(
        this.device,
        this.config.sampleRate,
        3,
        this.config.ffmpegPath,
      );
      this.config.vadThreshold = tune.vadThreshold;
      this.config.vadMinVoiceRatio = tune.vadMinVoiceRatio;
    } catch (e) {
      console.warn(`[VoiceCapture] AutoTune falhou: ${(e as Error).message}`);
    }

    console.log(`[VoiceCapture] Capturers: ${capturerCount} | Pipeline: ${pipelineConcurrency} | VAD: ${this.config.vadThreshold}`);

    this.capturers = Array.from(
      { length: capturerCount },
      (_, i) => {
        const cap = new Capturer(i, this.config, this.device);
        // quando detecta fim de fala, dispara rotação antecipada
        cap.onSpeechEnded(() => this.onSpeechEnd(i));
        return cap;
      },
    );

    this.pipeline = new TranscriptionPipeline(this.config, this.events, pipelineConcurrency);

    this.running = true;
    this.activeCapturer = 0;

    console.log("[VoiceCapture] Iniciando captura com VAD dinâmico...");

    await this.capturers[0]!.startRecording();

    // timer de segurança: max duration mesmo se não detectar pausa
    this.maxTimer = setInterval(() => {
      this.rotate("max-duration");
    }, this.config.maxBufferDurationMs);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.maxTimer) {
      clearInterval(this.maxTimer);
      this.maxTimer = null;
    }

    for (const cap of this.capturers) {
      if (cap.state === "recording") {
        const { data, durationMs, hasSpeech } = await cap.flush();
        if (data.length > 0 && hasSpeech) {
          this.pipeline.push(data, cap.id, durationMs);
        }
      }
    }

    await this.pipeline.drain();

    console.log("[VoiceCapture] Captura encerrada.");
    console.log(`[VoiceCapture] Texto completo:\n${this.pipeline.getFullText()}`);
    console.log(`[VoiceCapture] Requests economizados: ${this.pipeline.savedRequests}`);
  }

  private onSpeechEnd(capturerId: number): void {
    if (!this.running) return;
    if (capturerId !== this.activeCapturer) return;

    // rotação antecipada: fala terminou antes do max timer
    this.rotate("speech-end");
  }

  private async rotate(reason: "speech-end" | "max-duration"): Promise<void> {
    if (!this.running) return;

    const prevIndex = this.activeCapturer;
    const prev = this.capturers[prevIndex]!;

    if (prev.state !== "recording") return;

    // se max-duration e capturer não detectou fala, continua gravando (não rotaciona)
    if (reason === "max-duration" && !prev.hasSpeech) {
      return;
    }

    const freeIndex = this.findFreeCapturer(prevIndex);
    if (freeIndex === -1) {
      if (reason === "speech-end") return;
      console.warn("[VoiceCapture] Todos ocupados!");
      return;
    }

    const freeCapturer = this.capturers[freeIndex]!;

    // inicia próximo ANTES de parar (zero gap)
    await freeCapturer.startRecording();
    this.activeCapturer = freeIndex;

    const tag = reason === "speech-end" ? "pausa detectada" : "max-duration";
    const { data, durationMs, hasSpeech } = await prev.flush();

    if (data.length > 0 && hasSpeech) {
      console.log(
        `[VoiceCapture] Rotação (${tag}): ${durationMs}ms | Capturer ${freeIndex} gravando | Pending: ${this.pipeline.pending}`,
      );
      this.pipeline.push(data, prevIndex, durationMs);
    } else {
      console.log(
        `[VoiceCapture] Silêncio | Capturer ${freeIndex} gravando`,
      );
    }

    this.events.onBufferSwitch?.(freeIndex);

    // reseta o timer de max duration
    if (reason === "speech-end" && this.maxTimer) {
      clearInterval(this.maxTimer);
      this.maxTimer = setInterval(() => {
        this.rotate("max-duration");
      }, this.config.maxBufferDurationMs);
    }
  }

  private findFreeCapturer(excludeIndex: number): number {
    for (let i = 0; i < this.capturers.length; i++) {
      if (i !== excludeIndex && this.capturers[i]!.state === "idle") {
        return i;
      }
    }
    return -1;
  }

  mute(): void { this.pipeline?.mute(); }
  unmute(): void { this.pipeline?.unmute(); }

  get isRunning(): boolean {
    return this.running;
  }

  get pendingTranscriptions(): number {
    return this.pipeline?.pending ?? 0;
  }

  getResults() {
    return this.pipeline?.getResults() ?? [];
  }

  getFullText(): string {
    return this.pipeline?.getFullText() ?? "";
  }
}
