export class RateLimiter {
  private active = 0;
  private maxConcurrent: number;
  private waiters: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  get available(): number {
    return this.maxConcurrent - this.active;
  }

  get currentActive(): number {
    return this.active;
  }

  get waiting(): number {
    return this.waiters.length;
  }
}

// singleton global - ElevenLabs permite max 3 concurrent
export const elevenLabsLimiter = new RateLimiter(2); // usamos 2 para TTS, sobra 1 para regen
