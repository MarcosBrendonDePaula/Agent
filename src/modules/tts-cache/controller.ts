import { resolve } from "path";
import { CacheStore } from "./cache-store.ts";
import { WordTracker } from "./word-tracker.ts";
import { SentenceBuilder, type BuildResult } from "./sentence-builder.ts";
import { RegenQueue } from "./regen-queue.ts";
import { tokenize, normalize } from "./hasher.ts";
import { DEFAULT_CACHE_CONFIG, type TTSCacheConfig, type CacheStats, type RegenRequest } from "./types.ts";

export class TTSCacheController {
  private store: CacheStore;
  private tracker: WordTracker;
  private builder: SentenceBuilder;
  private regenQueue: RegenQueue;
  private config: TTSCacheConfig;
  private baseDir: string;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private synthesizeFn: ((text: string) => Promise<Uint8Array>) | null = null;
  private regenRunning = false;
  private regenConcurrency = 1; // 1 por vez - não compete com TTS principal
  private regenDelayMs = 500; // delay entre regens para não saturar a API

  constructor(config: Partial<TTSCacheConfig> = {}, baseDir = process.cwd(), language = "pt") {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.baseDir = baseDir;
    this.store = new CacheStore(this.config, this.baseDir, language);
    this.tracker = new WordTracker();
    this.builder = new SentenceBuilder(this.store);
    this.regenQueue = new RegenQueue();
  }

  async init(): Promise<void> {
    await this.store.load();
    await this.loadTracker();
    this.autoSaveTimer = setInterval(() => this.save(), 30000);
    console.log(`[TTS Cache] Inicializado: ${this.store.size} entradas`);
  }

  async shutdown(): Promise<void> {
    this.regenRunning = false;
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    await this.save();
    console.log("[TTS Cache] Salvo e encerrado.");
  }

  // registra a função de síntese do módulo TTS para re-geração
  setSynthesizer(fn: (text: string) => Promise<Uint8Array>): void {
    this.synthesizeFn = fn;
  }

  // --- Lookup (usado pelo TTS antes de chamar a API) ---

  async lookup(text: string, voiceId: string): Promise<BuildResult> {
    this.tracker.trackSentence(text);

    const result = await this.builder.tryBuildFromCache(text, voiceId);

    // analisa se precisa agendar re-geração
    if (this.config.autoPregenerate) {
      this.checkForUpgrades(text, voiceId);
    }

    return result;
  }

  // Lookup rápido: retorna áudio native direto ou null
  // Usado pelo TTS pipeline como cacheResolver - O(1) hash lookup
  async resolveAudio(text: string, voiceId: string): Promise<Uint8Array | null> {
    this.tracker.trackSentence(text);

    // só retorna se for native (frase completa com áudio bom)
    const cached = await this.store.getAudio(text, voiceId);
    if (cached && cached.quality === "native") {
      return cached.audio;
    }

    // agenda upgrades em background
    if (this.config.autoPregenerate) {
      this.checkForUpgrades(text, voiceId);
    }

    return null;
  }

  // --- Idioma ---

  setLanguage(language: string): void {
    this.store.language = language;
    console.log(`[TTS Cache] Idioma alterado: ${language}`);
  }

  // --- Store (TTS chama após gerar um áudio novo) ---

  async storeNative(text: string, voiceId: string, audio: Uint8Array): Promise<void> {
    await this.store.put(text, voiceId, audio, "native");
    console.log(`[Cache] +native "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`);
  }

  async storeStitched(text: string, voiceId: string, audio: Uint8Array): Promise<void> {
    await this.store.put(text, voiceId, audio, "stitched");
  }

  has(text: string, voiceId: string): boolean {
    return this.store.has(text, voiceId);
  }

  isNative(text: string, voiceId: string): boolean {
    return this.builder.isNative(text, voiceId);
  }

  // --- Auto-upgrade: detecta o que precisa re-gerar ---

  private checkForUpgrades(text: string, voiceId: string): void {
    const norm = normalize(text);
    const words = tokenize(norm);
    const { regenThresholds } = this.config;

    // NUNCA gera via API para palavras soltas - não vale o custo
    // Palavras só entram no cache quando vêm como parte de um áudio maior

    // frase completa (2+ palavras): se repetiu muito e ainda é stitched, upgrade
    if (words.length >= 2) {
      const sentenceEntry = this.store.getEntry(norm, voiceId);
      if (sentenceEntry && sentenceEntry.quality === "stitched" && sentenceEntry.hits >= regenThresholds.sentence) {
        this.enqueueRegen(norm, voiceId, sentenceEntry.hits);
      }
    }

    // bigrams: combinações frequentes de 2 palavras
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = words.slice(i, i + 2).join(" ");
      const phraseCount = this.tracker.getPhraseCount(bigram);
      const entry = this.store.getEntry(bigram, voiceId);
      if (phraseCount >= regenThresholds.bigram && (!entry || entry.quality === "stitched")) {
        this.enqueueRegen(bigram, voiceId, phraseCount);
      }
    }

