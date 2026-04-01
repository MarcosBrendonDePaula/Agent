import { Synthesizer } from "./synthesizer.ts";
import { AudioPlayer } from "./player.ts";
import { PriorityQueue } from "./priority-queue.ts";
import type { TTSConfig, TTSRequest, TTSResult, TTSEvents } from "./types.ts";

export type OnAudioGenerated = (text: string, audio: Uint8Array) => void | Promise<void>;
export type CacheResolver = (text: string) => Promise<Uint8Array | null>;

export class TTSPipeline {
  private synthesizer: Synthesizer;
  private player: AudioPlayer;
  private events: Partial<TTSEvents>;
  private queue: PriorityQueue;
  private concurrency: number;
  private activeJobs = 0;
  private activeRequests = new Map<string, { abort: AbortController }>();
  private results: TTSResult[] = [];
  private playQueue: TTSResult[] = [];
  private onAudioGenerated: OnAudioGenerated | null = null;
  private cacheResolver: CacheResolver | null = null;
  private playingNow = false;
  private paused = false;
  private skipCurrent = false;
  private drainResolve: (() => void) | null = null;
  private counter = 0;

  constructor(config: TTSConfig, events: Partial<TTSEvents>, concurrency = 2) {
    this.synthesizer = new Synthesizer(config);
    this.player = new AudioPlayer(config.ffmpegPath);
    this.events = events;
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
  }

  speak(text: string, priority = 0): string {
    const id = `tts-${++this.counter}`;
    const request: TTSRequest = {
      id,
      text,
      timestamp: Date.now(),
      priority,
    };

    this.queue.enqueue(request);

    console.log(
      `[TTS] + "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}" (${id}, p:${priority}) | Fila: ${this.queue.length} | Ativo: ${this.activeJobs}`,
    );

    this.events.onQueueChange?.(this.pending);
    this.processNext();
    return id;
  }

  cancel(id: string): boolean {
    const removed = this.queue.remove(id);
    if (removed) {
      this.events.onQueueChange?.(this.pending);
      return true;
    }

    const active = this.activeRequests.get(id);
    if (active) {
      active.abort.abort();
      return true;
    }

    const playIdx = this.playQueue.findIndex((r) => r.id === id);
    if (playIdx !== -1) {
      this.playQueue.splice(playIdx, 1);
      return true;
    }

    return false;
  }

  promote(id: string, newPriority: number): boolean {
    const ok = this.queue.promote(id, newPriority);
    if (ok) this.events.onQueueChange?.(this.pending);
    return ok;
  }

  moveToFront(id: string): boolean {
    const ok = this.queue.moveToFront(id);
    if (ok) this.events.onQueueChange?.(this.pending);
    return ok;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.processNext();
    this.playNext();
  }

  skip(): void {
    this.skipCurrent = true;
  }

  private processNext(): void {
    if (this.paused) return;
    while (this.activeJobs < this.concurrency && this.queue.length > 0) {
      const request = this.queue.dequeue()!;
      this.activeJobs++;
      this.events.onQueueChange?.(this.pending);
      this.processRequest(request);
    }
  }

  private async processRequest(request: TTSRequest): Promise<void> {
    const abort = new AbortController();
    this.activeRequests.set(request.id, { abort });

    try {
      this.events.onSpeechStart?.(request);
      const start = Date.now();

      // 1. tenta cache primeiro
      let audio: Uint8Array | null = null;
      let fromCache = false;

      if (this.cacheResolver) {
        audio = await this.cacheResolver(request.text);
        if (audio) {
          fromCache = true;
          console.log(`[TTS] CACHE HIT: ${request.id} (0ms)`);
        }
      }

      // 2. se não tem cache, chama API
      if (!audio) {
        audio = await this.synthesizer.synthesize(request.text);
        console.log(`[TTS] API: ${request.id} (${Date.now() - start}ms)`);
      }

      if (abort.signal.aborted) return;

      const result: TTSResult = {
        id: request.id,
        text: request.text,
        audio,
        durationMs: Date.now() - start,
        timestamp: request.timestamp,
      };

      this.results.push(result);
      this.events.onSpeechReady?.(result);

      // salva no cache se veio da API
      if (!fromCache && this.onAudioGenerated) {
        Promise.resolve(this.onAudioGenerated(request.text, audio)).catch(() => {});
      }

      this.playQueue.push(result);
      this.playQueue.sort((a, b) => a.timestamp - b.timestamp);
      this.playNext();
    } catch (error) {
      if (!abort.signal.aborted) {
        this.events.onError?.(error as Error, request);
      }
    } finally {
      this.activeRequests.delete(request.id);
      this.activeJobs--;
      this.events.onQueueChange?.(this.pending);
      this.processNext();
      this.checkDrain();
    }
  }

  private async playNext(): Promise<void> {
    if (this.playingNow || this.paused || this.playQueue.length === 0) return;

    this.playingNow = true;

    while (this.playQueue.length > 0) {
      if (this.paused) break;

      const result = this.playQueue.shift()!;
      this.skipCurrent = false;

      console.log(`[TTS] ▶ "${result.text.slice(0, 40)}${result.text.length > 40 ? "..." : ""}" (${result.id})`);

      this.events.onPlayStart?.(result.id);
      await this.player.play(result.audio, () => this.skipCurrent);
      this.events.onPlayEnd?.(result.id);

      this.events.onSpeechEnd?.(result.id);
    }

    this.playingNow = false;
    this.checkDrain();
  }

  private checkDrain(): void {
    if (
      this.activeJobs === 0 &&
      this.queue.length === 0 &&
      !this.playingNow &&
      this.playQueue.length === 0 &&
      this.drainResolve
    ) {
      this.drainResolve();
      this.drainResolve = null;
    }
  }

  clear(): TTSRequest[] {
    const cleared = this.queue.clear();
    this.events.onQueueChange?.(0);
    return cleared;
  }

  async drain(): Promise<void> {
    if (this.activeJobs === 0 && this.queue.length === 0 && !this.playingNow && this.playQueue.length === 0) return;
    return new Promise((resolve) => {
      this.drainResolve = resolve;
    });
  }

  getQueue(): TTSRequest[] {
    return this.queue.list();
  }

  setOnAudioGenerated(fn: OnAudioGenerated): void {
    this.onAudioGenerated = fn;
  }

  setCacheResolver(fn: CacheResolver): void {
    this.cacheResolver = fn;
  }

  get pending(): number {
    return this.queue.length + this.activeJobs + this.playQueue.length;
  }

  get isPlaying(): boolean {
    return this.playingNow;
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
