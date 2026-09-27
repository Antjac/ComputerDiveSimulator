// Geometry of the sea life added around the corals: anemones, starfish, sea urchins, jellyfish,
// eagle rays and reef sharks. Each shape is built once per site and drawn with instancing (or as
// a single mesh), so that the extra life costs few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './math';

/** Keeps only position, normal and uv, without index, so that parts can be merged. */
function part(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name);
  return out;
}

/**
 * Sea anemone: a short column crowned with curved tentacles, about 0.5 m high. Vertex colours
 * darken the column and lighten the tips (multiplied by the instance colour).
 */
export function anemoneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const column = new THREE.CylinderGeometry(0.17, 0.2, 0.12, 14, 1);
  column.translate(0, 0.06, 0);
  parts.push(part(column));
  const rnd = mulberry32(17);
  for (let i = 0; i < 100; i++) {
    const r = 0.18 * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const len = 0.2 + rnd() * 0.14;
    // Outer tentacles lean out and droop more than the ones in the middle.
    const lean = 0.25 + (r / 0.18) * 0.9;
    const out = (x: number) => new THREE.Vector3(Math.cos(a) * x, 0, Math.sin(a) * x);
    const base = out(r).setY(0.11);
    const mid = base.clone().add(out(Math.sin(lean) * len * 0.55)).setY(0.11 + Math.cos(lean * 0.6) * len * 0.6);
    const tip = base.clone().add(out(Math.sin(lean) * len * 1.05)).setY(0.11 + Math.cos(lean) * len * 0.75);
    const curve = new THREE.QuadraticBezierCurve3(base, mid, tip);
    parts.push(part(new THREE.TubeGeometry(curve, 4, 0.008 + rnd() * 0.005, 3, false)));
  }
  const g = mergeGeometries(parts)!;
  const p = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.6 + 0.7 * Math.min(1, Math.max(0, (p.getY(i) - 0.1) / 0.3));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Five-armed starfish lying flat, 1 m across (scaled down per instance). */
export function starfishGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.17;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 2, curveSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.03, 0);
  g.computeVertexNormals();
  return part(g);
}

/** Sea urchin: a dark ball bristling with long spines, 1 m across (scaled down per instance). */
export function urchinGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [part(new THREE.IcosahedronGeometry(0.22, 1))];
  const dirs = new THREE.IcosahedronGeometry(1, 1).attributes.position as THREE.BufferAttribute;
  const up = new THREE.Vector3(0, 1, 0);
  const seen = new Set<string>();
  const d = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i < dirs.count; i++) {
    d.fromBufferAttribute(dirs, i).normalize();
    const key = `${d.x.toFixed(2)},${d.y.toFixed(2)},${d.z.toFixed(2)}`;
    if (seen.has(key) || d.y < -0.5) continue; // no spines into the ground
    seen.add(key);
    const spine = new THREE.ConeGeometry(0.018, 0.34, 3);
    spine.translate(0, 0.17 + 0.18, 0);
    q.setFromUnitVectors(up, d);
    spine.applyQuaternion(q);
    parts.push(part(spine));
  }
  const g = mergeGeometries(parts)!;
  g.translate(0, 0.12, 0);
  return g;
}

/** Jellyfish: a translucent bell with hanging tentacles, bell 1 m across (scaled per instance). */
export function jellyfishGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.5 * Math.sin((t * Math.PI) / 2) * (1 + 0.08 * t), 0.45 * Math.cos((t * Math.PI) / 2) - 0.05 * t * t));
  }
  const parts: THREE.BufferGeometry[] = [part(new THREE.LatheGeometry(pts, 16))];
  // Frilly oral arms in the middle and fine tentacles around the rim.
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.PlaneGeometry(0.08, 0.9, 1, 6);
    arm.translate(0, -0.45, 0);
    arm.rotateY((i * Math.PI) / 4);
    parts.push(part(arm));
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const len = 0.9 + (i % 3) * 0.3;
    const t = new THREE.PlaneGeometry(0.012, len, 1, 4);
    t.translate(0, -len / 2, 0);
    t.rotateY(-a);
    t.translate(Math.cos(a) * 0.46, -0.04, Math.sin(a) * 0.46);
    parts.push(part(t));
  }
  return mergeGeometries(parts)!;
}

