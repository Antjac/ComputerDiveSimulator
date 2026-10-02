import { Tissues, WATER_VAPOUR, depthToPressure, n2Fraction, planAscent } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import type { Lang } from '../../../i18n';
import { depthInt, depthText, depthUnit, imperial, pressText, tempUnit, tempVal } from '../../../units';
import { ButtonHelp, ComputerView, clockOfDay } from '../../base';
import { type OdysseyNotice, OdysseyRules } from './rules';

/** §10 (figures) : texte des boîtes « Alertes ». */
const NOTICE_TEXT: Record<OdysseyNotice, string> = { pn2: 'PN2', density: 'Densité' };

/** Champs modulables de la page plongée (§8), dans l'ordre de la surbrillance (ordre non donné : lecture de l'écran). */
type Field = 'top' | 'dtr' | 'gas' | 'mid';
const FIELDS: Field[] = ['top', 'dtr', 'gas', 'mid'];
/** §8 (figure) : DTR → DTR/+5' → DTR/HS → DTR/DTP → DTR/BG. */
const DTR_MODES = ['DTR', "DTR/+5'", 'DTR/HS', 'DTR/DTP', 'DTR/BG'];
/** §8 (figures) : contenu du champ central du bas : bloc (avec sonde), pile, CNS, température, profondeur max., tissus. */
type Mid = 'tank' | 'battery' | 'cns' | 'temp' | 'max' | 'tissues';
const MIDS: Mid[] = ['tank', 'battery', 'cns', 'temp', 'max', 'tissues'];
/** §4.2 (figure) : tuiles de l'écran d'accueil. */
const TILES = ['Système', 'Réglages', 'Transfert', 'Plongée'];

const SCREWS = [[16, 14], [120, 10], [244, 10], [348, 14], [10, 150], [354, 150], [16, 286], [120, 290], [244, 290], [348, 286]]
  .map(([x, y]) => `<i class="od-screw" style="left:${x - 5}px;top:${y - 5}px"></i>`)
  .join('');

/** Nombre au format de l'Odyssey : virgule décimale. */
const fr = (t: string) => t.replace('.', ',');

/** Durée en minutes « N' », ou en « m'ss » sous `below` minutes (figures du §8). */
function dur(sec: number, below: number, roundUp = false): string {
  const s = Math.max(0, Math.round(sec));
  if (s < below * 60) return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}`;
  return `${roundUp ? Math.ceil(s / 60) : Math.floor(s / 60)}'`;
}

