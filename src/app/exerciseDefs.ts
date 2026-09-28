// Exercises for a student on their own: a starting situation prepared by the simulator, something to
// do, what to watch on the computer, a success condition read from the simulator's state, and a
// debrief built from the chosen computer's own rules and from what it actually signalled. Questions
// are about behaviour (which signal, when, what follows), never about stop times, which are only
// approximated for proprietary algorithms.
import { depthToPressure, gasLabel } from '../engine/buhlmann';
import type { DiveSession } from '../engine/session';
import type { ComputerView, DiveComputer } from '../computers/base';
import { depthLabel, imperial, rateLabel } from '../units';

export type Bi = { fr: string; en: string };

/** What an exercise sees at each check. */
export interface ExContext {
  s: DiveSession;
  c: DiveComputer;
  v: ComputerView;
  /** Simulated seconds since the exercise started (after "Go"), and since the previous check. */
  t: number;
  dt: number;
  /** First time (s) each signal was seen: the computer's alarm codes, and a few events of the exercise. */
  seen: Map<string, number>;
  /** Free memory of the exercise. */
  mem: Record<string, number | boolean>;
}

/** Tools to put the simulation in the starting situation. */
export interface SetupTools {
  s: DiveSession;
  /** The computer shown. */
  c: DiveComputer;
  /** Goes to `depth` and stays there for `sec` simulated seconds. */
  go(depth: number, sec: number): void;
  /** Stays at `depth` (after getting there) until `until` holds or `maxSec` passed; returns the seconds spent. */
  stayUntil(depth: number, until: (v: ComputerView) => boolean, maxSec: number): number;
  /** Ascends stop by stop until the diver is at the computer's first stop. */
  toFirstStop(): void;
}

export interface Exercise {
  id: string;
  title: Bi;
  goal: Bi;
  /** Prepares the starting situation; returns values for the situation text. */
  setup(x: SetupTools): Record<string, string>;
  /** The starting situation, with {placeholders} from setup(). */
  situation: Bi;
  task: Bi;
  observe: Bi[];
  /** Success: returns true. */
  done(x: ExContext): boolean;
  /** Failure: returns why, or null. */
  fail?(x: ExContext): Bi | null;
  /** What the computer's own rules say, for the debrief (lines); `r`: the setup's values and the exercise's memory. */
  rules(c: DiveComputer, s: DiveSession, v: ComputerView, r: { vars: Record<string, string>; mem: ExContext['mem'] }): Bi[];
}

const min = (sec: number) => String(Math.round(sec / 60));
/** A rate threshold as the manuals give it ("12 m/min", not "12.0 m/min"). */
const rate = (r: number) => (imperial() || r % 1 ? rateLabel(r) : `${r} m/min`);
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const surfaced = (x: ExContext) => x.v.depth < 1;

/** Stops are a grid of depths, or a continuous ceiling (the computer's own rule). */
function decoRule(c: DiveComputer): Bi {
  const p = c.baseParams();
  return c.violationRef === 'ceiling'
    ? {
      fr: `Votre ${c.name} raisonne en plafond continu : la profondeur à ne pas dépasser remonte peu à peu pendant la décompression.`,
      en: `Your ${c.name} uses a continuous ceiling: the depth not to go above rises gradually during decompression.`,
    }
    : {
      fr: `Votre ${c.name} donne des paliers tous les ${depthLabel(p.stopStep, 0)}, le dernier à ${depthLabel(p.lastStop, 0)} ; il vous considère au palier jusqu'à ${depthLabel(c.stopWindow, 1)} plus profond.`,
      en: `Your ${c.name} gives stops every ${depthLabel(p.stopStep, 0)}, the last one at ${depthLabel(p.lastStop, 0)}; you are at the stop down to ${depthLabel(c.stopWindow, 1)} deeper.`,
    };
}