/** Eagle ray: body, head and whip-like tail; the wings are separate (they flap). Nose towards +z. */
export function rayBodyGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 14, 8);
  body.scale(0.55, 0.22, 1.1);
  const head = new THREE.SphereGeometry(0.12, 10, 6);
  head.scale(1.3, 0.8, 1.4);
  head.translate(0, 0, 0.55);
  const tail = new THREE.CylinderGeometry(0.004, 0.035, 2.2, 4, 1);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, -1.55);
  return mergeGeometries([part(body), part(head), part(tail)])!;
}

/** One eagle ray wing, root along the body side (x = 0), tip at x = 1.3. */
export function rayWingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.42);
  s.quadraticCurveTo(0.7, 0.35, 1.3, -0.12); // leading edge
  s.quadraticCurveTo(0.7, -0.12, 0, -0.5); // trailing edge
  s.lineTo(0, 0.42);
  const g = new THREE.ShapeGeometry(s, 6);
  g.rotateX(Math.PI / 2); // lies flat, shape y → z (towards the nose)
  return part(g);
}

/**
 * Reef shark, one unit long like fishGeometry() (nose towards +z, tail beyond -0.35) so that the
 * FISH shader makes its tail swing: slender body, dorsal and pectoral fins, tall upper tail lobe.
 */
export function sharkGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(new THREE.Vector2(0.105 * Math.sin(Math.PI * Math.pow(t, 0.62)) + 0.012 * (1 - t), -0.5 + t * 1.0));
  }
  const body = new THREE.LatheGeometry(pts, 12);
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.85, 1);
  const fin = (points: [number, number][]) => {
    const s = new THREE.Shape();
    points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
    const g = new THREE.ShapeGeometry(s);
    g.rotateY(-Math.PI / 2); // shape x → z
    return part(g);
  };
  const dorsal = fin([[0.12, 0.07], [-0.02, 0.26], [-0.07, 0.24], [-0.04, 0.07]]);
  const caudal = fin([[-0.46, 0.0], [-0.66, 0.3], [-0.6, 0.02], [-0.6, -0.02], [-0.62, -0.16], [-0.46, -0.01]]);
  const second = fin([[-0.28, 0.05], [-0.33, 0.11], [-0.36, 0.04]]);
  const pectoral = (side: number) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.18);
    s.lineTo(0.26, -0.02);
    s.lineTo(0.2, -0.06);
    s.lineTo(0, 0.08);
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(Math.PI / 2);
    g.rotateZ(-0.35);
    if (side < 0) g.scale(-1, 1, 1);
    g.translate(side * 0.07, -0.05, 0);
    return part(g);
  };
  return mergeGeometries([part(body), dorsal, caudal, second, pectoral(1), pectoral(-1)])!;
}

/** Clownfish colours as vertex colours on the fish shape: orange with three white bands. */
export function clownfishColors(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const orange = new THREE.Color(0xff6a10);
  const white = new THREE.Color(0xf4f4f0);
  const black = new THREE.Color(0x201510);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const band = [0.26, 0.0, -0.3].some((b) => Math.abs(z - b) < 0.055);
    const edge = [0.26, 0.0, -0.3].some((b) => Math.abs(Math.abs(z - b) - 0.07) < 0.015) || z < -0.6;
    c.copy(band ? white : edge ? black : orange);
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Ribbons of brown algae, about 1.6 m high, swaying with the swell. */
export function kelpGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const h = 1.1 + (i % 3) * 0.35;
    const b = new THREE.PlaneGeometry(0.09, h, 1, 8);
    const p = b.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + h / 2;
      p.setX(k, p.getX(k) * (0.5 + 0.9 * Math.sin((Math.PI * y) / h + 0.3)) + Math.sin(y * 3 + i) * 0.04);
    }
    b.translate(0, h / 2, 0);
    b.rotateZ(((i % 3) - 1) * 0.12);
    b.rotateY(i * 1.25);
    b.translate(Math.cos(i * 2.1) * 0.12, 0, Math.sin(i * 2.1) * 0.12);
    b.computeVertexNormals();
    parts.push(part(b));
  }
  return mergeGeometries(parts)!;
}
