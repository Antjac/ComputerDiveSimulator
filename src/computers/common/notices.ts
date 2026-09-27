// Notifications shown until acknowledged (Perdix 2 errors, Suunto D5 warnings and notifications):
// a notice appears when its condition newly occurs, stays after the condition is gone, and is
// dismissed by a button press, highest priority first. A condition that lasts does not bring back a
// notice once dismissed; it has to clear and occur again.

export class Notices<K extends string> {
  private pending = new Set<K>();
  private was = new Set<K>();

  /** `order`: highest priority first. */
  constructor(private order: readonly K[]) {}

  /** Conditions true now (called every tick). */
  update(now: Iterable<K>): void {
    const set = new Set(now);
    for (const k of set) if (!this.was.has(k)) this.pending.add(k);
    this.was = set;
  }

  /** The notice on display (highest priority), if any. */
  get top(): K | undefined {
    return this.order.find((k) => this.pending.has(k));
  }

  /** All notices waiting, highest priority first. */
  get all(): K[] {
    return this.order.filter((k) => this.pending.has(k));
  }

  /** Dismisses the notice on display; false when there was none. */
  dismiss(): boolean {
    const k = this.top;
    if (k === undefined) return false;
    this.pending.delete(k);
    return true;
  }

  clear(): void {
    this.pending.clear();
    this.was.clear();
  }
}
