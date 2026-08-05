/**
 * Thread-safe counters for health audit (never fed back into behavior).
 */

export class Metrics {
  private readonly counters = new Map<string, number>();

  incr(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}
