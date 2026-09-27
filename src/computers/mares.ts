import { ceilingDepth, depthToPressure, ndl, pressureToDepth, type DecoParams } from '../engine/buhlmann';
import { DIVE_END_TIMEOUT, type DiveSession } from '../engine/session';
import type { Lang } from '../i18n';
import { depthInt, depthText, depthVal, tempUnit, tempVal } from '../units';
import { ButtonHelp, ComputerView, DiveComputer, SettingDef, clockOfDay } from './base';
import { sevenSeg } from './segments';
import { FastAscentRgbm, MissedStop, maresRgbmParams } from './mares/common';

/**
 * Mares Puck Pro. Display and rules follow the Puck Pro instruction manual (display information,
 * alarms, missed deco stop, uncontrolled ascent). Mares RGBM (Wienke) itself is proprietary: it is
 * approximated with Bühlmann + a repetitive-dive penalty.
 */
export class MaresPuck extends DiveComputer {
  readonly id = 'mares';
  readonly name = 'Mares Puck Pro';
  readonly algorithm = 'Mares RGBM (≈)';
  readonly exact = false;
  readonly notes = {
    fr: 'Le RGBM Mares est propriétaire : approximation (Bühlmann + P0/P1/P2, pénalité en successives). Affichage et règles conformes au manuel : alarme à 10 m/min, remontée incontrôlée (> 12 m/min) ou palier manqué > 3 min = mode profondimètre pour les plongées suivantes. Bouton : informations alternatives (profondeur moyenne, O2 % et CNS en nitrox, heure) ; appui long : rétroéclairage.',
    en: 'Mares RGBM is proprietary: approximation (Bühlmann + P0/P1/P2, repetitive-dive penalty). Display and rules as per the manual: alarm at 10 m/min, uncontrolled ascent (> 12 m/min) or missed stop > 3 min = bottom timer mode for the following dives. Button: alternate information (average depth, O2 % and CNS on nitrox, time of day); hold: backlight.',
  };
  readonly settingDefs: SettingDef[] = [
    {
      key: 'personal',
      label: { fr: 'Facteur P', en: 'P factor' },
      options: [{ value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }],
      default: 'P0',
    },
  ];

  deepState: 'none' | 'pending' | 'active' | 'done' = 'none';
  deepRemaining = 120;
  deepTarget = 0;
  /** Depth where a >12 m/min ascent started (uncontrolled ascent detection). */
  private fast = new FastAscentRgbm();
  private fastViolation = false;
  private missed = new MissedStop('rgbm');
  private decoViolation = false;
  private ndlTimer = 0;
  private lastNdl = 99;

  constructor() {
    super();
    // Safety stop: dives deeper than 10 m, 3 minutes between 6 and 3 m.
    this.safetyStop = { trigger: 10, start: 6, top: 3, bottom: 6, reset: 10 };
    this.ceilingMargin = 0.3; // alarm when more than 0.3 m above the stop
    this.lockAfter = null; // handled below (1 m for 3 min)
    this.lockHours = 24;
    this.stopWindow = 1;
    this.screenTimeout = 0;
    this.init();
  }

  baseParams(): DecoParams {
    return maresRgbmParams(this.settings.personal, null);
  }

  decoParams(s: DiveSession): DecoParams {
    return maresRgbmParams(this.settings.personal, s);
  }

