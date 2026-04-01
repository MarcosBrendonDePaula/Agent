import { VoiceCapture } from "./voice-capture.ts";
import { loadConfig, saveConfig, updateConfig } from "./config.ts";
import { detectAudioDevice } from "./audio-utils.ts";
import type { VoiceCaptureConfig, VoiceCaptureEvents, TranscriptionResult } from "./types.ts";

export type VoiceCaptureStatus = "stopped" | "running" | "paused";

export class VoiceCaptureController {
  private capture: VoiceCapture | null = null;
  private config!: VoiceCaptureConfig;
  private events: Partial<VoiceCaptureEvents>;
  private _status: VoiceCaptureStatus = "stopped";
  private pausedText: string = "";

  constructor(events: Partial<VoiceCaptureEvents> = {}) {
    this.events = events;
  }

  async init(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY não definida");
    this.config = await loadConfig(apiKey);
    console.log("[Controller] Config carregada:", this.configSummary());
  }

  async start(): Promise<void> {
    if (this._status === "running") {
      console.log("[Controller] Já está rodando.");
      return;
    }

    if (!this.config) await this.init();

    this.capture = new VoiceCapture(this.config, this.events);
    await this.capture.start();
    this._status = "running";
  }

  async stop(): Promise<string> {
    if (this._status === "stopped") {
      console.log("[Controller] Já está parado.");
      return "";
    }

    if (!this.capture) return "";

    await this.capture.stop();
    const text = this.capture.getFullText();
    this.capture = null;
    this._status = "stopped";
    this.pausedText = "";
    return text;
  }

  async pause(): Promise<void> {
    if (this._status !== "running" || !this.capture) {
      console.log("[Controller] Não está rodando para pausar.");
      return;
    }

    // salva o texto parcial e para a captura
    await this.capture.stop();
    this.pausedText = this.capture.getFullText();
    this.capture = null;
    this._status = "paused";
    console.log("[Controller] Pausado. Texto parcial salvo.");
  }

  async resume(): Promise<void> {
    if (this._status !== "paused") {
      console.log("[Controller] Não está pausado para retomar.");
      return;
    }

    // reinicia com o texto parcial preservado
    this.capture = new VoiceCapture(this.config, this.events);
    await this.capture.start();
    this._status = "running";
    console.log("[Controller] Retomado.");
  }

  async restart(): Promise<void> {
    console.log("[Controller] Reiniciando...");
    await this.stop();
    await this.init();
    await this.start();
  }

  async setConfig(updates: Partial<Omit<VoiceCaptureConfig, "openaiApiKey">>): Promise<void> {
    const apiKey = this.config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY não definida");

    this.config = await updateConfig(apiKey, updates);
    console.log("[Controller] Config atualizada:", this.configSummary());

    if (this._status === "running") {
      console.log("[Controller] Reiniciando com nova config...");
      await this.restart();
    }
  }

  async listDevices(): Promise<string[]> {
    const ffmpeg = this.config?.ffmpegPath ?? "ffmpeg";
    const { spawn } = await import("bun");

    const proc = spawn({
      cmd: [ffmpeg, "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    const devices: string[] = [];
    const regex = /"([^"]+)"\s*\(audio\)/g;
    let match;
    while ((match = regex.exec(stderr)) !== null) {
      devices.push(match[1]!);
    }

    return devices;
  }

  async setDevice(device: string): Promise<void> {
    await this.setConfig({ audioDevice: device });
  }

  getStatus(): { status: VoiceCaptureStatus; config: string; pending: number; text: string } {
    return {
      status: this._status,
      config: this.configSummary(),
      pending: this.capture?.pendingTranscriptions ?? 0,
      text: this._status === "paused"
        ? this.pausedText
        : this.capture?.getFullText() ?? "",
    };
  }

  getResults(): TranscriptionResult[] {
    return this.capture?.getResults() ?? [];
  }

  getFullText(): string {
    if (this._status === "paused") return this.pausedText;
    return this.capture?.getFullText() ?? "";
  }

  get status(): VoiceCaptureStatus {
    return this._status;
  }

  private configSummary(): string {
    if (!this.config) return "(não carregada)";
    return `lang=${this.config.language} | buffer=${this.config.maxBufferDurationMs}ms | capturers=${this.config.capturerCount} | concurrency=${this.config.pipelineConcurrency} | device=${this.config.audioDevice ?? "auto"}`;
  }
}
