import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay } from '../../base';
import { type CressiFields, cressiLcd, seg, stopPair } from '../lcd';
import { DonatelloRules } from './rules';

/** DESAT TIME (p. 8): the DESAT and PREDIVE screens alternate by themselves; period not given, 3 s assumed. */
const ALTERNATE_MS = 3000;

/** Cressi Donatello: single button and segmented LCD (the Goa's, ../lcd.ts), after the manual (rules in rules.ts). */
export class CressiDonatello extends DonatelloRules {
  /** Surface: PREDIVE (alternating with DESAT) or the TIME / DATE screen of the main menu. */
  private surfacePage: 'predive' | 'time' = 'predive';

  onDiveEnd(s: DiveSession): void {
    super.onDiveEnd(s);
    this.surfacePage = 'predive';
  }

  // FUNCTIONS OF THE BUTTONS (p. 7): short = NEXT (one step); long (1 s) = ENTER, and in the predive,
  // time-date and dive functions the backlight for 5 seconds; longer (3 s) = RETURN.
  press(button: string, s: DiveSession): boolean {
    if (button !== 'btn') return false;
    // MAIN MENU (p. 9): PREDIVE → TIME/DATE → MODE-S → … (only the first two simulated).
    if (!s.inDive) this.surfacePage = this.surfacePage === 'predive' ? 'time' : 'predive';
    // p. 24-25: additional information during the dive.
    else this.setScreen(this.screen === 1 ? 0 : 1);
    return true;
  }

