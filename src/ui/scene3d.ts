import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DiveSession } from '../engine/session';

export type Environment = 'reef' | 'wreck' | 'wall';

// World units are metres, y = -depth. The diver swims around a circle so the scenery loops.
const PATH_R = 30;
const SWIM_SPEED = 0.7; // m per real second (visual only, independent of the time speed)
const WORLD = 240;
// Sideways moves off the path (positive = outward, i.e. to the diver's left).
const LANE = 12; // max offset from the path (m)
const SIDE_SPEED = 0.6; // m per real second
const FLOOR_CLEARANCE = 1.2; // keep this much water under the diver (m)
// Wreck dimensions, shared by the model and the diver's collision test.
const WRECK_L = 36;
const WRECK_W = 7;
const WRECK_H = 5;

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

/**
 * Depth of the sea floor at (x, z). Along the diver's path it never rises above the site depth, so
 * the diver (clamped to the site depth by the simulation) never goes through the scenery.
 */
function floorDepth(env: Environment, site: number, x: number, z: number): number {
  const r = Math.hypot(x, z);
  const away = ramp(3, 12, Math.abs(r - PATH_R));
  let d = site + 0.4 + fbm(x * 0.09, z * 0.09) * 0.8;
  if (env === 'reef') {
    const bumps = Math.max(0, fbm(x * 0.035 + 10, z * 0.035) - 0.42) * 2.2;
    d -= away * Math.min(site * 0.55, bumps * site * 0.6);
  } else if (env === 'wreck') {
    d -= away * Math.max(0, fbm(x * 0.05 + 3, z * 0.05) - 0.55) * 6;
  } else {
    // A pinnacle inside the circle, a drop-off into the blue outside.
    const top = Math.max(4, site * 0.12) + fbm(x * 0.1, z * 0.1) * 3;
    d += (top - d) * ramp(PATH_R - 4, PATH_R - 9, r);
    d -= ramp(PATH_R - 4, PATH_R - 9, r) * (1 - ramp(PATH_R - 9, PATH_R - 20, r)) * (fbm(x * 0.3, z * 0.3) - 0.5) * 4;
    d += ramp(PATH_R + 5, PATH_R + 30, r) * Math.min(45, site * 0.9);
  }
  return Math.max(1.5, d);
}

// ---------------------------------------------------------------------------
// Fish

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
}

const SPECIES: Species[] = [
  { color: 0xcfd8e0, size: 0.2, count: 140, shape: [0.2, 0.3], speed: 1.1, spread: 3.5, depth: (s) => [3, Math.min(15, s - 2)] },
  { color: 0xffd23a, size: 0.35, count: 30, shape: [0.25, 0.42], speed: 0.8, spread: 2.5, depth: (s) => [5, Math.min(22, s - 2)] },
  { color: 0xff7a3c, size: 0.12, count: 60, shape: [0.25, 0.45], speed: 0.4, spread: 2, depth: () => [1, 3], nearFloor: true },
  { color: 0x9aa7b0, size: 1.2, count: 14, shape: [0.12, 0.16], speed: 0.6, spread: 3, depth: (s) => [Math.min(12, s * 0.5), Math.min(30, s * 0.7)] },
  { color: 0x6b5a48, size: 1.0, count: 2, shape: [0.35, 0.42], speed: 0.3, spread: 3, depth: () => [0.8, 2], nearFloor: true },
  { color: 0x3a6fd8, size: 0.25, count: 40, shape: [0.22, 0.5], speed: 0.5, spread: 2.5, depth: () => [1.5, 5], nearFloor: true },
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

function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 12, 8);
  const tail = new THREE.ConeGeometry(0.35, 0.4, 4);
  tail.rotateX(Math.PI / 2);
  tail.scale(0.25, 1, 1);
  tail.translate(0, 0, -0.62);
  return mergeGeometries([body, tail])!;
}

// ---------------------------------------------------------------------------

