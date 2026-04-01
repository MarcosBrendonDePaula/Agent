// "stitched" = montado juntando pedaços | "native" = áudio único gerado pela API
export type AudioQuality = "stitched" | "native";

export interface CacheEntry {
  key: string;
  text: string;
  audioFile: string;
  hits: number;
  lastUsed: number;
  createdAt: number;
  sizeBytes: number;
  voiceId: string;
  language: string;
  quality: AudioQuality;
  wordCount: number;
}

export interface RegenRequest {
  text: string;
  voiceId: string;
  hits: number;
  currentQuality: AudioQuality;
  priority: number;
}

export interface CacheStats {
  totalEntries: number;
  nativeEntries: number;
  stitchedEntries: number;
  totalHits: number;
  totalSizeBytes: number;
  hitRate: number;
  pendingRegens: number;
  topWords: Array<{ text: string; hits: number; quality: AudioQuality }>;
}

export interface TTSCacheConfig {
  cacheDir: string;
  indexFile: string;
  maxSizeBytes: number;
  maxEntries: number;
  minHitsToKeep: number;
  autoPregenerate: boolean;
  pregenerateThreshold: number;
  regenThresholds: {
    word: number;       // hits para cachear palavra individual (native)
    bigram: number;     // hits para gerar áudio nativo de 2 palavras
    trigram: number;    // hits para gerar áudio nativo de 3 palavras
    phrase: number;     // hits para gerar áudio nativo de frase 4+ palavras
    sentence: number;   // hits para gerar áudio nativo de frase completa
  };
}

export const DEFAULT_CACHE_CONFIG: TTSCacheConfig = {
  cacheDir: "cache/audio",
  indexFile: "cache/tts-index.json",
  maxSizeBytes: 500 * 1024 * 1024,
  maxEntries: 10000,
  minHitsToKeep: 2,
  autoPregenerate: true,
  pregenerateThreshold: 3,
  regenThresholds: {
    word: 2,
    bigram: 3,
    trigram: 4,
    phrase: 5,
    sentence: 3,
  },
};
