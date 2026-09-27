// Predictions shown by several computers: gradient factors or ascent time after staying a few more
// minutes at the current depth.
import { depthToPressure, planAscent, type DecoParams } from '../../engine/buhlmann';
import type { DiveSession } from '../../engine/session';

/** GF @SURF (highest gradient at the surface, %) after `minutes` more at `depth`. */
export function surfGfAfter(s: DiveSession, depth: number, minutes: number): number {
  const t = s.tissues.clone();
  t.expose(depthToPressure(depth), s.gas, minutes);
  return t.maxGradientPercent(depthToPressure(0));
}

/**
 * GF RATE: how much GF @SURF rises (r > 0) or falls over the next minute at `depth`. `text` has one
 * decimal below 10, as in the Mares figures ("77/1.6", "163/1").
 */
export function gfRate(s: DiveSession, depth: number): { r: number; text: string } {
  const r = surfGfAfter(s, depth, 1) - s.tissues.maxGradientPercent(depthToPressure(0));
  const a = Math.abs(r);
  return { r, text: a < 9.95 ? a.toFixed(1).replace(/\.0$/, '') : String(Math.round(a)) };
}

/** Total ascent time (min) if the diver stays `minutes` more at `depth` (TTS @+5, ASC+5…). */
export function ttsAfter(s: DiveSession, depth: number, minutes: number, p: DecoParams, anchor: number): number {
  const t = s.tissues.clone();
  t.expose(depthToPressure(depth), s.gas, minutes);
  return planAscent(t, depth, s.gas, p, anchor).tts;
}
