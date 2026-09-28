// Robot student: plays every exercise of the Exercises tab (src/app/exerciseDefs.ts) on every computer
// and reports success or failure; each one must be doable on every model. `npm run exercises`, or
// `npm run exercises -- <exercise id>`.
import { DiveSession } from '../src/engine/session';
import { createComputers } from '../src/computers';
import { EXERCISES, type ExContext, type SetupTools } from '../src/app/exerciseDefs';
Object.defineProperty(globalThis.performance, 'now', { value: () => 1_000_000 });

const argv = (globalThis as { process?: { argv: string[] } }).process!.argv;
const only = argv[2];
let failures = 0;
for (const ex of EXERCISES) {
  if (only && ex.id !== only) continue;
  const line: string[] = [];
  for (const proto of createComputers()) {
    const s = new DiveSession();
    s.siteDepth = 50; s.rmv = 14; s.rescueAlert = false; s.tank = { ...s.tank, volume: 15, fill: 232 }; s.refillTank();
    const cs = createComputers();
    const c = cs.find((x) => x.id === proto.id)!;
    s.on((e) => cs.forEach((k) => (e === 'start' ? k.onDiveStart(s) : k.onDiveEnd(s))));
    const advance = (sec: number, step = 1) => { for (let t = 0; t < sec; t += step) { s.step(step); cs.forEach((k) => k.tick(s, step)); } };
    const reach = (d: number) => { s.setTarget(d); for (let i = 0; i < 60 && Math.abs(s.depth - d) > 0.2; i++) advance(10); };
    const tools: SetupTools = {
      s, c,
      go: (d, sec) => { s.setTarget(d); advance(sec); },
      stayUntil: (d, until, max) => { const st = s.clock; reach(d); while (s.clock - st < max && !until(c.compute(s))) advance(20); return s.clock - st; },
      toFirstStop: () => { for (let i = 0; i < 800; i++) { const v = c.compute(s); if (v.atStop || !v.inDeco) return; s.setTarget(v.stopDepth); advance(10, 0.5); } },
    };
    const vars = ex.setup(tools);
    s.setRate(0);
    const seen = new Map<string, number>();
    const mem: Record<string, number | boolean> = {};
    const t0 = s.clock;
    let last = s.clock;
    let result = 'timeout';
    let phase = 0;
    for (let i = 0; i < 20000; i++) {
      advance(0.5, 0.5);
      const v = c.compute(s);
      const tt = s.clock - t0;
      for (const a of v.alarms) if (!seen.has(a)) seen.set(a, tt);
      // The student's actions.
      switch (ex.id) {
        case 'ascent':
          if (phase === 0) { s.setRate(-18); if (seen.has('ASCENT') || s.depth < 13) phase = 1; }
          else if (phase === 1) { s.setRate(0); s.setTarget(10); phase = 2; }
          break;
        case 'safety':
          if (phase === 0) { s.setTarget(4.5); phase = 1; }
          else if (phase === 1 && c.safetyState === 'done') { s.setTarget(0); phase = 2; }
          break;
        case 'deco':
          if (!v.inDeco && !(c.safetyState === 'pending' || c.safetyState === 'active' || c.safetyState === 'paused')) s.setTarget(0);
          else s.setTarget(v.inDeco ? Math.max(v.stopDepth, v.ceiling + 0.3) : 4.5);
          break;
        case 'ceiling':
          if (phase === 0) { phase = 1; mem.t = tt; }
          if (phase === 1 && v.inDeco) s.setTarget(v.stopDepth - 2); // follows the stop shown
          if (phase === 1 && tt - Number(mem.t) > 40) { s.setTarget(Math.max(v.stopDepth, v.ceiling + 0.3)); phase = 2; }
          else if (phase === 2) s.setTarget(Math.max(v.stopDepth, v.ceiling + 0.3));
          break;
        case 'repetitive':
          s.setTarget(20);
          break;
        case 'mod':
          if (phase === 0) { s.setRate(6); if (s.depth > v.mod + 0.5) phase = 1; }
          else if (phase === 1) { s.setRate(0); s.setTarget(v.mod - 3); phase = 2; }
          break;
      }
      const x: ExContext = { s, c, v, t: tt, dt: s.clock - last, seen, mem };
      last = s.clock;
      if (ex.done(x)) { result = `OK ${Math.round(tt / 60)}'`; break; }
      const why = ex.fail?.(x);
      if (why) { result = `FAIL(${why.fr.slice(0, 40)})`; break; }
    }
    void vars;
    if (!result.startsWith('OK')) failures++;
    line.push(`${c.name}: ${result}`);
  }
  console.log(`\n== ${ex.id}\n  ` + line.join('\n  '));
}
console.log(failures ? `\n✗ ${failures} exercise runs not passed` : '\n✓ every exercise passed on every computer');
