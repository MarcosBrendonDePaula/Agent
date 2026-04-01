import { Capturer } from "./capturer.ts";
import { TranscriptionPipeline } from "./pipeline.ts";
import { detectAudioDevice } from "./audio-utils.ts";
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
  private swapTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: Partial<VoiceCaptureConfig> & { openaiApiKey: string },
    events: Partial<VoiceCaptureEvents> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const device = this.config.audioDevice ?? await detectAudioDevice(this.config.ffmpegPath);
    const { capturerCount, pipelineConcurrency } = this.config;

    console.log(`[VoiceCapture] Dispositivo: ${device}`);
    console.log(`[VoiceCapture] Capturers: ${capturerCount} | Pipeline concorrência: ${pipelineConcurrency}`);

    // cria N capturadores rotativos
    this.capturers = Array.from(
      { length: capturerCount },
      (_, i) => new Capturer(i, this.config, device),
    );

    this.pipeline = new TranscriptionPipeline(this.config, this.events, pipelineConcurrency);

    this.running = true;
    this.activeCapturer = 0;

    console.log("[VoiceCapture] Iniciando captura rotativa com pipeline...");

    await this.capturers[0]!.startRecording();

    this.swapTimer = setInterval(() => {
      this.rotate();
    }, this.config.maxBufferDurationMs);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.swapTimer) {
      clearInterval(this.swapTimer);
      this.swapTimer = null;
    }

    // flush de todos os capturers que estejam gravando
    for (const cap of this.capturers) {
      if (cap.state === "recording") {
        const { data, durationMs } = await cap.flush();
        if (data.length > 0) {
          this.pipeline.push(data, cap.id, durationMs);
        }
      }
    }

    await this.pipeline.drain();

    console.log("[VoiceCapture] Captura encerrada.");
    console.log(`[VoiceCapture] Texto completo:\n${this.pipeline.getFullText()}`);
  }

  private async rotate(): Promise<void> {
    if (!this.running) return;

    const prevIndex = this.activeCapturer;
    const nextIndex = (prevIndex + 1) % this.capturers.length;

    const prev = this.capturers[prevIndex]!;
    const next = this.capturers[nextIndex]!;

    // se o próximo ainda está em flush (pipeline lento), pula pra outro livre
    const freeIndex = this.findFreeCapturer(prevIndex);
    if (freeIndex === -1) {
      console.warn("[VoiceCapture] Todos os capturers ocupados! Pipeline não está dando conta.");
      // mantém o atual gravando, não faz rotate
      return;
    }

    const freeCapturer = this.capturers[freeIndex]!;

    // 1. inicia o livre ANTES de parar o atual (zero gap)
    await freeCapturer.startRecording();
    this.activeCapturer = freeIndex;

    this.events.onBufferSwitch?.(freeIndex);
    console.log(
      `[VoiceCapture] Rotação: Capturer ${freeIndex} gravando | Capturer ${prevIndex} → pipeline | Pending: ${this.pipeline.pending}`,
    );

    // 2. flush do anterior e joga no pipeline
    const { data, durationMs } = await prev.flush();
    if (data.length > 0) {
      this.pipeline.push(data, prevIndex, durationMs);
    }
  }

  private findFreeCapturer(excludeIndex: number): number {
    // procura um capturer idle (não está gravando nem fazendo flush)
    for (let i = 0; i < this.capturers.length; i++) {
      if (i !== excludeIndex && this.capturers[i]!.state === "idle") {
        return i;
      }
    }
    return -1;
  }

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
