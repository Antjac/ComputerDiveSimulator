import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DiveSession } from '../engine/session';

export type Environment = 'reef' | 'wreck' | 'wall';

// World units are metres, y = -depth. The diver swims freely over a site of radius AREA and turns
// back on their own at its edge; the terrain goes further so the fog hides where it ends.
const AREA = 85;
const WORLD = 320;
const SWIM_SPEED = 0.7; // m per real second (visual only, independent of the time speed)
const TURN_RATE = 0.8; // rad per real second
/** Water kept between the diver's axis and whatever lies below or ahead of them (m). */
const CLEARANCE = 0.55;
/** Directions tried when the way ahead is blocked: angle off the heading, share of the speed. */
const GLIDES: [number, number][] = [[0, 1], [0.6, 0.8], [1.2, 0.4], [Math.PI / 2, 0.3], [-0.6, 0.8], [-1.2, 0.4], [-Math.PI / 2, 0.3]];

// Wreck: dimensions shared by the model and the collision test.
const WRECK_L = 36;
const WRECK_W = 7;
const WRECK_H = 5;
const WRECK_ROLL = 0.22; // lying slightly on its side
const WRECK_HEADING = 0.5;
/** Superstructure blocks on the deck (ship frame): x range, half width, top. */
const WRECK_PARTS = [
  { x0: -13, x1: -5, hw: 2.7, top: WRECK_H + 3 },
  { x0: -11.75, x1: -7.25, hw: 2.2, top: WRECK_H + 5 },
  { x0: -4.9, x1: -3.1, hw: 0.9, top: WRECK_H + 3.2 },
];

