import { Transcriber } from "./transcriber.ts";
import type { CapturerId, TranscriptionResult, VoiceCaptureConfig, VoiceCaptureEvents } from "./types.ts";

interface AudioSegment {
  data: Uint8Array;
  capturerId: CapturerId;
  timestamp: number;
  durationMs: number;
}

export class TranscriptionPipeline {
  private transcriber: Transcriber;
  private events: Partial<VoiceCaptureEvents>;
  private queue: AudioSegment[] = [];
  private concurrency: number;
  private activeJobs = 0;
  private results: TranscriptionResult[] = [];
  private drainResolve: (() => void) | null = null;

  constructor(
    config: VoiceCaptureConfig,
    events: Partial<VoiceCaptureEvents>,
    concurrency = 2,
  ) {
    this.transcriber = new Transcriber(config);
    this.events = events;
    this.concurrency = concurrency;
  }

  push(data: Uint8Array, capturerId: CapturerId, durationMs: number): void {
    const segment: AudioSegment = {
      data,
      capturerId,
      timestamp: Date.now(),
      durationMs,
    };

    this.queue.push(segment);
    console.log(
      `[Pipeline] Segmento enfileirado (Capturer ${capturerId}) | Fila: ${this.queue.length} | Processando: ${this.activeJobs}`,
    );

    this.processNext();
  }

  private processNext(): void {
    while (this.activeJobs < this.concurrency && this.queue.length > 0) {
      const segment = this.queue.shift()!;
      this.activeJobs++;
      this.processSegment(segment);
    }
  }

  private async processSegment(segment: AudioSegment): Promise<void> {
    try {
      const text = await this.transcriber.transcribe(segment.data);

      if (text) {
        const result: TranscriptionResult = {
          text,
          duration: segment.durationMs,
          timestamp: segment.timestamp,
          capturerId: segment.capturerId,
        };

        this.results.push(result);
        this.events.onTranscription?.(result);
      } else {
        this.events.onSilence?.(segment.capturerId);
      }
    } catch (error) {
      this.events.onError?.(error as Error, segment.capturerId);
    } finally {
      this.activeJobs--;
      this.processNext();

      if (this.activeJobs === 0 && this.queue.length === 0 && this.drainResolve) {
        this.drainResolve();
        this.drainResolve = null;
      }
    }
  }

  async drain(): Promise<void> {
    if (this.activeJobs === 0 && this.queue.length === 0) return;
    return new Promise((resolve) => {
      this.drainResolve = resolve;
    });
  }

  getResults(): TranscriptionResult[] {
    return [...this.results].sort((a, b) => a.timestamp - b.timestamp);
  }

  getFullText(): string {
    return this.getResults()
      .map((r) => r.text)
      .join(" ");
  }

  get pending(): number {
    return this.queue.length + this.activeJobs;
  }
}
