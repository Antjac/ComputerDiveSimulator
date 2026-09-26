export type Lang = 'fr' | 'en';

const dict = {
  title: { fr: 'Computer dive simulation', en: 'Computer dive simulation' },
  subtitle: {
    fr: 'Touchez ou cliquez (et glissez) dans l’eau pour fixer la profondeur visée. ▲/▼, molette ou flèches pour ajuster ; +/− accélère le temps, Espace = pause.',
    en: 'Tap or click (and drag) in the water to set the target depth. ▲/▼, wheel or arrow keys to fine-tune; +/− changes time speed, Space pauses.',
  },
  computer: { fr: 'Ordinateur', en: 'Computer' },
  settings: { fr: 'Réglages', en: 'Settings' },
  gas: { fr: 'Gaz', en: 'Gas' },
  gasLocked: { fr: 'Changement de gaz impossible pendant la plongée', en: 'Gas cannot be changed during the dive' },
  site: { fr: 'Fond du site', en: 'Site depth' },
  btnPress: { fr: 'Appui', en: 'Press' },
  btnHold: { fr: 'Appui long', en: 'Hold' },
  notSimulated: { fr: 'non simulé', en: 'not simulated' },
  btnInactive: { fr: 'Bouton inactif dans ce simulateur', en: 'Button inactive in this simulator' },
  envReef: { fr: 'Récif corallien', en: 'Coral reef' },
  envWreck: { fr: 'Épave', en: 'Wreck' },
  envWall: { fr: 'Tombant', en: 'Wall' },
  hint3d: {
    fr: 'Glisser ↕ : profondeur visée · glisser ↔ : tourner la vue · double-clic : recentrer',
    en: 'Drag ↕: target depth · drag ↔: turn the view · double-click: recentre',
  },
  view3dError: { fr: 'Vue 3D indisponible (WebGL non pris en charge)', en: '3D view unavailable (WebGL not supported)' },
  speed: { fr: 'Vitesse du temps', en: 'Time speed' },
  pause: { fr: 'Pause', en: 'Pause' },
  play: { fr: 'Reprendre', en: 'Resume' },
  reset: { fr: 'Réinitialiser (tissus saturés à l’air)', en: 'Reset (tissues at surface equilibrium)' },
  resetShort: { fr: 'Réinitialiser', en: 'Reset' },
  surfaceSkip: { fr: 'Intervalle surface +1 h', en: 'Surface interval +1 h' },
  algorithm: { fr: 'Algorithme', en: 'Algorithm' },
  exact: { fr: 'Algorithme public, reproduit fidèlement', en: 'Public algorithm, faithfully reproduced' },
  approx: { fr: 'Algorithme propriétaire : approximation', en: 'Proprietary algorithm: approximation' },
  compare: { fr: 'Comparaison des ordinateurs', en: 'Computer comparison' },
  compareShort: { fr: 'Comparer', en: 'Compare' },
  tissuesShort: { fr: 'Tissus', en: 'Tissues' },
  logShort: { fr: 'Carnet', en: 'Logbook' },
  units: { fr: 'Unités', en: 'Units' },
  metric: { fr: 'Métrique (m, bar, °C)', en: 'Metric (m, bar, °C)' },
  imperial: { fr: 'Impérial (ft, psi, °F)', en: 'Imperial (ft, psi, °F)' },
  tank: { fr: 'Bloc', en: 'Tank' },
  rmv: { fr: 'Consommation en surface', en: 'Surface consumption (RMV)' },
  reserve: { fr: 'Réserve', en: 'Reserve' },
  transmitter: { fr: 'Émetteur (sonde)', en: 'Transmitter' },
  transmitterModel: { fr: 'Émetteur compatible', en: 'Compatible transmitter' },
  noTransmitter: { fr: 'Cet ordinateur n’a pas d’émetteur : manomètre à côté.', en: 'No transmitter for this computer: gauge shown beside it.' },
  on: { fr: 'Activé', en: 'On' },
  off: { fr: 'Désactivé (manomètre)', en: 'Off (gauge)' },
  gasTime: { fr: 'Gaz (min)', en: 'Gas (min)' },
  spg: { fr: 'Manomètre', en: 'Pressure gauge' },
  tankCol: { fr: 'Bloc', en: 'Tank' },
  LOW_GAS: { fr: 'Réserve atteinte', en: 'Reserve reached' },
  OUT_OF_GAS: { fr: 'Bloc vide !', en: 'Out of gas!' },
  deviceHint: {
    fr: 'Survolez ou touchez un bouton de l’ordinateur pour voir sa fonction. Maintenez-le pour un appui long.',
    en: 'Hover over or tap a computer button to see what it does. Keep it pressed for a long press.',
  },
  ndl: { fr: 'NDL (min)', en: 'NDL (min)' },
  stop: { fr: 'Palier', en: 'Stop' },
  tts: { fr: 'DTR (min)', en: 'TTS (min)' },
  gfs: { fr: 'GF', en: 'GF' },
  profile: { fr: 'Profil de plongée', en: 'Dive profile' },
  tissues: { fr: 'Saturation des 16 compartiments', en: '16-compartment loading' },
  tissuesHelp: {
    fr: '% du gradient de la valeur M à la pression ambiante (100 % = limite de Bühlmann).',
    en: '% of the M-value gradient at ambient pressure (100 % = Bühlmann limit).',
  },
  depth: { fr: 'Profondeur', en: 'Depth' },
  ceiling: { fr: 'Plafond', en: 'Ceiling' },
  time: { fr: 'Temps', en: 'Time' },
  logbook: { fr: 'Carnet de plongée', en: 'Logbook' },
  noDives: { fr: 'Aucune plongée terminée pour l’instant.', en: 'No completed dive yet.' },
  dive: { fr: 'Plongée', en: 'Dive' },
  duration: { fr: 'Durée', en: 'Duration' },
  maxDepth: { fr: 'Prof. max', en: 'Max depth' },
  avgDepth: { fr: 'Prof. moy.', en: 'Avg depth' },
  minTemp: { fr: 'Temp. min', en: 'Min temp' },
  si: { fr: 'Interv. surface', en: 'Surface int.' },
  alarms: { fr: 'Alarmes', en: 'Alarms' },
  none: { fr: 'aucune', en: 'none' },
  status: { fr: 'État', en: 'Status' },
  atSurface: { fr: 'En surface', en: 'At the surface' },
  diving: { fr: 'En plongée', en: 'Diving' },
  surfaceSince: { fr: 'Intervalle surface', en: 'Surface interval' },
  simClock: { fr: 'Horloge simulée', en: 'Simulated clock' },
  disclaimer: {
    fr: 'Outil pédagogique uniquement. Ne l’utilisez jamais pour planifier une vraie plongée. Les interfaces sont inspirées des modèles cités et peuvent en différer (affichage, comportements, valeurs) ; aucune affiliation avec leurs fabricants.',
    en: 'Educational tool only. Never use it to plan a real dive. Displays are inspired by the listed models and may differ from them (layout, behaviour, values); no affiliation with their manufacturers.',
  },
  target: { fr: 'Cible', en: 'Target' },
  ascentRate: { fr: 'Vitesse verticale', en: 'Vertical speed' },
  // Alarm names
  ASCENT: { fr: 'Vitesse de remontée trop élevée', en: 'Ascent rate too fast' },
  ASCENT_WARN: { fr: 'Vitesse de remontée proche de la limite', en: 'Ascent rate near the limit' },
  CEILING: { fr: 'Plafond de déco dépassé (palier manqué)', en: 'Deco ceiling violated (missed stop)' },
  PPO2_HIGH: { fr: 'ppO₂ trop élevée', en: 'ppO₂ too high' },
  PPO2_LOW_WARN: { fr: 'ppO₂ basse', en: 'ppO₂ low' },
  CNS: { fr: 'CNS élevé', en: 'High CNS' },
  NDL_LOW: { fr: 'Limite sans palier proche', en: 'No-deco limit close' },
  DECO: { fr: 'Paliers obligatoires', en: 'Mandatory stops' },
  SAFETY_STOP: { fr: 'Palier de sécurité', en: 'Safety stop' },
  LOCKED: { fr: 'Ordinateur verrouillé (violation de déco)', en: 'Computer locked (deco violation)' },
  help: { fr: 'Aide', en: 'Help' },
  helpFree: {
    fr: 'Cet outil est gratuit. Remarques et suggestions bienvenues par e-mail :',
    en: 'This tool is free. Comments and suggestions are welcome by e-mail:',
  },
  helpText: {
    fr: 'Le temps s’écoule en continu. Cliquez ou glissez dans la colonne d’eau pour fixer la profondeur visée (ligne jaune) : le plongeur s’y rend à une vitesse réaliste, puis s’y stabilise. Attention, une remontée franche dépasse la vitesse autorisée. En surface depuis 3 minutes, la plongée est clôturée et enregistrée dans le carnet. Les tissus restent chargés : la plongée suivante est une successive.',
    en: 'Time runs continuously. Click or drag in the water column to set the target depth (yellow line): the diver swims there at a realistic speed, then stays neutrally buoyant. Careful: a brisk ascent exceeds the allowed ascent rate. After 3 minutes at the surface the dive is closed and saved to the logbook. Tissues stay loaded: the next dive is a repetitive dive.',
  },
} as const;

export type I18nKey = keyof typeof dict;

let current: Lang = (() => {
  try {
    const saved = localStorage.getItem('divesim.lang');
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language.startsWith('fr') ? 'fr' : 'en';
})();

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem('divesim.lang', l);
  } catch {
    /* storage unavailable */
  }
}

export function t(key: I18nKey): string {
  return dict[key][current];
}

export function isI18nKey(k: string): k is I18nKey {
  return k in dict;
}
