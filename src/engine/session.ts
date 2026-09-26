import { AIR, Gas, Tissues, depthToPressure } from './buhlmann';
import { OxygenTracker } from './oxygen';

export const DIVE_START_DEPTH = 1.2; // m
export const DIVE_END_TIMEOUT = 180; // s spent at the surface before the dive is closed
const MAX_DESCENT = 25; // m/min the diver can physically reach
const MAX_ASCENT = 22; // m/min (deliberately above computer limits so alarms can be triggered)
const ACCEL = 0.15; // m/s²

export interface ProfileSample {
  t: number; // s since dive start
  depth: number;
  ceiling: number;
}

/** Scuba tank: water capacity (L), working/fill pressure and reserve (bar). */
export interface Tank {
  volume: number;
  fill: number;
  reserve: number;
}

export interface DiveLogEntry {
  number: number;
  start: number; // session clock (s)
  duration: number; // s
  maxDepth: number;
  avgDepth: number;
  gas: Gas;
  minTemp: number;
  surfaceIntervalBefore: number | null; // s
  profile: ProfileSample[];
  cnsEnd: number;
  tankStart: number; // bar
  tankEnd: number; // bar
  gasUsed: number; // surface litres
  alarms: string[];
}

/** Water temperature model: warm surface layer, thermocline around 12–18 m. */
export function waterTemperature(depth: number): number {
  const surface = 24;
  const deep = 14;
  const x = (depth - 15) / 4;
  return deep + (surface - deep) / (1 + Math.exp(x)) - Math.min(1.5, Math.max(0, depth - 30) * 0.03);
}

/**
 * Physical state of the diver: depth, time, gas and tissue loading. Dive computers read this
 * state; they never change it.
 */
export class DiveSession {
  tissues = new Tissues();
  oxygen = new OxygenTracker();
  gas: Gas = { ...AIR };

  clock = 0; // s, total simulated time
  depth = 0;
  targetDepth = 0;
  velocity = 0; // m/s, positive = descending
  siteDepth = 40;
  /** Depth of whatever lies under the diver (seabed, wreck…), set by the 3D view; the diver rests on it. */
  seabed = Infinity;

  inDive = false;
  diveNumber = 0;
  diveStart = 0;
  diveTime = 0; // s
  maxDepth = 0;
  depthIntegral = 0;
  minTemp = 99;
  surfaceTimer = 0; // s at the surface during a dive
  lastDiveEnd: number | null = null;
  profile: ProfileSample[] = [];
  log: DiveLogEntry[] = [];
  diveAlarms = new Set<string>();
  /** Current ceiling reported by the active computer, stored in the profile. */
  reportedCeiling = 0;

  // Gas supply.
  tank: Tank = { volume: 12, fill: 200, reserve: 50 };
  /** Wireless tank transmitter paired with the computer (used when the model supports one). */
  transmitterOn = true;
  /** Surface respiratory minute volume (RMV / "SAC"), in litres per minute. */
  rmv = 20;
  tankPressure = 200;
  private tankAtStart = 200;
  private gasUsed = 0;
  /** Recent tank pressure samples [clock s, bar], used by computers to measure the breathing rate. */
  pressureHistory: [number, number][] = [];
  private historyTimer = 0;

  private sampleTimer = 0;
  private listeners: Array<(e: 'start' | 'end') => void> = [];

  on(fn: (e: 'start' | 'end') => void): void {
    this.listeners.push(fn);
  }

  get pressure(): number {
    return depthToPressure(this.depth);
  }

  get ppO2(): number {
    return this.pressure * this.gas.o2;
  }

  get temperature(): number {
    return waterTemperature(this.depth);
  }

  get avgDepth(): number {
    return this.diveTime > 0 ? this.depthIntegral / this.diveTime : 0;
  }

  /** Vertical speed in m/min, positive when ascending (dive computer convention). */
  get ascentRate(): number {
    return -this.velocity * 60;
  }

  get surfaceInterval(): number | null {
    if (this.inDive || this.lastDiveEnd === null) return null;
    return this.clock - this.lastDiveEnd;
  }

  setTarget(depth: number): void {
    this.targetDepth = Math.min(this.siteDepth, Math.max(0, depth));
  }

  canChangeGas(): boolean {
    return !this.inDive;
  }

