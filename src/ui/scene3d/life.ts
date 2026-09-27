// Sea life around the corals: anemones with their clownfish (which hide when the diver comes
// close), starfish and sea urchins on the bottom, jellyfish drifting in the blue, eagle rays gliding
// and reef sharks patrolling at a distance. Purely decorative: none of it is solid.
import * as THREE from 'three';
import {
  anemoneGeometry, clownfishColors, jellyfishGeometry, rayBodyGeometry, rayWingGeometry, sharkGeometry, starfishGeometry, urchinGeometry,
} from './creatures';
import { fishGeometry } from './geometry';
import { patch } from './materials';
import { clamp, wrapAngle } from './math';
import { AREA, Environment } from './sites';

/** What the sea life needs to know about the site. */
export interface SiteQuery {
  env: Environment;
  site: number;
  /** Depth of the seabed or the wreck at (x, z). */
  baseGround(x: number, z: number): number;
  /** Depth of the highest thing at (x, z) (rocks and corals included). */
  groundAt(x: number, z: number): number;
  /** Depth of the seabed alone. */
  floorAt(x: number, z: number): number;
  randomSpot(rnd: () => number, radius?: number): [number, number];
}

const COUNTS: Record<Environment, { anemones: number; starfish: number; urchins: number; jellies: number; rays: number; sharks: number }> = {
  reef: { anemones: 40, starfish: 160, urchins: 220, jellies: 10, rays: 2, sharks: 1 },
  wreck: { anemones: 24, starfish: 90, urchins: 160, jellies: 8, rays: 1, sharks: 2 },
  wall: { anemones: 30, starfish: 70, urchins: 200, jellies: 14, rays: 2, sharks: 2 },
};

/** Beyond this distance from the camera an animal is lost in the haze: not updated nor drawn. */
const FAR = 90;

interface Swimmer {
  obj: THREE.Object3D;
  center: THREE.Vector2;
  radius: number;
  /** Stretch of the loop along z (ellipse). */
  stretch: number;
  angle: number;
  speed: number; // m/s
  depth: number;
  dir: 1 | -1;
  flee: THREE.Vector3;
  heading: number;
  wings?: [THREE.Object3D, THREE.Object3D];
}

interface Jelly {
  x: number;
  y: number;
  z: number;
  size: number;
  phase: number;
  top: number;
  bottom: number;
}

export class SeaLife {
  readonly group = new THREE.Group();
  private dummy = new THREE.Object3D();
  private anemones: { pos: THREE.Vector3; size: number }[] = [];
  private clowns: THREE.InstancedMesh | null = null;
  private clownData: { home: number; phase: number; radius: number; dir: number; hide: number }[] = [];
  private jellies: Jelly[] = [];
  private jellyMesh: THREE.InstancedMesh | null = null;
  private swimmers: Swimmer[] = [];

  constructor(private q: SiteQuery, rnd: () => number, start: [number, number]) {
    const n = COUNTS[q.env];
    this.buildAnemones(rnd, n.anemones, start);
    this.buildBottom(rnd, n.starfish, n.urchins);
    this.buildJellies(rnd, n.jellies, start);
    for (let i = 0; i < n.rays; i++) this.swimmers.push(this.buildRay(rnd, start, i));
    for (let i = 0; i < n.sharks; i++) this.swimmers.push(this.buildShark(rnd, start, i));
  }

  // -------------------------------------------------------------------------
  // Placement

  /** Spot on the reef (raised ground, rocks, wreck) or anywhere on the bottom. */
  private spot(rnd: () => number, onReef: boolean, near?: [number, number], radius = AREA + 10, maxDepth = Infinity): [number, number, number] | null {
    const q = this.q;
    for (let t = 0; t < 40; t++) {
      let x: number;
      let z: number;
      if (near) {
        const r = radius * Math.sqrt(rnd());
        const a = rnd() * Math.PI * 2;
        x = near[0] + Math.cos(a) * r;
        z = near[1] + Math.sin(a) * r;
      } else {
        [x, z] = q.randomSpot(rnd, radius);
      }
      const d = q.groundAt(x, z);
      if (d > q.site + 2.5 || d > maxDepth) continue; // lost in the blue (wall), or too deep
      const raised = d < q.floorAt(x, z) - 0.3 || d < q.site - 0.3;
      if (onReef !== raised) continue;
      return [x, d, z];
    }
    return null;
  }

