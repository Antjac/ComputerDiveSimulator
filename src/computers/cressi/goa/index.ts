import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay } from '../../base';
import { type CressiFields, cressiLcd, seg, stopPair } from '../lcd';
import { GoaRules } from './rules';

/** Cressi Goa: buttons and segmented LCD, after the manual (rules in rules.ts). */
export class CressiGoa extends GoaRules {
  private surfacePage: 'top' | 'dive' = 'dive';

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    this.surfacePage = 'top';
  }


  // Dive: UP / DOWN show the additional information. Surface: DOWN goes from the TOP page to the DIVE
  // page, UP back. UP held: backlight.
  press(button: string, s: DiveSession): boolean {
    if (button !== 'up' && button !== 'down') return false;
    if (!s.inDive) this.surfacePage = button === 'down' ? 'dive' : 'top';
    else this.setScreen(this.screen === 1 ? 0 : 1);
    return true;
  }

  hold(button: string): boolean {
    if (button !== 'up') return false;
    this.backlightUntil = performance.now() + 5000;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      up: {
        name: '▲ / SEL',
        press: {
          real: { fr: 'Informations complémentaires : ppO2 max, mode, profondeur max atteignable, heure (et profondeur max)', en: 'Additional information: max ppO2, mode, max reachable depth, time (and max depth)' },
          simulated: true,
        },
        hold: { real: { fr: 'Rétroéclairage', en: 'Backlight' }, simulated: true, note: { fr: '5 s ici', en: '5 s here' } },
      },
      down: {
        name: '▼ / ESC',
        press: {
          real: { fr: 'Profondeur maximale (en déco, deep stop ou palier de sécurité)', en: 'Maximum depth (in deco, deep stop or safety stop)' },
          simulated: true,
          note: { fr: 'même écran que ▲', en: 'same screen as ▲' },
        },
        hold: { real: { fr: 'Retour au menu (en surface)', en: 'Back to the menu (at the surface)' }, simulated: false },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Display, laid out as the LCD in the manual's figures (shared with the Donatello: ../lcd.ts).

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    const f: CressiFields = {};
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
    const { h, m } = clockOfDay(s);
    const clock = `${h}:${String(m).padStart(2, '0')}`;
    const nitrox = s.gas.o2 > 0.21;
    const temp = String(Math.round(tempVal(v.temperature)));

    if (!v.inDive) {
      if (this.surfacePage === 'dive' || s.log.length === 0) {
        // DIVE (pre-dive) page: max ppO2 | mode, depth reachable with it, no-deco time, "DIVE".
        f.tl = seg(`PO${this.modPpo2.toFixed(1)}`, 4);
        f.tlLbl = 'MAX';
        f.tr = nitrox ? seg(String(Math.round(s.gas.o2 * 100)), 2) + '<i class="cg-u">%</i>' : seg('AIr', 3);
        f.depthLbl = 'MAXDEPTH';
        f.depth = seg(depthText(v.mod), 3);
        f.ndl = seg('99', 2);
        f.ndlLbl = true;
        f.deepStop = this.settings.deepstop === 'on';
        f.bottom = this.locked ? `<span class="blink">${seg('StOP', 4)}</span>` : seg('dIUE', 4);
        f.stopIcon = this.locked ? 'blink' : '';
        if (this.locked) f.bottomTag = 'DECO';
      } else {
        // TOP page in desaturation: SURF.T | DESAT, time of day, NO FLY countdown.
        const si = (v.surfaceInterval ?? 0) / 60;
        const noFly = Math.max(v.noFly, this.noFlyHours * 60 - si);
        if (v.desat > 0 || noFly > 0) {
          f.tl = seg(hm(si), 4);
          f.tlLbl = 'SURF.T';
          f.tr = seg(hm(v.desat), 4);
          f.trLbl = 'DESAT';
          f.bottom = seg(hm(Math.max(0, noFly)), 4);
          f.bottomTag = 'NO FLY';
        } else {
          const day = Math.floor((s.clock + 9 * 3600) / 86400);
          const date = new Date(2026, 8, 26 + day);
          f.tl = `<span class="cg-wd">${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()]}</span>`;
          f.tr = seg(`${date.getDate()} ${date.getMonth() + 1}`, 4);
          f.bottom = seg(String(Math.floor((s.clock % 60))).padStart(2, '0'), 2);
        }
        f.clock = seg(clock.padStart(5, ' '), 4, 'cg-bigseg');
      }
    } else if (this.locked) {
      // ERROR mode: depth and dive time only, STOP flashing.
      f.tl = seg(depthText(v.maxDepth), 3);
      f.tlLbl = 'MAX';
      f.tr = seg(String(Math.floor(v.diveTime / 60)), 3);
      f.trLbl = 'DIVE.T';
      f.trUnit = 'min';
      f.depthLbl = 'DEPTH';
      f.depth = seg(depthText(v.depth), 3);
      f.bottom = `<span class="blink">${seg('StOP', 4)}</span>`;
      f.stopIcon = 'blink';
    } else if (this.currentScreen() === 1) {
      // Additional information (▲): max ppO2 / its depth, mode or O2 %, max depth reached, time.
      const alt = Math.floor(performance.now() / 2000) % 2 === 1;
      f.tl = alt ? seg(depthText(v.mod), 3) : seg(`PO${this.modPpo2.toFixed(1)}`, 4);
      f.tlLbl = 'MAX';
      if (alt) f.tlUnit = 'm';
      f.tr = nitrox ? seg(String(Math.round(s.gas.o2 * 100)), 2) + '<i class="cg-u">%</i>' : seg('AIr', 3);
      f.depthLbl = 'MAXDEPTH';
      f.depth = seg(depthText(v.maxDepth), 3);
      f.bottom = seg(clock, 4);
      f.cns = true;
    } else {
      // Dive screen.
      f.tl = seg(depthText(v.maxDepth), 3);
      f.tlLbl = 'MAX';
      f.tlUnit = 'm';
      f.tr = seg(String(Math.floor(v.diveTime / 60)), 3);
      f.trLbl = 'DIVE.T';
      f.trUnit = 'min';
      f.depthLbl = 'DEPTH';
      f.depth = seg(depthText(v.depth), 3);
      f.ndl = seg(String(Math.min(99, v.ndl)), 2);
      f.ndlLbl = true;
      f.ndlBlink = !v.inDeco && v.ndl <= 3;
      f.sf = `SF${this.settings.sf.slice(2)}`;
      f.pen = this.penaltyActive;
      f.temp = temp;
      f.cns = true;
      f.dots = this.ascentDots(v.ascentRate);
      f.po2 = v.depth > v.mod;

      const deep = this.deepState === 'active' || this.deepState === 'pending';
      const safe = !v.inDeco && (v.safety.state === 'active' || v.safety.state === 'paused');
      if (v.inDeco && v.stopDepth > 0) {
        // First stop depth and time, total ascent time, DEC flashing; ▲ to go up, ▼ when above the stop.
        const above = v.ceilingViolation > 0;
        const below = v.depth > v.stopDepth + 1;
        f.tl = stopPair(depthInt(v.stopDepth), Math.min(99, v.stopTime));
        f.tlUnit = 'min';
        f.tlLbl = '';
        f.stopIcon = 'blink';
        f.ndl = seg(String(Math.min(99, v.tts)), 2);
        f.ndlLbl = 'deco';
        f.ndlBlink = false;
        f.decBottom = true;
        f.up = below ? 'blink' : above ? '' : 'on';
        f.down = above ? 'blink' : below ? '' : 'on';
      } else if (deep) {
        // Deep stop: STOP icon with the stop depth and time in minutes, DEEP STOP.
        f.tl = stopPair(depthInt(this.deepTarget), Math.ceil(this.deepRemaining / 60));
        f.tlUnit = 'min';
        f.tlLbl = '';
        f.stopIcon = this.deepState === 'active' ? 'on' : 'blink';
        f.deepStop = true;
      } else if (safe) {
        f.tl = seg('SAFE', 4);
        f.tlUnit = '';
        f.tr = seg(mmss(v.safety.remaining), 3);
      }
    }

    el.innerHTML = `
      <div class="dev cg">
        <div class="cg-case">
          <button class="cg-btn up" data-btn="up"></button>
          <button class="cg-btn down" data-btn="down"></button>
          <div class="cg-lcd ${this.backlit ? 'backlit' : ''}">${cressiLcd(f, s)}</div>
        </div>
      </div>`;
  }
}
