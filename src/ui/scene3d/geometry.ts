// Geometry of the scenery and of the fish.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, fbm, mulberry32, noise } from './math';


/** Smooth, lumpy geometry: `shape(x, y, z)` returns the radius factor along each unit direction. */
export function lumpy(detail: number, shape: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
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

export function rockGeometry(): THREE.BufferGeometry {
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

export function brainGeometry(): THREE.BufferGeometry {
  const g = lumpy(4, (x, y, z) => 0.6 * (1 + 0.05 * Math.sin(22 * (x + Math.sin(z * 5) * 0.25)) + 0.1 * (fbm(x * 2 + 4, z * 2 + y) - 0.5)));
  g.scale(1, 0.75, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) * 0.3);
  g.computeVertexNormals();
  return g;
}

/** Staghorn coral: a few levels of forking branches. */
export function branchGeometry(): THREE.BufferGeometry {
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
export function tableGeometry(): THREE.BufferGeometry {
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

export function tubeGeometry(): THREE.BufferGeometry {
  const tubes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const t = new THREE.CylinderGeometry(0.12, 0.15, 0.8 + i * 0.35, 10, 1, true);
    t.translate(Math.cos(i * 2.1) * 0.16, (0.8 + i * 0.35) / 2, Math.sin(i * 2.1) * 0.16);
    tubes.push(t);
  }
  return mergeGeometries(tubes)!;
}

/** Barrel sponge: a thick open vase. */
export function barrelGeometry(): THREE.BufferGeometry {
  const pts = [
    [0.2, 0], [0.38, 0.2], [0.5, 0.55], [0.5, 0.9], [0.46, 1.1], [0.38, 1.1], [0.4, 0.9], [0.38, 0.55], [0.1, 0.3],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 18);
}

/** Sea fan: a half disc whose lattice comes from an alpha map. */
export function fanGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(0.9, 18, 0, Math.PI);
}

export let fanTexture: THREE.Texture | null = null;
export function fanAlpha(): THREE.Texture {
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
export function whipGeometry(): THREE.BufferGeometry {
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
export function grassGeometry(): THREE.BufferGeometry {
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
export function fishGeometry(): THREE.BufferGeometry {
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
