import type { DiveComputer } from './base';
import { GarminDescent } from './garmin';
import { CressiGoa } from './goa';
import { MaresPuck } from './mares';
import { MaresQuadCi } from './quadci';
import { ScubaproG2 } from './scubapro';
import { ShearwaterPerdix } from './shearwater';
import { SuuntoD5 } from './suunto';

export function createComputers(): DiveComputer[] {
  return [new ShearwaterPerdix(), new GarminDescent(), new SuuntoD5(), new MaresPuck(), new MaresQuadCi(), new ScubaproG2(), new CressiGoa()];
}

export type { ComputerView } from './base';
export { DiveComputer } from './base';