  /** Fast-ascent alarm from 10 m/min. */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate >= 10 ? 2 : rate >= 8 ? 1 : 0;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.deepState = 'none';
    this.deepRemaining = 120;
    this.deepTarget = 0;
    this.fast.reset();
    this.fastViolation = false;
    this.missed.reset();
    this.decoViolation = false;
    this.screen = 0;
  }

  onDiveEnd(s: DiveSession): void {
    // After a violation, the following dives run in bottom timer mode only.
    if (this.fastViolation || this.decoViolation) this.lock(s);
  }

  tick(s: DiveSession, dt: number): void {
    super.tick(s, dt);
    if (!s.inDive) return;

    // Uncontrolled ascent: > 12 m/min started deeper than 12 m and kept for 2/3 of that depth.
    if (this.fast.update(s.ascentRate, s.depth)) this.fastViolation = true;

    // Missed deco stop: more than 1 m above the stop for more than 3 minutes.
    const p = this.decoParams(s);
    const ceil = ceilingDepth(s.tissues, this.anchor, p);
    const inDeco = ceil > 0;
    const stopDepth = inDeco ? Math.max(p.lastStop, Math.ceil(ceil / p.stopStep - 1e-6) * p.stopStep) : 0;
    this.ndlTimer -= dt;
    if (this.ndlTimer <= 0) {
      this.ndlTimer = 10;
      this.lastNdl = inDeco ? 0 : ndl(s.tissues, s.depth, s.gas, p.gfHigh);
    }
    if (inDeco) {
      if (this.missed.update(stopDepth - s.depth, dt)) this.decoViolation = true;
    } else {
      this.missed.reset();
    }

    // Deep stop (not mandatory): generated when approaching the no-deco limit on dives deeper than 20 m.
    if (this.deepState === 'none' && s.maxDepth > 20 && (inDeco || this.lastNdl <= 10)) {
      // Half the absolute pressure of the maximum depth; below 10 m a deep stop makes no sense.
      this.deepTarget = Math.round(pressureToDepth(depthToPressure(s.maxDepth) / 2));
      this.deepState = this.deepTarget >= 10 ? 'pending' : 'done';
    }
    if (this.deepState === 'pending' || this.deepState === 'active') {
      if (Math.abs(s.depth - this.deepTarget) <= 1) {
        this.deepState = 'active';
        this.deepRemaining -= dt;
        if (this.deepRemaining <= 0) this.deepState = 'done';
      } else if (s.depth < this.deepTarget - 1) {
        this.deepState = 'done';
      } else if (this.deepState === 'active') {
        this.deepState = 'pending';
      }
    }
  }

  // Manual §1.5 and §3.3: each press cycles average depth, O2 % and CNS (nitrox only), then time of
  // day (4 s time-out back to dive time and temperature); press and hold switches the backlight on.
  press(_button: string, s: DiveSession): boolean {
    let next = this.screen + 1;
    if (next === 2 && s.gas.o2 === 0.21) next = 4;
    this.setScreen(next > 4 ? 0 : next);
    return true;
  }

  hold(): boolean {
    this.backlightUntil = performance.now() + 5000;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      main: {
        name: 'BUTTON',
        press: {
          real: { fr: 'Informations alternatives : profondeur moyenne, O2 % et CNS (nitrox), heure (4 s)', en: 'Alternate information: average depth, O2 % and CNS (nitrox), time of day (4 s)' },
          simulated: true,
        },
        hold: {
          real: { fr: 'Rétroéclairage (durée réglée dans le menu LGHt)', en: 'Backlight (duration set in the LGHt menu)' },
          simulated: true,
          note: { fr: 'durée fixe de 5 s ici', en: 'fixed 5 s here' },
        },
      },
    };
  }

  render(el: HTMLElement, view: ComputerView, s: DiveSession, _lang: Lang): void {
    // §3.2.4: while the missed deco stop alarm is on, "desaturation of the simulated tissue
    // compartments is halted and resumes only when the diver returns to the correct stop depth".
    const v = this.withPausedDeco(view);
    if (this.screen === 4 && performance.now() - this.screenChangedAt > 4000) this.screen = 0;
    const screen = this.currentScreen();
    const bottomTimer = v.locked; // after a violation: depth gauge and timer only
    const surfacing = v.inDive && v.depth < 1.2;
    const cns = v.cns >= 75;
    const time = (min: number) => `${Math.floor(min)}:`;
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

    const depthTxt = v.depth < 1.2 ? '---' : depthText(v.depth);
    const modAlarm = v.inDive && v.depth > v.mod;
    const ceilingAlarm = v.ceilingViolation === 2;
    const depthBlink = modAlarm || ceilingAlarm ? 'blink' : '';

    // Top-right field: max depth (or avg, or MOD on alarm).
    let topRightLbl = 'max';
    let topRightVal = depthText(v.maxDepth);
    if (modAlarm) [topRightLbl, topRightVal] = ['mod', String(depthInt(v.mod))];
    else if (screen === 1) [topRightLbl, topRightVal] = ['avg', depthText(v.avgDepth)];

    // Middle row.
    let midLbl = 'no deco';
    let mid = sevenSeg(time(Math.min(99, v.ndl)), 3, 'mr-mid');
    let leftSmall = '';
    let rightSmall = '';
    let arrows = '';
    const showDeep = !bottomTimer && v.inDive && (this.deepState === 'active' || this.deepState === 'pending');
    const showSafe = v.inDive && !v.inDeco && (v.safety.state === 'active' || v.safety.state === 'paused' || (v.safety.state === 'pending' && v.depth < 7 && v.depth >= 1.2));

    if (bottomTimer) {
      midLbl = 'bottom timer';
      mid = sevenSeg(mmss(v.diveTime), 4, 'mr-mid');
    } else if (surfacing) {
      midLbl = '';
      mid = sevenSeg(mmss(DIVE_END_TIMEOUT - s.surfaceTimer), 3, 'mr-mid');
    } else if (!v.inDive) {
      midLbl = 'surf';
      const si = Math.floor((v.surfaceInterval ?? 0) / 60);
      mid = sevenSeg(v.surfaceInterval === null ? '-:--' : `${Math.floor(si / 60)}:${String(si % 60).padStart(2, '0')}`, 3, 'mr-mid');
    } else if (showDeep && this.deepState === 'active') {
      midLbl = 'deep deco';
      mid = sevenSeg(`${depthInt(this.deepTarget)}.`, 2, 'mr-mid') + sevenSeg(mmss(this.deepRemaining), 3, 'mr-mid');
    } else if (v.inDeco) {
      midLbl = 'deco';
      mid = sevenSeg(`${depthInt(v.stopDepth)}.`, 2, 'mr-mid') + sevenSeg(time(v.stopTime), 2, 'mr-mid');
      rightSmall = `<div class="mr-lbl">asc</div>${sevenSeg(time(v.tts), 2, 'mr-small')}`;
      if (v.ceilingViolation > 0) arrows = `<span class="mr-tri ${ceilingAlarm ? 'blink' : ''}">▼</span>`;
      else if (v.atStop) arrows = '<span class="mr-tri">▼▲</span>';
    } else if (showSafe) {
      midLbl = 'safe';
      mid = sevenSeg(mmss(v.safety.remaining), 3, 'mr-mid');
    }
    if (showDeep && this.deepState === 'pending' && !v.inDeco) leftSmall = sevenSeg(String(depthInt(this.deepTarget)), 2, 'mr-small');
    // Vertical speed at the far left of the middle row while moving.
    const speed = Math.abs(v.ascentRate);
    if (v.inDive && speed > 0.8 && !leftSmall) leftSmall = sevenSeg(depthVal(speed).toFixed(0), 2, `mr-small ${v.ascentRate >= 10 ? 'blink' : ''}`);

    // Bottom row.
    const clock = clockOfDay(s);
    let bottomLeft = sevenSeg(time(v.diveTime / 60), 3, 'mr-small');
    let bottomRightLbl = tempUnit();
    let bottomRight = sevenSeg(String(Math.round(tempVal(v.temperature))), 2, 'mr-small');
    if (screen === 2 && v.o2 !== 21) [bottomRightLbl, bottomRight] = ['O2%', sevenSeg(String(v.o2), 2, 'mr-small')];
    if (screen === 3 || cns) [bottomRightLbl, bottomRight] = ['cns', sevenSeg(String(Math.round(v.cns)), 3, `mr-small ${cns ? 'blink' : ''}`)];
    if (screen === 4) {
      bottomLeft = sevenSeg(`${clock.h}:${String(clock.m).padStart(2, '0')}`, 4, 'mr-small');
      [bottomRightLbl, bottomRight] = ['', ''];
    }
    if (!v.inDive && v.noFly > 0) [bottomRightLbl, bottomRight] = ['no fly', sevenSeg(`${Math.ceil(v.noFly / 60)}`, 2, 'mr-small')];

    // 10-segment nitrogen bar graph (leading compartment); all black in decompression.
    const segs = v.inDeco ? 10 : Math.min(10, Math.floor(v.n2Load / 10));
    const n2 = Array.from({ length: 10 }, (_, i) => `<i class="${i < segs ? 'on' : ''}"></i>`).join('');

    const icons: string[] = [];
    if (this.ascentAlarm || this.fastViolation) icons.push(`<span class="mr-fast ${this.fastViolation ? '' : 'blink'}">fast</span>`);
    if (this.decoViolation || (bottomTimer && !this.fastViolation)) icons.push('<span class="mr-glass">⧗</span>');

    el.innerHTML = `
      <div class="dev mr">
        <div class="mr-case">
          <button class="mr-btn" data-btn="main"></button>
          <div class="mr-lcd ${this.backlit ? 'backlit' : ''}">
            <div class="mr-row mr-toprow">
              <div class="mr-depth"><div class="mr-lbl">depth</div><div class="${depthBlink}">${sevenSeg(depthTxt, 3, 'mr-big')}</div></div>
              <div class="mr-max"><div class="mr-lbl">${topRightLbl}</div>${sevenSeg(v.inDive || s.log.length ? topRightVal : '---', 3, 'mr-small')}</div>
            </div>
            <div class="mr-row mr-midrow">
              <div class="mr-left">${arrows || leftSmall}</div>
              <div class="mr-center"><div class="mr-lbl c">${midLbl}</div><div class="mr-midval">${mid}</div></div>
              <div class="mr-right">${rightSmall}</div>
            </div>
            <div class="mr-row mr-bottomrow">
              <div class="mr-bl"><div class="mr-lbl stack">dive<br>time</div>${bottomLeft}</div>
              <div class="mr-br">${bottomRight}<span class="mr-lbl">${bottomRightLbl}</span></div>
            </div>
            <div class="mr-n2">${n2}</div>
            <div class="mr-icons">${icons.join('')}</div>
          </div>
        </div>
      </div>`;
  }
}
