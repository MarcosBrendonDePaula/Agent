import { resolve } from "path";
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from "./types.ts";

const CONFIG_PATH = resolve(import.meta.dir, "../../../config/memory.json");

type ConfigFile = Partial<MemoryConfig>;

export async function loadMemoryConfig(): Promise<MemoryConfig> {
  let fileConfig: ConfigFile = {};

  try {
    const file = Bun.file(CONFIG_PATH);
    fileConfig = await file.json();
  } catch {
    console.warn("[Memory Config] memory.json não encontrado, usando defaults.");
  }

  return { ...DEFAULT_MEMORY_CONFIG, ...fileConfig };
}

export async function saveMemoryConfig(config: MemoryConfig): Promise<void> {
  const { ...toSave } = config;
  await Bun.write(CONFIG_PATH, JSON.stringify(toSave, null, 2) + "\n");
}

export async function updateMemoryConfig(updates: Partial<MemoryConfig>): Promise<MemoryConfig> {
  const current = await loadMemoryConfig();
  const updated = { ...current, ...updates };
  await saveMemoryConfig(updated);
  return updated;
}
