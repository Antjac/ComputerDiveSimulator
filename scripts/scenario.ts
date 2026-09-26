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
  console.log(`\n== ${label}  depth=${s.depth.toFixed(1)} t=${(s.diveTime/60).toFixed(1)}min rate=${s.ascentRate.toFixed(1)}`);
  for (const c of cs) {
    const v = c.compute(s);
    console.log(c.name.padEnd(18), `GF ${v.gfLow}/${v.gfHigh}`.padEnd(10), `NDL ${v.ndl}`.padEnd(7), `ceil ${v.ceiling.toFixed(1)}`.padEnd(10),
      `stops ${v.plan.stops.map((x) => `${x.depth}m/${x.minutes}`).join(' ')}`.padEnd(40), `TTS ${v.tts}`, `safety ${v.safety.state}`, v.alarms.join(','));
  }
};
s.setTarget(30); run(120); report('arrive 30m');
run(60 * 14); report('30m +16min');
run(60 * 10); report('30m +26min');
s.setTarget(15); run(90); report('ascending to 15');
s.setTarget(3); run(120); report('at 3m (maybe above ceiling)');
s.setTarget(6); run(60*8); report('6m 8min');
s.setTarget(0); run(60*5); report('surface');
console.log('log', s.log.map(l=>({n:l.number, dur:Math.round(l.duration/60), max:l.maxDepth.toFixed(1), alarms:l.alarms})));
run(3600); report('SI 1h');
s.setTarget(18); run(60*30); report('dive 2, 18m 30min');