    // trigrams
    for (let i = 0; i < words.length - 2; i++) {
      const trigram = words.slice(i, i + 3).join(" ");
      const phraseCount = this.tracker.getPhraseCount(trigram);
      const entry = this.store.getEntry(trigram, voiceId);
      if (phraseCount >= regenThresholds.trigram && (!entry || entry.quality === "stitched")) {
        this.enqueueRegen(trigram, voiceId, phraseCount);
      }
    }

    // frases maiores (4-6 palavras)
    if (words.length >= 4) {
      for (let size = Math.min(words.length, 6); size >= 4; size--) {
        for (let i = 0; i <= words.length - size; i++) {
          const phrase = words.slice(i, i + size).join(" ");
          const phraseCount = this.tracker.getPhraseCount(phrase);
          const entry = this.store.getEntry(phrase, voiceId);
          if (phraseCount >= regenThresholds.phrase && (!entry || entry.quality === "stitched")) {
            this.enqueueRegen(phrase, voiceId, phraseCount);
          }
        }
      }
    }

    // inicia processamento da fila de regen se não está rodando
    this.processRegenQueue();
  }

  private enqueueRegen(text: string, voiceId: string, hits: number): void {
    const currentQuality = this.store.getQuality(text, voiceId) ?? "stitched";
    const added = this.regenQueue.enqueue({
      text,
      voiceId,
      hits,
      currentQuality,
      priority: hits,
    });
    if (added) {
      console.log(`[Cache Regen] Agendado: "${text}" (hits: ${hits}, ${currentQuality} → native)`);
    }
  }

  private async processRegenQueue(): Promise<void> {
    if (this.regenRunning || !this.synthesizeFn) return;
    if (this.regenQueue.length === 0) return;

    this.regenRunning = true;

    // processa 1 por vez com delay entre cada - não compete com TTS principal
    while (this.regenQueue.length > 0 && this.regenRunning) {
      const req = this.regenQueue.dequeue()!;
      await this.processRegen(req);

      // pausa entre regens para dar espaço ao TTS principal
      if (this.regenQueue.length > 0) {
        await new Promise((r) => setTimeout(r, this.regenDelayMs));
      }
    }

    this.regenRunning = false;
  }

  private async processRegen(req: RegenRequest): Promise<void> {
    try {
      console.log(`[Cache Regen] Gerando native: "${req.text}"`);
      const audio = await this.synthesizeFn!(req.text);
      await this.store.upgrade(req.text, req.voiceId, audio);
      console.log(`[Cache Regen] OK: "${req.text}" → native`);
    } catch (error) {
      console.error(`[Cache Regen] Erro: "${req.text}"`, (error as Error).message);
    } finally {
      this.regenQueue.done(req.text, req.voiceId);
    }
  }

  // --- Stats & Queries ---

  getStats(): CacheStats {
    return this.store.getStats();
  }

  getRegenQueue(): RegenRequest[] {
    return this.regenQueue.list();
  }

  getTopCached(limit = 20) {
    return this.store.getTopEntries(limit);
  }

  getFrequentWords(minCount = 3, limit = 50) {
    return this.tracker.getFrequentWords(minCount, limit);
  }

  getFrequentPhrases(minCount = 2, limit = 30) {
    return this.tracker.getFrequentPhrases(minCount, limit);
  }

  getUpgradePending(): number {
    return this.regenQueue.length + this.regenQueue.activeCount;
  }

  // --- Persistência ---

  async save(): Promise<void> {
    await this.store.save();
    await this.saveTracker();
  }

  private async loadTracker(): Promise<void> {
    try {
      const path = resolve(this.baseDir, "cache/word-tracker.json");
      const data = await Bun.file(path).json();
      this.tracker.deserialize(data);
      console.log("[TTS Cache] Word tracker carregado.");
    } catch { /* primeiro uso */ }
  }

  private async saveTracker(): Promise<void> {
    const path = resolve(this.baseDir, "cache/word-tracker.json");
    await Bun.write(path, JSON.stringify(this.tracker.serialize(), null, 2));
  }
}
