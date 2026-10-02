import { type DecoParams, COMPARTMENTS, SURFACE_PRESSURE, Tissues, AIR, depthToPressure, ndl } from '../../../engine/buhlmann';
import type { DiveSession } from '../../../engine/session';
import { type AlertCue, type ComputerView, DiveComputer, SettingDef } from '../../base';
import { Notices } from '../../common/notices';
import { ppo2Setting } from '../../common/ppo2';

export type OdysseyNotice = 'pn2' | 'density';

const on = { fr: 'Actif', en: 'On' };
const off = { fr: 'Inactif', en: 'Off' };

// §6 (figure « Facteurs de gradient ») : « La valeur du GF Low entre 20 et 100 % », « La valeur du
// GF High entre 40 et 100 % ». La figure règle les valeurs chiffre par chiffre ; le simulateur les
// propose par pas de 5.
const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

/** Densité des gaz purs vers 20 °C (g/l à 1 bar) : O₂, N₂, He. */
const RHO = { o2: 1.331, n2: 1.165, he: 0.166 };

/**
 * Azoth Systems Odyssey (firmware 2.0.x), circuit ouvert (CO).
 * Règles d'après le manuel utilisateur version 2.0 du 02/02/2026 (sections citées en commentaire).
 */
export abstract class OdysseyRules extends DiveComputer {
  readonly id = 'odyssey';
  readonly name = 'Azoth Systems Odyssey';
  readonly algorithm = 'Bühlmann ZHL-16C + GF';
  // §2 : Bühlmann ZHL-16C, GF du plongeur (§6). Mais §11 : un « dispositif breveté » de gestion des
  // plongées successives (niveau Standard par défaut) majore la décompression des plongées suivantes
  // d'une façon non publiée : variante non documentée.
  readonly exact = false;
  readonly undocumentedVariant = true;
  readonly transmitter = 'ODC SENSOR';
  readonly notes = {
    fr: 'Mode circuit ouvert (CO), un seul gaz. Bühlmann ZHL-16C avec les facteurs de gradient du plongeur (GF bas 20 à 100 %, GF haut 40 à 100 % ; 80/80 par défaut supposé, d’après les figures). La majoration brevetée des plongées successives (§11, niveau Standard par défaut) n’est pas publiée et n’est pas simulée : les plongées successives sont celles d’un Bühlmann pur. Boutons G et D : déplacent la surbrillance entre les champs modulables (§8) ; OK : change le contenu du champ en surbrillance (DTR → DTR/+5’ → DTR/HS → DTR/DTP → DTR/BG ; bloc, pile, CNS, température, profondeur max., graphique des tissus ; GFsurf ou Plafond). En surface, OK passe de l’écran d’accueil à la page plongée. Paliers (§8) : surbrillance marron à plus de 10 cm au-dessus du palier, rouge à plus de 10 cm au-dessus du plafond ; aucun verrouillage. NDL : « +240’ » au-delà de 240 min, surbrillance grise et deux séries de vibrations sous 3 min. Vitesse de remontée (§10.3) : consigne VR réglable (12 m/min), flèches rouges au-delà, sans vibration. Alarmes (§10) : ppO2 du gaz fond (champ rouge), PN2 et densité du gaz (boîte « Alertes » acquittée par un bouton), bloc sous 50 bar (rouge, vibrations). DTR calculée à 12 m/min, 6 m/min entre les paliers (§8). Le « Palier O’Dive » du menu Déco n’est pas décrit par le manuel : simulé comme un palier supplémentaire à la profondeur du dernier palier, désactivé (0’00) par défaut ; l’Odyssey n’a pas de palier de sécurité documenté. Non simulés : circuit fermé, multigaz et changement de gaz, boussole, planificateur, carnet, menus, taille de police agrandie, eau douce, perte de liaison ODC SENSOR.',
    en: 'Open circuit (CO) mode, single gas. Bühlmann ZHL-16C with the diver’s gradient factors (GF low 20 to 100 %, GF high 40 to 100 %; 80/80 by default assumed, from the figures). The patented repetitive dive penalty (§11, Standard level by default) is not published and is not simulated: repetitive dives are those of plain Bühlmann. L and R buttons: move the highlight between the selectable fields (§8); OK: changes the content of the highlighted field (DTR → DTR/+5’ → DTR/HS → DTR/DTP → DTR/BG; tank, battery, CNS, temperature, max. depth, tissue graph; GFsurf or Plafond). At the surface, OK switches between the home screen and the dive page. Stops (§8): brown highlight more than 10 cm above the stop, red more than 10 cm above the ceiling; no lock-out. NDL: “+240’” beyond 240 min, grey highlight and two series of vibrations below 3 min. Ascent rate (§10.3): settable VR (12 m/min), red arrows beyond it, no vibration. Alarms (§10): bottom gas ppO2 (red field), PN2 and gas density (“Alertes” box acknowledged with a button), tank below 50 bar (red, vibration). DTR computed at 12 m/min, 6 m/min between stops (§8). The Deco menu’s “Palier O’Dive” is not described by the manual: simulated as an extra stop at the last stop depth, off (0’00) by default; the Odyssey has no documented safety stop. Not simulated: closed circuit, multi-gas and gas switching, compass, planner, logbook, menus, large font size, fresh water, ODC SENSOR link loss.',
  };