/** Azoth Systems Odyssey : boutons et affichage, d'après le manuel (règles dans rules.ts). */
export class AzothOdyssey extends OdysseyRules {
  /** Écran d'accueil ou page plongée (en surface). */
  private page: 'home' | 'dive' = 'home';
  private homeSel = 3;
  private sel: Field | null = null;
  private selAt = 0;
  private dtrMode = 0;
  private mid: Mid = 'tank';

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    // §9 : en plongée, l'ordinateur affiche la page plongée.
    this.page = 'dive';
    this.sel = null;
  }

  // §4.3 et §8 : G et D déplacent la surbrillance, le bouton central (OK) valide / fait varier
  // l'affichage du champ en surbrillance. §10.2 : un message d'alerte s'efface par l'appui sur
  // n'importe lequel des 3 boutons.
  press(button: string, s: DiveSession): boolean {
    if (this.notices.dismiss()) return true;
    if (!s.inDive && this.page === 'home') {
      if (button === 'left') this.homeSel = (this.homeSel + 3) % 4;
      else if (button === 'right') this.homeSel = (this.homeSel + 1) % 4;
      else if (this.homeSel === 3) this.page = 'dive';
      return true;
    }
    if (button === 'left' || button === 'right') {
      const order: (Field | null)[] = [null, ...FIELDS];
      const i = order.indexOf(this.sel);
      this.sel = order[(i + (button === 'right' ? 1 : order.length - 1)) % order.length];
      this.selAt = performance.now();
      return true;
    }
    if (this.sel === null) {
      if (!s.inDive) this.page = 'home';
      return true;
    }
    this.selAt = performance.now();
    if (this.sel === 'top') this.settings.top = this.settings.top === 'ceil' ? 'gfsurf' : 'ceil';
    else if (this.sel === 'dtr') this.dtrMode = (this.dtrMode + 1) % DTR_MODES.length;
    else if (this.sel === 'mid') {
      const list = this.mids(s);
      this.mid = list[(list.indexOf(this.mid) + 1) % list.length];
    }
    return true;
  }

  private mids(s: DiveSession): Mid[] {
    return MIDS.filter((m) => m !== 'tank' || this.airIntegrated(s));
  }

  buttons(): Record<string, ButtonHelp> {
    return {
      left: {
        name: 'G',
        press: {
          real: { fr: 'Déplace la surbrillance vers le champ précédent (§8)', en: 'Moves the highlight to the previous field (§8)' },
          simulated: true,
          note: { fr: 'G + D : mise en marche ; G + centre : boussole (non simulés). Ordre des champs non donné par le manuel', en: 'L + R: power on; L + centre: compass (not simulated). Order of the fields not given by the manual' },
        },
      },
      ok: {
        name: 'OK',
        press: {
          real: { fr: 'Valider / entrer : change l’affichage du champ en surbrillance (§8)', en: 'Confirm / enter: changes the highlighted field (§8)' },
          simulated: true,
          note: { fr: 'en surface : passe de l’écran d’accueil à la page plongée et inversement ; changement de gaz non simulé (un seul gaz)', en: 'at the surface: switches between the home screen and the dive page; gas switching not simulated (single gas)' },
        },
      },
      right: {
        name: 'D',
        press: {
          real: { fr: 'Déplace la surbrillance vers le champ suivant (§8)', en: 'Moves the highlight to the next field (§8)' },
          simulated: true,
          note: { fr: 'centre + D : boussole (non simulée)', en: 'centre + R: compass (not simulated)' },
        },
      },
    };
  }

  /**
   * §8 : durée totale de remontée, à 12 m/min jusqu'au premier palier puis 6 m/min entre les paliers,
   * plus les paliers (et le palier O'Dive restant, s'il est actif), en secondes.
   */
  private dtrSec(t: Tissues, depth: number, s: DiveSession, v: ComputerView): number {
    const plan = planAscent(t, depth, s.gas, this.decoParams(s), this.anchor, 1 / 6);
    const first = plan.stops.length ? plan.stops[0].depth : 0;
    const stops = plan.stops.reduce((a, st) => a + st.minutes, 0);
    const odive = !v.inDeco && (v.safety.state === 'pending' || v.safety.state === 'active' || v.safety.state === 'paused') ? v.safety.remaining / 60 : 0;
    return (Math.max(0, depth - first) / 12 + first / 6 + stops + odive) * 60;
  }

  /** Champ DTR (§8) : la DTR et, sous elle, la valeur du mode choisi. */
  private dtrField(v: ComputerView, s: DiveSession): { label: string; main: string; sub: string | null } {
    const sec = this.dtrSec(s.tissues, v.depth, s, v);
    // Figures : « 2' », « 5' », « 0'40 » : m'ss sous 1 min.
    const main = dur(sec, 1, true);
    const label = DTR_MODES[this.dtrMode];
    switch (this.dtrMode) {
      case 1: {
        const t = s.tissues.clone();
        t.expose(depthToPressure(v.depth), s.gas, 5);
        return { label, main, sub: dur(this.dtrSec(t, v.depth, s, v), 1, true) };
      }
      case 2: {
        const end = (s.clock + 9 * 3600 + sec) % 86400;
        return { label, main, sub: `${Math.floor(end / 3600)}:${String(Math.floor((end % 3600) / 60)).padStart(2, '0')}` };
      }
      case 3:
        return { label, main, sub: `${Math.ceil((v.diveTime + sec) / 60)}'` };
      case 4:
        // Un seul gaz simulé : la DTR « Back Gas » est la DTR.
        return { label, main, sub: main };
      default:
        return { label, main, sub: null };
    }
  }

  render(el: HTMLElement, v: ComputerView, s: DiveSession, _lang: Lang): void {
    if (this.sel && performance.now() - this.selAt > 10_000) this.sel = null; // délai non donné : 10 s supposées
    if (!this.mids(s).includes(this.mid)) this.mid = this.airIntegrated(s) ? 'tank' : 'tissues';
    const screen = !v.inDive && this.page === 'home' ? this.home(v, s) : this.divePage(v, s);
    el.innerHTML = `
      <div class="dev od">
        <div class="od-body">
          ${SCREWS}
          <button class="od-btn l" data-btn="left"></button>
          <button class="od-btn r" data-btn="right"></button>
          <button class="od-btn ok" data-btn="ok"></button>
          <div class="od-bezel"><div class="od-screen ${v.inDive ? '' : 'surf'}">${screen}</div></div>
        </div>
      </div>`;
  }

  /** §4.2 / §4.4 (figures) : écran d'accueil. */
  private home(v: ComputerView, s: DiveSession): string {
    const si = v.surfaceInterval;
    const siTxt = si === null ? '--' : si < 3600 ? `${Math.floor(si / 60)}'` : `${Math.floor(si / 3600)} heures`;
    const { h, m } = clockOfDay(s);
    const day = Math.floor((s.clock + 9 * 3600) / 86400) + 2; // date fictive
    const gas = `CO ${Math.round(s.gas.o2 * 100)}%`;
    const icons = ['⚙', '☰', '◓', '⤵'];
    const tile = (i: number) => `<div class="od-tile ${this.homeSel === i ? 'sel' : ''}"><b>${icons[i]}</b><span>${TILES[i]}</span>${i === 3 && v.noFly > 0 ? '<i class="od-nofly">✈</i>' : ''}</div>`;
    return `<div class="od-home">
      ${tile(0)}
      <div class="od-hc top"><div>${siTxt}</div><div>${gas}</div><div>${v.gfLow}/${v.gfHigh}</div></div>
      ${tile(1)}
      ${tile(2)}
      <div class="od-hc bot"><div>${String(day).padStart(2, '0')}/10/26</div><div>${h}:${String(m).padStart(2, '0')}</div><div>${battery()}</div><small>1,5lithium</small></div>
      ${tile(3)}
    </div>`;
  }

  /** §8 (figures) : page plongée. */
  private divePage(v: ComputerView, s: DiveSession): string {
    const hl = (f: Field) => (this.sel === f ? ' od-hl' : '');
    // §8 : palier au-dessus de la consigne (marron) ou du plafond (rouge), au-delà de 10 cm.
    const deco = v.inDive && v.inDeco;
    const stopCls = deco && v.depth < v.ceiling - 0.1 ? ' od-red' : deco && v.depth < v.stopDepth - 0.1 ? ' od-brown' : '';

    // Ligne du haut : Durée, Profondeur, GFsurf ou Plafond.
    const timeTxt = dur(v.diveTime, 5); // m'ss au début de la plongée (figures : « 3'20 », puis « 8' ») ; seuil supposé
    const depth = imperial() ? depthText(v.depth) : fr(depthText(v.depth));
    const ceilMode = this.settings.top === 'ceil';
    const topLbl = ceilMode ? 'Plafond' : 'GFsurf';
    const topVal = ceilMode ? (imperial() ? String(depthInt(v.ceiling)) : fr(v.ceiling.toFixed(1))) : String(Math.round(v.surfGf));
    const top = `
      <div class="od-cell l"><div class="od-lbl">Durée</div><div class="od-val">${timeTxt}</div></div>
      <div class="od-cell c"><div class="od-lbl">Profondeur</div><div class="od-val">${depth}</div></div>
      <div class="od-cell r${hl('top')}${ceilMode ? stopCls : ''}"><div class="od-lbl">${topLbl}</div><div class="od-val">${topVal}</div></div>`;

    // Ligne du milieu : NDL ou palier, DTR.
    const dtr = this.dtrField(v, s);
    const dtrHtml = `<div class="od-cell r dtr${hl('dtr')}"><div class="od-lbl">${dtr.label}</div>${dtr.sub === null
      ? `<div class="od-val">${dtr.main}</div>`
      : `<div class="od-two"><span>${dtr.main}</span><span>${dtr.sub}</span></div>`}</div>`;
    const odive = v.inDive && !deco && (v.safety.state === 'pending' || v.safety.state === 'active' || v.safety.state === 'paused');
    let middle: string;
    if (!v.inDive) {
      // §5.1 (figures) : « Vol possible dans hh:mm » en rouge sur la page plongée.
      const nf = v.noFly > 0 ? `<div class="od-nf">Vol possible dans ${Math.floor(v.noFly / 60)}:${String(Math.floor(v.noFly % 60)).padStart(2, '0')}</div>` : '';
      middle = `<div class="od-cell l wide"><div class="od-lbl">NDL</div>${nf}</div>`;
    } else if (deco || odive) {
      const sec = deco ? v.stopTimeSec : v.safety.remaining;
      const depthStop = deco ? v.stopDepth : Number(this.settings.lastStop) || 3;
      // Figures : « 1'45 », « 0'55 », puis « 3' » : m'ss sous 3 min.
      middle = `<div class="od-cell l${stopCls}"><div class="od-lbl">Durée</div><div class="od-val">${dur(sec, 3, true)}</div></div>
        <div class="od-cell c${stopCls}"><div class="od-lbl">Palier</div><div class="od-val">${depthInt(depthStop)}</div></div>${dtrHtml}`;
    } else {
      // §8 : « +240' » au-delà de 240 min, m'ss sous 3 min (figure « 1'05 »), surbrillance grise sous
      // 3 min ; grisée une fois les paliers terminés (figure « Fin des paliers »).
      const ndlSec = this.ndlSeconds(s, this.decoParams(s).gfHigh);
      const ndlTxt = v.ndl > 240 ? "+240'" : dur(ndlSec, 3);
      const cls = v.ndl < 3 ? ' od-grey' : this.hadDeco ? ' od-dim' : '';
      middle = `<div class="od-cell l ndl${cls}"><div class="od-lbl">NDL</div><div class="od-val">${ndlTxt}</div></div>${dtrHtml}`;
    }

    // Ligne du bas : mode, gaz, champ modulable, ppO2.
    const o2 = Math.round(s.gas.o2 * 100);
    const he = Math.round(s.gas.he * 100);
    const ai = this.airIntegrated(s);
    // Figures : « 21/00 », et « 21% » avec la pression bouteille affichée (place) ; « OXY » pour l'oxygène pur.
    const gas = o2 === 100 ? 'OXY' : ai ? `${o2}%` : `${o2}/${String(he).padStart(2, '0')}`;
    // §10 (figures) : ppO2 sur fond rouge au-delà de l'alerte PO2 fond (« 1,32 » pour 1,30) ; fond
    // olive juste en dessous (« 1,29 », figure de l'alarme PN2) : seuil de 0,05 bar déduit.
    const lim = this.modPpo2;
    const poCls = v.ppO2 > lim ? ' od-al' : v.ppO2 > lim - 0.05 ? ' od-wa' : '';
    const bottom = `
      <div class="od-b mode">CO</div>
      <div class="od-b gas${hl('gas')}">${gas}</div>
      <div class="od-b mid${hl('mid')}${this.mid === 'tank' && v.tank.pressure < 50 ? ' od-al' : ''}">${this.midField(v, s)}</div>
      <div class="od-b po2${poCls}">${fr(v.ppO2.toFixed(2))}</div>`;

    const notice = v.inDive ? this.notices.top : undefined;
    const dialog = notice ? `<div class="od-dlg"><div class="od-dlg-h">Alertes</div><div class="od-dlg-b"><i>!</i><span>${NOTICE_TEXT[notice]}</span></div><div class="od-dlg-ok">Ok</div></div>` : '';
    return `
      ${this.vrColumn(v)}
      <div class="od-main">
        <div class="od-row">${top}</div>
        <div class="od-row two">${middle}</div>
        <div class="od-bot">${bottom}</div>
      </div>${dialog}`;
  }

  /**
   * §10.3 (figures, VR = 12 m/min) : vitesse en haut ; dessous un tiret, trois ▼, trois ▲ et un tiret.
   * Lente (10) : ▲ et tiret du bas blancs ; normale (12) : tout en vert ; rapide (14, 16, 18) : rouge,
   * un, deux puis trois ▼ allumés ; excessive (30) : le tiret du haut aussi. Seuils intermédiaires
   * déduits des figures (+2, +4, +6 m/min ; tiret au double de la VR).
   */
  private vrColumn(v: ComputerView): string {
    const r = v.inDive ? v.ascentRate : 0;
    const vr = this.vr;
    const slots: string[] = Array(8).fill('off');
    let theme = 'grey';
    if (r > vr) {
      theme = 'red';
      slots[3] = 'on';
      if (r > vr + 3) slots[2] = 'on';
      if (r > vr + 5) slots[1] = 'on';
      if (r >= 2 * vr) slots[0] = 'on';
    } else if (r >= vr - 1) {
      theme = 'green';
      slots.fill('on');
    } else if (r >= 1) {
      slots[4] = slots[5] = slots[6] = slots[7] = 'on';
    } else {
      slots[7] = 'green';
    }
    const shape = (i: number) => (i === 0 || i === 7 ? 'dash' : i < 4 ? 'dn' : 'up');
    const num = String(Math.min(99, Math.round(Math.abs(r)))).padStart(2, '0');
    const numCls = r > vr + 6 ? 'od-al' : r < -0.5 ? 'od-desc' : '';
    return `<div class="od-vr ${theme}"><div class="od-rate ${numCls}">${num}</div>${slots.map((st, i) => `<i class="${shape(i)} ${st}"></i>`).join('')}<b class="od-dome"></b></div>`;
  }

  /** Champ central du bas (§8, figures du §5 et du §8). */
  private midField(v: ComputerView, s: DiveSession): string {
    switch (this.mid) {
      case 'tank': {
        // §8 : vert de 250 à 100 bar, orange de 99 à 50 bar, rouge de 49 à 0 bar.
        const p = v.tank.pressure;
        const c = p >= 99.5 ? 'g' : p >= 49.5 ? 'o' : 'r';
        const level = Math.max(0, Math.min(1, p / 250));
        return `<span class="od-tank ${c}"><i style="height:${Math.round(level * 100)}%"></i></span><sub>1</sub>${pressText(p)}<small>${imperial() ? 'psi' : 'b'}</small>`;
      }
      case 'battery':
        return battery(); // valeur fictive : pile pleine
      case 'cns':
        return `${Math.round(v.cns)}%`;
      case 'temp':
        return `${Math.round(tempVal(v.temperature))}${tempUnit()}`;
      case 'max':
        return `${imperial() ? depthText(v.maxDepth) : fr(depthText(v.maxDepth))}${depthUnit()}`;
      default:
        return tissueGraph(s.tissues, s.pressure, s.gas.o2, s.gas.he);
    }
  }
}

