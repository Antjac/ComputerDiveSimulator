// Types shared by every computer model: settings, buttons, and the computed view.
import { DecoPlan } from '../../engine/buhlmann';





export interface SettingOption {
  value: string;
  /** A device value ("R0", "On"…) or, for words, both languages. */
  label: string | { fr: string; en: string };
}

export interface SettingDef {
  key: string;
  label: { fr: string; en: string };
  options: SettingOption[];
  default: string;
  /** Shown without the advanced mode (e.g. the screen layout). */
  essential?: boolean;
}

export type AlarmCode =
  | 'ASCENT' | 'ASCENT_WARN' | 'CEILING' | 'PPO2_HIGH' | 'CNS'
  | 'NDL_LOW' | 'DECO' | 'LOCKED' | 'LOW_GAS' | 'OUT_OF_GAS';

export type Bi = { fr: string; en: string };

/**
 * Sound (buzzer) or vibration an alert makes on the real device, per its manual. The page plays a
 * cue when its key appears among the active ones, then repeats it as described.
 */
export interface AlertCue {
  /** The condition: a cue plays when its key appears (a new key, even for the same alarm, replays). */
  key: string;
  /** Beeps, vibration (played as a buzzing sound, and a real vibration on phones that allow it), or both. */
  kind: 'beep' | 'buzz' | 'both';
  /** Sound pattern: urgent alarm, warning or short notice. */
  level: 'alarm' | 'warning' | 'info';
  /** Plays once, repeats while the condition lasts, or repeats until a button of the computer is pressed. */
  until: 'once' | 'clear' | 'ack';
  /** Seconds between repeats (real time). */
  every?: number;
  /** Seconds the first sound lasts (the pattern is repeated to fill it); one pattern by default. */
  first?: number;
  /** Seconds each repeat lasts; one pattern by default. */
  repeat?: number;
}

/** What a button does on the real device (per its manual), and whether the simulator reproduces it. */
export interface ButtonAction {
  real: Bi;
  simulated: boolean;
  /** Extra detail on how the simulation differs from the device. */
  note?: Bi;
}

export interface ButtonHelp {
  name: string;
  press: ButtonAction | null;
  hold?: ButtonAction | null;
}

export type SafetyState = 'none' | 'pending' | 'active' | 'paused' | 'done';

/** Safety stop behaviour, as documented in each manual. Depths in metres. */
export interface SafetyStopDef {
  trigger: number; // the stop is required once the dive went deeper than this
  start: number; // the countdown starts when shallower than this
  top: number; // ...and keeps running while deeper than this
  bottom: number; // ...and shallower than this
  reset: number; // going deeper than this restarts the stop from scratch
}

export interface ComputerView {
  inDive: boolean;
  depth: number;
  maxDepth: number;
  avgDepth: number;
  diveTime: number; // s
  temperature: number;
  gas: string;
  o2: number; // %
  ppO2: number;
  mod: number; // m
  cns: number;
  otu: number;
  gfLow: number; // %
  gfHigh: number; // %
  ndl: number; // min
  inDeco: boolean;
  plan: DecoPlan;
  stopDepth: number; // first mandatory stop, 0 if none
  stopTime: number; // whole minutes at the first stop (rounded up)
  stopTimeSec: number; // seconds at the first stop
  atStop: boolean; // within the stop window of the first stop
  tts: number; // min
  ceiling: number; // m
  ceilingViolation: 0 | 1 | 2; // 0 ok, 1 above ceiling within the safe margin, 2 beyond it
  gf99: number; // %
  surfGf: number; // %
  n2Load: number; // % of the no-deco limit (100 = decompression required)
  ascentRate: number; // m/min, positive = up
  ascentLevel: 0 | 1 | 2; // ok / warn / alarm (colour of the ascent indicator)
  safety: { state: SafetyState; remaining: number; total: number };
  alarms: AlarmCode[];
  surfaceInterval: number | null; // s
  noFly: number; // min
  desat: number; // min
  diveNumber: number;
  locked: boolean;
  tank: TankView;
}

export interface TankView {
  pressure: number; // bar
  fill: number;
  reserve: number;
  /** Tank data shown by the computer itself (optional transmitter paired and enabled). */
  ai: boolean;
  sacBar: number; // bar/min at the surface
  /** Model-specific remaining time (GTR / ATR / RBT / gas time), null when not available. */
  gasTime: number | null;
}
