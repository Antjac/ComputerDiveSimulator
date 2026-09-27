import * as THREE from 'three';
import type { DiveSession } from '../../engine/session';
import { fanAlpha, fishGeometry, rockGeometry } from './geometry';
import { fx, patch } from './materials';
import { clamp, fbm, mulberry32, noise, ramp, wrapAngle } from './math';
import { AREA, CLEARANCE, Environment, WORLD, WRECK_H, WRECK_HEADING, WRECK_L, WRECK_ROLL, WRECK_W, floorDepth, startOf, wallEdge, wreckTop } from './sites';
import { SeaLife } from './life';
import { SolidGrid } from './solids';
import { buildAmbience, buildBoat, buildDiver, buildOverlays } from './models';
import { CORALS, CoralKind, SPECIES, School, Species } from './species';

export type { Environment } from './sites';

const SWIM_SPEED = 0.7; // m per real second (visual only, independent of the time speed)
const TURN_RATE = 0.8; // rad per real second
/** Directions tried when the way ahead is blocked: angle off the heading, share of the speed. */
const GLIDES: [number, number][] = [[0, 1], [0.6, 0.8], [1.2, 0.4], [Math.PI / 2, 0.3], [-0.6, 0.8], [-1.2, 0.4], [-Math.PI / 2, 0.3]];

export class Scene3D {
  ceiling = 0;
  safetyBand = false;
  stopDepth = 0;
  paused = false;
  environment: Environment = 'reef';
  /** Called once the user has interacted with the view (to hide the hint). */
  onInteract: (() => void) | null = null;
  /** Boat offering a full tank (main.ts): comes alongside the diver while true, leaves otherwise. */
  boatWanted = false;

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
  private life: SeaLife | null = null;

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

  private boat = new THREE.Group();
  private boatPos = 0; // 0 = away (hidden), 1 = alongside
  private boatDock = new THREE.Vector3();
  private boatDir = new THREE.Vector3(); // direction it comes from (and leaves to)
  private boatAt: { x: number; top: number; bottom: number } | null = null;

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

    buildDiver(this.diver, this.diverPitch, this.fins, this.torch);
    this.scene.add(this.diver);
    const amb = buildAmbience();
    this.dome = amb.dome;
    this.scene.add(this.dome);
    this.surface = amb.surface;
    this.scene.add(this.surface);
    this.rays = amb.rays;
    for (const ray of this.rays) this.scene.add(ray);
    this.snowBase = amb.snowBase;
    this.snow = amb.snow;
    this.scene.add(this.snow);
    this.bubbles = amb.bubbles;
    this.scene.add(this.bubbles);
    const ov = buildOverlays();
    this.targetRing = ov.targetRing;
    this.ceilingDisc = ov.ceilingDisc;
    this.safetyTube = ov.safetyTube;
    this.scene.add(this.targetRing, this.ceilingDisc, this.safetyTube);
    buildBoat(this.boat);
    this.scene.add(this.boat);
    this.renderer.localClippingEnabled = true;
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
  // Boat

  /** Crosses in front of the diver and stops broadside, about 9 m ahead of them. */
  private updateBoat(dt: number, pos: THREE.Vector3, fwd: THREE.Vector3): void {
    if (this.boatPos === 0 && this.boatWanted) {
      this.boatDock.set(pos.x, 0, pos.z).addScaledVector(fwd, 9);
      this.boatDir.set(fwd.z, 0, -fwd.x);
    }
    this.boatPos = clamp(this.boatPos + ((this.boatWanted ? 1 : -1) * dt) / 2.5, 0, 1);
    this.boat.visible = this.boatPos > 0;
    this.boatAt = null;
    if (!this.boat.visible) return;
    const e = 1 - Math.pow(1 - this.boatPos, 3);
    // Arrives bow first and leaves the same way, ahead.
    this.boat.position.copy(this.boatDock).addScaledVector(this.boatDir, (this.boatWanted ? 45 : -45) * (1 - e));
    this.boat.position.y = Math.sin(this.time * 1.1) * 0.06;
    this.boat.rotation.set(0, Math.atan2(-this.boatDir.x, -this.boatDir.z), Math.sin(this.time * 0.9) * 0.03);
    if (this.boatPos < 1) return;
    // Anchors for the speech bubble (top of the cabin, keel), in CSS px of the canvas; kept inside
    // the view (top centre when the boat is behind the camera) so the question stays on screen.
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const top = this.boat.position.clone().add(new THREE.Vector3(0, 1.7, 0)).project(this.camera);
    const keel = this.boat.position.clone().add(new THREE.Vector3(0, -0.8, 0)).project(this.camera);
    const toY = (v: number) => ((1 - clamp(v, -0.9, 0.9)) / 2) * h;
    this.boatAt =
      top.z < 1 && keel.z < 1
        ? { x: ((clamp(top.x, -0.9, 0.9) + 1) / 2) * w, top: toY(Math.max(top.y, keel.y)), bottom: toY(Math.min(top.y, keel.y)) }
        : { x: w / 2, top: toY(0.9), bottom: toY(0.9) };
  }

  /** Boat alongside (else null): centre, top of the cabin and keel, in CSS px of the canvas. */
  boatAnchor(): { x: number; top: number; bottom: number } | null {
    return this.boatAt;
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
    this.life = new SeaLife(
      {
        env,
        site,
        baseGround: (x, z) => this.baseGround(x, z),
        groundAt: (x, z) => this.groundAt(x, z),
        floorAt: (x, z) => this.floorAt(x, z),
        randomSpot: (r, radius) => this.randomSpot(r, radius),
      },
      rnd,
      [this.px, this.pz],
    );
    this.world.add(this.life.group);
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
    this.life?.update(dt, this.time, pos, this.camera.position);
    this.updateBoat(realDt, pos, fwd);

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
    // The diver waits (no swimming ahead) while the boat is there, so as not to swim through it.
    const step = this.boatPos > 0 ? 0 : SWIM_SPEED * dt * (1 - Math.min(0.5, Math.abs(turn) * 0.4));
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
