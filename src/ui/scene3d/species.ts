// Scenery tables: corals and fish species.
import * as THREE from 'three';
import { barrelGeometry, brainGeometry, branchGeometry, fanGeometry, grassGeometry, tableGeometry, tubeGeometry, whipGeometry } from './geometry';
import { Environment } from './sites';


export interface CoralKind {
  geo: () => THREE.BufferGeometry;
  count: Record<Environment, number>;
  colors: number[];
  size: [number, number];
  /** Collision dome per unit of scale: radius and height. */
  solid?: [number, number];
  sway?: number;
  fan?: boolean;
  grass?: boolean;
  doubleSide?: boolean;
}

export const CORALS: CoralKind[] = [
  { geo: brainGeometry, count: { reef: 1000, wreck: 180, wall: 500 }, colors: [0xc9a86a, 0x9a8a55, 0x7fa06a, 0xb08870, 0xd6c49a], size: [0.5, 1.9], solid: [0.6, 0.45] },
  { geo: branchGeometry, count: { reef: 1300, wreck: 220, wall: 600 }, colors: [0xc79a6a, 0xa87c55, 0x8fb4a0, 0xd9a0b0, 0xb07fb5], size: [0.6, 1.6], solid: [0.5, 0.75] },
  { geo: tableGeometry, count: { reef: 320, wreck: 60, wall: 200 }, colors: [0x8c9a6a, 0xa38f6a, 0x6f8f86, 0xb89a78], size: [0.7, 2.2], solid: [0.95, 0.55] },
  { geo: tubeGeometry, count: { reef: 260, wreck: 260, wall: 700 }, colors: [0xb06cff, 0xff9a3c, 0xffd84a, 0x6f5fb0, 0xd65a5a], size: [0.5, 1.4], solid: [0.3, 1.2], doubleSide: true },
  { geo: barrelGeometry, count: { reef: 140, wreck: 100, wall: 220 }, colors: [0x9a5a4a, 0x8a6a50, 0x7a4a5a], size: [0.6, 1.6], solid: [0.5, 1.1], doubleSide: true },
  { geo: fanGeometry, count: { reef: 260, wreck: 180, wall: 700 }, colors: [0xd04a6a, 0xe0803a, 0xb040a0, 0xe8d070], size: [0.6, 1.8], fan: true, sway: 0.03, doubleSide: true },
  { geo: whipGeometry, count: { reef: 600, wreck: 320, wall: 700 }, colors: [0xa050c0, 0xe0c040, 0xd05050, 0xe8e0c8], size: [0.6, 1.4], sway: 0.1 },
  { geo: grassGeometry, count: { reef: 1800, wreck: 500, wall: 0 }, colors: [0x5a8a3a, 0x6f9a40, 0x4a7a3a], size: [0.7, 1.4], grass: true, sway: 0.5, doubleSide: true },
];

export interface Species {
  color: number;
  size: number;
  count: number;
  /** Body proportions (width, height) relative to the length. */
  shape: [number, number];
  speed: number; // m/s
  spread: number; // school radius (m)
  /** Preferred depth: absolute band, or height above the floor. */
  depth: (site: number) => [number, number];
  nearFloor?: boolean;
  groups: number;
}

export const SPECIES: Species[] = [
  { color: 0xcfd8e0, size: 0.2, count: 140, shape: [0.2, 0.3], speed: 1.1, spread: 3.5, depth: (s) => [3, Math.min(15, s - 2)], groups: 6 },
  { color: 0xffd23a, size: 0.35, count: 30, shape: [0.25, 0.42], speed: 0.8, spread: 2.5, depth: (s) => [5, Math.min(22, s - 2)], groups: 4 },
  { color: 0xff7a3c, size: 0.12, count: 60, shape: [0.25, 0.45], speed: 0.4, spread: 2, depth: () => [1, 3], nearFloor: true, groups: 8 },
  { color: 0x9aa7b0, size: 1.2, count: 14, shape: [0.12, 0.16], speed: 0.6, spread: 3, depth: (s) => [Math.min(12, s * 0.5), Math.min(30, s * 0.7)], groups: 3 },
  { color: 0x6b5a48, size: 1.0, count: 2, shape: [0.35, 0.42], speed: 0.3, spread: 3, depth: () => [0.8, 2], nearFloor: true, groups: 5 },
  { color: 0x3a6fd8, size: 0.25, count: 40, shape: [0.22, 0.5], speed: 0.5, spread: 2.5, depth: () => [1.5, 5], nearFloor: true, groups: 7 },
];

export interface School {
  species: Species;
  mesh: THREE.InstancedMesh;
  offsets: Float32Array;
  phases: Float32Array;
  anchor: THREE.Vector3;
  orbit: number;
  angle: number;
  dir: 1 | -1;
  center: THREE.Vector3;
  flee: THREE.Vector3;
}