export const EXERCISES: Exercise[] = [
  {
    id: 'ndl',
    title: { fr: 'Arriver au bout du temps sans palier', en: 'Run out of no-deco time' },
    goal: {
      fr: 'Voir comment l’ordinateur annonce la fin de la plongée sans palier, et ce qui remplace le temps sans palier.',
      en: 'See how the computer announces the end of the no-deco dive, and what replaces the no-deco time.',
    },
    setup: (x) => {
      const sec = 60 + x.stayUntil(30, (v) => v.inDeco || v.ndl <= 5, 40 * 60);
      return { time: min(sec), ndl: String(x.c.compute(x.s).ndl) };
    },
    situation: {
      fr: 'Vous êtes à 30 m depuis {time} min, à l’air. Il vous reste {ndl} min sans palier.',
      en: 'You have been at 30 m for {time} min, on air. {ndl} min of no-deco time are left.',
    },
    task: {
      fr: 'Restez à 30 m sans toucher aux commandes (vous pouvez accélérer le temps ×5 ou ×10) jusqu’à ce que l’ordinateur annonce des paliers obligatoires.',
      en: 'Stay at 30 m without touching the controls (you can speed time up ×5 or ×10) until the computer announces mandatory stops.',
    },
    observe: [
      { fr: 'Le temps sans palier qui diminue, et l’alerte avant qu’il n’arrive à zéro.', en: 'The no-deco time going down, and the warning before it reaches zero.' },
      { fr: 'Ce qui prend sa place : profondeur du premier palier, durée, temps total de remontée.', en: 'What replaces it: first stop depth, its time, total ascent time.' },
    ],
    done: (x) => x.v.inDeco,
    fail: (x) => (surfaced(x) ? { fr: 'Vous êtes remonté avant d’entrer en décompression.', en: 'You ascended before entering decompression.' } : null),
    rules: (c) => [decoRule(c)],
  },
  {
    id: 'ascent',
    title: { fr: 'Remonter trop vite', en: 'Ascend too fast' },
    goal: {
      fr: 'Découvrir le signal de vitesse de remontée excessive et ses conséquences sur votre ordinateur.',
      en: 'Discover the fast ascent signal and its consequences on your computer.',
    },
    setup: (x) => {
      x.go(25, 10 * 60);
      return {};
    },
    situation: { fr: 'Vous êtes à 25 m depuis 10 min, à l’air, sans palier obligatoire.', en: 'You have been at 25 m for 10 min, on air, with no mandatory stop.' },
    task: {
      fr: 'Appuyez plusieurs fois sur ▲ pour remonter vite (15 m/min ou plus) jusqu’à ce que votre ordinateur réagisse. Ralentissez ensuite (■ ou ▼) et stabilisez-vous vers 10 m.',
      en: 'Press ▲ several times to ascend fast (15 m/min or more) until your computer reacts. Then slow down (■ or ▼) and hold around 10 m.',
    },
    observe: [
      { fr: 'Le signal affiché (texte, flèches, barre, couleur) et le son.', en: 'The signal shown (text, arrows, bar, colour) and the sound.' },
      { fr: 'Ce qui change ensuite : palier de sécurité allongé ou obligatoire, pénalité…', en: 'What changes afterwards: longer or mandatory safety stop, penalty…' },
    ],
    done: (x) => {
      if (!x.seen.has('ASCENT')) return false;
      // Slowed down: 15 s without the alarm, below 12 m.
      if (x.v.alarms.includes('ASCENT') || x.v.depth < 3) x.mem.calm = 0;
      else x.mem.calm = (Number(x.mem.calm) || 0) + x.dt;
      return Number(x.mem.calm) >= 15 && x.v.depth <= 12;
    },
    fail: (x) => (surfaced(x) ? { fr: 'Vous êtes arrivé en surface : recommencez en ralentissant plus tôt.', en: 'You reached the surface: try again, slowing down earlier.' } : null),
    rules: (c) => {
      let r = 0;
      for (let k = 2; k <= 60 && !r; k += 0.5) if (c.ascentAlarmCondition(k, 20)) r = k;
      if (!r) return [];
      const delay = c.ascentAlarmDelay > 0 ? { fr: `, pendant plus de ${c.ascentAlarmDelay} s`, en: `, for more than ${c.ascentAlarmDelay} s` } : { fr: '', en: '' };
      return [{
        fr: `D’après ses règles, votre ${c.name} déclenche l’alarme de vitesse vers 20 m au-delà de ${rate(r)}${delay.fr}.`,
        en: `According to its rules, your ${c.name} raises the ascent rate alarm around 20 m above ${rate(r)}${delay.en}.`,
      }];
    },
  },
  {
    id: 'safety',
    title: { fr: 'Faire le palier de sécurité', en: 'Do the safety stop' },
    goal: {
      fr: 'Savoir où commence le décompte du palier de sécurité, ce qui l’interrompt et quand on peut sortir.',
      en: 'Know where the safety stop countdown starts, what interrupts it and when you can surface.',
    },
    setup: (x) => {
      x.go(18, 12 * 60);
      return {};
    },
    situation: { fr: 'Vous êtes à 18 m depuis 12 min, à l’air, sans palier obligatoire.', en: 'You have been at 18 m for 12 min, on air, with no mandatory stop.' },
    task: {
      fr: 'Remontez calmement (8 à 9 m/min au plus), faites le palier de sécurité demandé par votre ordinateur jusqu’au bout, puis remontez en surface.',
      en: 'Ascend calmly (8 to 9 m/min at most), do the safety stop your computer asks for until the end, then surface.',
    },
    observe: [
      { fr: 'À quelle profondeur le décompte démarre, et comment il est affiché.', en: 'At which depth the countdown starts, and how it is shown.' },
      { fr: 'Ce qui se passe si vous sortez de la zone du palier pendant le décompte.', en: 'What happens if you leave the stop zone during the countdown.' },
    ],
    done: (x) => {
      if (x.c.safetyState === 'done') x.mem.safetyDone = true;
      return surfaced(x) && x.mem.safetyDone === true;
    },
    fail: (x) => (surfaced(x) && x.mem.safetyDone !== true ? { fr: 'Vous êtes sorti avant la fin du palier de sécurité.', en: 'You surfaced before the end of the safety stop.' } : null),
    rules: (c, s) => {
      const ss = c.safetyStop;
      return [{
        fr: `Palier de sécurité de votre ${c.name} : ${mmss(c.safetySeconds(s))} entre ${depthLabel(ss.top, 0)} et ${depthLabel(ss.bottom, 0)}, après une plongée plus profonde que ${depthLabel(ss.trigger, 0)} ; redescendre sous ${depthLabel(ss.reset, 0)} le fait repartir de zéro.`,
        en: `Safety stop of your ${c.name}: ${mmss(c.safetySeconds(s))} between ${depthLabel(ss.top, 0)} and ${depthLabel(ss.bottom, 0)}, after a dive deeper than ${depthLabel(ss.trigger, 0)}; going back below ${depthLabel(ss.reset, 0)} restarts it.`,
      }];
    },
  },
  {
    id: 'deco',
    title: { fr: 'Faire ses paliers de décompression', en: 'Do your decompression stops' },
    goal: {
      fr: 'Lire les informations de décompression et remonter en respectant les paliers jusqu’à la surface.',
      en: 'Read the decompression information and ascend following the stops up to the surface.',
    },
    setup: (x) => {
      const sec = 60 + x.stayUntil(40, (v) => v.inDeco && v.tts >= 8, 40 * 60);
      return { time: min(sec) };
    },
    situation: {
      fr: 'Vous êtes à 40 m depuis {time} min, à l’air : vous avez dépassé le temps sans palier.',
      en: 'You have been at 40 m for {time} min, on air: you went past the no-deco time.',
    },
    task: {
      fr: 'Remontez jusqu’au premier palier indiqué, faites tous les paliers sans jamais passer au-dessus, puis remontez en surface. Vous pouvez accélérer le temps pendant les paliers.',
      en: 'Ascend to the first stop shown, do every stop without ever going above it, then surface. You can speed time up during the stops.',
    },
    observe: [
      { fr: 'Profondeur et durée du palier, temps total de remontée, et comment ils évoluent.', en: 'Stop depth and time, total ascent time, and how they change.' },
      { fr: 'Le signal quand vous arrivez au palier, et quand les paliers sont terminés.', en: 'The signal when you reach the stop, and when the stops are cleared.' },
    ],
    done: (x) => surfaced(x) && !x.v.inDeco && !x.seen.has('CEILING') && !x.v.locked,
    fail: (x) => (x.seen.has('CEILING')
      ? { fr: 'Vous êtes passé au-dessus du palier. Recommencez, ou faites l’exercice « Passer au-dessus du palier » pour voir ce qui se passe.', en: 'You went above the stop. Try again, or do the "Go above the stop" exercise to see what happens.' }
      : null),
    rules: (c) => [decoRule(c)],
  },
  {
    id: 'ceiling',
    title: { fr: 'Passer au-dessus du palier', en: 'Go above the stop' },
    goal: {
      fr: 'Voir comment votre ordinateur réagit quand on remonte au-dessus d’un palier obligatoire, et combien de temps il laisse pour corriger.',
      en: 'See how your computer reacts when you ascend above a mandatory stop, and how long it gives you to correct it.',
    },
    setup: (x) => {
      // A first stop at 9 m at the bottom, 6 m or deeper on arrival: room to go 2 m above it, and
      // above the ceiling too on the computers that use a continuous one.
      x.stayUntil(40, (v) => v.inDeco && v.stopDepth >= 9, 60 * 60);
      x.toFirstStop();
      return { stop: depthLabel(x.c.compute(x.s).stopDepth, 0) };
    },
    situation: {
      fr: 'Vous êtes à votre premier palier de décompression ({stop}), après une plongée à 40 m.',
      en: 'You are at your first decompression stop ({stop}), after a dive to 40 m.',
    },
    task: {
      fr: 'Remontez à environ 2 m au-dessus du palier affiché (il peut changer pendant la remontée) et observez votre ordinateur pendant 30 s. Puis redescendez au palier et restez-y 20 s.',
      en: 'Ascend to about 2 m above the stop shown (it may change during the ascent) and watch your computer for 30 s. Then go back down to the stop and stay there for 20 s.',
    },
    observe: [
      { fr: 'Le signal de palier manqué (texte, flèche, son) et s’il annonce un délai.', en: 'The missed stop signal (text, arrow, sound) and whether it announces a delay.' },
      { fr: 'Ce qui arrive si vous restez au-dessus trop longtemps (vous pouvez essayer ensuite).', en: 'What happens if you stay above for too long (you can try it afterwards).' },
    ],
    done: (x) => {
      if (!x.seen.has('CEILING')) return false;
      if (x.v.alarms.includes('CEILING')) x.mem.back = 0;
      else x.mem.back = (Number(x.mem.back) || 0) + x.dt;
      return Number(x.mem.back) >= 20 && !x.v.locked;
    },
    fail: (x) => (x.v.locked
      ? { fr: 'Votre ordinateur s’est verrouillé : vous êtes resté trop longtemps au-dessus du palier.', en: 'Your computer locked: you stayed above the stop for too long.' }
      : surfaced(x) ? { fr: 'Vous êtes remonté en surface.', en: 'You surfaced.' } : null),
    rules: (c) => [
      decoRule(c),
      {
        fr: `Le délai avant verrouillage et ses conséquences sont propres à chaque modèle : pour votre ${c.name}, voir « Détails de la simulation » dans les réglages.${c.lockHours ? ` S’il se verrouille, c’est pour ${c.lockHours} h.` : ''}`,
        en: `The delay before the lock and its consequences depend on the model: for your ${c.name}, see "Simulation details" in the settings.${c.lockHours ? ` If it locks, it is for ${c.lockHours} h.` : ''}`,
      },
    ],
  },
  {
    id: 'mod',
    title: { fr: 'Dépasser la profondeur maximale du mélange', en: 'Go past the gas’s maximum depth' },
    goal: {
      fr: 'Voir comment l’ordinateur signale une ppO₂ trop élevée en nitrox, et à quelle profondeur.',
      en: 'See how the computer signals a too high ppO₂ on nitrox, and at which depth.',
    },
    setup: (x) => {
      x.s.gas = { o2: 0.32, he: 0 };
      x.go(26, 3 * 60);
      return { mod: depthLabel(x.c.compute(x.s).mod, 0) };
    },
    situation: {
      fr: 'Vous plongez au Nitrox 32, à 26 m depuis 3 min. Votre ordinateur fixe la profondeur maximale (MOD) à {mod}.',
      en: 'You are diving Nitrox 32, at 26 m for 3 min. Your computer puts the maximum depth (MOD) at {mod}.',
    },
    task: {
      fr: 'Descendez lentement (▼) jusqu’à ce que votre ordinateur signale la ppO₂ trop élevée, puis remontez au-dessus de la MOD et restez-y 10 s.',
      en: 'Descend slowly (▼) until your computer signals the ppO₂ too high, then ascend above the MOD and stay there for 10 s.',
    },
    observe: [
      { fr: 'À quelle profondeur le signal apparaît, et sous quelle forme.', en: 'At which depth the signal appears, and in which form.' },
      { fr: 'S’il disparaît dès que vous remontez, ou s’il reste une trace.', en: 'Whether it goes away as soon as you ascend, or leaves a mark.' },
    ],
    done: (x) => {
      if (x.v.depth > x.v.mod) x.seen.set('MOD', x.seen.get('MOD') ?? x.t);
      if (!x.seen.has('MOD')) return false;
      if (x.v.depth > x.v.mod - 1) x.mem.above = 0;
      else x.mem.above = (Number(x.mem.above) || 0) + x.dt;
      return Number(x.mem.above) >= 10;
    },
    rules: (c, s, v) => [{
      fr: `MOD de votre ${c.name} avec le ${gasLabel(s.gas)} : ${depthLabel(v.mod, 0)} (ppO₂ ${(depthToPressure(v.mod) * s.gas.o2).toFixed(1)} bar, réglable dans ses réglages).`,
      en: `MOD of your ${c.name} with ${gasLabel(s.gas)}: ${depthLabel(v.mod, 0)} (ppO₂ ${(depthToPressure(v.mod) * s.gas.o2).toFixed(1)} bar, adjustable in its settings).`,
    }],
  },
  {
    id: 'repetitive',
    title: { fr: 'Faire une plongée successive', en: 'Make a repetitive dive' },
    goal: {
      fr: 'Voir que l’azote resté dans les tissus après une plongée raccourcit le temps sans palier de la suivante, et ce que l’ordinateur affiche entre les deux.',
      en: 'See that the nitrogen left in the tissues after a dive shortens the next dive’s no-deco time, and what the computer shows in between.',
    },
    setup: (x) => {
      // First dive: 25 min at 20 m, the no-deco time read 2 min after the start (as in the second
      // dive), a safety stop, the surface, then one hour of surface interval.
      x.go(20, 2 * 60);
      const ndl1 = x.c.compute(x.s).ndl;
      x.go(20, 23 * 60);
      x.stayUntil(4.5, (v) => v.safety.state === 'done', 10 * 60);
      x.go(0, 60 * 60);
      return { ndl1: String(ndl1) };
    },
    situation: {
      fr: 'Vous avez plongé 25 min à 20 m à l’air (votre ordinateur affichait {ndl1} min sans palier 2 min après le début), fait le palier de sécurité, puis passé 1 h en surface.',
      en: 'You dived 25 min at 20 m on air (your computer showed {ndl1} min of no-deco time 2 min after the start), did the safety stop, then spent 1 h at the surface.',
    },
    task: {
      fr: 'Avant de redescendre, regardez l’écran de surface. Puis redescendez à 20 m, restez-y 1 min et comparez le temps sans palier avec celui de la première plongée ({ndl1} min).',
      en: 'Before going down again, look at the surface screen. Then go back down to 20 m, stay there for 1 min and compare the no-deco time with the first dive’s ({ndl1} min).',
    },
    observe: [
      { fr: 'En surface : intervalle depuis la dernière plongée, désaturation, interdiction de vol, et le temps sans palier annoncé s’il y en a un.', en: 'At the surface: interval since the last dive, desaturation, no-fly time, and the no-deco time planned if any.' },
      { fr: 'Au fond : le temps sans palier, comparé à celui de la première plongée.', en: 'At the bottom: the no-deco time, compared with the first dive’s.' },
    ],
    done: (x) => {
      // One minute at 20 m (19 m or deeper) on this second dive, then the no-deco time is read.
      if (x.s.inDive && x.v.depth >= 19) x.mem.bottom = (Number(x.mem.bottom) || 0) + x.dt;
      if ((Number(x.mem.bottom) || 0) < 60) return false;
      x.mem.ndl2 = x.v.ndl;
      return true;
    },
    rules: (c, _s, _v, r) => [
      ...(typeof r.mem.ndl2 === 'number' ? [{
        fr: `Votre ${c.name} affichait ${r.vars.ndl1} min sans palier à 20 m pendant la première plongée, ${r.mem.ndl2} min pendant la seconde${r.mem.ndl2 < Number(r.vars.ndl1)
          ? ' : l’azote resté dans les tissus raccourcit la plongée successive.'
          : '. Après 1 h, les compartiments rapides, qui limitent le temps sans palier à cette profondeur, ont déjà presque désaturé.'}`,
        en: `Your ${c.name} showed ${r.vars.ndl1} min of no-deco time at 20 m on the first dive, ${r.mem.ndl2} min on the second${r.mem.ndl2 < Number(r.vars.ndl1)
          ? ': the nitrogen left in the tissues shortens the repetitive dive.'
          : '. After 1 h, the fast compartments, which limit the no-deco time at this depth, have almost off-gassed already.'}`,
      }] : []),
      {
        fr: 'Certains ordinateurs ajoutent une pénalité propre aux plongées successives. L’écart exact dépend de l’algorithme, seulement approché ici pour les modèles propriétaires (≈) : comparez les réactions des ordinateurs, pas les minutes.',
        en: 'Some computers add a penalty of their own for repetitive dives. The exact difference depends on the algorithm, only approximated here for the proprietary models (≈): compare how the computers react, not the minutes.',
      },
    ],
  },
];
