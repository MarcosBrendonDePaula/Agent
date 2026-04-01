import { resolve } from "path";
import { DEFAULT_TTS_CONFIG, type TTSConfig } from "./types.ts";

const CONFIG_PATH = resolve(import.meta.dir, "../../../config/tts.json");

interface ConfigFile {
  voiceId?: string;
  modelId?: string;
  language?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  outputFormat?: string;
  concurrency?: number;
  ffmpegPath?: string | null;
}

export async function loadTTSConfig(elevenLabsApiKey: string): Promise<TTSConfig> {
  let fileConfig: ConfigFile = {};

  try {
    const file = Bun.file(CONFIG_PATH);
    fileConfig = await file.json();
  } catch {
    console.warn("[TTS Config] tts.json não encontrado, usando defaults.");
  }

  return {
    elevenLabsApiKey,
    voiceId: fileConfig.voiceId ?? DEFAULT_TTS_CONFIG.voiceId,
    modelId: fileConfig.modelId ?? DEFAULT_TTS_CONFIG.modelId,
    language: fileConfig.language ?? DEFAULT_TTS_CONFIG.language,
    stability: fileConfig.stability ?? DEFAULT_TTS_CONFIG.stability,
    similarityBoost: fileConfig.similarityBoost ?? DEFAULT_TTS_CONFIG.similarityBoost,
    style: fileConfig.style ?? DEFAULT_TTS_CONFIG.style,
    speed: fileConfig.speed ?? DEFAULT_TTS_CONFIG.speed,
    outputFormat: fileConfig.outputFormat ?? DEFAULT_TTS_CONFIG.outputFormat,
    concurrency: fileConfig.concurrency ?? DEFAULT_TTS_CONFIG.concurrency,
    ffmpegPath: fileConfig.ffmpegPath ?? undefined,
  };
}

export async function saveTTSConfig(config: TTSConfig): Promise<void> {
  const toSave: ConfigFile = {
    voiceId: config.voiceId,
    modelId: config.modelId,
    language: config.language,
    stability: config.stability,
    similarityBoost: config.similarityBoost,
    style: config.style,
    speed: config.speed,
    outputFormat: config.outputFormat,
    concurrency: config.concurrency,
    ffmpegPath: config.ffmpegPath ?? null,
  };

  await Bun.write(CONFIG_PATH, JSON.stringify(toSave, null, 2) + "\n");
  console.log("[TTS Config] Salvo em", CONFIG_PATH);
}

export async function updateTTSConfig(
  elevenLabsApiKey: string,
  updates: Partial<ConfigFile>,
): Promise<TTSConfig> {
  const current = await loadTTSConfig(elevenLabsApiKey);
  const updated: TTSConfig = {
    ...current,
    ...Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    ),
  };
  await saveTTSConfig(updated);
  return updated;
}