/** First-person-ish 3D view of the dive: same depth control as the water column, more scenery. */
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
  private schools: School[] = [];
  private turtle!: THREE.Group;
  private turtleAngle = 0;

  private hemi = new THREE.HemisphereLight(0xbfe9ff, 0x2a2418, 1);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private torch = new THREE.SpotLight(0xfff4e0, 0, 28, 0.42, 0.5, 1.2);
  private fog = new THREE.FogExp2(0x3fa9cc, 0.03);

  private diver = new THREE.Group();
  private diverPitch = new THREE.Group();
  private fins: THREE.Group[] = [];
  private finPhase = 0;
  private pathAngle = 0;
  private lateral = 0;
  private lateralTarget = 0;
  private lateralVel = 0;
  private wreck: THREE.Object3D | null = null;

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
  private drag: { x: number; y: number; target: number; lateral: number; yaw: number; orbit: boolean } | null = null;
  private time = 0;
  private dummy = new THREE.Object3D();

  constructor(private canvas: HTMLCanvasElement, private session: DiveSession) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x3fa9cc);
    this.sun.position.set(20, 60, 10);
    this.scene.add(this.hemi, this.sun, this.world);

    this.buildDiver();
    this.buildAmbience();
    this.buildOverlays();
    this.bindInput();
  }

  // -------------------------------------------------------------------------
  // Input: vertical drag = target depth, horizontal drag = move left/right,
  // right-button or Shift + drag = orbit the camera.

  /** Moves the sideways target by `metres` to the right of the screen (negative = left). */
  steer(metres: number): void {
    this.setLateralTarget(this.lateralTarget + this.screenRightSign() * metres);
    this.onInteract?.();
  }

  private setLateralTarget(v: number): void {
    this.lateralTarget = Math.max(-LANE, Math.min(LANE, Math.round(v * 2) / 2));
  }

  /** Screen-right is inward (−) when the camera is behind the diver, outward once it looks back. */
  private screenRightSign(): number {
    return Math.cos(this.yaw) >= 0 ? -1 : 1;
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
        lateral: this.lateralTarget,
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
      if (Math.abs(dx) > 4) this.setLateralTarget(this.drag.lateral + this.screenRightSign() * dx * 0.05);
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
    const suit = new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.8 });
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.4, metalness: 0.4 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.6, side: THREE.DoubleSide });
    const maskMat = new THREE.MeshStandardMaterial({ color: 0x7fe0ff, emissive: 0x1a6070, roughness: 0.2 });
    const compMat = new THREE.MeshStandardMaterial({ color: 0xff6a3d, emissive: 0x552010 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.65, 4, 10), suit);
    torso.rotation.x = Math.PI / 2;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.65, 14), tankMat);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, 0.26, -0.05);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), suit);
    head.position.set(0, 0.06, 0.58);
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.06), maskMat);
    mask.position.set(0, 0.08, 0.7);
    this.diverPitch.add(torso, tank, head, mask);

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
    // Surface seen from below.
    const surf = new THREE.PlaneGeometry(220, 220, 48, 48);
    surf.rotateX(-Math.PI / 2);
    this.surface = new THREE.Mesh(
      surf,
      new THREE.MeshBasicMaterial({ color: 0xc6f1ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
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
    this.targetRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe678, transparent: true, opacity: 0.8, fog: false }));

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
    this.wreck = null;

    const env = this.environment;
    const site = this.session.siteDepth;
    const rnd = mulberry32(env === 'reef' ? 11 : env === 'wreck' ? 23 : 37);
    const floor = (x: number, z: number) => floorDepth(env, site, x, z);

    this.world.add(this.buildTerrain(floor, site));
    this.world.add(this.buildRocks(floor, rnd));
    this.world.add(...this.buildCorals(floor, site, rnd));
    if (env === 'wreck') {
      this.wreck = this.buildWreck(site);
      this.world.add(this.wreck);
      this.wreck.updateMatrixWorld(true);
    }

    // Fish schools spread around the path so the diver swims through them.
    let k = 0;
    for (const sp of SPECIES) {
      const groups = sp.count <= 2 ? 3 : sp.size < 0.3 ? 4 : 2;
      for (let g = 0; g < groups; g++, k++) {
        const a = (k * 2.39996) % (Math.PI * 2);
        const r = PATH_R + (rnd() - 0.5) * 10;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const [d0, d1] = sp.depth(site);
        let depth = d0 + rnd() * Math.max(0, d1 - d0);
        if (sp.nearFloor) depth = floor(x, z) - depth;
        depth = Math.min(site - 0.8, Math.max(1.5, depth));
        this.schools.push(this.buildSchool(sp, new THREE.Vector3(x, -depth, z), rnd));
      }
    }
    this.buildTurtle(site);
  }

  private buildTerrain(floor: (x: number, z: number) => number, site: number): THREE.Mesh {
    const seg = 170;
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xd2bb85);
    const rock = new THREE.Color(0x6e6858);
    const reef = new THREE.Color(0x5d6a45);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = floor(x, z);
      pos.setY(i, -d);
      const up = Math.min(1, Math.max(0, (site - d) / 5));
      c.copy(sand).lerp(this.environment === 'reef' ? reef : rock, up);
      const n = (noise(x * 0.4, z * 0.4) - 0.5) * 0.12;
      colors[i * 3] = c.r + n;
      colors[i * 3 + 1] = c.g + n;
      colors[i * 3 + 2] = c.b + n;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: this.environment === 'wall' }));
  }

  private buildRocks(floor: (x: number, z: number) => number, rnd: () => number): THREE.InstancedMesh {
    const n = 160;
    const mesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x7b776a, roughness: 1, flatShading: true }),
      n,
    );
    let i = 0;
    while (i < n) {
      const x = (rnd() - 0.5) * 160;
      const z = (rnd() - 0.5) * 160;
      if (Math.abs(Math.hypot(x, z) - PATH_R) < 2.5) continue;
      const s = 0.3 + rnd() * rnd() * 2.2;
      this.dummy.position.set(x, -floor(x, z) + s * 0.2, z);
      this.dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      this.dummy.scale.set(s, s * (0.5 + rnd() * 0.5), s * (0.7 + rnd() * 0.6));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i++, this.dummy.matrix);
    }
    return mesh;
  }

  private buildCorals(floor: (x: number, z: number) => number, site: number, rnd: () => number): THREE.Object3D[] {
    const env = this.environment;
    const palette = [0xff6f91, 0xff9a3c, 0xb06cff, 0xffd84a, 0xff4f5e, 0x4fd1c5, 0xe8e0c8];

    // Brain / boulder coral.
    const brainGeo = new THREE.SphereGeometry(0.6, 12, 8);
    brainGeo.scale(1, 0.6, 1);
    // Branching coral: a few tilted twigs.
    const twigs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new THREE.CylinderGeometry(0.035, 0.07, 0.9, 5);
      t.translate(0, 0.45, 0);
      t.rotateZ((i % 3 - 1) * 0.5);
      t.rotateY(i * 1.05);
      twigs.push(t);
    }
    const branchGeo = mergeGeometries(twigs)!;
    // Tube sponges.
    const tubes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const t = new THREE.CylinderGeometry(0.12, 0.15, 0.8 + i * 0.35, 10, 1, true);
      t.translate(Math.cos(i * 2.1) * 0.16, (0.8 + i * 0.35) / 2, Math.sin(i * 2.1) * 0.16);
      tubes.push(t);
    }
    const tubeGeo = mergeGeometries(tubes)!;
    // Sea fan.
    const fanGeo = new THREE.CircleGeometry(0.9, 14, 0, Math.PI);

    const kinds = [
      { geo: brainGeo, n: env === 'reef' ? 260 : 60, side: THREE.FrontSide },
      { geo: branchGeo, n: env === 'reef' ? 320 : 80, side: THREE.FrontSide },
      { geo: tubeGeo, n: env === 'wall' ? 220 : 90, side: THREE.DoubleSide },
      { geo: fanGeo, n: env === 'wall' ? 200 : env === 'reef' ? 90 : 50, side: THREE.DoubleSide },
    ];
    const out: THREE.Object3D[] = [];
    kinds.forEach((kind, ki) => {
      const mesh = new THREE.InstancedMesh(kind.geo, new THREE.MeshStandardMaterial({ roughness: 0.85, side: kind.side }), kind.n);
      const col = new THREE.Color();
      let i = 0;
      let tries = 0;
      while (i < kind.n && tries++ < kind.n * 30) {
        let x: number;
        let z: number;
        if (env === 'wall' && rnd() < 0.7) {
          // On the pinnacle and its face.
          const a = rnd() * Math.PI * 2;
          const r = PATH_R - 4 - rnd() * 14;
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
        } else {
          x = (rnd() - 0.5) * 130;
          z = (rnd() - 0.5) * 130;
        }
        const dPath = Math.abs(Math.hypot(x, z) - PATH_R);
        if (dPath < 1.6) continue;
        const d = floor(x, z);
        // Reefs thrive on the bumps, sand patches stay sparse.
        if (env === 'reef' && d > site - 0.5 && rnd() < 0.6) continue;
        const s = 0.5 + rnd() * 1.4;
        this.dummy.position.set(x, -d - (ki === 0 ? 0.15 * s : 0), z);
        this.dummy.rotation.set(ki === 3 ? 0 : (rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, 0);
        if (ki === 3 && env === 'wall') this.dummy.rotation.y = -Math.atan2(z, x) + Math.PI / 2;
        this.dummy.scale.setScalar(s);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
        col.setHex(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.75 + rnd() * 0.3);
        mesh.setColorAt(i, col);
        i++;
      }
      mesh.count = i;
      out.push(mesh);
    });
    return out;
  }

  private buildWreck(site: number): THREE.Group {
    const L = WRECK_L;
    const W = WRECK_W;
    const H = WRECK_H;
    const rust = new THREE.MeshStandardMaterial({ color: 0x7a4b32, roughness: 0.95, flatShading: true });
    const paint = new THREE.MeshStandardMaterial({ color: 0x8c7462, roughness: 0.9, flatShading: true });
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
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
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

    // Lying on its side on the sand, beside the path.
    const roll = new THREE.Group();
    roll.rotation.x = 0.22;
    roll.add(ship);
    const a0 = 0.6;
    const place = new THREE.Group();
    place.position.set(Math.cos(a0) * (PATH_R + 10), -(site + 1.2), Math.sin(a0) * (PATH_R + 10));
    place.rotation.y = -a0 - Math.PI / 2;
    place.add(roll);
    return place;
  }

  private buildSchool(sp: Species, anchor: THREE.Vector3, rnd: () => number): School {
    const mesh = new THREE.InstancedMesh(fishGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.25 }), sp.count);
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
      col.setHex(sp.color).multiplyScalar(0.85 + rnd() * 0.3);
      mesh.setColorAt(i, col);
    }
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

  private buildTurtle(site: number): void {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x5f6b3a, roughness: 0.7, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x8c8a5a, roughness: 0.8 });
    const t = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 7), shellMat);
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
    t.userData.depth = Math.min(site - 2, Math.max(4, site * 0.45));
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
    const env = this.environment;
    const site = s.siteDepth;
    const floor = (x: number, z: number) => floorDepth(env, site, x, z);

    // Diver along the path, offset sideways towards the lateral target unless the seabed or the
    // wreck is in the way; blocked on both counts, they slide back towards the path (always clear).
    this.pathAngle += (SWIM_SPEED * dt) / (PATH_R + this.lateral);
    const a = this.pathAngle;
    const prevLateral = this.lateral;
    const step = Math.max(-SIDE_SPEED, Math.min(SIDE_SPEED, (this.lateralTarget - this.lateral) * 1.5)) * dt;
    if (this.isClear(a, this.lateral + step, s.depth, floor)) this.lateral += step;
    else if (!this.isClear(a, this.lateral, s.depth, floor)) {
      const back = SIDE_SPEED * 2 * dt;
      this.lateral = Math.abs(this.lateral) <= back ? 0 : this.lateral - Math.sign(this.lateral) * back;
    }
    if (dt > 0) this.lateralVel += ((this.lateral - prevLateral) / dt - this.lateralVel) * Math.min(1, dt * 5);
    const r = PATH_R + this.lateral;
    const pos = new THREE.Vector3(Math.cos(a) * r, -s.depth, Math.sin(a) * r);
    const fwd = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    this.diver.position.copy(pos);
    this.diver.rotation.y = -a + Math.atan2(this.lateralVel, SWIM_SPEED);
    this.diverPitch.rotation.x = Math.max(-0.55, Math.min(0.55, s.velocity * 1.2));
    this.finPhase += dt * (3 + Math.abs(s.velocity) * 8);
    this.fins.forEach((f, i) => (f.rotation.x = Math.sin(this.finPhase + i * Math.PI) * 0.35));

    // Camera behind the diver, orbitable, kept in the water and above the floor.
    const back = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const want = pos.clone().addScaledVector(back, -5.5);
    want.y += 1.4;
    want.y = Math.min(want.y, -0.35);
    want.y = Math.max(want.y, -floor(want.x, want.z) + 0.8);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(want);
    this.camPos.lerp(want, Math.min(1, realDt * 4));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(pos.x + fwd.x * 1.5, pos.y + 0.2, pos.z + fwd.z * 1.5);

    this.updateLight(Math.max(0, -this.camera.position.y));
    this.updateAmbience();
    this.updateBubbles(simDt, dt, pos, fwd);
    this.updateFish(dt, pos, floor);
    this.updateTurtle(dt, floor);

    // Overlays around the diver.
    const rt = PATH_R + this.lateralTarget;
    this.targetRing.position.set(Math.cos(a) * rt, -s.targetDepth, Math.sin(a) * rt);
    this.targetRing.visible = Math.abs(s.targetDepth - s.depth) > 0.3 || Math.abs(this.lateralTarget - this.lateral) > 0.3;
    this.ceilingDisc.visible = this.ceiling > 0;
    this.ceilingDisc.position.set(pos.x, -this.ceiling, pos.z);
    this.safetyTube.visible = this.safetyBand;
    this.safetyTube.position.set(pos.x, -4.5, pos.z);

    this.renderer.render(this.scene, this.camera);
  }

  /** Whether the diver fits at path angle `a`, sideways offset `lateral` and `depth`. */
  private isClear(a: number, lateral: number, depth: number, floor: (x: number, z: number) => number): boolean {
    if (lateral === 0) return true;
    const r = PATH_R + lateral;
    const p = new THREE.Vector3(Math.cos(a) * r, -depth, Math.sin(a) * r);
    // On the path the floor can be as close as 0.4 m below the deepest allowed depth.
    const margin = Math.min(FLOOR_CLEARANCE, this.session.siteDepth + 0.4 - depth);
    if (floor(p.x, p.z) - depth < margin) return false;
    if (this.wreck) {
      const q = this.wreck.worldToLocal(p);
      if (Math.abs(q.x) < WRECK_L / 2 + 1.5 && Math.abs(q.z) < WRECK_W / 2 + 2.5 && q.y < WRECK_H + 6) return false;
    }
    return true;
  }

  /** Light fades and turns blue with depth (reds are absorbed first); the torch takes over. */
  private updateLight(depth: number): void {
    const k = Math.min(1, depth / 55);
    const water = new THREE.Color(0x46b4d8).lerp(new THREE.Color(0x02141f), Math.pow(k, 0.75));
    (this.scene.background as THREE.Color).copy(water);
    this.fog.color.copy(water);
    this.fog.density = 0.026 + 0.018 * k;
    this.sun.intensity = 2.4 * Math.exp(-depth / 22) + 0.08;
    this.sun.color.set(0xffffff).lerp(new THREE.Color(0x5fbfd6), Math.min(1, depth / 15));
    this.hemi.intensity = 1.1 * Math.exp(-depth / 28) + 0.1;
    this.hemi.color.set(0xbfe9ff).lerp(new THREE.Color(0x2a6f8a), Math.min(1, depth / 30));
    this.torch.intensity = 40 * ramp(12, 35, depth);
  }

  private updateAmbience(): void {
    const cam = this.camera.position;

    // Waves.
    const sp = this.surface.geometry.attributes.position as THREE.BufferAttribute;
    this.surface.position.set(Math.round(cam.x / 5) * 5, 0, Math.round(cam.z / 5) * 5);
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i) + this.surface.position.x;
      const z = sp.getZ(i) + this.surface.position.z;
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

  private updateFish(dt: number, diver: THREE.Vector3, floor: (x: number, z: number) => number): void {
    const tmp = new THREE.Vector3();
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
      c.y = Math.min(-1, Math.max(c.y, -floor(c.x, c.z) + 0.6));

      const heading = Math.atan2(-Math.sin(sc.angle) * sc.dir, Math.cos(sc.angle) * sc.dir);
      const spread = 1 + Math.min(1, sc.flee.length() * 0.12);
      for (let i = 0; i < sp.count; i++) {
        const ph = sc.phases[i] + this.time * (1.5 + sp.speed);
        const x = c.x + sc.offsets[i * 3] * spread + Math.sin(ph * 0.5) * 0.2;
        const z = c.z + sc.offsets[i * 3 + 2] * spread + Math.cos(ph * 0.4) * 0.2;
        const y = Math.min(-0.5, Math.max(c.y + sc.offsets[i * 3 + 1] * spread + Math.sin(ph * 0.3) * 0.15, -floor(x, z) + 0.25));
        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(0, heading + Math.sin(ph * 2) * 0.12, 0);
        this.dummy.scale.set(sp.size * sp.shape[0], sp.size * sp.shape[1], sp.size);
        this.dummy.updateMatrix();
        sc.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      sc.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateTurtle(dt: number, floor: (x: number, z: number) => number): void {
    const t = this.turtle;
    this.turtleAngle += (0.35 * dt) / (PATH_R + 4);
    const a = -this.turtleAngle + 2;
    const x = Math.cos(a) * (PATH_R + 4);
    const z = Math.sin(a) * (PATH_R + 4);
    const y = Math.max(-(t.userData.depth as number) + Math.sin(this.time * 0.15) * 2, -floor(x, z) + 1);
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
