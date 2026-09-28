import type { DiveComputer } from './base';
import { GarminDescent } from './garmin';
import { CressiDonatello } from './cressi/donatello';
import { CressiGoa } from './cressi/goa';
import { MaresPuck } from './mares/puck';
import { MaresGenius } from './mares/genius';
import { MaresQuadAir } from './mares/quadair';
import { MaresQuadCi } from './mares/quadci';
import { ScubaproG2 } from './scubapro/g2';
import { ScubaproLuna } from './scubapro/luna';
import { ShearwaterPerdix } from './shearwater';
import { SuuntoD5 } from './suunto/d5';
import { SuuntoZoopNovo } from './suunto/zoopnovo';

/** Every simulated computer, in alphabetical order of name (the order of the lists and tables). */
export function createComputers(): DiveComputer[] {
  const all = [new ShearwaterPerdix(), new GarminDescent(), new SuuntoD5(), new MaresPuck(), new MaresQuadCi(), new MaresQuadAir(), new MaresGenius(), new ScubaproG2(), new ScubaproLuna(), new CressiGoa(), new CressiDonatello(), new SuuntoZoopNovo()];
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

/** Computer shown on a first visit. */
export const DEFAULT_COMPUTER = 'shearwater';

export type { ComputerView } from './base';
export { DiveComputer } from './base';
