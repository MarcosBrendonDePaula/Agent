import { resolve } from "path";
import { DEFAULT_CONFIG, type VoiceCaptureConfig } from "./types.ts";

const CONFIG_PATH = resolve(import.meta.dir, "../../../config/voice-capture.json");

interface ConfigFile {
  sampleRate?: number;
  silenceThresholdMs?: number;
  maxBufferDurationMs?: number;
  language?: string;
  capturerCount?: number;
  pipelineConcurrency?: number;
  audioDevice?: string | null;
  ffmpegPath?: string | null;
  vadThreshold?: number;
  vadMinVoiceRatio?: number;
}

export async function loadConfig(openaiApiKey: string): Promise<VoiceCaptureConfig> {
  let fileConfig: ConfigFile = {};

  try {
    const file = Bun.file(CONFIG_PATH);
    fileConfig = await file.json();
  } catch {
    console.warn("[Config] voice-capture.json não encontrado, usando defaults.");
  }

  return {
    openaiApiKey,
    sampleRate: fileConfig.sampleRate ?? DEFAULT_CONFIG.sampleRate,
    silenceThresholdMs: fileConfig.silenceThresholdMs ?? DEFAULT_CONFIG.silenceThresholdMs,
    maxBufferDurationMs: fileConfig.maxBufferDurationMs ?? DEFAULT_CONFIG.maxBufferDurationMs,
    language: fileConfig.language ?? DEFAULT_CONFIG.language,
    capturerCount: fileConfig.capturerCount ?? DEFAULT_CONFIG.capturerCount,
    pipelineConcurrency: fileConfig.pipelineConcurrency ?? DEFAULT_CONFIG.pipelineConcurrency,
    audioDevice: fileConfig.audioDevice ?? undefined,
    ffmpegPath: fileConfig.ffmpegPath ?? undefined,
    vadThreshold: fileConfig.vadThreshold ?? DEFAULT_CONFIG.vadThreshold,
    vadMinVoiceRatio: fileConfig.vadMinVoiceRatio ?? DEFAULT_CONFIG.vadMinVoiceRatio,
  };
}

export async function saveConfig(config: VoiceCaptureConfig): Promise<void> {
  const toSave: ConfigFile = {
    sampleRate: config.sampleRate,
    silenceThresholdMs: config.silenceThresholdMs,
    maxBufferDurationMs: config.maxBufferDurationMs,
    language: config.language,
    capturerCount: config.capturerCount,
    pipelineConcurrency: config.pipelineConcurrency,
    audioDevice: config.audioDevice ?? null,
    ffmpegPath: config.ffmpegPath ?? null,
    vadThreshold: config.vadThreshold,
    vadMinVoiceRatio: config.vadMinVoiceRatio,
  };

  await Bun.write(CONFIG_PATH, JSON.stringify(toSave, null, 2) + "\n");
  console.log("[Config] Salvo em", CONFIG_PATH);
}

export async function updateConfig(
  openaiApiKey: string,
  updates: Partial<ConfigFile>,
): Promise<VoiceCaptureConfig> {
  const current = await loadConfig(openaiApiKey);
  const updated: VoiceCaptureConfig = {
    ...current,
    ...Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    ),
  };
  await saveConfig(updated);
  return updated;
}