// ---------------------------------------------------------------------------
// Deterministic noise and randomness (same scenery on every load)

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise in [0, 1]. */
function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < 4; i++) {
    sum += noise(x, y) * amp;
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Smooth ramp from 0 at `a` to 1 at `b` (a may be greater than b). */
function ramp(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Angle in (−π, π]. */
function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
}

// ---------------------------------------------------------------------------
// Sites

/** z of the drop-off along x on the wall site (plateau at smaller z, the blue beyond). */
function wallEdge(x: number): number {
  return (fbm(x * 0.012 + 5, 1.7) - 0.5) * 40;
}

/**
 * Depth of the sea floor at (x, z). The sand lies around the site depth (the deepest the simulation
 * lets the diver go); anything shallower is scenery the diver has to swim around or over.
 */
function floorDepth(env: Environment, site: number, x: number, z: number): number {
  // Never shallower than site + clearance, so the full site depth stays reachable on the sand.
  const sand = site + CLEARANCE + 0.05 + fbm(x * 0.05, z * 0.05) * 1.0;
  let d: number;
  if (env === 'reef') {
    // A shallow reef flat to the north (−z), its slope down to the sand, coral heads on the sand.
    const warp = (fbm(x * 0.015, z * 0.015 + 4) - 0.5) * 40;
    const flat = Math.min(site - 1, 3 + fbm(x * 0.08, z * 0.08) * 3);
    const t = ramp(-60, -25, z + warp);
    d = flat + (sand - flat) * Math.pow(t, 0.8);
    const bommie = Math.max(0, fbm(x * 0.04 + 10, z * 0.04) - 0.5) * 2.4;
    d -= t * Math.min(site - 3, bommie * site * 0.5);
  } else if (env === 'wreck') {
    d = sand - Math.max(0, fbm(x * 0.03 + 3, z * 0.03) - 0.6) * 6;
  } else {
    const s = z - wallEdge(x);
    const top = Math.min(site - 2, 5 + fbm(x * 0.06, z * 0.06) * 4);
    const deep = site + Math.max(15, Math.min(45, site));
    d = top + ramp(-40, 0, s) * 3;
    if (s > 0) d += s * 5 + (fbm(x * 0.2, z * 0.2) - 0.5) * 4;
    d = Math.min(deep, d);
  }
  // Rugged rock and reef, smooth sand.
  const rough = clamp((sand - d) / 2, 0, 1);
  d += (fbm(x * 0.45, z * 0.45) - 0.5) * 1.4 * rough;
  return Math.max(1.5, d);
}

/** Half width of the hull at `x` (ship frame), negative outside it. */
function hullHalfWidth(x: number): number {
  if (x < -WRECK_L / 2 || x > WRECK_L / 2) return -1;
  const bow = WRECK_L / 2 - 9;
  return x < bow ? WRECK_W / 2 : (WRECK_W / 2) * (1 - ((x - bow) / 9) ** 2);
}

/** Height of a flat top `top` (half width `hw`) once the hull is rolled, at `lz` across the wreck. */
function rolledTop(top: number, hw: number, lz: number): number {
  const c = Math.cos(WRECK_ROLL);
  const s = Math.sin(WRECK_ROLL);
  const zs = (lz - top * s) / c;
  return Math.abs(zs) <= hw ? top * c - zs * s : -Infinity;
}

/** Highest point of the wreck above (lx, lz) in its placement frame, or −Infinity. */
function wreckTop(lx: number, lz: number): number {
  let y = -Infinity;
  const hw = hullHalfWidth(lx);
  if (hw > 0) y = rolledTop(WRECK_H, hw, lz);
  for (const p of WRECK_PARTS) if (lx >= p.x0 && lx <= p.x1) y = Math.max(y, rolledTop(p.top, p.hw, lz));
  return y;
}

// ---------------------------------------------------------------------------
// Solid scenery (rocks, corals) as domes in a grid, for collisions

interface Solid {
  x: number;
  z: number;
  r: number;
  /** Depth of the highest point, and height of the dome. */
  top: number;
  h: number;
}

class SolidGrid {
  private cells = new Map<number, Solid[]>();
  private static readonly CELL = 3;

  private static key(ix: number, iz: number): number {
    return (ix + 1024) * 2048 + (iz + 1024);
  }

  clear(): void {
    this.cells.clear();
  }

  add(s: Solid): void {
    const c = SolidGrid.CELL;
    for (let ix = Math.floor((s.x - s.r) / c); ix <= Math.floor((s.x + s.r) / c); ix++) {
      for (let iz = Math.floor((s.z - s.r) / c); iz <= Math.floor((s.z + s.r) / c); iz++) {
        const k = SolidGrid.key(ix, iz);
        const list = this.cells.get(k);
        if (list) list.push(s);
        else this.cells.set(k, [s]);
      }
    }
  }

  /** Shallowest of `depth` and the solids at (x, z). */
  top(x: number, z: number, depth: number): number {
    const list = this.cells.get(SolidGrid.key(Math.floor(x / SolidGrid.CELL), Math.floor(z / SolidGrid.CELL)));
    if (!list) return depth;
    for (const s of list) {
      const q = ((x - s.x) ** 2 + (z - s.z) ** 2) / (s.r * s.r);
      if (q < 1) depth = Math.min(depth, s.top + q * s.h);
    }
    return depth;
  }
}

// ---------------------------------------------------------------------------
// Shader tweaks on the standard material: caustics, mottled surfaces, sand ripples, swaying soft
// corals and swimming fish.

const fx = { uTime: { value: 0 } };

interface Look {
  caustics?: boolean;
  mottle?: number;
  ripples?: boolean;
  sway?: number;
  fish?: boolean;
}

const VERT_HEAD = /* glsl */ `
uniform float uTime;
varying vec3 vWPos;
varying vec3 vWNormal;
#ifdef FISH
attribute float aPhase;
varying float vFishY;
#endif
`;

const VERT_BEGIN = /* glsl */ `
#ifdef SWAY
{
  vec3 swayBase = vec3(0.0);
  #ifdef USE_INSTANCING
  swayBase = instanceMatrix[3].xyz;
  #endif
  float swayH = max(0.0, position.y);
  float swayP = uTime * 1.1 + swayBase.x * 0.31 + swayBase.z * 0.23;
  transformed.x += sin(swayP) * SWAY * swayH * swayH;
  transformed.z += cos(swayP * 0.7) * SWAY * 0.5 * swayH * swayH;
}
#endif
#ifdef FISH
transformed.x += sin(uTime * 9.0 + aPhase - position.z * 6.0) * 0.1 * (1.0 - smoothstep(-0.6, 0.3, position.z));
vFishY = position.y;
#endif
`;

const VERT_WORLD = /* glsl */ `
{
  vec4 fxW = vec4(transformed, 1.0);
  vec3 fxN = objectNormal;
  #ifdef USE_INSTANCING
  fxW = instanceMatrix * fxW;
  fxN = mat3(instanceMatrix) * fxN;
  #endif
  fxW = modelMatrix * fxW;
  vWPos = fxW.xyz;
  vWNormal = normalize(mat3(modelMatrix) * fxN);
}
`;

const FRAG_HEAD = /* glsl */ `
uniform float uTime;
varying vec3 vWPos;
varying vec3 vWNormal;
#ifdef FISH
varying float vFishY;
#endif
float fxHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float fxNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(fxHash(i), fxHash(i + vec3(1, 0, 0)), f.x), mix(fxHash(i + vec3(0, 1, 0)), fxHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(fxHash(i + vec3(0, 0, 1)), fxHash(i + vec3(1, 0, 1)), f.x), mix(fxHash(i + vec3(0, 1, 1)), fxHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Tileable water caustics (after joltz0r's well-known shader).
float fxCaustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.2831853, 6.2831853) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
`;

const FRAG_COLOR = /* glsl */ `
#ifdef MOTTLE
diffuseColor.rgb *= 1.0 + MOTTLE * ((fxNoise(vWPos * 0.8) * 0.65 + fxNoise(vWPos * 3.7) * 0.35) - 0.5) * 2.0;
#endif
#ifdef RIPPLES
{
  float rp = sin(vWPos.x * 2.6 + sin(vWPos.z * 0.7) * 2.0 + fxNoise(vWPos * 0.35) * 5.0);
  diffuseColor.rgb *= 1.0 + 0.08 * rp * smoothstep(0.8, 0.95, vWNormal.y);
}
#endif
#ifdef FISH
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.95), (1.0 - smoothstep(-0.4, -0.05, vFishY)) * 0.55);
diffuseColor.rgb *= mix(1.0, 0.5, smoothstep(0.05, 0.45, vFishY));
#endif
#ifdef CAUSTICS
{
  float cDepth = max(0.0, -vWPos.y);
  float cs = fxCaustic(vWPos.xz * 0.22, uTime * 0.5) * 0.6 + fxCaustic(vWPos.xz * 0.37 + 3.1, uTime * 0.43) * 0.4;
  diffuseColor.rgb *= 1.0 + 1.8 * cs * exp(-cDepth / 12.0) * smoothstep(0.0, 0.8, vWNormal.y);
}
#endif
`;

function patch<M extends THREE.MeshStandardMaterial>(mat: M, look: Look): M {
  const defs: string[] = [];
  if (look.mottle) defs.push(`#define MOTTLE ${look.mottle.toFixed(3)}`);
  if (look.ripples) defs.push('#define RIPPLES');
  if (look.caustics) defs.push('#define CAUSTICS');
  if (look.sway) defs.push(`#define SWAY ${look.sway.toFixed(3)}`);
  if (look.fish) defs.push('#define FISH');
  const head = defs.join('\n');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = fx.uTime;
    sh.vertexShader = `${head}\n${VERT_HEAD}${sh.vertexShader}`
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BEGIN}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_WORLD}`);
    sh.fragmentShader = `${head}\n${FRAG_HEAD}${sh.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>\n${FRAG_COLOR}`,
    );
  };
  mat.customProgramCacheKey = () => head;
  return mat;
}

// ---------------------------------------------------------------------------
// Geometry

/** Smooth, lumpy geometry: `shape(x, y, z)` returns the radius factor along each unit direction. */
function lumpy(detail: number, shape: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = shape(x, y, z);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function rockGeometry(): THREE.BufferGeometry {
  const g = lumpy(2, (x, y, z) => {
    let k = 0.72 + fbm(x * 1.1 + z * 0.8 + 7, y * 1.1 - z * 0.6 + 3) * 0.6;
    if (y < -0.2) k *= 0.8;
    return k;
  });
  // Darker underside, algae on top.
  const n = g.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(n.count * 3);
  const base = new THREE.Color(0x938b7c);
  const algae = new THREE.Color(0x66743f);
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    const up = n.getY(i);
    c.copy(base).lerp(algae, clamp(up * 1.4 - 0.4, 0, 0.8)).multiplyScalar(0.6 + 0.4 * clamp(up + 0.6, 0, 1));
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function brainGeometry(): THREE.BufferGeometry {
  const g = lumpy(4, (x, y, z) => 0.6 * (1 + 0.05 * Math.sin(22 * (x + Math.sin(z * 5) * 0.25)) + 0.1 * (fbm(x * 2 + 4, z * 2 + y) - 0.5)));
  g.scale(1, 0.75, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) * 0.3);
  g.computeVertexNormals();
  return g;
}

/** Staghorn coral: a few levels of forking branches. */
function branchGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const rnd = mulberry32(5);
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, level: number) => {
    const c = new THREE.CylinderGeometry(r * 0.7, r, len, 5, 1);
    c.translate(0, len / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    c.translate(from.x, from.y, from.z);
    parts.push(c);
    if (level === 0) return;
    const end = from.clone().addScaledVector(dir, len);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rnd();
      const d = dir.clone().add(new THREE.Vector3(Math.cos(a), 0.2, Math.sin(a)).multiplyScalar(0.55 + rnd() * 0.3)).normalize();
      grow(end, d, len * 0.72, r * 0.7, level - 1);
    }
  };
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4).normalize(), 0.35, 0.06, 2);
  }
  return mergeGeometries(parts)!;
}

/** Table coral: a wide plate on a short stalk. */
function tableGeometry(): THREE.BufferGeometry {
  const stalk = new THREE.CylinderGeometry(0.1, 0.16, 0.5, 8);
  stalk.translate(0, 0.25, 0);
  const plate = new THREE.CylinderGeometry(1, 0.9, 0.08, 24, 1);
  const p = plate.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    const k = 1 + (noise(Math.atan2(z, x) * 3 + 10, 2) - 0.5) * 0.3;
    p.setXYZ(i, x * k, p.getY(i) + 0.5 - r * 0.08, z * k);
  }
  plate.computeVertexNormals();
  return mergeGeometries([stalk, plate])!;
}

function tubeGeometry(): THREE.BufferGeometry {
  const tubes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const t = new THREE.CylinderGeometry(0.12, 0.15, 0.8 + i * 0.35, 10, 1, true);
    t.translate(Math.cos(i * 2.1) * 0.16, (0.8 + i * 0.35) / 2, Math.sin(i * 2.1) * 0.16);
    tubes.push(t);
  }
  return mergeGeometries(tubes)!;
}

/** Barrel sponge: a thick open vase. */
function barrelGeometry(): THREE.BufferGeometry {
  const pts = [
    [0.2, 0], [0.38, 0.2], [0.5, 0.55], [0.5, 0.9], [0.46, 1.1], [0.38, 1.1], [0.4, 0.9], [0.38, 0.55], [0.1, 0.3],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 18);
}

/** Sea fan: a half disc whose lattice comes from an alpha map. */
function fanGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(0.9, 18, 0, Math.PI);
}

let fanTexture: THREE.Texture | null = null;
function fanAlpha(): THREE.Texture {
  if (fanTexture) return fanTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  const rnd = mulberry32(3);
  const branch = (x: number, y: number, a: number, len: number, w: number, level: number) => {
    const x2 = x + Math.cos(a) * len;
    const y2 = y - Math.sin(a) * len;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x2, y2);
    g.stroke();
    if (level > 0) {
      branch(x2, y2, a + 0.25 + rnd() * 0.2, len * 0.8, w * 0.75, level - 1);
      branch(x2, y2, a - 0.25 - rnd() * 0.2, len * 0.8, w * 0.75, level - 1);
    }
  };
  for (let i = 0; i < 5; i++) branch(128, 128, 0.35 + i * 0.6, 26, 5, 5);
  // Fine cross links.
  g.lineWidth = 1.2;
  for (let r = 20; r < 125; r += 7) {
    g.beginPath();
    g.arc(128, 128, r, Math.PI, 0);
    g.stroke();
  }
  // Keep the lattice inside the disc.
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  fanTexture = new THREE.CanvasTexture(cv);
  return fanTexture;
}

/** Soft coral / sea whips: a clump of tall thin stems. */
function whipGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.8 + (i % 3) * 0.3;
    const c = new THREE.CylinderGeometry(0.012, 0.03, h, 4, 4);
    c.translate(0, h / 2, 0);
    c.rotateZ((i - 2) * 0.12);
    c.rotateY(i * 1.3);
    c.translate(Math.cos(i * 1.3) * 0.08, 0, Math.sin(i * 1.3) * 0.08);
    parts.push(c);
  }
  return mergeGeometries(parts)!;
}

/** Sea grass: a tuft of blades. */
function grassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.35 + (i % 4) * 0.08;
    const b = new THREE.PlaneGeometry(0.035, h, 1, 4);
    b.translate(0, h / 2, 0);
    b.rotateZ(((i % 3) - 1) * 0.2);
    b.rotateY(i * 0.9);
    b.translate(Math.cos(i * 2.4) * 0.1, 0, Math.sin(i * 2.4) * 0.1);
    parts.push(b);
  }
  return mergeGeometries(parts)!;
}

/** Fish, one unit long, nose towards +z: lathe body, forked tail and dorsal fin. */
function fishGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(0.5 * Math.sin(Math.PI * Math.pow(t, 0.75)) + 0.06 * (1 - t), -0.35 + t * 0.85));
  }
  const body = new THREE.LatheGeometry(pts, 10);
  body.rotateX(Math.PI / 2);
  const tailShape = new THREE.Shape();
  tailShape.moveTo(-0.3, 0);
  tailShape.lineTo(-0.66, 0.32);
  tailShape.lineTo(-0.55, 0);
  tailShape.lineTo(-0.66, -0.32);
  tailShape.lineTo(-0.3, 0);
  const tail = new THREE.ShapeGeometry(tailShape);
  tail.rotateY(-Math.PI / 2);
  const finShape = new THREE.Shape();
  finShape.moveTo(0.2, 0.38);
  finShape.lineTo(-0.25, 0.62);
  finShape.lineTo(-0.2, 0.3);
  finShape.lineTo(0.2, 0.38);
  const fin = new THREE.ShapeGeometry(finShape);
  fin.rotateY(-Math.PI / 2);
  return mergeGeometries([body.toNonIndexed(), tail.toNonIndexed(), fin.toNonIndexed()])!;
}

// ---------------------------------------------------------------------------
// Scenery tables

interface CoralKind {
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

const CORALS: CoralKind[] = [
  { geo: brainGeometry, count: { reef: 1000, wreck: 180, wall: 500 }, colors: [0xc9a86a, 0x9a8a55, 0x7fa06a, 0xb08870, 0xd6c49a], size: [0.5, 1.9], solid: [0.6, 0.45] },
  { geo: branchGeometry, count: { reef: 1300, wreck: 220, wall: 600 }, colors: [0xc79a6a, 0xa87c55, 0x8fb4a0, 0xd9a0b0, 0xb07fb5], size: [0.6, 1.6], solid: [0.5, 0.75] },
  { geo: tableGeometry, count: { reef: 320, wreck: 60, wall: 200 }, colors: [0x8c9a6a, 0xa38f6a, 0x6f8f86, 0xb89a78], size: [0.7, 2.2], solid: [0.95, 0.55] },
  { geo: tubeGeometry, count: { reef: 260, wreck: 260, wall: 700 }, colors: [0xb06cff, 0xff9a3c, 0xffd84a, 0x6f5fb0, 0xd65a5a], size: [0.5, 1.4], solid: [0.3, 1.2], doubleSide: true },
  { geo: barrelGeometry, count: { reef: 140, wreck: 100, wall: 220 }, colors: [0x9a5a4a, 0x8a6a50, 0x7a4a5a], size: [0.6, 1.6], solid: [0.5, 1.1], doubleSide: true },
  { geo: fanGeometry, count: { reef: 260, wreck: 180, wall: 700 }, colors: [0xd04a6a, 0xe0803a, 0xb040a0, 0xe8d070], size: [0.6, 1.8], fan: true, sway: 0.03, doubleSide: true },
  { geo: whipGeometry, count: { reef: 600, wreck: 320, wall: 700 }, colors: [0xa050c0, 0xe0c040, 0xd05050, 0xe8e0c8], size: [0.6, 1.4], sway: 0.1 },
  { geo: grassGeometry, count: { reef: 1800, wreck: 500, wall: 0 }, colors: [0x5a8a3a, 0x6f9a40, 0x4a7a3a], size: [0.7, 1.4], grass: true, sway: 0.5, doubleSide: true },
];

interface Species {
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

const SPECIES: Species[] = [
  { color: 0xcfd8e0, size: 0.2, count: 140, shape: [0.2, 0.3], speed: 1.1, spread: 3.5, depth: (s) => [3, Math.min(15, s - 2)], groups: 6 },
  { color: 0xffd23a, size: 0.35, count: 30, shape: [0.25, 0.42], speed: 0.8, spread: 2.5, depth: (s) => [5, Math.min(22, s - 2)], groups: 4 },
  { color: 0xff7a3c, size: 0.12, count: 60, shape: [0.25, 0.45], speed: 0.4, spread: 2, depth: () => [1, 3], nearFloor: true, groups: 8 },
  { color: 0x9aa7b0, size: 1.2, count: 14, shape: [0.12, 0.16], speed: 0.6, spread: 3, depth: (s) => [Math.min(12, s * 0.5), Math.min(30, s * 0.7)], groups: 3 },
  { color: 0x6b5a48, size: 1.0, count: 2, shape: [0.35, 0.42], speed: 0.3, spread: 3, depth: () => [0.8, 2], nearFloor: true, groups: 5 },
  { color: 0x3a6fd8, size: 0.25, count: 40, shape: [0.22, 0.5], speed: 0.5, spread: 2.5, depth: () => [1.5, 5], nearFloor: true, groups: 7 },
];

interface School {
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

/** Where the diver starts on each site: position and heading. */
function startOf(env: Environment): [number, number, number] {
  if (env === 'reef') return [5, 5, Math.PI]; // facing the reef slope
  if (env === 'wreck') return [-16, 20, Math.atan2(16, -20)]; // facing the wreck
  return [0, wallEdge(0) + 8, Math.PI / 2]; // along the wall, wall on the left
}

// ---------------------------------------------------------------------------

/** Third-person 3D view of the dive: same depth control as the water column, free swimming. */
export class Scene3D {
  ceiling = 0;
  safetyBand = false;
  stopDepth = 0;
  paused = false;
  environment: Environment = 'reef';
  /** Called once the user has interacted with the view (to hide the hint). */
  onInteract: (() => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
  private world = new THREE.Group();
  private builtFor = '';
  private env: Environment = 'reef';
  private site = 40;
  private solids = new SolidGrid();
  private schools: School[] = [];
  private turtle!: THREE.Group;
  private turtleCenter = new THREE.Vector2();
  private turtleAngle = 0;
  private wreck: { x: number; z: number; y: number; cos: number; sin: number } | null = null;

  private hemi = new THREE.HemisphereLight(0xbfe9ff, 0x2a2418, 1);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private torch = new THREE.SpotLight(0xfff4e0, 0, 28, 0.42, 0.5, 1.2);
  private fog = new THREE.FogExp2(0x3fa9cc, 0.03);
  private dome!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  private diver = new THREE.Group();
  private diverPitch = new THREE.Group();
  private fins: THREE.Group[] = [];
  private finPhase = 0;
  private px = 0;
  private pz = 0;
  private heading = 0;
  private headingTarget = 0;
  private turnVel = 0;
  private glideSide = 1;
  private stuckTimer = 0;
  private stuckFrom = new THREE.Vector2();
  private backOff = 0;

  private surface!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private rays: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = [];
  private snow!: THREE.Points;
  private snowBase!: Float32Array;
  private bubbles!: THREE.InstancedMesh;
  private bubbleData: { p: THREE.Vector3; r: number; w: number }[] = [];
  private bubbleTimer = 0;

  private targetRing!: THREE.Mesh;
  private ceilingDisc!: THREE.Mesh;
  private safetyTube!: THREE.Mesh;

  private yaw = 0;
  private camPos = new THREE.Vector3();
  private drag: { x: number; y: number; target: number; heading: number; yaw: number; orbit: boolean } | null = null;
  private time = 0;
  private dummy = new THREE.Object3D();

  constructor(private canvas: HTMLCanvasElement, private session: DiveSession) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene.fog = this.fog;
    this.sun.position.set(20, 60, 10);
    this.scene.add(this.hemi, this.sun, this.world);

    this.buildDiver();
    this.buildAmbience();
    this.buildOverlays();
    this.bindInput();
  }

  // -------------------------------------------------------------------------
  // Input: vertical drag = target depth, horizontal drag = turn,
  // right-button or Shift + drag = orbit the camera.

  /** Turns the diver to the right (`dir` = 1) or left (−1) by `angle` from where they head now. */
  steer(dir: number, angle = 0.35): void {
    this.headingTarget = this.heading - dir * angle;
    this.onInteract?.();
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        target: this.session.targetDepth,
        heading: this.headingTarget,
        yaw: this.yaw,
        orbit: e.button === 2 || e.shiftKey,
      };
      this.onInteract?.();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dy = e.clientY - this.drag.y;
      const dx = e.clientX - this.drag.x;
      if (this.drag.orbit) {
        this.yaw = this.drag.yaw - dx * 0.008;
        return;
      }
      if (Math.abs(dy) > 4) this.session.setTarget(Math.round((this.drag.target + dy * 0.08) * 2) / 2);
      if (Math.abs(dx) > 4) this.headingTarget = this.drag.heading - dx * 0.006;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    const end = () => (this.drag = null);
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.session.setTarget(Math.round((this.session.targetDepth + Math.sign(e.deltaY) * 0.5) * 2) / 2);
        this.onInteract?.();
      },
      { passive: false },
    );
    c.addEventListener('dblclick', () => (this.yaw = 0));
  }

  // -------------------------------------------------------------------------
  // Static pieces

  private buildDiver(): void {
    const suit = new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.7 });
    const bcd = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.8 });
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.35, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.3, metalness: 0.9 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.6, side: THREE.DoubleSide });
    const maskMat = new THREE.MeshStandardMaterial({ color: 0x7fe0ff, emissive: 0x1a6070, roughness: 0.1, metalness: 0.3 });
    const compMat = new THREE.MeshStandardMaterial({ color: 0xff6a3d, emissive: 0x552010 });
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.65, 4, 12), suit);
    torso.rotation.x = Math.PI / 2;
    const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.225, 0.4, 4, 12), bcd);
    vest.rotation.x = Math.PI / 2;
    vest.position.z = 0.12;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 16), tankMat);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, 0.28, -0.05);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), steel);
    valve.rotation.x = Math.PI / 2;
    valve.position.set(0, 0.28, 0.32);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), suit);
    head.position.set(0, 0.06, 0.58);
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), maskMat);
    mask.position.set(0, 0.08, 0.7);
    const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10), steel);
    reg.rotation.x = Math.PI / 2;
    reg.position.set(0, -0.03, 0.72);
    const hose = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([new THREE.Vector3(0.03, 0.3, 0.34), new THREE.Vector3(0.16, 0.2, 0.55), new THREE.Vector3(0.05, -0.03, 0.7)]),
        12,
        0.015,
        5,
      ),
      hoseMat,
    );
    this.diverPitch.add(torso, vest, tank, valve, head, mask, reg, hose);

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 4, 8), suit);
      leg.rotation.x = Math.PI / 2;
      leg.position.set(side * 0.1, -0.02, -0.72);
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, -0.02, -1.0);
      const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.45), finMat);
      fin.rotation.x = -Math.PI / 2;
      fin.position.z = -0.2;
      hip.add(fin);
      this.fins.push(hip);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.45, 4, 8), suit);
      arm.rotation.set(Math.PI / 2.4, 0, side * 0.25);
      arm.position.set(side * 0.2, -0.12, 0.35);
      this.diverPitch.add(leg, hip, arm);
    }
    const comp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.07), compMat);
    comp.position.set(-0.24, -0.2, 0.52);
    this.diverPitch.add(comp);

    // Dive torch: only noticeable once the surface light fades.
    this.torch.position.set(0, 0.1, 0.7);
    this.torch.target.position.set(0, -1.5, 8);
    this.diverPitch.add(this.torch, this.torch.target);

    this.diver.add(this.diverPitch);
    this.scene.add(this.diver);
  }

  private buildAmbience(): void {
    // Water all around: brighter towards the surface, darker towards the depths. Its horizon is the
    // fog colour, so distant scenery melts into it.
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uBottom;
          varying vec3 vDir;
          void main() {
            float h = normalize(vDir).y;
            vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.7)) : mix(uHorizon, uBottom, pow(-h, 0.6));
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    this.scene.add(this.dome);

    // Surface seen from below: only inside Snell's window (a cone of ~48.6° above the eye), fading
    // out at its rim; beyond it the surface reflects the depths and melts into the water colour.
    const surf = new THREE.PlaneGeometry(2, 2, 48, 48);
    surf.rotateX(-Math.PI / 2);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g2 = cv.getContext('2d')!;
    const grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.75, '#fff');
    grad.addColorStop(1, '#000');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 128, 128);
    this.surface = new THREE.Mesh(
      surf,
      new THREE.MeshBasicMaterial({
        color: 0xc6f1ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false,
        alphaMap: new THREE.CanvasTexture(cv),
      }),
    );
    this.scene.add(this.surface);

    // Sun rays.
    for (let i = 0; i < 7; i++) {
      const geo = new THREE.CylinderGeometry(0.4, 2.6, 34, 12, 1, true);
      geo.translate(0, -17, 0);
      const ray = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xe8fbff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      ray.userData = { dx: (i - 3) * 5 + Math.sin(i * 12.9) * 2, dz: Math.cos(i * 7.3) * 9, phase: i * 1.7 };
      this.rays.push(ray);
      this.scene.add(ray);
    }

    // Marine snow around the camera.
    const n = 1400;
    this.snowBase = new Float32Array(n * 3);
    const rnd = mulberry32(7);
    for (let i = 0; i < n * 3; i++) this.snowBase[i] = rnd() * 30;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8f4f0, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    // Exhaled bubbles.
    this.bubbles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.6, emissive: 0x335566 }),
      120,
    );
    this.bubbles.count = 0;
    this.bubbles.frustumCulled = false;
    this.scene.add(this.bubbles);
  }

  private buildOverlays(): void {
    const ring = new THREE.TorusGeometry(1.3, 0.025, 6, 48);
    ring.rotateX(Math.PI / 2);
    this.targetRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe678, transparent: true, opacity: 0.8, fog: false, toneMapped: false }));

    const disc = new THREE.CircleGeometry(9, 48);
    disc.rotateX(-Math.PI / 2);
    this.ceilingDisc = new THREE.Mesh(
      disc,
      new THREE.MeshBasicMaterial({ color: 0xff4a3c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );

    const tube = new THREE.CylinderGeometry(7, 7, 3, 48, 1, true);
    this.safetyTube = new THREE.Mesh(
      tube,
      new THREE.MeshBasicMaterial({ color: 0x50dc8c, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    this.scene.add(this.targetRing, this.ceilingDisc, this.safetyTube);
  }

  // -------------------------------------------------------------------------
  // Ground queries

  private floorAt(x: number, z: number): number {
    return floorDepth(this.env, this.site, x, z);
  }

  /** Seabed or wreck. */
  private baseGround(x: number, z: number): number {
    let d = this.floorAt(x, z);
    const w = this.wreck;
    if (w) {
      const dx = x - w.x;
      const dz = z - w.z;
      const top = wreckTop(dx * w.cos - dz * w.sin, dx * w.sin + dz * w.cos);
      if (top > -Infinity) d = Math.min(d, -(w.y + top));
    }
    return d;
  }

  /** Depth of the highest thing at (x, z): seabed, wreck, rocks or corals. */
  private groundAt(x: number, z: number): number {
    return this.solids.top(x, z, this.baseGround(x, z));
  }

  /** Shallowest ground under the diver's body (head, fins and sides) at (x, z) heading `h`. */
  private footprint(x: number, z: number, h: number): number {
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    let g = this.groundAt(x, z);
    g = Math.min(g, this.groundAt(x + fx * 0.75, z + fz * 0.75));
    g = Math.min(g, this.groundAt(x - fx * 1.1, z - fz * 1.1));
    g = Math.min(g, this.groundAt(x + fz * 0.35, z - fx * 0.35));
    g = Math.min(g, this.groundAt(x - fz * 0.35, z + fx * 0.35));
    return g;
  }

  // -------------------------------------------------------------------------
  // Site (rebuilt when the environment or the site depth changes)

  private rebuild(): void {
    this.world.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.world.clear();
    this.schools = [];
    this.solids.clear();
    this.wreck = null;

    const env = (this.env = this.environment);
    const site = (this.site = this.session.siteDepth);
    const rnd = mulberry32(env === 'reef' ? 11 : env === 'wreck' ? 23 : 37);

    if (env === 'wreck') {
      const y = -(site + 1.2);
      this.wreck = { x: 0, z: 0, y, cos: Math.cos(WRECK_HEADING), sin: Math.sin(WRECK_HEADING) };
      this.world.add(this.buildWreck(y));
    }
    this.world.add(this.buildTerrain());
    this.world.add(this.buildRocks(rnd));
    this.world.add(...this.buildCorals(rnd));
    this.buildFish(rnd);

    // Start where the site is worth seeing, out of any scenery if the diver is already deep.
    const [sx, sz, sh] = startOf(env);
    this.placeDiver(sx, sz, sh);
    this.turtleCenter.set(sx + Math.sin(sh) * 22, sz + Math.cos(sh) * 22);
    this.buildTurtle();
  }

  private placeDiver(x: number, z: number, h: number): void {
    const need = this.session.depth + CLEARANCE;
    for (let r = 0; r < 80; r += 1.5) {
      const steps = Math.max(1, Math.round(r * 2));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const cx = x + Math.cos(a) * r;
        const cz = z + Math.sin(a) * r;
        if (this.footprint(cx, cz, h) >= need) {
          this.px = cx;
          this.pz = cz;
          this.heading = this.headingTarget = h;
          this.camPos.set(0, 0, 0);
          return;
        }
      }
    }
    this.px = x;
    this.pz = z;
    this.heading = this.headingTarget = h;
    this.camPos.set(0, 0, 0);
  }

  private buildTerrain(): THREE.Mesh {
    const seg = 256;
    const site = this.site;
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, -this.floorAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as THREE.BufferAttribute;

    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xd8c79a);
    const deepSand = new THREE.Color(0x9a8f74);
    const reef = new THREE.Color(0x8c7a5c);
    const algae = new THREE.Color(0x5f6d40);
    const rock = new THREE.Color(0x5e574d);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = -pos.getY(i);
      const raised = clamp((site + 0.3 - d) / 2, 0, 1);
      c.copy(d > site + 3 ? deepSand : sand).lerp(reef, raised);
      c.lerp(algae, raised * fbm(x * 0.1 + 40, z * 0.1) * 0.6);
      c.lerp(sand, raised * ramp(0.55, 0.7, fbm(x * 0.07 - 30, z * 0.07))); // sand and rubble patches
      c.lerp(rock, ramp(0.75, 0.45, nrm.getY(i)));
      const n = (noise(x * 0.4, z * 0.4) - 0.5) * 0.1;
      colors[i * 3] = c.r + n;
      colors[i * 3 + 1] = c.g + n;
      colors[i * 3 + 2] = c.b + n;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return new THREE.Mesh(
      geo,
      patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), { caustics: true, mottle: 0.16, ripples: true }),
    );
  }

  /** Random point in the site (a bit beyond the diver's reach so the edge is not bare). */
  private randomSpot(rnd: () => number, radius = AREA + 20): [number, number] {
    const r = radius * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  private buildRocks(rnd: () => number): THREE.InstancedMesh {
    const n = this.env === 'reef' ? 180 : this.env === 'wreck' ? 220 : 260;
    const mesh = new THREE.InstancedMesh(
      rockGeometry(),
      patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), { caustics: true, mottle: 0.25 }),
      n,
    );
    const col = new THREE.Color();
    let i = 0;
    let tries = 0;
    while (i < n && tries++ < n * 20) {
      const [x, z] = this.randomSpot(rnd);
      const d = this.baseGround(x, z);
      if (d > this.site + 3) continue; // lost in the blue
      if (this.wreck && d < this.floorAt(x, z) - 0.5) continue; // not on the wreck
      const s = 0.3 + rnd() * rnd() * 2.2;
      const sx = s * (0.8 + rnd() * 0.4);
      const sy = s * (0.45 + rnd() * 0.4);
      const sz = s * (0.8 + rnd() * 0.4);
      this.dummy.position.set(x, -d + sy * 0.3, z);
      this.dummy.rotation.set((rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3);
      this.dummy.scale.set(sx, sy, sz);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      col.setScalar(0.8 + rnd() * 0.35);
      mesh.setColorAt(i, col);
      this.solids.add({ x, z, r: Math.max(sx, sz) * 0.9, top: d - sy * 1.25, h: sy * 1.25 });
      i++;
    }
    mesh.count = i;
    return mesh;
  }

  /** How likely a coral (or sea grass) grows at (x, z) where the ground is at depth `d`. */
  private habitat(kind: CoralKind, x: number, z: number, d: number): number {
    const site = this.site;
    const raised = clamp((site + 0.3 - d) / 2, 0, 1);
    const grassPatch = fbm(x * 0.05 + 20, z * 0.05) > 0.52 ? 1 : 0;
    if (kind.grass) return raised < 0.1 ? grassPatch : 0;
    if (this.env === 'reef') return 0.06 + 0.94 * raised * (0.35 + 0.65 * fbm(x * 0.08 + 7, z * 0.08));
    if (this.env === 'wreck') return d < this.floorAt(x, z) - 0.5 ? 1 : 0.1 + 0.5 * raised;
    return d > site + 2 ? 0 : 1;
  }

  private buildCorals(rnd: () => number): THREE.Object3D[] {
    const env = this.env;
    const up = new THREE.Vector3(0, 1, 0);
    const n = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const spin = new THREE.Quaternion();
    const out: THREE.Object3D[] = [];
    for (const kind of CORALS) {
      const count = kind.count[env];
      if (!count) continue;
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: kind.doubleSide ? THREE.DoubleSide : THREE.FrontSide });
      if (kind.fan) {
        mat.alphaMap = fanAlpha();
        mat.alphaTest = 0.4;
      }
      const mesh = new THREE.InstancedMesh(kind.geo(), patch(mat, { caustics: true, mottle: 0.2, sway: kind.sway }), count);
      const col = new THREE.Color();
      let i = 0;
      let tries = 0;
      while (i < count && tries++ < count * 40) {
        let x: number;
        let z: number;
        if (this.wreck && !kind.grass && rnd() < 0.3) {
          // Growth on the wreck.
          const lx = (rnd() - 0.5) * WRECK_L * 0.95;
          const lz = (rnd() - 0.5) * WRECK_W * 1.3;
          const w = this.wreck;
          x = w.x + lx * w.cos + lz * w.sin;
          z = w.z - lx * w.sin + lz * w.cos;
        } else {
          [x, z] = this.randomSpot(rnd);
        }
        const d = this.baseGround(x, z);
        if (rnd() > this.habitat(kind, x, z, d)) continue;
        if (this.solids.top(x, z, d) < d - 0.2) continue; // something already there
        const s = kind.size[0] + rnd() * (kind.size[1] - kind.size[0]);

        // Grow out of the surface, halfway between upright and its normal.
        const e = 0.4;
        n.set(this.baseGround(x - e, z) - this.baseGround(x + e, z), 2 * e, this.baseGround(x, z - e) - this.baseGround(x, z + e));
        n.set(-n.x, n.y, -n.z).normalize();
        const facing = kind.fan && n.y < 0.95 ? Math.atan2(n.x, n.z) : rnd() * Math.PI * 2;
        q.setFromUnitVectors(up, n.clone().lerp(up, 0.5).normalize());
        spin.setFromAxisAngle(up, facing);
        this.dummy.quaternion.copy(q).multiply(spin);
        this.dummy.position.set(x, -d - 0.05 * s, z);
        this.dummy.scale.setScalar(s);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        col.setHex(kind.colors[Math.floor(rnd() * kind.colors.length)]).multiplyScalar(0.75 + rnd() * 0.35);
        mesh.setColorAt(i, col);
        if (kind.solid && s > 0.4) this.solids.add({ x, z, r: kind.solid[0] * s, top: d - kind.solid[1] * s, h: kind.solid[1] * s });
        i++;
      }
      mesh.count = i;
      out.push(mesh);
    }
    return out;
  }

  private buildWreck(y: number): THREE.Group {
    const L = WRECK_L;
    const W = WRECK_W;
    const H = WRECK_H;
    const look = { caustics: true, mottle: 0.35 };
    const rust = patch(new THREE.MeshStandardMaterial({ color: 0x7a4b32, roughness: 0.95, flatShading: true }), look);
    const paint = patch(new THREE.MeshStandardMaterial({ color: 0x8c7462, roughness: 0.9, flatShading: true }), look);
    const dark = new THREE.MeshStandardMaterial({ color: 0x120e0b, roughness: 1 });

    const plan = new THREE.Shape();
    plan.moveTo(-L / 2, -W / 2);
    plan.lineTo(L / 2 - 9, -W / 2);
    plan.quadraticCurveTo(L / 2 - 2, -W / 2, L / 2, 0);
    plan.quadraticCurveTo(L / 2 - 2, W / 2, L / 2 - 9, W / 2);
    plan.lineTo(-L / 2, W / 2);
    plan.lineTo(-L / 2, -W / 2);
    const hullGeo = new THREE.ExtrudeGeometry(plan, { depth: H, bevelEnabled: false, curveSegments: 8 });
    hullGeo.rotateX(-Math.PI / 2);

    const ship = new THREE.Group();
    ship.add(new THREE.Mesh(hullGeo, rust));
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, yy: number, z: number, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, yy, z);
      m.rotation.set(rx, 0, rz);
      ship.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(8, 3, 5.4), paint, -9, H + 1.5, 0);
    add(new THREE.BoxGeometry(4.5, 2, 4.4), paint, -9.5, H + 4, 0);
    add(new THREE.CylinderGeometry(0.8, 0.9, 3.2, 12), rust, -4, H + 1.6, 0);
    add(new THREE.CylinderGeometry(0.15, 0.2, 9, 8), rust, 8, H + 4.5, 0);
    add(new THREE.CylinderGeometry(0.15, 0.2, 7, 8), rust, 2, H + 0.3, 1.8, Math.PI / 2 - 0.15, 0.4); // fallen mast
    add(new THREE.BoxGeometry(3.5, 0.3, 3.5), dark, 3, H + 0.05, 0);
    add(new THREE.BoxGeometry(3.5, 0.3, 3.5), dark, 10, H + 0.05, 0);
    const hole = new THREE.CircleGeometry(0.28, 12);
    for (let i = 0; i < 9; i++) {
      add(hole, dark, -14 + i * 3, H - 1.2, W / 2 + 0.02);
      add(hole, dark, -14 + i * 3, H - 1.2, -W / 2 - 0.02, 0, 0).rotation.y = Math.PI;
    }
    add(new THREE.BoxGeometry(2.5, 3, 0.2), dark, -2, 1.8, W / 2 + 0.01); // breach in the hull

    const roll = new THREE.Group();
    roll.rotation.x = WRECK_ROLL;
    roll.add(ship);
    const place = new THREE.Group();
    place.position.set(0, y, 0);
    place.rotation.y = WRECK_HEADING;
    place.add(roll);
    return place;
  }

  private buildFish(rnd: () => number): void {
    const site = this.site;
    for (const sp of SPECIES) {
      for (let g = 0; g < sp.groups; g++) {
        let x: number;
        let z: number;
        if (this.env === 'wreck' && rnd() < 0.45) {
          const a = rnd() * Math.PI * 2;
          const r = 6 + rnd() * 14;
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
        } else if (this.env === 'wall') {
          x = (rnd() - 0.5) * AREA * 1.6;
          z = wallEdge(x) + (rnd() - 0.4) * 30;
        } else {
          [x, z] = this.randomSpot(rnd, AREA * 0.85);
        }
        const ground = this.groundAt(x, z);
        const [d0, d1] = sp.depth(site);
        let depth = d0 + rnd() * Math.max(0, d1 - d0);
        if (sp.nearFloor) depth = Math.min(ground, site) - depth;
        depth = Math.min(site - 0.8, ground - 0.8, Math.max(1.5, depth));
        this.schools.push(this.buildSchool(sp, new THREE.Vector3(x, -Math.max(1.5, depth), z), rnd));
      }
    }
  }

  private buildSchool(sp: Species, anchor: THREE.Vector3, rnd: () => number): School {
    const geo = fishGeometry();
    const phase = new Float32Array(sp.count);
    const mesh = new THREE.InstancedMesh(
      geo,
      patch(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }), { fish: true }),
      sp.count,
    );
    mesh.frustumCulled = false;
    const offsets = new Float32Array(sp.count * 3);
    const phases = new Float32Array(sp.count);
    const col = new THREE.Color();
    for (let i = 0; i < sp.count; i++) {
      // Flattened ellipsoid, denser in the middle.
      const r = sp.spread * Math.cbrt(rnd());
      const a = rnd() * Math.PI * 2;
      const b = Math.acos(2 * rnd() - 1);
      offsets[i * 3] = r * Math.sin(b) * Math.cos(a);
      offsets[i * 3 + 1] = r * Math.cos(b) * 0.45;
      offsets[i * 3 + 2] = r * Math.sin(b) * Math.sin(a);
      phases[i] = rnd() * Math.PI * 2;
      phase[i] = phases[i] * 3;
      col.setHex(sp.color).multiplyScalar(0.85 + rnd() * 0.3);
      mesh.setColorAt(i, col);
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    this.world.add(mesh);
    return {
      species: sp,
      mesh,
      offsets,
      phases,
      anchor,
      orbit: 4 + rnd() * 7,
      angle: rnd() * Math.PI * 2,
      dir: rnd() < 0.5 ? 1 : -1,
      center: anchor.clone(),
      flee: new THREE.Vector3(),
    };
  }

  private buildTurtle(): void {
    const shellMat = patch(new THREE.MeshStandardMaterial({ color: 0x5f6b3a, roughness: 0.7, flatShading: true }), { mottle: 0.4 });
    const skinMat = patch(new THREE.MeshStandardMaterial({ color: 0x8c8a5a, roughness: 0.8 }), { mottle: 0.3 });
    const t = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), shellMat);
    shell.scale.set(1.1, 0.4, 1.4);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skinMat);
    head.position.set(0, 0.02, 0.82);
    head.scale.set(1, 0.8, 1.3);
    t.add(shell, head);
    for (const [x, z, len] of [[-1, 0.35, 0.7], [1, 0.35, 0.7], [-1, -0.45, 0.35], [1, -0.45, 0.35]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x * 0.45, 0, z);
      const flip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.22), skinMat);
      flip.position.x = (x * len) / 2;
      pivot.add(flip);
      pivot.userData.side = x;
      pivot.userData.front = z > 0;
      t.add(pivot);
    }
    t.userData.depth = Math.min(this.site - 2, Math.max(4, this.site * 0.45));
    this.turtle = t;
    this.world.add(t);
  }

  // -------------------------------------------------------------------------
  // Per frame

  private resize(): boolean {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return false;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    return true;
  }

  /** `simDt` in simulated seconds, `realDt` in real seconds. */
  draw(simDt: number, realDt: number): void {
    if (!this.resize()) return;
    const s = this.session;
    const key = `${this.environment}:${s.siteDepth}`;
    if (key !== this.builtFor) {
      this.builtFor = key;
      this.rebuild();
    }
    const dt = this.paused ? 0 : realDt;
    this.time += dt;
    fx.uTime.value = this.time;

    this.updateDiver(dt);
    const pos = new THREE.Vector3(this.px, -s.depth, this.pz);
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.diver.position.copy(pos);
    this.diver.rotation.y = this.heading;
    this.diverPitch.rotation.x = clamp(s.velocity * 1.2, -0.55, 0.55);
    this.diverPitch.rotation.z = -this.turnVel * 0.5;
    this.finPhase += dt * (3 + Math.abs(s.velocity) * 8);
    this.fins.forEach((f, i) => (f.rotation.x = Math.sin(this.finPhase + i * Math.PI) * 0.35));

    this.updateCamera(realDt, pos, fwd);
    this.updateLight(Math.max(0, -this.camera.position.y));
    this.updateAmbience();
    this.updateBubbles(simDt, dt, pos, fwd);
    this.updateFish(dt, pos);
    this.updateTurtle(dt);

    // Overlays around the diver.
    const target = Math.min(s.targetDepth, s.seabed);
    this.targetRing.position.set(pos.x, -target, pos.z);
    this.targetRing.visible = Math.abs(target - s.depth) > 0.3;
    this.ceilingDisc.visible = this.ceiling > 0;
    this.ceilingDisc.position.set(pos.x, -this.ceiling, pos.z);
    this.safetyTube.visible = this.safetyBand;
    this.safetyTube.position.set(pos.x, -4.5, pos.z);

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Turns towards the wanted heading and swims forward. A move is refused if the seabed, the wreck,
   * a rock or a coral would come closer than the clearance; the diver then glides along it, or backs
   * off and turns away when wedged. What lies under the diver is handed to the simulation, which
   * keeps them from sinking into it.
   */
  private updateDiver(dt: number): void {
    const s = this.session;
    // Past the edge of the site, turn back towards its centre.
    if (Math.hypot(this.px, this.pz) > AREA) {
      const off = wrapAngle(Math.atan2(-this.px, -this.pz) - this.heading);
      if (Math.abs(off) > 0.3) this.headingTarget = this.heading + Math.sign(off) * 0.5;
    }
    const need = s.depth + CLEARANCE;
    let here = this.footprint(this.px, this.pz, this.heading);
    const fits = (x: number, z: number, h = this.heading) => {
      const g = this.footprint(x, z, h);
      return g >= need || g >= here - 1e-4;
    };

    // Turn, unless that swings the head or the fins into something.
    let turn = clamp(wrapAngle(this.headingTarget - this.heading) * 2, -TURN_RATE, TURN_RATE);
    if (turn !== 0 && fits(this.px, this.pz, this.heading + turn * dt)) this.heading += turn * dt;
    else if (turn !== 0) {
      turn = 0;
      this.headingTarget = this.heading;
    }
    if (dt > 0) this.turnVel += (turn - this.turnVel) * Math.min(1, dt * 4);
    here = this.footprint(this.px, this.pz, this.heading);
    const step = SWIM_SPEED * dt * (1 - Math.min(0.5, Math.abs(turn) * 0.4));
    if (step > 0) {
      // Barely moved for a while (wedged in a nook): back off a little while turning away.
      this.stuckTimer += dt;
      if (this.stuckTimer > 1) {
        if (Math.hypot(this.px - this.stuckFrom.x, this.pz - this.stuckFrom.y) < 0.15) this.backOff = 1.2;
        this.stuckTimer = 0;
        this.stuckFrom.set(this.px, this.pz);
      }
      if (this.backOff > 0) {
        this.backOff -= dt;
        this.headingTarget = this.heading + this.glideSide * 0.8;
        const x = this.px - Math.sin(this.heading) * step * 0.5;
        const z = this.pz - Math.cos(this.heading) * step * 0.5;
        if (fits(x, z)) {
          this.px = x;
          this.pz = z;
        }
      } else {
        // Straight on, else glide along the obstacle (even when facing it squarely): first on the
        // side used last time, then on the other one.
        for (const [a0, f] of GLIDES) {
          const k = step * f;
          const a = a0 * this.glideSide;
          const x = this.px + Math.sin(this.heading + a) * k;
          const z = this.pz + Math.cos(this.heading + a) * k;
          if (fits(x, z)) {
            this.px = x;
            this.pz = z;
            if (a0 < 0) this.glideSide = -this.glideSide;
            break;
          }
        }
      }
    }
    // The scenery only stops the diver from sinking into it; it never lifts them (the depth profile
    // stays entirely in the user's hands).
    s.seabed = Math.max(this.footprint(this.px, this.pz, this.heading) - CLEARANCE, s.depth);
  }

  /** Behind the diver, orbitable, pulled in when the scenery hides the diver. */
  private updateCamera(realDt: number, pos: THREE.Vector3, fwd: THREE.Vector3): void {
    const a = this.heading + this.yaw;
    const want = pos.clone().add(new THREE.Vector3(-Math.sin(a) * 5.5, 1.4, -Math.cos(a) * 5.5));
    const clear = pos.clone();
    const p = new THREE.Vector3();
    for (let i = 1; i <= 12; i++) {
      p.lerpVectors(pos, want, i / 12);
      if (this.groundAt(p.x, p.z) < -p.y + 0.4) break;
      clear.copy(p);
    }
    clear.y = Math.min(clear.y, -0.35);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(clear);
    this.camPos.lerp(clear, Math.min(1, realDt * 4));
    // The smoothing may cut a corner: keep the camera itself out of the scenery.
    this.camPos.y = Math.max(this.camPos.y, -this.groundAt(this.camPos.x, this.camPos.z) + 0.3);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(pos.x + fwd.x * 1.5, pos.y + 0.2, pos.z + fwd.z * 1.5);
    this.dome.position.copy(this.camPos);
  }

  /** Light fades and turns blue with depth (reds are absorbed first); the torch takes over. */
  private updateLight(depth: number): void {
    const k = Math.min(1, depth / 55);
    const water = new THREE.Color(0x2f9fc4).lerp(new THREE.Color(0x021420), Math.pow(k, 0.75));
    this.fog.color.copy(water);
    this.fog.density = 0.026 + 0.018 * k;
    const u = this.dome.material.uniforms;
    u.uHorizon.value.copy(water);
    u.uTop.value.copy(water).lerp(new THREE.Color(0xbff0ff), 0.75 * Math.exp(-depth / 25) + 0.08);
    u.uBottom.value.copy(water).multiplyScalar(0.3);
    this.sun.intensity = 2.4 * Math.exp(-depth / 22) + 0.08;
    this.sun.color.set(0xffffff).lerp(new THREE.Color(0x5fbfd6), Math.min(1, depth / 15));
    this.hemi.intensity = 1.1 * Math.exp(-depth / 28) + 0.1;
    this.hemi.color.set(0xbfe9ff).lerp(new THREE.Color(0x2a6f8a), Math.min(1, depth / 30));
    this.torch.intensity = 40 * ramp(12, 35, depth);
  }

  private updateAmbience(): void {
    const cam = this.camera.position;

    // Waves, on Snell's window above the camera.
    const sp = this.surface.geometry.attributes.position as THREE.BufferAttribute;
    const radius = Math.max(0, -cam.y) * 1.13 + 4;
    this.surface.position.set(cam.x, 0, cam.z);
    this.surface.scale.set(radius, 1, radius);
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i) * radius + cam.x;
      const z = sp.getZ(i) * radius + cam.z;
      sp.setY(i, Math.sin(x * 0.18 + this.time * 1.2) * 0.18 + Math.cos(z * 0.23 + this.time * 0.9) * 0.14);
    }
    sp.needsUpdate = true;

    // Rays follow the camera loosely and sway.
    const fade = Math.exp(-Math.max(0, -cam.y) / 14);
    for (const r of this.rays) {
      const u = r.userData as { dx: number; dz: number; phase: number };
      r.position.set(cam.x + u.dx, 0, cam.z + u.dz);
      r.rotation.set(0.12 + Math.sin(this.time * 0.2 + u.phase) * 0.04, 0, 0.1 + Math.cos(this.time * 0.17 + u.phase) * 0.05);
      r.material.opacity = (0.035 + 0.02 * Math.sin(this.time * 0.6 + u.phase)) * fade;
      r.visible = fade > 0.02;
    }

    // Snow drifting slowly, wrapped in a 30 m cube around the camera.
    const snow = this.snow.geometry.attributes.position as THREE.BufferAttribute;
    const arr = snow.array as Float32Array;
    const drift = this.time * 0.05;
    const wrap = (v: number, c: number) => c - 15 + ((((v - c + 15) % 30) + 30) % 30);
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = wrap(this.snowBase[i] + Math.sin(drift + i) * 0.3, cam.x);
      arr[i + 1] = Math.min(-0.2, wrap(this.snowBase[i + 1] - drift, cam.y));
      arr[i + 2] = wrap(this.snowBase[i + 2], cam.z);
    }
    snow.needsUpdate = true;
  }

  private updateBubbles(simDt: number, dt: number, pos: THREE.Vector3, fwd: THREE.Vector3): void {
    this.bubbleTimer += simDt;
    if (this.session.depth > 0.5 && this.bubbleTimer > 4) {
      this.bubbleTimer = 0;
      for (let i = 0; i < 7 && this.bubbleData.length < 120; i++) {
        const p = pos.clone().addScaledVector(fwd, 0.55);
        p.y += 0.2;
        p.x += (Math.random() - 0.5) * 0.15;
        p.z += (Math.random() - 0.5) * 0.15;
        this.bubbleData.push({ p, r: 0.02 + Math.random() * 0.05, w: Math.random() * 6 });
      }
    }
    let n = 0;
    for (const b of this.bubbleData) {
      b.p.y += dt * (0.8 + b.r * 12);
      b.w += dt * 4;
      b.r *= 1 + dt * 0.04; // expand as the pressure drops
      if (b.p.y > -0.05) continue;
      this.dummy.position.set(b.p.x + Math.sin(b.w) * 0.05, b.p.y, b.p.z + Math.cos(b.w) * 0.05);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(b.r, b.r * 0.7, b.r);
      this.dummy.updateMatrix();
      this.bubbles.setMatrixAt(n++, this.dummy.matrix);
    }
    this.bubbleData = this.bubbleData.filter((b) => b.p.y <= -0.05);
    this.bubbles.count = n;
    this.bubbles.instanceMatrix.needsUpdate = true;
  }

  private updateFish(dt: number, diver: THREE.Vector3): void {
    const tmp = new THREE.Vector3();
    const cam = this.camera.position;
    for (const sc of this.schools) {
      const sp = sc.species;
      sc.angle += (sc.dir * sp.speed * dt) / sc.orbit;
      const c = sc.center;
      c.set(
        sc.anchor.x + Math.cos(sc.angle) * sc.orbit,
        sc.anchor.y + Math.sin(sc.angle * 2 + sc.orbit) * 0.8,
        sc.anchor.z + Math.sin(sc.angle) * sc.orbit,
      );
      // Keep away from the diver.
      tmp.copy(c).add(sc.flee).sub(diver);
      const dist = tmp.length();
      const scare = 4 + sp.spread;
      if (dist < scare) sc.flee.addScaledVector(tmp.normalize(), (scare - dist) * dt * 1.5);
      else sc.flee.multiplyScalar(Math.max(0, 1 - dt * 0.3));
      c.add(sc.flee);
      c.y = Math.min(-1, Math.max(c.y, -this.groundAt(c.x, c.z) + 0.6));

      // Lost in the fog: skip.
      sc.mesh.visible = c.distanceTo(cam) < 90;
      if (!sc.mesh.visible) continue;

      const heading = Math.atan2(-Math.sin(sc.angle) * sc.dir, Math.cos(sc.angle) * sc.dir);
      const spread = 1 + Math.min(1, sc.flee.length() * 0.12);
      for (let i = 0; i < sp.count; i++) {
        const ph = sc.phases[i] + this.time * (1.5 + sp.speed);
        const x = c.x + sc.offsets[i * 3] * spread + Math.sin(ph * 0.5) * 0.2;
        const z = c.z + sc.offsets[i * 3 + 2] * spread + Math.cos(ph * 0.4) * 0.2;
        const y = Math.min(-0.5, Math.max(c.y + sc.offsets[i * 3 + 1] * spread + Math.sin(ph * 0.3) * 0.15, -this.groundAt(x, z) + 0.25));
        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(0, heading + Math.sin(ph * 2) * 0.12, 0);
        this.dummy.scale.set(sp.size * sp.shape[0], sp.size * sp.shape[1], sp.size);
        this.dummy.updateMatrix();
        sc.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      sc.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateTurtle(dt: number): void {
    const t = this.turtle;
    const R = 16;
    this.turtleAngle += (0.35 * dt) / R;
    const a = -this.turtleAngle + 2;
    const x = this.turtleCenter.x + Math.cos(a) * R;
    const z = this.turtleCenter.y + Math.sin(a) * R;
    const y = Math.max(-(t.userData.depth as number) + Math.sin(this.time * 0.15) * 2, -this.groundAt(x, z) + 1);
    t.position.set(x, Math.min(-1, y), z);
    t.rotation.y = Math.atan2(Math.sin(a), -Math.cos(a));
    for (const p of t.children) {
      const side = p.userData.side as number | undefined;
      if (side === undefined) continue;
      const front = p.userData.front as boolean;
      p.rotation.z = side * Math.sin(this.time * 1.4 + (front ? 0 : 1)) * (front ? 0.5 : 0.2);
    }
  }
}
