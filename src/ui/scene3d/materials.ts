// Shader tweaks on the standard material: caustics, mottled surfaces, sand ripples, swaying soft
// corals and swimming fish.
import * as THREE from 'three';

export const fx = { uTime: { value: 0 } };

export interface Look {
  caustics?: boolean;
  mottle?: number;
  ripples?: boolean;
  sway?: number;
  fish?: boolean;
  /** Tail beat of the fish, in rad/s (9 by default: small reef fish). */
  swimRate?: number;
}

export const VERT_HEAD = /* glsl */ `
uniform float uTime;
varying vec3 vWPos;
varying vec3 vWNormal;
#ifdef FISH
attribute float aPhase;
varying float vFishY;
#endif
`;

export const VERT_BEGIN = /* glsl */ `
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
transformed.x += sin(uTime * FISH_RATE + aPhase - position.z * 6.0) * 0.1 * (1.0 - smoothstep(-0.6, 0.3, position.z));
vFishY = position.y;
#endif
`;

export const VERT_WORLD = /* glsl */ `
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

export const FRAG_HEAD = /* glsl */ `
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

export const FRAG_COLOR = /* glsl */ `
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

export function patch<M extends THREE.MeshStandardMaterial>(mat: M, look: Look): M {
  const defs: string[] = [];
  if (look.mottle) defs.push(`#define MOTTLE ${look.mottle.toFixed(3)}`);
  if (look.ripples) defs.push('#define RIPPLES');
  if (look.caustics) defs.push('#define CAUSTICS');
  if (look.sway) defs.push(`#define SWAY ${look.sway.toFixed(3)}`);
  if (look.fish) defs.push('#define FISH', `#define FISH_RATE ${(look.swimRate ?? 9).toFixed(3)}`);
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
