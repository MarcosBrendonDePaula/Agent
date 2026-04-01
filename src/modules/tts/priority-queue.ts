import type { TTSRequest } from "./types.ts";

export class PriorityQueue {
  private items: TTSRequest[] = [];

  enqueue(request: TTSRequest): void {
    const idx = this.items.findIndex((r) => r.priority < request.priority);
    if (idx === -1) {
      this.items.push(request);
    } else {
      this.items.splice(idx, 0, request);
    }
  }

  dequeue(): TTSRequest | undefined {
    return this.items.shift();
  }

  remove(id: string): TTSRequest | undefined {
    const idx = this.items.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    return this.items.splice(idx, 1)[0];
  }

  promote(id: string, newPriority: number): boolean {
    const item = this.remove(id);
    if (!item) return false;
    item.priority = newPriority;
    this.enqueue(item);
    return true;
  }

  moveToFront(id: string): boolean {
    const item = this.remove(id);
    if (!item) return false;
    const maxPriority = this.items.length > 0 ? this.items[0]!.priority + 1 : 100;
    item.priority = maxPriority;
    this.items.unshift(item);
    return true;
  }

  peek(): TTSRequest | undefined {
    return this.items[0];
  }

  clear(): TTSRequest[] {
    const cleared = [...this.items];
    this.items = [];
    return cleared;
  }

  list(): TTSRequest[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }
}