  hold(button: string): boolean {
    if (button !== 'btn') return false;
    this.backlightUntil = performance.now() + 5000;
    return true;
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      btn: {
        name: 'Bouton / Button',
        press: {
          real: {
            fr: 'Informations complémentaires : ppO2 max et sa profondeur, mode (AIR ou %O2), profondeur max atteinte, heure. En surface : écran suivant du menu (TIME, MODE-S, LOG, DIVE-S…)',
            en: 'Additional information: max ppO2 and its depth, mode (AIR or %O2), max depth reached, time. At the surface: next screen of the menu (TIME, MODE-S, LOG, DIVE-S…)',
          },
          simulated: true,
          note: {
            fr: 'retour à l’écran de plongée après 5 s (délai non donné par le manuel) ; en surface, seuls PREDIVE et TIME',
            en: 'back to the dive screen after 5 s (delay not given in the manual); at the surface, only PREDIVE and TIME',
          },
        },
        hold: {
          real: { fr: 'Appui long (1 s) : rétroéclairage 5 s ; en surface, entrer dans le menu. Appui plus long (3 s) : retour', en: 'Long press (1 s): backlight for 5 s; at the surface, enter the menu. Longer press (3 s): return' },
          simulated: true,
          note: { fr: 'rétroéclairage seulement', en: 'backlight only' },
        },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Display, laid out as the LCD in the manual's figures (p. 8-9, 23-29).

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    const f: CressiFields = { unit: depthUnit() };
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
    const { h, m } = clockOfDay(s);
    const clock = `${h}:${String(m).padStart(2, '0')}`;
    const nitrox = s.gas.o2 > 0.21;
    const mode = nitrox ? seg(String(Math.round(s.gas.o2 * 100)), 2) + '<i class="cg-u">%</i>' : seg('AIr', 3);

    if (!v.inDive) {
      const si = (v.surfaceInterval ?? 0) / 60;
      const noFly = s.log.length > 0 ? Math.max(v.noFly, this.noFlyHours * 60 - si) : 0;
      const desatScreen = (v.desat > 0 || noFly > 0) && Math.floor(performance.now() / ALTERNATE_MS) % 2 === 1;
      if (this.surfacePage === 'time') {
        // TIME / DATE (p. 7, 10): day of the week | day-month, time of day, seconds. Date fictitious.
        const day = Math.floor((s.clock + 9 * 3600) / 86400);
        const date = new Date(2026, 8, 26 + day);
        f.tl = `<span class="cg-wd">${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][date.getDay()]}</span>`;
        f.tr = seg(`${date.getDate()}-${date.getMonth() + 1}`, 5);
        f.clock = seg(clock.padStart(5, ' '), 4, 'cg-bigseg');
        f.bottom = seg(String(Math.floor(s.clock % 60)).padStart(2, '0'), 2);
      } else if (desatScreen) {
        // SWITCH ON (DESAT) (p. 8): SURF.T | DESAT countdown, time of day, NO FLY countdown.
        f.tl = seg(hm(si), 4);
        f.tlLbl = 'SURF.T';
        f.tr = seg(hm(v.desat), 4);
        f.trLbl = 'DESAT';
        f.clock = seg(clock.padStart(5, ' '), 4, 'cg-bigseg');
        f.bottom = seg(hm(Math.max(0, noFly)), 4);
        f.bottomTag = 'NO FLY';
      } else {
        // PRE DIVE (p. 8, 10): MAX PO2 | AIR or %O2 (NITROX), DEEP STOP, depth reachable with the PO2, DIVE.
        f.tl = seg(`PO${this.modPpo2.toFixed(1)}`, 4);
        f.tlLbl = 'MAX';
        f.tr = mode;
        f.depthLbl = 'MAXDEPTH';
        f.depth = seg(depthText(v.mod), 3);
        f.deepStop = this.settings.deepstop === 'on';
        f.bottom = seg('dIUE', 4);
        if (this.locked) {
          // ERROR PROGRAM (p. 30): on the PRE DIVE screen, STOP flashing, DECO and the stop icon with the up arrow.
          f.bottom = `<span class="blink">${seg('StOP', 4)}</span>`;
          f.decoIcon = 'on';
          f.up = 'on';
        }
      }
    } else if (this.locked) {
      // ERROR PROGRAM (p. 30): "the word STOP" repeatedly shown, depth and dive time.
      f.tl = seg(depthText(v.maxDepth), 3);
      f.tlLbl = 'MAX';
      f.tlUnit = depthUnit();
      f.tr = seg(String(Math.floor(v.diveTime / 60)), 3);
      f.trLbl = 'DIVE.T';
      f.trUnit = 'min';
      f.depthLbl = 'DEPTH';
      f.depth = seg(depthText(v.depth), 3);
      f.bottom = `<span class="blink">${seg('StOP', 4)}</span>`;
      f.stopIcon = 'blink';
    } else if (this.currentScreen() === 1) {
      // Additional information (p. 24-25): max PO2 alternating with its depth | AIR or %O2, max depth, time.
      const alt = Math.floor(performance.now() / 2000) % 2 === 1;
      f.tl = alt ? seg(depthText(v.mod), 3) : seg(`PO${this.modPpo2.toFixed(1)}`, 4);
      f.tlLbl = 'MAX';
      if (alt) f.tlUnit = depthUnit();
      f.tr = mode;
      f.depthLbl = 'MAXDEPTH';
      f.depth = seg(depthText(v.maxDepth), 3);
      f.bottom = seg(clock, 4);
      f.cns = true;
    } else {
      // Dive screen (p. 23, 25): MAX | DIVE.T, depth, NO DECO, average depth, temperature.
      f.tl = seg(depthText(v.maxDepth), 3);
      f.tlLbl = 'MAX';
      f.tlUnit = depthUnit();
      f.tr = seg(String(Math.floor(v.diveTime / 60)), 3);
      f.trLbl = 'DIVE.T';
      f.trUnit = 'min';
      f.depthLbl = 'DEPTH';
      f.depth = seg(depthText(v.depth), 3);
      f.ndl = seg(String(Math.min(99, v.ndl)), 2);
      f.ndlLbl = true;
      // DECOMPRESSION FOREWARNING (p. 29): from 3 minutes (flashing: as on the Goa, not stated).
      f.ndlBlink = !v.inDeco && v.ndl <= 3;
      f.sf = `SF${this.settings.sf.slice(2)}`;
      f.pen = this.penaltyActive; // ASCENT RATE (p. 28): penalty icon
      const avg = String(depthInt(v.avgDepth));
      f.avg = seg(`A.${avg}`, avg.length + 1);
      f.temp = String(Math.round(tempVal(v.temperature)));
      f.tempUnit = tempUnit();
      f.cns = true;
      f.dots = this.ascentDots(v.ascentRate);
      f.mute = this.settings.alsp === 'off';
      // PO2 ALARM (p. 26): the PO2 icon and the depth flash beyond the MOD, the icon then stays on.
      const overMod = v.depth > v.mod;
      const max = this.depthAlarm();
      f.po2 = this.po2Exceeded || overMod;
      f.po2Blink = overMod;
      f.depthBlink = overMod || (max !== null && v.depth > max);

      const safe = !v.inDeco && (v.safety.state === 'active' || v.safety.state === 'paused');
      if (v.inDeco && v.stopDepth > 0) {
        // DIVING OUTSIDE THE NO-DECOMPRESSION LIMITS (p. 29-30): DECO icon, first stop depth and time,
        // TOTAL ascent time. Arrows: both steady at the stop, ▲ flashing more than 1 m below it,
        // ▼ flashing above it.
        const above = v.ceilingViolation > 0;
        const below = v.depth > v.stopDepth + 1;
        f.tl = stopPair(depthInt(v.stopDepth), Math.min(99, v.stopTime));
        f.tlUnit = 'min';
        f.tlLbl = '';
        f.decoIcon = 'on';
        f.ndl = seg(String(Math.min(99, v.tts)), 2);
        f.ndlLbl = 'deco';
        f.ndlBlink = false;
        f.up = below ? 'blink' : above ? '' : 'on';
        f.down = above ? 'blink' : below ? '' : 'on';
      } else if (this.deepShown()) {
        // DEEP STOP (p. 29): stop icon with the depth and the time in minutes.
        f.tl = stopPair(depthInt(this.deepTarget), Math.ceil(this.deepRemaining / 60));
        f.tlUnit = 'min';
        f.tlLbl = '';
        f.stopIcon = this.deepState === 'active' ? 'on' : 'blink';
        f.deepStop = true;
      } else if (safe) {
        // SAFETY STOP (p. 28): SAFE and the countdown in minutes and seconds.
        f.tl = seg('SAFE', 4);
        f.tlUnit = '';
        f.tr = seg(mmss(v.safety.remaining), 3);
      }
    }

    el.innerHTML = `
      <div class="dev cg cd">
        <div class="cd-case">
          <div class="cd-lug top"></div><div class="cd-lug bottom"></div>
          <div class="cd-bezel">
            <div class="cg-lcd ${this.backlit ? 'backlit' : ''}">${cressiLcd(f, s)}</div>
          </div>
          <button class="cd-btn" data-btn="btn"></button>
        </div>
      </div>`;
  }
}
