import { resolve } from "path";
import { DEFAULT_THINKING_CONFIG, type ThinkingConfig } from "./types.ts";

const CONFIG_PATH = resolve(import.meta.dir, "../../../config/thinking.json");

type ConfigFile = Partial<Omit<ThinkingConfig, "apiKey">>;

export async function loadThinkingConfig(apiKey: string): Promise<ThinkingConfig> {
  let fileConfig: ConfigFile = {};

  try {
    const file = Bun.file(CONFIG_PATH);
    fileConfig = await file.json();
  } catch {
    console.warn("[Thinking Config] thinking.json não encontrado, usando defaults.");
  }

  return {
    apiKey,
    model: fileConfig.model ?? DEFAULT_THINKING_CONFIG.model,
    systemPrompt: fileConfig.systemPrompt ?? DEFAULT_THINKING_CONFIG.systemPrompt,
    maxHistoryMessages: fileConfig.maxHistoryMessages ?? DEFAULT_THINKING_CONFIG.maxHistoryMessages,
    temperature: fileConfig.temperature ?? DEFAULT_THINKING_CONFIG.temperature,
    maxTokens: fileConfig.maxTokens ?? DEFAULT_THINKING_CONFIG.maxTokens,
  };
}

export async function saveThinkingConfig(config: ThinkingConfig): Promise<void> {
  const { apiKey, ...toSave } = config;
  await Bun.write(CONFIG_PATH, JSON.stringify(toSave, null, 2) + "\n");
}
