// Shared application state: the diver's session, the computers, and what the interface shows.
import { createComputers, DEFAULT_COMPUTER, type DiveComputer } from '../computers';
import { DiveSession } from '../engine/session';
import type { Environment, Scene3D } from '../ui/scene3d';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export const q = (sel: string) => document.querySelector(sel);

export const session = new DiveSession();
export const computers = createComputers();

/** Phones (same query as style.css): the tabs sit in a bottom bar and open a sheet over the water column. */
export const compactMq = window.matchMedia('(max-width: 640px), (max-height: 500px) and (orientation: landscape)');

export const app = {
  /** Computer shown (and whose settings are edited). */
  active: (computers.find((c) => c.id === DEFAULT_COMPUTER) ?? computers[0]) as DiveComputer,
  /** Simulated seconds per real second. */
  speed: 1,
  paused: false,
  view: '2d' as '2d' | '3d',
  env: 'reef' as Environment,
  tankId: '12-200',
  /** Logbook entry whose profile is drawn at the surface (-1: none). */
  selectedLog: -1,
  activeTab: 'settings',
  /** Phones: the sheet is closed at start. */
  sheetOpen: !compactMq.matches,
  /** 3D view, loaded on first use. */
  scene3d: null as Scene3D | null,
  /** Alarm sounds of the computers (off until the user turns them on). */
  sound: false,
  /** Analog pressure gauge also shown with a transmitter (a backup gauge on the regulator). */
  spgWithTx: false,
};
