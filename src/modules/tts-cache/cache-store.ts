import { resolve } from "path";
import { hashKey, normalize, tokenize } from "./hasher.ts";
import type { AudioQuality, CacheEntry, TTSCacheConfig, CacheStats } from "./types.ts";

export class CacheStore {
  private index = new Map<string, CacheEntry>();
  private config: TTSCacheConfig;
  private baseDir: string;
  private _language: string;
  private dirty = false;
  private totalLookups = 0;
  private totalHits = 0;

  constructor(config: TTSCacheConfig, baseDir: string, language = "pt") {
    this.config = config;
    this.baseDir = baseDir;
    this._language = language;
  }

  set language(lang: string) {
    this._language = lang;
  }

  get language(): string {
    return this._language;
  }

  private hash(text: string, voiceId: string): string {
    return hashKey(text, voiceId, this._language);
  }

  async load(): Promise<void> {
    try {
      const indexPath = resolve(this.baseDir, this.config.indexFile);
      const file = Bun.file(indexPath);
      const data = await file.json() as CacheEntry[];
      this.index.clear();
      for (const entry of data) {
        this.index.set(entry.key, entry);
      }
      console.log(`[Cache] Carregado: ${this.index.size} entradas`);
    } catch {
      console.log("[Cache] Índice novo (nenhum existente).");
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    const indexPath = resolve(this.baseDir, this.config.indexFile);
    const entries = Array.from(this.index.values());
    await Bun.write(indexPath, JSON.stringify(entries, null, 2));
    this.dirty = false;
  }

  get(text: string, voiceId: string): CacheEntry | undefined {
    this.totalLookups++;
    const key = this.hash(text, voiceId);
    const entry = this.index.get(key);

    if (entry) {
      entry.hits++;
      entry.lastUsed = Date.now();
      this.dirty = true;
      this.totalHits++;
      return entry;
    }

    return undefined;
  }

  async getAudio(text: string, voiceId: string): Promise<{ audio: Uint8Array; quality: AudioQuality } | null> {
    const entry = this.get(text, voiceId);
    if (!entry) return null;

    try {
      const filePath = resolve(this.baseDir, entry.audioFile);
      const file = Bun.file(filePath);
      return {
        audio: new Uint8Array(await file.arrayBuffer()),
        quality: entry.quality,
      };
    } catch {
      this.index.delete(entry.key);
      this.dirty = true;
      return null;
    }
  }

  async put(text: string, voiceId: string, audio: Uint8Array, quality: AudioQuality): Promise<CacheEntry> {
    const key = this.hash(text, voiceId);
    const audioFile = `${this.config.cacheDir}/${key}.mp3`;
    const filePath = resolve(this.baseDir, audioFile);

    const existing = this.index.get(key);
    const prevHits = existing?.hits ?? 0;

    await Bun.write(filePath, audio);

    const entry: CacheEntry = {
      key,
      text: normalize(text),
      audioFile,
      hits: prevHits + 1,
      lastUsed: Date.now(),
      createdAt: existing?.createdAt ?? Date.now(),
      sizeBytes: audio.length,
      voiceId,
      language: this._language,
      quality,
      wordCount: tokenize(text).length,
    };

    this.index.set(key, entry);
    this.dirty = true;

    await this.enforceLimit();
    return entry;
  }

  async upgrade(text: string, voiceId: string, audio: Uint8Array): Promise<CacheEntry> {
    return this.put(text, voiceId, audio, "native");
  }

  has(text: string, voiceId: string): boolean {
    return this.index.has(this.hash(text, voiceId));
  }

  getEntry(text: string, voiceId: string): CacheEntry | undefined {
    return this.index.get(this.hash(text, voiceId));
  }

  getQuality(text: string, voiceId: string): AudioQuality | null {
    return this.index.get(this.hash(text, voiceId))?.quality ?? null;
  }

  getHits(text: string, voiceId: string): number {
    return this.index.get(this.hash(text, voiceId))?.hits ?? 0;
  }

  getStitchedEntries(): CacheEntry[] {
    return Array.from(this.index.values())
      .filter((e) => e.quality === "stitched")
      .sort((a, b) => b.hits - a.hits);
  }

  getEntriesNeedingUpgrade(thresholds: TTSCacheConfig["regenThresholds"]): CacheEntry[] {
    return Array.from(this.index.values())
      .filter((e) => {
        if (e.quality === "native") return false;
        const threshold = this.thresholdForEntry(e, thresholds);
        return e.hits >= threshold;
      })
      .sort((a, b) => b.hits - a.hits);
  }

  private thresholdForEntry(entry: CacheEntry, thresholds: TTSCacheConfig["regenThresholds"]): number {
    if (entry.wordCount === 1) return thresholds.word;
    if (entry.wordCount === 2) return thresholds.bigram;
    if (entry.wordCount === 3) return thresholds.trigram;
    if (entry.wordCount <= 6) return thresholds.phrase;
    return thresholds.sentence;
  }

  getTopEntries(limit = 50): CacheEntry[] {
    return Array.from(this.index.values())
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);
  }

  getStats(): CacheStats {
    const entries = Array.from(this.index.values());
    const totalSizeBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
    const nativeEntries = entries.filter((e) => e.quality === "native").length;
    const stitchedEntries = entries.filter((e) => e.quality === "stitched").length;
    const pendingRegens = this.getEntriesNeedingUpgrade(this.config.regenThresholds).length;

    return {
      totalEntries: entries.length,
      nativeEntries,
      stitchedEntries,
      totalHits: this.totalHits,
      totalSizeBytes,
      hitRate: this.totalLookups > 0 ? this.totalHits / this.totalLookups : 0,
      pendingRegens,
      topWords: entries
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 20)
        .map((e) => ({ text: e.text, hits: e.hits, quality: e.quality })),
    };
  }

  private async enforceLimit(): Promise<void> {
    const entries = Array.from(this.index.values());

    if (entries.length > this.config.maxEntries) {
      const toRemove = entries
        .sort((a, b) => {
          if (a.quality !== b.quality) return a.quality === "stitched" ? -1 : 1;
          return a.lastUsed - b.lastUsed;
        })
        .filter((e) => e.hits < this.config.minHitsToKeep)
        .slice(0, entries.length - this.config.maxEntries);

      for (const entry of toRemove) await this.removeEntry(entry);
    }

    let totalSize = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
    if (totalSize > this.config.maxSizeBytes) {
      const sorted = entries.sort((a, b) => {
        const scoreA = a.hits / a.sizeBytes;
        const scoreB = b.hits / b.sizeBytes;
        return scoreA - scoreB;
      });

      for (const entry of sorted) {
        if (totalSize <= this.config.maxSizeBytes) break;
        totalSize -= entry.sizeBytes;
        await this.removeEntry(entry);
      }
    }
  }

  private async removeEntry(entry: CacheEntry): Promise<void> {
    try {
      const filePath = resolve(this.baseDir, entry.audioFile);
      const { unlink } = await import("fs/promises");
      await unlink(filePath);
    } catch { /* já não existe */ }
    this.index.delete(entry.key);
    this.dirty = true;
  }

  get size(): number {
    return this.index.size;
  }
}
