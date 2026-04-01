import type { RegenRequest } from "./types.ts";

export class RegenQueue {
  private queue: RegenRequest[] = [];
  private processing = new Set<string>();

  enqueue(request: RegenRequest): boolean {
    const key = `${request.voiceId}:${request.text}`;
    if (this.processing.has(key)) return false;
    if (this.queue.some((r) => r.text === request.text && r.voiceId === request.voiceId)) return false;

    // insere por prioridade (mais hits = mais prioritário)
    const idx = this.queue.findIndex((r) => r.priority < request.priority);
    if (idx === -1) {
      this.queue.push(request);
    } else {
      this.queue.splice(idx, 0, request);
    }
    return true;
  }

  dequeue(): RegenRequest | undefined {
    const item = this.queue.shift();
    if (item) {
      this.processing.add(`${item.voiceId}:${item.text}`);
    }
    return item;
  }

  done(text: string, voiceId: string): void {
    this.processing.delete(`${voiceId}:${text}`);
  }

  list(): RegenRequest[] {
    return [...this.queue];
  }

  get length(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.processing.size;
  }
}
