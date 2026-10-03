// Gas switch prompt of the multi-gas models: during the ascent, once the diver is shallower than the
// switch depth (MOD) of a richer programmed gas, the computer offers it; the diver accepts (the gas
// becomes the one breathed) or declines, or the offer expires. Each model shows it its own way and
// cites its manual; a gas is offered again only after the diver went back deeper than its MOD.
import type { DiveSession } from '../../engine/session';

export class GasPrompt {
  /**
   * `sticky`: a declined gas stays out of the calculation for the rest of the dive, without a new offer,
   * until the diver switches to it by hand (Scubapro: "you will finish the dive without using the
   * excluded gas", G2 §3.4.2, Luna §3.19.3); otherwise going back below its MOD includes it again (Mares).
   */
  constructor(private readonly sticky = false) {}

  /** Gas offered now (index in DiveSession.allGases), or null. */
  offer: number | null = null;
  /** Gases declined (or whose offer expired) since the diver was last deeper than their MOD. */
  readonly declined = new Set<number>();
  private at = 0;
  /** Gases that may be offered: the diver has been deeper than their switch depth. */
  private armed = new Set<number>();

  reset(): void {
    this.offer = null;
    this.declined.clear();
    this.armed.clear();
  }

  /**
   * `mods`: switch depth of each programmed gas (index as in allGases; the first, the bottom gas, is
   * ignored); `timeout`: seconds before an unanswered offer expires (null: never).
   * Returns the gases whose offer just expired, and those back in the plan after a dive below their MOD.
   */
  update(s: DiveSession, mods: number[], timeout: number | null): { expired: number | null; included: number[] } {
    const included: number[] = [];
    // A gas switched to by hand is in use again.
    this.declined.delete(s.breathing);
    for (let i = 1; i < mods.length; i++) {
      if (this.sticky && this.declined.has(i)) continue;
      if (s.depth > mods[i] + 0.3) {
        this.armed.add(i);
        if (this.declined.delete(i)) included.push(i);
      }
    }
    let expired: number | null = null;
    if (this.offer !== null) {
      const o = this.offer;
      if (s.breathing === o || s.depth > mods[o] + 0.3 || !s.inDive) this.offer = null;
      else if (timeout !== null && s.clock - this.at > timeout) {
        this.declined.add(o);
        this.offer = null;
        expired = o;
      }
      return { expired, included };
    }
    if (!s.inDive) return { expired, included };
    const gases = s.allGases;
    const cur = gases[s.breathing]?.o2 ?? 0;
    let best: number | null = null;
    for (let i = 1; i < mods.length; i++) {
      if (!this.armed.has(i) || i === s.breathing || gases[i].o2 <= cur + 1e-9 || s.depth > mods[i]) continue;
      if (best === null || gases[i].o2 > gases[best].o2) best = i;
    }
    if (best !== null) {
      this.offer = best;
      this.at = s.clock;
      this.armed.delete(best);
    }
    return { expired, included };
  }

  /** The diver accepts the gas offered. */
  accept(s: DiveSession): void {
    if (this.offer !== null) s.switchGas(this.offer);
    this.offer = null;
  }

  /** The diver declines it (stays on the current gas). */
  decline(): void {
    if (this.offer !== null) this.declined.add(this.offer);
    this.offer = null;
  }
}
