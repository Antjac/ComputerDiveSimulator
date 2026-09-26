import { DiveSession } from '../src/engine/session';
import { createComputers } from '../src/computers';

const s = new DiveSession();
// Full speed toward targets, as the timings below assume.
s.ascentSpeed = 22;
s.descentSpeed = 25;
const cs = createComputers();
s.on((e) => cs.forEach((c) => (e === 'start' ? c.onDiveStart(s) : c.onDiveEnd(s))));
const run = (sec: number) => { for (let i = 0; i < sec * 2; i++) { s.step(0.5); cs.forEach((c) => c.tick(s, 0.5)); } };
const report = (label: string) => {
  console.log(`\n== ${label}  depth=${s.depth.toFixed(1)} t=${(s.diveTime / 60).toFixed(1)} tank=${s.tankPressure.toFixed(0)} bar`);
  for (const c of cs) {
    const v = c.compute(s);
    console.log(c.name.padEnd(20), `ai=${v.tank.ai}`.padEnd(9), `${c.gasTimeName || '-'} ${v.tank.gasTime ?? '—'}`.padEnd(14), `TTS ${v.tts}`, v.alarms.join(','));
  }
};
s.setTarget(30); run(180); report('30 m, 3 min');
run(600); report('30 m, 13 min');
run(600); report('30 m, 23 min');
run(300); report('30 m, 28 min');
