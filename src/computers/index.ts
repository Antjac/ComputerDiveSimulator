import type { DiveComputer } from './base';
import { GarminDescent } from './garmin';
import { CressiGoa } from './goa';
import { MaresPuck } from './mares/puck';
import { MaresGenius } from './mares/genius';
import { MaresQuadAir } from './mares/quadair';
import { MaresQuadCi } from './mares/quadci';
import { ScubaproG2 } from './scubapro';
import { ShearwaterPerdix } from './shearwater';
import { SuuntoD5 } from './suunto';

/** Every simulated computer, in alphabetical order of name (the order of the lists and tables). */
export function createComputers(): DiveComputer[] {
  const all = [new ShearwaterPerdix(), new GarminDescent(), new SuuntoD5(), new MaresPuck(), new MaresQuadCi(), new MaresQuadAir(), new MaresGenius(), new ScubaproG2(), new CressiGoa()];
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/** Computer shown on a first visit. */
export const DEFAULT_COMPUTER = 'shearwater';

export type { ComputerView } from './base';
export { DiveComputer } from './base';
