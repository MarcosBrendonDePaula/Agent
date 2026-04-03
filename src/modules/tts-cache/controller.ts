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
  // Usado pelo TTS pipeline como cacheResolver
  // 1. Match exato (hash) → O(1)
  // 2. Match fuzzy (similaridade >= 85%) → scan linear, mas só se falhou o exato
  async resolveAudio(text: string, voiceId: string): Promise<Uint8Array | null> {
    this.tracker.trackSentence(text);

    // 1. match exato
    const cached = await this.store.getAudio(text, voiceId);
    if (cached && cached.quality === "native") {
      console.log(`[Cache] HIT exato: "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`);
      return cached.audio;
    }

    // 2. match fuzzy — frases parecidas (variações de transcrição)
    const fuzzy = await this.store.fuzzyGetAudio(text, voiceId, 0.85);
    if (fuzzy) {
      console.log(`[Cache] HIT fuzzy: "${text.slice(0, 35)}..." ≈ "${fuzzy.matchedText.slice(0, 35)}..."`);
      return fuzzy.audio;
    }

    // 3. stitching — monta a frase a partir de pedaços cacheados
    const build = await this.builder.tryBuildFromCache(text, voiceId);
    if (build.fullyCached && build.fragments.length > 0) {
      const stitched = this.concatAudioBuffers(build.fragments.map(f => f.audio));
      console.log(`[Cache] HIT stitched: "${text.slice(0, 40)}..." (${build.fragments.length} fragmentos, ${Math.round(build.cacheHitRatio * 100)}%)`);
      // armazena o stitched pra próximo lookup ser mais rápido
      await this.storeStitched(text, voiceId, stitched);
      return stitched;
    }

    // agenda upgrades em background
    if (this.config.autoPregenerate) {
      this.checkForUpgrades(text, voiceId);
    }

    return null;
  }

  // Concatena buffers de áudio MP3 (simples: append dos buffers)
  private concatAudioBuffers(buffers: Uint8Array[]): Uint8Array {
    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      result.set(buf, offset);
      offset += buf.length;
    }
    return result;
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

  // --- Auto-upgrade: SÓ frases completas stitched → native ---

  private checkForUpgrades(text: string, voiceId: string): void {
    const norm = normalize(text);
    const { regenThresholds } = this.config;

    // Só regenera frases completas que foram realmente faladas e estão stitched
    const entry = this.store.getEntry(norm, voiceId);
    if (entry && entry.quality === "stitched" && entry.hits >= regenThresholds.sentence) {
      this.enqueueRegen(norm, voiceId, entry.hits);
      this.processRegenQueue();
    }
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
