import { Transcriber } from "./transcriber.ts";
import { VAD } from "./vad.ts";
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
  private silenceThreshold: number;
  private minVoiceRatio: number;
  private skippedCount = 0;
  private mergedCount = 0;
  private _muted = false;

  constructor(
    config: VoiceCaptureConfig,
    events: Partial<VoiceCaptureEvents>,
    concurrency = 2,
  ) {
    this.transcriber = new Transcriber(config);
    this.events = events;
    this.concurrency = concurrency;
    this.silenceThreshold = config.vadThreshold ?? 0.02;
    this.minVoiceRatio = config.vadMinVoiceRatio ?? 0.03;
  }

  mute(): void { this._muted = true; }
  unmute(): void { this._muted = false; }
  get isMuted(): boolean { return this._muted; }

  push(data: Uint8Array, capturerId: CapturerId, durationMs: number, confirmedSpeech = false): void {
    // muted = TTS está reproduzindo, descarta pra evitar eco
    if (this._muted) {
      console.log(`[Pipeline] Muted (TTS reproduzindo) | descartado (Capturer ${capturerId})`);
      return;
    }

    // VAD: analisa conteúdo de voz no buffer
    const voiceRatio = VAD.voiceRatio(data, this.silenceThreshold);

    // se o capturer NÃO confirmou speech E voiceRatio é baixo → descarta
    // se o capturer confirmou speech, confia nele (pode ter ratio baixo em buffer longo)
    if (!confirmedSpeech && voiceRatio < this.minVoiceRatio) {
      this.skippedCount++;
      console.log(
        `[Pipeline] Silêncio descartado (Capturer ${capturerId}) | voz: ${Math.round(voiceRatio * 100)}% | Economizados: ${this.skippedCount} requests`,
      );
      this.events.onSilence?.(capturerId);
      return;
    }

    const segment: AudioSegment = {
      data,
      capturerId,
      timestamp: Date.now(),
      durationMs,
    };

    this.queue.push(segment);

    // tenta merge se tem múltiplos segmentos esperando e nenhum job ativo
    if (this.queue.length > 1 && this.activeJobs === 0) {
      this.mergeQueue();
    }

    console.log(
      `[Pipeline] Enfileirado (Capturer ${capturerId}) | voz: ${Math.round(voiceRatio * 100)}% | ${durationMs}ms | Fila: ${this.queue.length} | Ativo: ${this.activeJobs}`,
    );

    this.processNext();
  }

  private mergeQueue(): void {
    if (this.queue.length < 2) return;

    // calcula tamanho total - Whisper aceita até 25MB / ~30min
    const totalBytes = this.queue.reduce((s, seg) => s + seg.data.length, 0);
    const totalDuration = this.queue.reduce((s, seg) => s + seg.durationMs, 0);

    // limite: max 60s ou 5MB por merge (margem segura)
    if (totalDuration > 60000 || totalBytes > 5 * 1024 * 1024) return;

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    const firstTimestamp = this.queue[0]!.timestamp;
    const firstCapturer = this.queue[0]!.capturerId;

    for (const seg of this.queue) {
      merged.set(seg.data, offset);
      offset += seg.data.length;
    }

    const mergedCount = this.queue.length;
    this.mergedCount += mergedCount - 1;

    this.queue = [{
      data: merged,
      capturerId: firstCapturer,
      timestamp: firstTimestamp,
      durationMs: totalDuration,
    }];

    console.log(
      `[Pipeline] Merge: ${mergedCount} segmentos → 1 (${totalDuration}ms, ${(totalBytes / 1024).toFixed(0)}KB) | Requests economizados: ${this.mergedCount}`,
    );
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

  get savedRequests(): number {
    return this.skippedCount + this.mergedCount;
  }
}
