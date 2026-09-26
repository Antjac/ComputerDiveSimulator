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
    fr: 'Glisser ↕ : profondeur visée · glisser ↔ ou ◀/▶ : tourner · clic droit ou Maj + glisser : pivoter la caméra · double-clic : recentrer',
    en: 'Drag ↕: target depth · drag ↔ or ◀/▶: turn · right-click or Shift + drag: orbit the camera · double-click: recentre',
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
  captionExact: {
    fr: 'Interprétation non officielle de l’interface · algorithme public, valeurs pouvant différer de l’appareil réel',
    en: 'Unofficial interpretation of the display · public algorithm, values may differ from the real device',
  },
  captionApprox: {
    fr: 'Interprétation non officielle · algorithme propriétaire approché : les valeurs diffèrent de l’appareil réel',
    en: 'Unofficial interpretation · approximated proprietary algorithm: values differ from the real device',
  },
  introTitle: { fr: 'Avant de commencer', en: 'Before you start' },
  introEdu: {
    fr: 'Ce simulateur est un outil pédagogique. Ne l’utilisez jamais pour planifier ou conduire une vraie plongée : suivez votre formation, vos tables et le manuel de votre ordinateur.',
    en: 'This simulator is an educational tool. Never use it to plan or conduct a real dive: follow your training, your tables and your computer’s manual.',
  },
  introApprox: {
    fr: 'Les écrans sont des interprétations inspirées des modèles cités, pas des reproductions. Les ordinateurs marqués ≈ utilisent des algorithmes propriétaires non publiés, approchés ici : leurs valeurs (NDL, paliers…) diffèrent de celles de l’appareil réel.',
    en: 'Displays are interpretations inspired by the listed models, not reproductions. Computers marked ≈ use unpublished proprietary algorithms, approximated here: their values (NDL, stops…) differ from the real device.',
  },
  introBrands: {
    fr: 'Projet indépendant, sans affiliation avec les fabricants. Les noms de marques appartiennent à leurs propriétaires et ne servent qu’à identifier les modèles.',
    en: 'Independent project, not affiliated with the manufacturers. Brand names belong to their owners and are only used to identify the models.',
  },
  introOk: { fr: 'J’ai compris', en: 'I understand' },
  about: { fr: 'À propos', en: 'About' },
  close: { fr: 'Fermer', en: 'Close' },
  aboutModels: { fr: 'Ordinateurs simulés', en: 'Simulated computers' },
  aboutModel: { fr: 'Modèle', en: 'Model' },
  aboutFidelity: { fr: 'Fidélité', en: 'Fidelity' },
  aboutModelsNote: {
    fr: 'Les algorithmes propriétaires (RGBM, ZH-L16 ADT MB) ne sont pas publiés : ils sont approchés à partir de Bühlmann ZHL-16C avec des facteurs de gradient et des pénalités calibrés sur des valeurs publiées. Les écrans et les règles (alarmes, paliers, verrouillages…) s’inspirent des manuels utilisateurs publics de chaque modèle, sans les reproduire : disposition, couleurs, polices, textes, menus, comportements et valeurs peuvent différer, et seule une partie des fonctions est simulée. Le manuel officiel et l’appareil réel font foi.',
    en: 'Proprietary algorithms (RGBM, ZH-L16 ADT MB) are unpublished: they are approximated from Bühlmann ZHL-16C with gradient factors and penalties calibrated on published values. Displays and rules (alarms, stops, lockouts…) are inspired by each model’s public user manual without reproducing it: layout, colours, fonts, texts, menus, behaviour and values may differ, and only part of the features are simulated. The official manual and the real device prevail.',
  },
  aboutBrandsTitle: { fr: 'Marques et affiliation', en: 'Trademarks and affiliation' },
  aboutBrands: {
    fr: 'Ce projet est indépendant et n’est ni affilié, ni approuvé, ni sponsorisé par les fabricants cités. Shearwater, Perdix, Garmin, Descent, Suunto, Mares, Puck, Scubapro et Galileo sont des marques de leurs propriétaires respectifs ; elles sont citées uniquement pour identifier les modèles dont les interfaces sont inspirées. Aucun logo, code ou élément graphique des fabricants n’est inclus.',
    en: 'This project is independent and is not affiliated with, endorsed or sponsored by the manufacturers mentioned. Shearwater, Perdix, Garmin, Descent, Suunto, Mares, Puck, Scubapro and Galileo are trademarks of their respective owners; they are only mentioned to identify the models whose displays inspired this simulator. No manufacturer logo, code or artwork is included.',
  },
  aboutRemoval: {
    fr: 'Si vous représentez l’un de ces fabricants et souhaitez qu’un élément soit modifié ou retiré, écrivez à :',
    en: 'If you represent one of these manufacturers and would like something changed or removed, please write to:',
  },
  aboutLicenceTitle: { fr: 'Licence et responsabilité', en: 'Licence and liability' },
  aboutLicence: {
    fr: 'Logiciel libre sous licence MIT, fourni « tel quel », sans aucune garantie. Les calculs sont des approximations. Les auteurs ne sauraient être tenus responsables de son utilisation.',
    en: 'Free software under the MIT licence, provided “as is”, without any warranty. Calculations are approximations. The authors cannot be held liable for its use.',
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