function battery(): string {
  return '<span class="od-bat"><i></i><i></i><i></i><i></i><i></i></span>';
}

/**
 * Graphique des tissus (§8, figures) : une ligne par compartiment (rapides en haut), à gauche du trait
 * blanc la sous-saturation (part de la pression inspirée encore à absorber), à droite la sursaturation
 * (% du gradient jusqu'à la M-value). Échelles et couleurs déduites des figures.
 */
function tissueGraph(t: Tissues, pAmb: number, o2: number, he: number): string {
  const g = t.gradientPercents(pAmb);
  const inspired = (pAmb - WATER_VAPOUR) * (n2Fraction({ o2, he }) + he);
  const rows = g.map((x, i) => {
    const p = t.n2[i] + t.he[i];
    if (p < inspired) {
      const w = Math.min(1, (inspired - p) / inspired) * 45;
      const col = w > 20 ? '#2440ff' : '#7a3cff';
      return `<i style="top:${i * 2}px;right:55%;width:${w.toFixed(1)}%;background:${col}"></i>`;
    }
    const w = Math.min(1, Math.max(0, x) / 100) * 55;
    const col = x < 30 ? '#3cc83c' : x < 60 ? '#e8d020' : x < 85 ? '#f09020' : '#e83020';
    return `<i style="top:${i * 2}px;left:45%;width:${w.toFixed(1)}%;background:${col}"></i>`;
  });
  return `<span class="od-tis">${rows.join('')}<b></b></span>`;
}
