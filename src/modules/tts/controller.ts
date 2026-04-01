import { TTSPipeline, type OnAudioGenerated, type CacheResolver } from "./tts-pipeline.ts";
import { Synthesizer } from "./synthesizer.ts";
import { loadTTSConfig, updateTTSConfig } from "./config.ts";
import type { TTSConfig, TTSEvents, TTSRequest } from "./types.ts";

export type TTSStatus = "stopped" | "ready" | "speaking" | "paused";

export class TTSController {
  private pipeline: TTSPipeline | null = null;
  private config!: TTSConfig;
  private events: Partial<TTSEvents>;
  private _status: TTSStatus = "stopped";

  constructor(events: Partial<TTSEvents> = {}) {
    this.events = events;
  }

  async init(): Promise<void> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY não definida");
    this.config = await loadTTSConfig(apiKey);
    this.pipeline = new TTSPipeline(this.config, this.events, this.config.concurrency);
    this._status = "ready";
    console.log("[TTS Controller] Pronto.", this.configSummary());
  }

  // --- Controle de fala ---

  speak(text: string, priority = 0): string {
    this.ensureReady();
    this._status = "speaking";
    return this.pipeline!.speak(text, priority);
  }

  speakNow(text: string): string {
    return this.speak(text, 999);
  }

  cancel(id: string): boolean {
    return this.pipeline?.cancel(id) ?? false;
  }

  skip(): void {
    this.pipeline?.skip();
  }

  clear(): TTSRequest[] {
    return this.pipeline?.clear() ?? [];
  }

  // --- Controle de fluxo ---

  pause(): void {
    if (this._status !== "speaking") return;
    this.pipeline?.pause();
    this._status = "paused";
  }

  resume(): void {
    if (this._status !== "paused") return;
    this.pipeline?.resume();
    this._status = "speaking";
  }

  async stop(): Promise<void> {
    if (!this.pipeline) return;
    this.pipeline.clear();
    await this.pipeline.drain();
    this.pipeline = null;
    this._status = "stopped";
    console.log("[TTS Controller] Parado.");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.init();
  }

  async waitForCompletion(): Promise<void> {
    if (!this.pipeline) return;
    await this.pipeline.drain();
    if (this._status === "speaking") this._status = "ready";
  }

  // --- Fila ---

  getQueue(): TTSRequest[] {
    return this.pipeline?.getQueue() ?? [];
  }

  promote(id: string, newPriority: number): boolean {
    return this.pipeline?.promote(id, newPriority) ?? false;
  }

  moveToFront(id: string): boolean {
    return this.pipeline?.moveToFront(id) ?? false;
  }

  // --- Config ---

  async setConfig(updates: Partial<Omit<TTSConfig, "elevenLabsApiKey">>): Promise<void> {
    const apiKey = this.config?.elevenLabsApiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY não definida");

    this.config = await updateTTSConfig(apiKey, updates);

    if (this._status !== "stopped") {
      this.pipeline = new TTSPipeline(this.config, this.events, this.config.concurrency);
    }

    console.log("[TTS Controller] Config atualizada:", this.configSummary());
  }

  async listVoices(): Promise<Array<{ id: string; name: string; language: string }>> {
    this.ensureReady();
    const synth = new Synthesizer(this.config);
    return synth.listVoices();
  }

  async setVoice(voiceId: string): Promise<void> {
    await this.setConfig({ voiceId });
  }

  async setSpeed(speed: number): Promise<void> {
    await this.setConfig({ speed });
  }

  async setConcurrency(concurrency: number): Promise<void> {
    await this.setConfig({ concurrency });
  }

  // --- Status ---

  getStatus(): { status: TTSStatus; config: string; pending: number; queue: TTSRequest[] } {
    return {
      status: this._status,
      config: this.configSummary(),
      pending: this.pipeline?.pending ?? 0,
      queue: this.getQueue(),
    };
  }

  get status(): TTSStatus {
    return this._status;
  }

  get pending(): number {
    return this.pipeline?.pending ?? 0;
  }

  get isPlaying(): boolean {
    return this.pipeline?.isPlaying ?? false;
  }

  // --- Hooks ---

  onAudioGenerated(fn: OnAudioGenerated): void {
    this.pipeline?.setOnAudioGenerated(fn);
  }

  setCacheResolver(fn: CacheResolver): void {
    this.pipeline?.setCacheResolver(fn);
  }

  // --- Internos ---

  private ensureReady(): void {
    if (!this.pipeline || this._status === "stopped") {
      throw new Error("[TTS Controller] Não inicializado. Chame init() primeiro.");
    }
  }

  private configSummary(): string {
    if (!this.config) return "(não carregada)";
    return `voice=${this.config.voiceId} | model=${this.config.modelId} | speed=${this.config.speed} | concurrency=${this.config.concurrency}`;
  }
}