  readonly settingDefs: SettingDef[] = [
    {
      // §6 : GF Low de 20 à 100 %. Valeur par défaut non donnée : les figures montrent surtout 80/80
      // (écran d'accueil, exemple d'altitude §9) ; 80 supposé.
      key: 'gfLow',
      label: { fr: 'GF bas (Facteurs de gradient)', en: 'GF low (Gradient factors)' },
      options: range(20, 100, 5).map((v) => ({ value: String(v), label: `${v} %` })),
      default: '80',
      group: 'deco',
    },
    {
      // §6 : GF High de 40 à 100 %. 80 supposé (figures).
      key: 'gfHigh',
      label: { fr: 'GF haut (Facteurs de gradient)', en: 'GF high (Gradient factors)' },
      options: range(40, 100, 5).map((v) => ({ value: String(v), label: `${v} %` })),
      default: '80',
      group: 'deco',
    },
    {
      // §6, menu Déco (figures) : « Dernier palier 3m » ou « 6m ».
      key: 'lastStop',
      label: { fr: 'Dernier palier', en: 'Last stop' },
      options: [{ value: '3', label: '3 m' }, { value: '6', label: '6 m' }],
      default: '3',
    },
    {
      // §6, menu Déco (figures) : « Palier O'Dive 0'00 » ou « 4' ». Fonction non décrite par le
      // manuel : simulée comme un palier supplémentaire au dernier palier ; 0'00 (désactivé) supposé.
      key: 'odive',
      label: { fr: 'Palier O’Dive', en: 'O’Dive stop' },
      options: range(0, 10, 1).map((v) => ({ value: String(v), label: v ? `${v}'` : "0'00" })),
      default: '0',
      group: 'deco',
    },
    {
      // §10 (figure « Personnel ») : « Vitesse de remontée 12m/min » ; l'exemple du §10.3 et le calcul
      // de la DTR (§8) utilisent 12 m/min. Autres valeurs et valeur par défaut non données.
      key: 'vr',
      label: { fr: 'Vitesse de remontée (VR)', en: 'Ascent rate (VR)' },
      options: [9, 10, 12, 15, 18].map((v) => ({ value: String(v), label: `${v} m/min` })),
      default: '12',
      group: 'alerts',
    },
    // §10 (figure « Alertes ») : « Alerte PO₂ fond 1,30b » ; plage et valeur par défaut non données.
    { ...ppo2Setting(1.2, 1.6, 1.3, 'Alerte PO₂ fond', 0.05), group: 'alerts' },
    {
      // §10 (figure « Alertes ») : « Alerte PEN₂ 50m » ; plage et valeur par défaut non données.
      key: 'pen2',
      label: { fr: 'Alerte PEN₂ (profondeur équivalente)', en: 'PEN₂ alert (equivalent depth)' },
      options: range(30, 70, 5).map((v) => ({ value: String(v), label: `${v} m` })),
      default: '50',
      group: 'alerts',
    },
    {
      // §10 (figure « Alertes ») : « Alerte densité gaz 5,20g/l » ; plage et valeur par défaut non données.
      key: 'density',
      label: { fr: 'Alerte densité gaz', en: 'Gas density alert' },
      options: range(40, 65, 1).map((v) => ({ value: (v / 10).toFixed(1), label: `${(v / 10).toFixed(2)} g/l` })),
      default: '5.2',
      group: 'alerts',
    },
    {
      // §10 : « La fonction d'alarme par vibrations peut être désactivée » (figures : Actif / Inactif).
      // Valeur par défaut non donnée : Actif supposé.
      key: 'vibration',
      label: { fr: 'Vibreur', en: 'Vibration' },
      options: [{ value: 'on', label: on }, { value: 'off', label: off }],
      default: 'on',
    },
    {
      // §8 (figures) : le champ en haut à droite affiche « GFsurf » ou « Plafond » ; on le change en
      // plongée (surbrillance + OK). Choix par défaut non donné.
      key: 'top',
      essential: true,
      label: { fr: 'Champ en haut à droite', en: 'Top right field' },
      options: [{ value: 'gfsurf', label: 'GFsurf' }, { value: 'ceil', label: 'Plafond' }],
      default: 'gfsurf',
    },
  ];

