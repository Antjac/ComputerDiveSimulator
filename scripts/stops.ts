// Decompression stop checks for every computer (or one: `npm run stops -- <id>`).
//  1. Deco dive (40 m / 25 min on air), then follow the computer's own stops: the stop time must
//     count down steadily once at the stop (never grow), and the diver must reach the surface.
//  2. At the 6 m stop, go to 5.5 m then 5.0 m: report the violation level and the lock after 3 min.
import { DiveSession } from '../src/engine/session';
import { createComputers } from '../src/computers';
import type { DiveComputer } from '../src/computers';

// Node's process is not typed in this project (no @types/node).
const only = (globalThis as { process?: { argv: string[] } }).process?.argv[2];

function setup(id: string): { s: DiveSession; c: DiveComputer; step: (sec: number) => void } {
  const s = new DiveSession();
  s.siteDepth = 60;
  const cs = createComputers();
  const c = cs.find((x) => x.id === id)!;
  s.on((e) => cs.forEach((x) => (e === 'start' ? x.onDiveStart(s) : x.onDiveEnd(s))));
  const step = (sec: number) => {
    for (let i = 0; i < sec * 2; i++) {
      s.step(0.5);
      cs.forEach((x) => x.tick(s, 0.5));
    }
  };
  s.descentSpeed = 20;
  s.ascentSpeed = 9;
  s.setTarget(40);
  step(25 * 60);
  return { s, c, step };
}

for (const { id, name } of createComputers()) {
  if (only && id !== only) continue;
  const problems: string[] = [];

  // 1. Follow the stops.
  {
    const { s, c, step } = setup(id);
    let prev: { depth: number; sec: number; at: boolean } | null = null;
    let surfacedAt = -1;
    for (let t = 0; t < 120 * 60; t += 10) {
      const v = c.compute(s);
      s.reportedCeiling = v.ceiling;
      if (v.locked) { problems.push(`locked while following its own stops (${Math.round(t / 60)}')`); break; }
      if (v.inDeco && prev && prev.at && v.atStop && prev.depth === v.stopDepth && v.stopTimeSec > prev.sec + 10) {
        problems.push(`stop time grew at the ${v.stopDepth} m stop: ${prev.sec}s → ${v.stopTimeSec}s`);
      }
      if (v.ceilingViolation) problems.push(`violation ${v.ceilingViolation} while following the stops at ${s.depth.toFixed(1)} m`);
      prev = { depth: v.stopDepth, sec: v.stopTimeSec, at: v.atStop };
      s.setTarget(v.inDeco ? v.stopDepth : v.safety.state === 'pending' || v.safety.state === 'active' ? 4.5 : 0);
      if (!s.inDive || (s.depth < 0.1 && !v.inDeco)) { surfacedAt = Math.round(t / 60); break; }
      step(10);
    }
    if (surfacedAt < 0) problems.push('never reached the surface');
    console.log(`\n${name}: surfaced after ${surfacedAt}' of ascent`);
  }

  // 2. Above the 6 m stop.
  {
    const { s, c, step } = setup(id);
    for (let i = 0; i < 400; i++) {
      const v = c.compute(s);
      if (v.stopDepth <= 6 && s.depth <= 6.05) break;
      s.setTarget(v.inDeco ? v.stopDepth : 6);
      step(10);
    }
    const out: string[] = [];
    for (const d of [6.0, 5.5, 5.0]) {
      s.setTarget(d);
      step(40);
      const v = c.compute(s);
      out.push(`${d.toFixed(1)} m: viol=${v.ceilingViolation}${v.alarms.includes('CEILING') ? ' CEILING' : ''}`);
    }
    step(150);
    out.push(`3 min at 5.0 m: ${c.locked ? 'locked' : 'not locked'}`);
    console.log(`  6 m stop → ${out.join(' | ')}`);
  }

  console.log(problems.length ? problems.map((p) => `  ✗ ${p}`).join('\n') : '  ✓ stops OK');
}
