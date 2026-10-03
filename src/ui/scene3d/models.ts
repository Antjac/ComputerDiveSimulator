// Static 3D models: the diver, the water around, the boat, the depth overlays.
import * as THREE from 'three';
import { mulberry32 } from './math';

/** Diver in their suit, BCD and tank, with fins (kicked by the animation) and a dive torch. */
export function buildDiver(diver: THREE.Group, pitch: THREE.Group, fins: THREE.Group[], torch: THREE.SpotLight): void {
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
    pitch.add(torso, vest, tank, valve, head, mask, reg, hose);

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
      fins.push(hip);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.45, 4, 8), suit);
      arm.rotation.set(Math.PI / 2.4, 0, side * 0.25);
      arm.position.set(side * 0.2, -0.12, 0.35);
      pitch.add(leg, hip, arm);
    }
    const comp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.07), compMat);
    comp.position.set(-0.24, -0.2, 0.52);
    pitch.add(comp);

    // Dive torch: only noticeable once the surface light fades.
    torch.position.set(0, 0.1, 0.7);
    torch.target.position.set(0, -1.5, 8);
    pitch.add(torch, torch.target);

    diver.add(pitch);
  }

/** Water all around, the surface seen from below, sun rays, marine snow and the exhaled bubbles. */
export function buildAmbience() {
  const rays: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = [];
    // Water all around: brighter towards the surface, darker towards the depths. Its horizon is the
    // fog colour, so distant scenery melts into it.
    const dome = new THREE.Mesh(
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
    dome.renderOrder = -1;
    dome.frustumCulled = false;

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
    const surface = new THREE.Mesh(
      surf,
      new THREE.MeshBasicMaterial({
        color: 0xc6f1ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false,
        alphaMap: new THREE.CanvasTexture(cv),
      }),
    );

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
      rays.push(ray);
    }

    // Marine snow around the camera.
    const n = 1400;
    const snowBase = new Float32Array(n * 3);
    const rnd = mulberry32(7);
    for (let i = 0; i < n * 3; i++) snowBase[i] = rnd() * 30;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe8f4f0, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false }));
    snow.frustumCulled = false;

    // Exhaled bubbles.
    const bubbles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.6, emissive: 0x335566 }),
      120,
    );
    bubbles.count = 0;
    bubbles.frustumCulled = false;
  return { dome, surface, rays, snowBase, snow, bubbles };
}

/**
 * Sea surface seen from above (diver at the surface): a finely meshed square of water around the
 * camera whose vertices and colours follow the swell each frame (Scene3D.updateOcean: darker troughs,
 * lighter crests, a little foam), and a flat sea beyond it up to the horizon. Nearly opaque: the
 * shallow scenery only shows faintly under it.
 */
export function buildOcean(): { near: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhongMaterial>; far: THREE.Mesh<THREE.RingGeometry, THREE.MeshPhongMaterial> } {
  const geo = new THREE.PlaneGeometry(1, 1, 120, 120);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  const near = new THREE.Mesh(
    geo,
    new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x5f8fa8, shininess: 120, flatShading: true, transparent: true, opacity: 0.95 }),
  );
  // Flat sea from the edge of the near square to the horizon (fog blends it into the sky).
  const ring = new THREE.RingGeometry(34, 1500, 64, 1);
  ring.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(ring, new THREE.MeshPhongMaterial({ color: 0x0b4462, specular: 0x4f7f98, shininess: 60, transparent: true, opacity: 0.97 }));
  for (const m of [near, far]) {
    m.frustumCulled = false;
    m.visible = false;
  }
  return { near, far };
}

  /** Small dive boat (about 7 m), bow along +z; seen from below: red antifouling, keel, outboard. */
export function buildBoat(boat: THREE.Group): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0x8e2a22, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.3 });
    // Hull side profile (z along the boat, y up), extruded across its width.
    const profile = new THREE.Shape();
    profile.moveTo(-3.4, -0.55);
    profile.lineTo(2.1, -0.55);
    profile.quadraticCurveTo(3.3, -0.4, 3.7, 0.55);
    profile.lineTo(-3.4, 0.55);
    profile.closePath();
    const hullGeo = (depth: number) => {
      const g = new THREE.ExtrudeGeometry(profile, { depth, bevelEnabled: false });
      g.translate(0, 0, -depth / 2);
      g.rotateY(-Math.PI / 2); // profile x → boat z
      return g;
    };
    const hull = new THREE.Mesh(hullGeo(2.4), white);
    // Antifouling: a slightly wider copy clipped to the part under the waterline.
    const bottom = new THREE.Mesh(hullGeo(2.44), red);
    bottom.scale.set(1.01, 1, 1.01);
    red.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, 5), red);
    keel.position.set(0, -0.66, 0.1);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 2), white);
    cabin.position.set(0, 1.1, 0.4);
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.3, 0.35), dark);
    motor.position.set(0, -0.1, -3.6);
    const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), dark);
    prop.rotation.x = Math.PI / 2;
    prop.position.set(0, -0.65, -3.8);
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.06), dark);
    ladder.position.set(0.7, -0.35, -3.45);
    boat.add(hull, bottom, keel, cabin, motor, prop, ladder);
    boat.visible = false;
  }

/** Target depth ring, ceiling disc and safety stop band around the diver. */
export function buildOverlays() {
    const ring = new THREE.TorusGeometry(1.3, 0.025, 6, 48);
    ring.rotateX(Math.PI / 2);
    const targetRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe678, transparent: true, opacity: 0.8, fog: false, toneMapped: false }));

    const disc = new THREE.CircleGeometry(9, 48);
    disc.rotateX(-Math.PI / 2);
    const ceilingDisc = new THREE.Mesh(
      disc,
      new THREE.MeshBasicMaterial({ color: 0xff4a3c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );

    const tube = new THREE.CylinderGeometry(7, 7, 3, 48, 1, true);
    const safetyTube = new THREE.Mesh(
      tube,
      new THREE.MeshBasicMaterial({ color: 0x50dc8c, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    return { targetRing, ceilingDisc, safetyTube };
}
