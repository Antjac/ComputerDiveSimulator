/**
 * Messages that stay on the screen until any button is pressed. Each render pass starts with
 * `begin()`, then asks `show(key, on)` for every message; a button press acknowledges the messages
 * shown in the last pass (`ackAll()`). A message whose condition went off is re-armed.
 */
export class Acks {
  private acked = new Set<string>();
  private pending: string[] = [];

  begin(): void {
    this.pending = [];
  }

  /** Should the message be shown (condition on and not acknowledged yet)? */
  show(key: string, on = true): boolean {
    if (!on) {
      this.acked.delete(key);
      return false;
    }
    if (this.acked.has(key)) return false;
    this.pending.push(key);
    return true;
  }

  ackAll(): void {
    for (const k of this.pending) this.acked.add(k);
  }

  clear(): void {
    this.acked.clear();
  }
}