  /** §10 : boîtes de dialogue « Alertes », affichées jusqu'à l'appui sur un bouton. */
  protected notices = new Notices<OdysseyNotice>(['pn2', 'density']);
  /** La plongée a demandé des paliers (§8 : NDL grisée une fois les paliers terminés, d'après la figure). */
  protected hadDeco = false;

  constructor() {
    super();
    // §8 : « Si la profondeur est inférieure au plafond théorique de décompression, le champ
    // d'affichage du palier est mis en surbrillance rouge au-delà de -10cm » (la surbrillance marron,
    // au-dessus de la consigne, est gérée par l'écran). Aucun verrouillage n'est décrit.
    this.violationRef = 'ceiling';
    this.ceilingMargin = 0.1;
    this.stopWindow = 1.0; // non donné par le manuel
    this.ndlCap = 241; // §8 : « +240' » au-delà de 240 min
    this.init();
  }

  baseParams(): DecoParams {
    const hi = Number(this.settings.gfHigh) || 80;
    const lo = Math.min(Number(this.settings.gfLow) || 80, hi); // contrôle de l'appareil non décrit
    // §8 : remontée à 12 m/min (la DTR ajoute 6 m/min entre les paliers, voir dtr()).
    return { gfLow: lo / 100, gfHigh: hi / 100, lastStop: Number(this.settings.lastStop) || 3, stopStep: 3, ascentRate: 12 };
  }

  /** Consigne VR (§10.3). */
  get vr(): number {
    return Number(this.settings.vr) || 12;
  }

  /**
   * §10.1 : alarme « Instantanée si Vm/min > à la consigne enregistrée ». §10.3 (figures, VR = 12) :
   * 10 lente (blanc), 12 normale (vert), 14 et plus rapide (rouge).
   */
  ascentLevel(rate: number): 0 | 1 | 2 {
    return rate > this.vr ? 2 : 0;
  }

  /** Le « Palier O'Dive » est actif (sinon pas de palier supplémentaire, ni de palier de sécurité). */
  get hasSafetyStop(): boolean {
    return this.settings.odive !== '0';
  }

  safetySeconds(): number {
    return (Number(this.settings.odive) || 0) * 60;
  }

  onDiveStart(s: DiveSession): void {
    super.onDiveStart(s);
    this.notices.clear();
    this.hadDeco = false;
  }

  /** ppN₂ (bar) au-delà de laquelle l'alarme PN2 se déclenche : celle de l'air à la profondeur PEN₂. */
  pn2Limit(): number {
    return 0.79 * depthToPressure(Number(this.settings.pen2) || 50);
  }

  /** Densité du gaz respiré à la pression ambiante (g/l). */
  gasDensity(s: DiveSession): number {
    const n2 = 1 - s.gas.o2 - s.gas.he;
    return (s.gas.o2 * RHO.o2 + n2 * RHO.n2 + s.gas.he * RHO.he) * s.pressure;
  }

  ppn2(s: DiveSession): number {
    return (1 - s.gas.o2 - s.gas.he) * s.pressure;
  }

