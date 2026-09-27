export type Lang = 'fr' | 'en';

const dict = {
  title: { fr: 'Simulateur d’ordinateurs de plongée', en: 'Dive Computers simulator' },
  subtitle: {
    fr: 'Touchez ou cliquez (et glissez) dans l’eau pour aller à une profondeur (à la dernière vitesse choisie). ▲/▼ ou flèches : vitesse de montée / descente (±1 m/min), ■ ou 0 : arrêt ; +/− accélère le temps, Espace = pause.',
    en: 'Tap or click (and drag) in the water to go to a depth (at the last chosen speed). ▲/▼ or arrow keys: ascent / descent speed (±1 m/min), ■ or 0: stop; +/− changes time speed, Space pauses.',
  },
  rateUp: { fr: 'Monter plus vite / descendre moins vite (1 m/min)', en: 'Ascend faster / descend slower (1 m/min)' },
  rateDown: { fr: 'Descendre plus vite / monter moins vite (1 m/min)', en: 'Descend faster / ascend slower (1 m/min)' },
  rateStop: { fr: 'Stabiliser (vitesse nulle)', en: 'Hold depth (zero speed)' },
  rateCmd: { fr: 'consigne', en: 'set' },
  rateTarget: { fr: 'vers', en: 'to' },
  computer: { fr: 'Ordinateur', en: 'Computer' },
  settings: { fr: 'Réglages', en: 'Settings' },
  advanced: { fr: 'Réglages avancés', en: 'Advanced settings' },
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
  imperialShort: { fr: 'Impérial', en: 'Imperial' },
  tank: { fr: 'Bloc', en: 'Tank' },
  rmv: { fr: 'Conso. en surface', en: 'Surface RMV' },
  // Rescue alert (session.emergency, main.ts renderRescue)
  rescueAlert: { fr: 'Alerte secours', en: 'Rescue alert' },
  enabled: { fr: 'Activé', en: 'On' },
  disabled: { fr: 'Désactivé', en: 'Off' },
  rescueHelp: {
    fr: 'Arrête la simulation après une remontée trop rapide ou des paliers obligatoires non faits (pas le palier de principe). Un bloc vide l’arrête toujours.',
    en: 'Stops the simulation after an ascent that is too fast or required stops left undone (not the safety stop). An empty tank always stops it.',
  },
  rescueStop: { fr: 'Simulation arrêtée', en: 'Simulation stopped' },
  rescueAirT: { fr: 'Panne d’air', en: 'Out of air' },
  rescueAirB: { fr: 'Le bloc est vide, à {depth}.', en: 'The tank is empty, at {depth}.' },
  rescueRapidT: { fr: 'Remontée trop rapide', en: 'Ascent too fast' },
  rescueRapidB: {
    fr: 'Vitesse moyenne de {rate} de {from} à {to} (alerte au-delà de {max}).',
    en: 'Average speed of {rate} from {from} to {to} (alert above {max}).',
  },
  rescueToSurface: { fr: 'la surface', en: 'the surface' },
  rescueDecoT: { fr: 'Paliers non effectués', en: 'Stops not completed' },
  rescueDecoB: {
    fr: 'Arrivée en surface avec des paliers encore obligatoires, quel que soit l’ordinateur : un compartiment dépasse sa valeur M de surface (SurfGF {gf} %, Bühlmann ZH-L16C sans gradient factors).',
    en: 'Surfaced while decompression stops were still required, whatever the computer: a compartment exceeds its surface M-value (SurfGF {gf} %, Bühlmann ZH-L16C without gradient factors).',
  },
  rescueFoot: {
    fr: 'En réalité, c’est une urgence : appliquez les procédures apprises en formation, qui varient selon les fédérations. Recommencez pour repartir avec des tissus neufs.',
    en: 'In real life this is an emergency: follow the procedures from your training, which vary between agencies. Start over to begin again with fresh tissues.',
  },
  rescueReset: { fr: 'Recommencer', en: 'Start over' },
  rescueHide: { fr: 'Masquer', en: 'Hide' },
  rescueShow: { fr: 'Afficher l’alerte', en: 'Show the alert' },
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
  tissuesNow: { fr: 'À la profondeur (GF99)', en: 'At depth (GF99)' },
  tissuesSurf: { fr: 'En surface (SurfGF)', en: 'At the surface (SurfGF)' },
  leading: { fr: 'Tissu directeur', en: 'Leading tissue' },
  gf99Help: {
    fr: 'GF99 : sursaturation du compartiment le plus chargé à la profondeur actuelle, en % de la valeur M (0 % = équilibre, 100 % = limite de Bühlmann).',
    en: 'GF99: supersaturation of the most loaded compartment at the current depth, in % of the M-value (0 % = equilibrium, 100 % = Bühlmann limit).',
  },
  surfGfHelp: {
    fr: 'SurfGF : le GF qu’on aurait en remontant instantanément en surface. Au-dessus du GF haut de l’ordinateur, une sortie directe n’est pas permise.',
    en: 'SurfGF: the GF you would have if you surfaced instantly. Above the computer’s GF high, a direct ascent is not allowed.',
  },
  tissuesHelpSurf: {
    fr: '% du gradient de la valeur M en surface : le GF de chaque compartiment si l’on sortait maintenant. La ligne pointillée est le GF haut de l’ordinateur.',
    en: '% of the M-value gradient at the surface: each compartment’s GF if you surfaced now. The dashed line is the computer’s GF high.',
  },
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
  // Dive type from the surface interval before it: under 15 min consecutive, under 12 h repetitive.
  diveType: { fr: 'Type', en: 'Type' },
  diveSingle: { fr: 'Simple', en: 'Single' },
  diveConsecutive: { fr: 'Consécutive', en: 'Consecutive' },
  diveRepetitive: { fr: 'Successive', en: 'Repetitive' },
  diveTypeHelp: {
    fr: 'Consécutive : moins de 15 min d’intervalle surface ; successive : moins de 12 h ; simple : première plongée ou plus de 12 h.',
    en: 'Consecutive: surface interval under 15 min; repetitive: under 12 h; single: first dive or more than 12 h.',
  },
  // Boat offering a full tank at the surface (main.ts, updateBoat).
  boatAsk: { fr: 'Ohé ! Il vous reste {p}. On vous passe un bloc plein ?', en: 'Ahoy! You have {p} left. Want a full tank?' },
  boatAskNote: { fr: 'Oui : vous remontez à bord, la plongée est terminée.', en: 'Yes: you climb aboard and the dive ends.' },
  boatYes: { fr: 'Oui', en: 'Yes' },
  boatNo: { fr: 'Non', en: 'No' },
  boatYesReply: { fr: 'Voilà un bloc plein : {p}. Bonne pause à bord !', en: 'Here is a full tank: {p}. Enjoy the break on board!' },
  boatNoReply: { fr: 'Pas de souci, bonne plongée !', en: 'No worries, enjoy your dive!' },
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
  introTour: { fr: 'Faire la visite', en: 'Take the tour' },
  // Guided tour (src/ui/tour.ts, steps in main.ts)
  tourOpen: { fr: 'Comment s’en servir ?', en: 'How to use it?' },
  tourPrev: { fr: 'Précédent', en: 'Back' },
  tourNext: { fr: 'Suivant', en: 'Next' },
  tourDone: { fr: 'Terminer', en: 'Finish' },
  tourWelcomeT: { fr: 'Visite guidée', en: 'Guided tour' },
  tourWelcomeB: {
    fr: 'En quelques étapes : piloter la plongée, lire l’ordinateur, comparer les modèles. La simulation est en pause pendant la visite.<br><span class="muted">Naviguez avec les flèches ← → du clavier, quittez avec Échap.</span>',
    en: 'In a few steps: steering the dive, reading the computer, comparing models. The simulation is paused during the tour.<br><span class="muted">Use the ← → arrow keys to navigate, Esc to leave.</span>',
  },
  tourComputerT: { fr: 'Choisir un ordinateur', en: 'Pick a computer' },
  tourComputerB: {
    fr: 'Choisissez le modèle simulé. <b>✓</b> : algorithme public (Bühlmann + facteurs de gradient), reproduit fidèlement. <b>≈</b> : algorithme propriétaire, approché. Tous les ordinateurs suivent la même plongée : vous pouvez en changer à tout moment, même sous l’eau.',
    en: 'Choose the simulated model. <b>✓</b>: public algorithm (Bühlmann + gradient factors), faithfully reproduced. <b>≈</b>: proprietary algorithm, approximated. All computers follow the same dive: you can switch at any time, even underwater.',
  },
  tourSceneT: { fr: 'La colonne d’eau', en: 'The water column' },
  tourSceneB: {
    fr: 'Cliquez ou touchez dans l’eau pour choisir une profondeur, ou glissez pour la faire varier : le plongeur s’y rend à la dernière vitesse choisie, puis s’y stabilise. Après 3 minutes en surface, la plongée est terminée et enregistrée dans le carnet.',
    en: 'Click or tap in the water to pick a depth, or drag to change it: the diver goes there at the last chosen speed, then stays there. After 3 minutes at the surface, the dive ends and is saved to the logbook.',
  },
  tourRateT: { fr: 'Vitesse de montée et de descente', en: 'Ascent and descent speed' },
  tourRateB: {
    fr: '<b>▲ / ▼</b> (ou les flèches du clavier) : vitesse de montée ou de descente, par pas de 1 m/min. <b>■</b> (ou 0) : stabiliser. Une remontée trop rapide déclenche l’alarme de l’ordinateur, comme sur l’appareil réel.',
    en: '<b>▲ / ▼</b> (or the arrow keys): ascent or descent speed, in 1 m/min steps. <b>■</b> (or 0): hold depth. Ascending too fast triggers the computer’s alarm, as on the real device.',
  },
  tourViewT: { fr: 'Vue 2D ou 3D', en: '2D or 3D view' },
  tourViewB: {
    fr: 'La vue 3D place le plongeur dans un décor (récif, épave, tombant) : glissez verticalement pour la profondeur, horizontalement pour tourner.',
    en: 'The 3D view puts the diver in a setting (reef, wreck, wall): drag vertically for depth, horizontally to turn.',
  },
  tourDeviceT: { fr: 'L’écran de l’ordinateur', en: 'The computer display' },
  tourDeviceB: {
    fr: 'Il affiche ce que montrerait le modèle choisi : profondeur, durée, NDL, paliers… Survolez ou touchez un <b>bouton</b> de l’ordinateur pour voir sa fonction ; maintenez-le pour un appui long. Les alarmes s’affichent juste en dessous.',
    en: 'It shows what the chosen model would display: depth, time, NDL, stops… Hover over or tap one of the computer’s <b>buttons</b> to see what it does; keep it pressed for a long press. Alarms are listed right below.',
  },
  tourProfileT: { fr: 'Profil de plongée', en: 'Dive profile' },
  tourProfileB: {
    fr: 'La profondeur et le plafond de décompression au fil du temps. Survolez la courbe pour lire les valeurs.',
    en: 'Depth and decompression ceiling over time. Hover over the curve to read the values.',
  },
  tourSettingsT: { fr: 'Réglages', en: 'Settings' },
  tourSettingsB: {
    fr: 'Les réglages de l’ordinateur choisi (écran…), le gaz, modifiable seulement en surface, et l’<b>alerte secours</b>, qui arrête la simulation en cas d’incident. Les <b>réglages avancés</b> regroupent d’abord la plongée (unités, fond du site, bloc, réserve, consommation), puis les autres réglages de l’ordinateur et l’émetteur.',
    en: 'The chosen computer’s settings (display…), the gas, which can only be changed at the surface, and the <b>rescue alert</b>, which stops the simulation after an incident. <b>Advanced settings</b> hold the dive first (units, site depth, tank, reserve, consumption), then the computer’s other settings and the transmitter.',
  },
  tourTimeT: { fr: 'Le temps', en: 'Time' },
  tourTimeB: {
    fr: 'Accélérez le temps (touches + / −), mettez en pause (Espace), ajoutez une heure d’intervalle surface entre deux plongées, ou réinitialisez les tissus.',
    en: 'Speed time up (+ / − keys), pause (Space), add an hour of surface interval between two dives, or reset the tissues.',
  },
  tourCompareT: { fr: 'Comparer', en: 'Compare' },
  tourCompareB: {
    fr: 'Tous les ordinateurs calculent la même plongée : NDL, palier, durée totale de remontée et autonomie côte à côte. Cliquez sur une ligne pour passer sur cet ordinateur.',
    en: 'All computers compute the same dive: NDL, stop, time to surface and gas time side by side. Click a row to switch to that computer.',
  },
  tourTissuesT: { fr: 'Tissus', en: 'Tissues' },
  tourTissuesB: {
    fr: 'La saturation des 16 compartiments du modèle de Bühlmann, à la profondeur actuelle (GF99) ou en cas de remontée immédiate (SurfGF). Survolez une barre pour le détail.',
    en: 'The loading of the 16 Bühlmann compartments, at the current depth (GF99) or if you surfaced now (SurfGF). Hover over a bar for details.',
  },
  tourLogT: { fr: 'Carnet', en: 'Logbook' },
  tourLogB: {
    fr: 'Chaque plongée terminée y est enregistrée. Sur grand écran, cliquez sur une plongée pour revoir son profil. Les tissus restent chargés : la plongée suivante est une successive.',
    en: 'Every completed dive is saved here. On a large screen, click a dive to see its profile again. Tissues stay loaded: the next dive is a repetitive dive.',
  },
  tourEndT: { fr: 'À vous de plonger !', en: 'Your turn to dive!' },
  tourEndB: {
    fr: 'Relancez cette visite à tout moment avec ce bouton. Le bouton « À propos », en haut à droite, détaille les modèles simulés et leurs limites. Rappel : outil pédagogique, jamais pour planifier une vraie plongée.',
    en: 'Replay this tour at any time with this button. The “About” button, top right, details the simulated models and their limits. Reminder: educational tool, never for planning a real dive.',
  },
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

/** Has the user already picked a language (saved in local storage)? */
export function langChosen(): boolean {
  try {
    const saved = localStorage.getItem('divesim.lang');
    return saved === 'fr' || saved === 'en';
  } catch {
    return false; // storage unavailable: asked again at each visit
  }
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
