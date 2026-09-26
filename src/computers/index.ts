import type { DiveComputer } from './base';
import { GarminDescent } from './garmin';
import { MaresPuck } from './mares';
import { ScubaproG2 } from './scubapro';
import { ShearwaterPerdix } from './shearwater';
import { SuuntoD5 } from './suunto';

export function createComputers(): DiveComputer[] {
  return [new ShearwaterPerdix(), new GarminDescent(), new SuuntoD5(), new MaresPuck(), new ScubaproG2()];
}

export type { ComputerView } from './base';
export { DiveComputer } from './base';