  tick(s: DiveSession, dt: number): void {
    // Palier O'Dive (non décrit) : au dernier palier, compté entre 1 m au-dessus et 1,5 m en dessous,
    // après une plongée plus profonde que 10 m (seuils supposés).
    const last = Number(this.settings.lastStop) || 3;
    this.safetyStop = { trigger: 10, start: last + 1.5, top: last - 1, bottom: last + 1.5, reset: 10 };
    super.tick(s, dt);
    if (!this.hasSafetyStop) this.safetyState = 'none';
    if (!s.inDive) return;
    if (!s.tissues.tolerates(SURFACE_PRESSURE, this.decoParams(s).gfHigh)) this.hadDeco = true;
    // §10.1 : « Profondeur liée à la pression partielle Azote » et « à la densité du gaz respiré ».
    const now: OdysseyNotice[] = [];
    if (this.ppn2(s) > this.pn2Limit()) now.push('pn2');
    if (this.gasDensity(s) > (Number(this.settings.density) || 5.2)) now.push('density');
    this.notices.update(now);
  }

  /** Les boîtes « Alertes » s'effacent par l'appui sur un bouton (voir press()). */
  acknowledgeAlerts(): boolean {
    return true;
  }

  /**
   * §5.1 : interdiction de vol tant que la « Tension d'Azote Résiduelle » d'un compartiment dépasse
   * 0,8 bar. Les deux figures montrent environ 12 h juste après une plongée courte (« Vol possible dans
   * 11:57 ») : un minimum de 12 h en est déduit.
   */
  noFlyMinutes(t: Tissues, sinceEnd: number): number {
    const sim = t.clone();
    let m = 0;
    const loaded = () => {
      for (let i = 0; i < COMPARTMENTS; i++) if (sim.n2[i] + sim.he[i] > 0.8) return true;
      return false;
    };
    while (loaded() && m < 72 * 60) {
      sim.expose(SURFACE_PRESSURE, AIR, 5);
      m += 5;
    }
    return Math.max(m, 12 * 60 - sinceEnd / 60, 0);
  }

  /** NDL en secondes (§8 : affichée en m'ss sous 3 min). */
  ndlSeconds(s: DiveSession, gfHigh: number): number {
    const m = ndl(s.tissues, s.depth, s.gas, gfHigh, this.ndlCap);
    if (m >= 3) return m * 60;
    const sim = s.tissues.clone();
    const p = s.pressure;
    sim.expose(p, s.gas, m);
    let sec = m * 60;
    while (sec < 180 && sim.tolerates(SURFACE_PRESSURE, gfHigh)) {
      sim.expose(p, s.gas, 5 / 60);
      sec += 5;
    }
    return Math.max(0, sec - 5);
  }

  compute(s: DiveSession): ComputerView {
    const v = super.compute(s);
    if (!s.inDive && s.log.length > 0) v.noFly = this.noFlyMinutes(s.tissues, s.surfaceInterval ?? 0);
    return v;
  }

  summary(v: ComputerView): { ndl: string; stop: string; tts: string } {
    const r = super.summary(v);
    if (!v.inDeco && v.ndl > 240) r.ndl = '+240';
    return r;
  }

  get soundKind(): AlertCue['kind'] {
    return 'buzz';
  }

  /**
   * Vibrations (§10) : NDL sous 3 min, « deux séries d'avertissement par vibration » (§8) ; pression
   * bouteille faible « avec vibrations », vitesse de remontée « sans vibration » (légende des figures
   * du §10). Boîtes « Alertes » PN2 et densité : vibration supposée (non précisé), jusqu'à l'acquittement.
   */
  alertCues(v: ComputerView): AlertCue[] {
    if (this.settings.vibration === 'off' || !v.inDive) return [];
    const cues: AlertCue[] = [];
    if (!v.inDeco && v.ndl < 3 && v.depth > 1) cues.push({ key: 'ndl3', kind: 'buzz', level: 'warning', until: 'once', first: 2 });
    if (v.tank.ai && v.tank.pressure < 50) cues.push({ key: 'low-gas', kind: 'buzz', level: 'warning', until: 'once' });
    for (const key of this.notices.all) cues.push({ key, kind: 'buzz', level: 'alarm', until: 'ack', every: 10 });
    return cues;
  }
}
