import { tokenize, normalize } from "./hasher.ts";
import { CacheStore } from "./cache-store.ts";
import type { AudioQuality } from "./types.ts";

export interface AudioFragment {
  text: string;
  audio: Uint8Array;
  cached: boolean;
  quality: AudioQuality;
}

export interface BuildResult {
  fragments: AudioFragment[];
  fullyCached: boolean;
  bestQuality: AudioQuality;
  cacheHitRatio: number;
  missingParts: string[];
}

export class SentenceBuilder {
  private store: CacheStore;

  constructor(store: CacheStore) {
    this.store = store;
  }

  async tryBuildFromCache(text: string, voiceId: string): Promise<BuildResult> {
    const norm = normalize(text);

    // 1. frase completa nativa? melhor cenário
    const full = await this.store.getAudio(norm, voiceId);
    if (full) {
      return {
        fragments: [{ text: norm, audio: full.audio, cached: true, quality: full.quality }],
        fullyCached: true,
        bestQuality: full.quality,
        cacheHitRatio: 1,
        missingParts: [],
      };
    }

    // 2. greedy match: tenta maior pedaço cacheado primeiro
    const words = tokenize(norm);
    const fragments: AudioFragment[] = [];
    const missingParts: string[] = [];
    let hits = 0;
    let allNative = true;
    let i = 0;

    while (i < words.length) {
      let matched = false;

      for (let size = Math.min(words.length - i, 8); size >= 1; size--) {
        const chunk = words.slice(i, i + size).join(" ");
        const cached = await this.store.getAudio(chunk, voiceId);

        if (cached) {
          fragments.push({ text: chunk, audio: cached.audio, cached: true, quality: cached.quality });
          if (cached.quality !== "native") allNative = false;
          hits += size;
          i += size;
          matched = true;
          break;
        }
      }

      if (!matched) {
        missingParts.push(words[i]!);
        i++;
      }
    }

    const fullyCached = missingParts.length === 0;

    return {
      fragments,
      fullyCached,
      bestQuality: fullyCached && allNative ? "native" : "stitched",
      cacheHitRatio: words.length > 0 ? hits / words.length : 0,
      missingParts,
    };
  }

  canBuildFully(text: string, voiceId: string): boolean {
    const norm = normalize(text);
    if (this.store.has(norm, voiceId)) return true;
    const words = tokenize(norm);
    return words.every((w) => this.store.has(w, voiceId));
  }

  isNative(text: string, voiceId: string): boolean {
    return this.store.getQuality(text, voiceId) === "native";
  }
}