  /** Advance the simulation by dt seconds (dt should be ≤ 1 s). */
  step(dt: number): void {
    const prevDepth = this.depth;

    // Diver kinematics: head toward the target depth with limited speed and acceleration.
    const bottom = Math.min(this.siteDepth, this.seabed);
    const diff = Math.min(this.targetDepth, bottom) - this.depth;
    const maxV = diff > 0 ? MAX_DESCENT / 60 : MAX_ASCENT / 60;
    // Braking curve v = sqrt(2·a·d) so the diver stops on the target without overshooting.
    const desired = Math.sign(diff) * Math.min(maxV, Math.sqrt(2 * ACCEL * 0.8 * Math.abs(diff)), Math.abs(diff) / Math.max(dt, 0.5));
    const dv = desired - this.velocity;
    this.velocity += Math.sign(dv) * Math.min(Math.abs(dv), ACCEL * dt);
    // Never sink below the bottom; if it rose above the diver, the kinematics above bring them up.
    this.depth = Math.min(Math.max(bottom, prevDepth), Math.max(0, this.depth + this.velocity * dt));
    if (this.depth === 0 && this.velocity < 0) this.velocity = 0;
    if (this.depth >= bottom && this.velocity > 0) this.velocity = 0;

    const minutes = dt / 60;
    this.tissues.exposeLinear(depthToPressure(prevDepth), depthToPressure(this.depth), this.gas, minutes);
    this.oxygen.expose(this.ppO2, minutes);
    this.breathe(prevDepth, minutes, dt);
    this.clock += dt;

    if (!this.inDive && this.depth > DIVE_START_DEPTH) this.startDive();

    if (this.inDive) {
      this.diveTime += dt;
      this.depthIntegral += this.depth * dt;
      this.maxDepth = Math.max(this.maxDepth, this.depth);
      this.minTemp = Math.min(this.minTemp, this.temperature);
      this.sampleTimer += dt;
      if (this.sampleTimer >= 5) {
        this.sampleTimer = 0;
        this.profile.push({ t: this.diveTime, depth: this.depth, ceiling: this.reportedCeiling });
      }
      if (this.depth < DIVE_START_DEPTH) {
        this.surfaceTimer += dt;
        if (this.surfaceTimer >= DIVE_END_TIMEOUT) this.endDive();
      } else {
        this.surfaceTimer = 0;
      }
    }
  }

  /** Gas consumption: RMV scaled by ambient pressure, drawn from the tank. */
  private breathe(prevDepth: number, minutes: number, dt: number): void {
    const inWater = Math.max(prevDepth, this.depth) > 0.5;
    if (inWater && this.tankPressure > 0) {
      const pAtm = depthToPressure((prevDepth + this.depth) / 2) / 1.01325;
      const liters = this.rmv * pAtm * minutes;
      this.gasUsed += liters;
      this.tankPressure = Math.max(0, this.tankPressure - liters / this.tank.volume);
    }
    this.historyTimer += dt;
    if (this.historyTimer >= 5) {
      this.historyTimer = 0;
      this.pressureHistory.push([this.clock, this.tankPressure]);
      if (this.pressureHistory.length > 60) this.pressureHistory.shift();
    }
  }

  /** Fresh tank (done automatically when a new dive starts after the previous one was closed). */
  refillTank(): void {
    this.tankPressure = this.tank.fill;
    this.pressureHistory = [];
  }

  get outOfGas(): boolean {
    return this.tankPressure <= 0;
  }

  private startDive(): void {
    if (this.lastDiveEnd !== null) this.refillTank();
    this.tankAtStart = this.tankPressure;
    this.gasUsed = 0;
    this.inDive = true;
    this.diveNumber += 1;
    this.diveStart = this.clock;
    this.diveTime = 0;
    this.maxDepth = 0;
    this.depthIntegral = 0;
    this.minTemp = 99;
    this.surfaceTimer = 0;
    this.sampleTimer = 0;
    this.profile = [{ t: 0, depth: 0, ceiling: 0 }];
    this.diveAlarms.clear();
    this.listeners.forEach((l) => l('start'));
  }

  private endDive(): void {
    // The dive ends when the diver surfaced; the trailing surface time is not counted.
    const duration = this.diveTime - this.surfaceTimer;
    this.log.push({
      number: this.diveNumber,
      start: this.diveStart,
      duration,
      maxDepth: this.maxDepth,
      avgDepth: this.depthIntegral / Math.max(1, duration),
      gas: { ...this.gas },
      minTemp: this.minTemp,
      surfaceIntervalBefore: this.lastDiveEnd === null ? null : this.diveStart - this.lastDiveEnd,
      profile: this.profile.filter((p) => p.t <= duration + 5),
      cnsEnd: this.oxygen.cns,
      tankStart: this.tankAtStart,
      tankEnd: this.tankPressure,
      gasUsed: this.gasUsed,
      alarms: [...this.diveAlarms],
    });
    this.inDive = false;
    this.lastDiveEnd = this.clock - this.surfaceTimer;
    this.diveTime = duration;
    this.listeners.forEach((l) => l('end'));
  }

  /** Full reset: fresh tissues, as after several days without diving. */
  reset(): void {
    this.tissues = new Tissues();
    this.oxygen.reset();
    this.clock = 0;
    this.depth = 0;
    this.targetDepth = 0;
    this.velocity = 0;
    this.inDive = false;
    this.diveNumber = 0;
    this.diveTime = 0;
    this.maxDepth = 0;
    this.depthIntegral = 0;
    this.surfaceTimer = 0;
    this.lastDiveEnd = null;
    this.refillTank();
    this.profile = [];
    this.log = [];
    this.diveAlarms.clear();
  }

}