  private buildAnemones(rnd: () => number, count: number, start: [number, number]): void {
    const colors = [0xb86ad8, 0x8fd06a, 0xe8a0b8, 0xe8d8a8, 0x6ac8c0];
    const mesh = new THREE.InstancedMesh(
      anemoneGeometry(),
      patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), { caustics: true, mottle: 0.1, sway: 0.9 }),
      count,
    );
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // A third of them close to where the diver starts, so that they are met early. Clownfish
      // anemones live in shallow water: none deeper than 25 m.
      const p = this.spot(rnd, true, i < count / 3 ? start : undefined, i < count / 3 ? 25 : undefined, 25);
      if (!p) continue;
      const s = 0.8 + rnd() * 0.7;
      this.dummy.position.set(p[0], -p[1] - 0.04, p[2]);
      this.dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(this.anemones.length, this.dummy.matrix);
      col.setHex(colors[Math.floor(rnd() * colors.length)]).multiplyScalar(0.8 + rnd() * 0.3);
      mesh.setColorAt(this.anemones.length, col);
      this.anemones.push({ pos: new THREE.Vector3(p[0], -p[1] + 0.3 * s, p[2]), size: s });
    }
    mesh.count = this.anemones.length;
    this.group.add(mesh);

    // Two or three clownfish per anemone.
    for (let a = 0; a < this.anemones.length; a++) {
      const k = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < k; i++) this.clownData.push({ home: a, phase: rnd() * Math.PI * 2, radius: 0.15 + rnd() * 0.2, dir: rnd() < 0.5 ? 1 : -1, hide: 0 });
    }
    const geo = clownfishColors(fishGeometry());
    const phase = new Float32Array(this.clownData.length).map(() => rnd() * 6);
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    this.clowns = new THREE.InstancedMesh(
      geo,
      patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }), { fish: true }),
      this.clownData.length,
    );
    this.clowns.frustumCulled = false;
    this.group.add(this.clowns);
  }

  private buildBottom(rnd: () => number, starfish: number, urchins: number): void {
    const place = (mesh: THREE.InstancedMesh, count: number, colors: number[], size: [number, number], onReef: () => boolean) => {
      const col = new THREE.Color();
      let n = 0;
      for (let i = 0; i < count; i++) {
        const p = this.spot(rnd, onReef());
        if (!p) continue;
        const s = size[0] + rnd() * (size[1] - size[0]);
        this.dummy.position.set(p[0], -p[1] - 0.01, p[2]);
        this.dummy.rotation.set((rnd() - 0.5) * 0.2, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.2);
        this.dummy.scale.setScalar(s);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(n, this.dummy.matrix);
        col.setHex(colors[Math.floor(rnd() * colors.length)]).multiplyScalar(0.8 + rnd() * 0.3);
        mesh.setColorAt(n, col);
        n++;
      }
      mesh.count = n;
      this.group.add(mesh);
    };
    place(
      new THREE.InstancedMesh(starfishGeometry(), patch(new THREE.MeshStandardMaterial({ roughness: 0.8 }), { caustics: true, mottle: 0.3 }), starfish),
      starfish,
      [0xd8452f, 0xe07a2a, 0x3a64c8, 0xe8c14a, 0xc83a6a],
      [0.18, 0.32],
      () => rnd() < 0.25,
    );
    place(
      new THREE.InstancedMesh(urchinGeometry(), patch(new THREE.MeshStandardMaterial({ roughness: 0.5 }), { mottle: 0.2 }), urchins),
      urchins,
      [0x1c1622, 0x2a1830, 0x3a2a4a, 0x16181c],
      [0.12, 0.2],
      () => rnd() < 0.7,
    );
  }

  private buildJellies(rnd: () => number, count: number, start: [number, number]): void {
    const q = this.q;
    const mesh = new THREE.InstancedMesh(
      jellyfishGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x6a4a8a,
        emissiveIntensity: 0.35,
        roughness: 0.2,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      count,
    );
    mesh.frustumCulled = false;
    const colors = [0xf0c8e8, 0xc8d8ff, 0xe8e0ff, 0xffd8c8];
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 6 + rnd() * 30;
      const a = rnd() * Math.PI * 2;
      const x = start[0] + Math.cos(a) * r;
      const z = start[1] + Math.sin(a) * r;
      const bottom = Math.min(q.site - 3, q.groundAt(x, z) - 2.5, 20);
      const top = 2.5;
      if (bottom <= top) continue;
      this.jellies.push({ x, z, y: -(top + rnd() * (bottom - top)), size: 0.25 + rnd() * 0.3, phase: rnd() * Math.PI * 2, top, bottom });
      col.setHex(colors[Math.floor(rnd() * colors.length)]);
      mesh.setColorAt(this.jellies.length - 1, col);
    }
    mesh.count = this.jellies.length;
    this.jellyMesh = mesh;
    this.group.add(mesh);
  }

  private swimmer(obj: THREE.Object3D, rnd: () => number, start: [number, number], depth: number, speed: number, far: number): Swimmer {
    const a = rnd() * Math.PI * 2;
    const r = far + rnd() * 15;
    this.group.add(obj);
    return {
      obj,
      center: new THREE.Vector2(start[0] + Math.cos(a) * r, start[1] + Math.sin(a) * r),
      radius: 14 + rnd() * 14,
      stretch: 0.6 + rnd() * 0.5,
      angle: rnd() * Math.PI * 2,
      speed,
      depth,
      dir: rnd() < 0.5 ? 1 : -1,
      flee: new THREE.Vector3(),
      heading: 0,
    };
  }

  private buildRay(rnd: () => number, start: [number, number], i: number): Swimmer {
    const skin = patch(new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.6, side: THREE.DoubleSide }), { mottle: 0.55, caustics: true });
    const ray = new THREE.Group();
    ray.add(new THREE.Mesh(rayBodyGeometry(), skin));
    const wing = (side: number) => {
      const pivot = new THREE.Group();
      pivot.position.x = side * 0.2;
      const m = new THREE.Mesh(rayWingGeometry(), skin);
      if (side < 0) m.scale.x = -1;
      pivot.add(m);
      ray.add(pivot);
      return pivot;
    };
    const wings: [THREE.Object3D, THREE.Object3D] = [wing(1), wing(-1)];
    ray.scale.setScalar(1 + rnd() * 0.3);
    ray.rotation.order = 'YXZ';
    const depth = clamp(this.q.site * 0.55 + i * 3, 5, 22);
    const s = this.swimmer(ray, rnd, start, depth, 0.9, 12 + i * 10);
    s.wings = wings;
    return s;
  }

  private buildShark(rnd: () => number, start: [number, number], i: number): Swimmer {
    const geo = sharkGeometry();
    geo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
    const shark = new THREE.Mesh(
      geo,
      patch(new THREE.MeshStandardMaterial({ color: 0x77828c, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }), { fish: true, swimRate: 2.4 }),
    );
    shark.scale.setScalar(1.6 + rnd() * 0.5);
    shark.rotation.order = 'YXZ';
    const depth = clamp(this.q.site * 0.75 - i * 3, 6, 30);
    return this.swimmer(shark, rnd, start, depth, 1.1, 30 + i * 12);
  }

  // -------------------------------------------------------------------------
  // Per frame

  update(dt: number, time: number, diver: THREE.Vector3, cam: THREE.Vector3): void {
    this.updateClowns(dt, time, diver);
    this.updateJellies(dt, time, cam);
    for (const s of this.swimmers) this.updateSwimmer(s, dt, time, diver, cam);
  }

  /** Clownfish circle their anemone and dive into it when the diver comes within 2.5 m. */
  private updateClowns(dt: number, time: number, diver: THREE.Vector3): void {
    const mesh = this.clowns;
    if (!mesh) return;
    for (let i = 0; i < this.clownData.length; i++) {
      const f = this.clownData[i];
      const { pos: home, size } = this.anemones[f.home];
      const near = home.distanceTo(diver) < 2.5;
      f.hide = clamp(f.hide + (near ? dt * 2 : -dt * 0.5), 0, 1);
      const a = f.phase + f.dir * time * (0.6 + f.radius);
      const r = f.radius * size * (1 - 0.8 * f.hide);
      const x = home.x + Math.cos(a) * r;
      const z = home.z + Math.sin(a) * r;
      const y = home.y + 0.1 * size + Math.sin(time * 1.3 + f.phase) * 0.05 - 0.3 * size * f.hide;
      this.dummy.position.set(x, y, z);
      // Nose along the circle: velocity (-sin a, cos a) × dir.
      this.dummy.rotation.set(0, Math.atan2(-Math.sin(a) * f.dir, Math.cos(a) * f.dir), 0);
      this.dummy.scale.set(0.034, 0.06, 0.12);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Jellyfish pulse and rise slowly, then sink back down once they reach their top. */
  private updateJellies(dt: number, time: number, cam: THREE.Vector3): void {
    const mesh = this.jellyMesh;
    if (!mesh) return;
    for (let i = 0; i < this.jellies.length; i++) {
      const j = this.jellies[i];
      const beat = Math.sin(time * 1.6 + j.phase);
      // Rises on each contraction, drifts down very slowly otherwise.
      j.y += dt * (Math.max(0, beat) * 0.18 - 0.03);
      if (-j.y < j.top) j.y = -j.bottom;
      j.x += Math.sin(time * 0.05 + j.phase) * dt * 0.05;
      const far = Math.hypot(j.x - cam.x, j.z - cam.z) > FAR;
      this.dummy.position.set(j.x, j.y, j.z);
      this.dummy.rotation.set(Math.sin(time * 0.3 + j.phase) * 0.15, j.phase, 0);
      const s = far ? 0 : j.size;
      this.dummy.scale.set(s * (1 + 0.12 * beat), s * (1 - 0.1 * beat), s * (1 + 0.12 * beat));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Rays and sharks follow a wide loop, bank into the turn and keep clear of the diver. */
  private updateSwimmer(s: Swimmer, dt: number, time: number, diver: THREE.Vector3, cam: THREE.Vector3): void {
    s.angle += (s.dir * s.speed * dt) / s.radius;
    const x = s.center.x + Math.cos(s.angle) * s.radius;
    const z = s.center.y + Math.sin(s.angle) * s.radius * s.stretch;
    const pos = s.obj.position;
    const ground = this.q.groundAt(x, z);
    const y = -Math.min(s.depth + Math.sin(time * 0.1 + s.radius) * 1.5, ground - 2);
    // Keep 6 m away from the diver.
    const away = new THREE.Vector3(x + s.flee.x, y, z + s.flee.z).sub(diver);
    const dist = away.length();
    if (dist < 6) s.flee.addScaledVector(away.normalize(), (6 - dist) * dt);
    else s.flee.multiplyScalar(Math.max(0, 1 - dt * 0.2));
    const nx = x + s.flee.x;
    const nz = z + s.flee.z;
    const ny = Math.min(-1.5, y + s.flee.y);
    const heading = Math.atan2(nx - pos.x, nz - pos.z);
    if (pos.lengthSq() > 0 && Math.hypot(nx - pos.x, nz - pos.z) > 1e-4) s.heading += wrapAngle(heading - s.heading) * Math.min(1, dt * 3);
    pos.set(nx, ny, nz);
    s.obj.visible = pos.distanceTo(cam) < FAR;
    s.obj.rotation.y = s.heading;
    s.obj.rotation.z = -s.dir * clamp(s.speed / s.radius, 0, 0.3) * 4; // banking
    if (s.wings) {
      // Beats a few times, then glides.
      const beat = Math.sin(time * 1.3 + s.radius) * (0.25 + 0.2 * Math.max(0, Math.sin(time * 0.25 + s.radius)));
      s.wings[0].rotation.z = beat;
      s.wings[1].rotation.z = -beat;
    }
  }
}
