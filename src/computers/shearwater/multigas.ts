// Multi-gas rules shared by the Shearwater models: the 3 GasNx mode (Perdix 2 and Peregrine TX
// Recreational manuals) and the Perdix 2 OC Tec mode (Technical manual), and their Select Gas menu.
import type { Gas } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';
import type { SettingDef } from '../base';

/** Dive modes simulated: single gas (Air / Nitrox), 3 GasNx, OC Tec (Perdix 2 only). */
export type SwMode = 'nitrox' | '3gasnx' | 'octec';

/**
 * Adv. Config 2, OC Deco PPO2: "All decompression predictions (Deco schedule and TTS) assume that the
 * gas used for decompression at a given depth will be the gas with the highest PPO2 that is less than
 * or equal to this value. (Default 1.61)". The manuals give the PPO2 limits in ATA (1 ATA = 1.013 bar);
 * the simulator applies them as bar, like the MOD PPO2 (about 1 % of the depth).
 */
export const OC_DECO_PPO2 = 1.61;

/** Adv. Config 2 OC Deco PPO2 setting (range not given by the manuals: 1.40 to 1.70 offered). */
export function decoPpo2Setting(showIf: (s: Record<string, string>) => boolean): SettingDef {
  return {
    key: 'decoPpo2',
    label: { fr: 'PPO2 de déco (OC Deco PPO2)', en: 'OC Deco PPO2' },
    options: [1.4, 1.45, 1.5, 1.55, 1.6, 1.61, 1.65, 1.7].map((v) => ({ value: v.toFixed(2), label: v.toFixed(2) })),
    default: '1.61',
    group: 'deco',
    showIf,
  };
}

/** Gas O2 % as Shearwater shows it: gases are set from 21 to 99 % O2 (Nitrox Gases, Define Gas). */
export function swO2(g: Gas): number {
  return Math.min(99, Math.round(g.o2 * 100));
}

/** Recreational modes gas name: "Air" for 21 % O2, "Nx" and the O2 % otherwise. */
export function nxName(g: Gas): string {
  const o2 = swO2(g);
  return o2 === 21 ? 'Air' : `Nx${o2}`;
}

/** Technical modes gas name: O2 / He fractions in percent, two digits each ("21/00", "18/45"). */
export function trimixName(g: Gas): string {
  return `${String(swO2(g)).padStart(2, '0')}/${String(Math.round(g.he * 100)).padStart(2, '0')}`;
}

/**
 * The best gas at the current depth: "the gas with the highest PPO2" that obeys its limit; "the least
 * oxygen rich mix is considered a bottom gas and obeys the OC MOD PPO2 limit. Other gases are
 * considered deco gases and obey Deco PPO2 limit" (Adv. Config 2). Null when no gas is breathable.
 */
export function bestGas(s: DiveSession, gases: Gas[], modPpo2: number, decoPpo2: number): number | null {
  const bottom = gases.reduce((b, g, i) => (g.o2 < gases[b].o2 ? i : b), 0);
  let best: number | null = null;
  gases.forEach((g, i) => {
    const limit = i === bottom ? modPpo2 : decoPpo2;
    if (s.pressure * g.o2 <= limit + 1e-9 && (best === null || g.o2 > gases[best].o2)) best = i;
  });
  return best;
}

/**
 * Main menu and Select Gas menu (Perdix 2 Technical manual §10, Recreational manuals §11): MENU (left)
 * steps through the items, SELECT / FUNC (right) acts on the item shown; "If no buttons are pushed for
 * 10 seconds, the menu system will time-out, returning to the main screen".
 *
 * Select Gas, classic style (Technical manual, default there): one gas at a time, "Gases are sorted
 * from highest O2% to lowest", "Upon entering the Select Gas menu, the first gas shown is always the
 * highest O2% gas", Next steps, "Stepping past the last gas will exit the menu without changing the
 * active gas". New style (Recreational manuals, 3 GasNx): every gas on the row, Next moves the pointer
 * ("scrolling past last gas wraps back to first gas"), "When a gas change is suggested, the
 * recommended best gas will be automatically queued up for selection", else the active gas.
 */
export class SwMenu {
  /** Item shown (index in the list given to the methods), null: menu closed. */
  item: number | null = null;
  /** Select Gas open: gas under the pointer (index in allGases). */
  gas: number | null = null;
  private last = 0;

  constructor(private readonly style: 'classic' | 'new') {}

  get open(): boolean {
    if (this.item !== null && performance.now() - this.last > 10_000) this.close();
    return this.item !== null;
  }

  close(): void {
    this.item = null;
    this.gas = null;
  }

  /** Gas indexes, highest O2 first. */
  static order(gases: Gas[]): number[] {
    return gases.map((_, i) => i).sort((a, b) => gases[b].o2 - gases[a].o2 || a - b);
  }

  /** MENU (left): opens the menu, next item, or next gas. `items`: the menu items of the moment. */
  menu(items: string[], gases: Gas[]): void {
    this.last = performance.now();
    if (this.item === null) {
      this.item = 0;
      return;
    }
    if (this.gas !== null) {
      const order = SwMenu.order(gases);
      const k = order.indexOf(this.gas) + 1;
      if (k < order.length) this.gas = order[k];
      else if (this.style === 'new') this.gas = order[0];
      else this.gas = null; // classic: past the last gas, back out of Select Gas
      return;
    }
    this.item += 1;
    if (this.item >= items.length) this.close();
  }

  /**
   * SELECT / FUNC (right) on the item `name`: enters Select Gas (`queued`: the gas pointed first in the
   * new style), or selects the gas under the pointer. Returns the gas selected, if any.
   */
  select(name: string, gases: Gas[], queued: number): number | null {
    this.last = performance.now();
    if (this.gas !== null) {
      const g = this.gas;
      this.close();
      return g;
    }
    if (name === 'Select Gas') this.gas = this.style === 'classic' ? SwMenu.order(gases)[0] : queued;
    return null;
  }
}
