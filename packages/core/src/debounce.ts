/** Groups bursts of calls per key: `fn` runs once, `delayMs` after the last call for that key. */
export class KeyedDebouncer {
  private readonly delayMs: number;
  private readonly fn: (key: string) => void;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(delayMs: number, fn: (key: string) => void) {
    this.delayMs = delayMs;
    this.fn = fn;
  }

  schedule(key: string): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.fn(key);
      }, this.delayMs),
    );
  }

  cancel(key: string): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.delete(key);
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
