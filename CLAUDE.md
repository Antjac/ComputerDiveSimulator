# Simulateur d'ordinateurs de plongée — consignes pour Claude

Simulateur pédagogique d'ordinateurs de plongée (TypeScript + Vite, sans framework). L'utilisateur
écrit en français : répondre en français. Textes de l'interface toujours en français **et** en
anglais (`src/i18n.ts`, champs `{ fr, en }` des modèles).

## Commandes

```bash
npm run dev        # serveur Vite (hook de test window.__divesim en dev : session, computers, advance, refresh, select)
npm run build      # tsc --noEmit + build : doit passer avant de rendre la main
npm run stops      # contrôle des paliers de tous les ordinateurs (ou : npm run stops -- <id>)
npm run scenario   # rejoue un profil sur tous les ordinateurs
npm run calib      # tables de NDL (calibration des algorithmes approchés)
npm run snapshot   # non-régression : vues et HTML de tous les ordinateurs × états × unités × mises en page
                   # comparés à .snapshots/baseline.json (-- --save pour la créer avant un refactoring,
                   # -- <id> pour un seul ordinateur). Un changement voulu d'affichage la rend obsolète.
npm run exercises  # joue chaque exercice de l'onglet Exercices sur chaque ordinateur : tous doivent être réussis
```

## Architecture en bref

- `src/engine/buhlmann.ts` : ZHL-16C + GF (méthode d'Erik Baker), `planAscent`, `ceilingDepth`, `updateAnchor`, `ndl`.
- `src/engine/session.ts` : état **physique** du plongeur (profondeur, tissus, gaz, blocs). Les
  ordinateurs le lisent, ne le modifient jamais, à une exception près : le changement de gaz fait
  avec les boutons de l'ordinateur affiché (`s.switchGas`), qui vaut pour tous les ordinateurs
  comparés. Les tissus sont **partagés** par tous les modèles.
- Multigaz : gaz du bloc principal + gaz de déco en blocs relais (`decoGases`, `breathing`) ;
  chaque modèle déclare `maxGases`, `decoPpo2`/`decoMod`, `planGases` (gaz comptés dans le plan) ;
  invites de changement communes dans `common/gasSwitch.ts` (et `mares/common.ts`).
- `src/computers/base/` : classe `DiveComputer` (`computer.ts` : paliers, palier de sécurité,
  violations, verrouillage, `compute()` → `ComputerView`), types, formats, calculs sur les tissus.
- `src/computers/common/` : utilitaires partagés (prédictions GF/TTS, jours de plongée, acquittement
  des alarmes, afficheurs 7 segments et à matrice de points) ; `src/computers/mares/common.ts` : règles communes aux Mares ;
  `src/computers/scubapro/common.ts` : règles communes aux Scubapro (vitesse idéale, niveaux MB, PDIS, SOS, RBT) ;
  `src/computers/cressi/common.ts` : règles communes aux Cressi (RGBM ≈, deep stop, mode ERROR, pénalités),
  `cressi/lcd.ts` + `lcd.css` : l'afficheur segmenté commun au Goa et au Donatello.
- Un dossier par modèle (`src/computers/<marque>/` ou `mares/<modèle>/`) : `rules.ts` (classe
  abstraite `XRules extends DiveComputer` : réglages, algorithme, paliers, alarmes — ce qu'on vérifie
  dans le manuel), `index.ts` (classe finale : écrans, boutons, rendu HTML), sa feuille `.css`
  (importée dans `src/style.css`). Enregistré dans `src/computers/index.ts`.
- `src/app/` : l'interface, un module par fonction (`state.ts` état partagé, `settings.ts`,
  `diveControls.ts`, `tabs.ts`, `render.ts`, `loop.ts` boucle de simulation, `rescue.ts`,
  `devHook.ts`, `exercises.ts` onglet Exercices et `exerciseDefs.ts` ses exercices…). Les modules ne
  font que déclarer ; `src/main.ts` les branche dans l'ordre.
- `src/ui/` : scène 2D, graphiques, visite guidée ; `src/ui/scene3d/` : vue 3D (three.js, chargée à
  la demande). `src/styles/` : feuilles de la page.

## Règle d'or : le manuel officiel fait foi

Le but est que **comportement et affichage soient aussi proches que possible de l'appareil réel**.
L'utilisateur ne doit pas avoir à le redemander.

1. **Travailler à partir du manuel officiel du modèle exact** (et du mode simulé, ex. Perdix 2 en
   mode Recreational). Ne jamais s'appuyer sur un modèle voisin ou une ancienne génération (ex. le
   manuel du Perdix 1 ne vaut pas pour le Perdix 2), ni sur sa mémoire.
2. **Lire les figures, pas seulement le texte.** Beaucoup d'informations (libellés exacts, ordre des
   champs, couleurs, décimales) ne figurent que dans les captures d'écran, et le texte est parfois
   incomplet (ex. la liste des champs BR du Quad Ci omet « GF @SURF/GF RATE », visible sur la figure).
3. **Citer la section** du manuel dans un commentaire à côté de chaque règle implémentée
   (`// §5.2 : …`). Les notes du modèle (`notes.fr/en`) résument ce qui est simulé et ce qui ne l'est pas.
4. **Ne rien inventer.** Si le manuel ne dit rien, le dire explicitement à l'utilisateur (« non
   vérifié ») plutôt que de présenter une supposition comme un fait. Une déduction tirée des figures
   est signalée comme telle (commentaire + compte rendu). Les valeurs fictives (n° de série,
   batterie…) sont marquées comme telles dans le code.
5. **Après une vérification, lister ce qui reste non vérifié** et les écarts repérés mais non corrigés.

### Obtenir et lire un manuel

- Chercher le PDF sur le site du fabricant (WebSearch), le télécharger avec `curl -sL -A "Mozilla/5.0"`
  dans le scratchpad, vérifier l'en-tête `%PDF`.
- Texte : `pdftotext -layout manuel.pdf manuel.txt` puis `grep`. Les manuels sur plusieurs colonnes
  s'extraient mal : découper les lignes par colonnes (`ligne[:80]`, `ligne[80:]`).
- Figures : `pdftoppm -f N -l N -r 220 -png manuel.pdf page`, recadrer avec PIL et lire l'image.
  L'outil Read lit aussi les PDF (`pages`), mais en basse résolution.
- Si le site bloque (protection anti-robot, ex. Scubapro) : miroirs (ManualsLib avec `?page=N` via
  WebFetch, readkong…), en vérifiant qu'il s'agit bien du même modèle et d'une révision récente.
- Le résumé de WebFetch sur un PDF peut être faux : toujours vérifier dans le document lui-même.

## Checklist : ajouter (ou revoir) un ordinateur

Passer **chaque** point en revue dans le manuel, l'implémenter ou noter qu'il n'est pas simulé.

### 1. Identité et algorithme
- Nom exact, mode simulé, algorithme. `exact = true` seulement si l'algorithme est public et
  reproduit (Bühlmann + GF) ; sinon approximation (≈) calibrée sur les tables de NDL publiées
  (`npm run calib`).
- Paramètres de déco : GF (ou équivalent) pour chaque niveau de conservatisme, profondeur du dernier
  palier (3/6 m), pas entre paliers, **vitesse de remontée supposée par le calcul** (ex. 10 m/min
  Perdix 2 et D5), eau douce/salée, altitude.
- Pénalités propres au modèle : plongées successives, multi-jours, remontée rapide, palier ignoré…

### 2. Réglages (`settingDefs`)
- Tous les réglages utiles à la plongée, avec les valeurs **par défaut du fabricant**.
- Marquer `essential: true` le seul réglage d'affichage de l'écran (mise en page) ; les autres vont
  dans « Réglages avancés ».

### 3. Boutons (`buttons()`, `press()`, `hold()`)
- Chaque bouton, appui court et long, en plongée ; fonction réelle d'après le manuel, `simulated`
  vrai/faux et `note` si la simulation diffère.
- Enchaînement exact des écrans : ordre, écrans conditionnels (surface seulement, avec émetteur, en
  nitrox seulement, champs masqués en mode AIR…), retour à l'écran principal, **délai de retour et
  ses exceptions** (ex. Perdix 2 : 10 s sauf TISSUES et bloc).

### 4. Écran principal, dans chaque état
Vérifier champs, **libellés exacts** (casse, abréviations : `SurGF` et non `SurfGF`, `STOP, m` et non
`CEILING` sur le D5), unités, décimales, arrondis, couleurs, clignotements, pour :
surface, pré-plongée, descente, sans palier, NDL faible, entrée en déco, approche d'un palier, au
palier, au-dessus du palier, palier de sécurité (attente, en cours, en pause, terminé), remontée
rapide, surface pendant la plongée (surfacing), après la plongée, ordinateur verrouillé.

Pour **chaque mise en page** du modèle (ex. E-Z et FULL sur le Quad Ci), vérifier à l'écran que
chaque valeur tient dans sa case, y compris combinée à une alarme ou un bandeau (ex. palier de
sécurité + HALF TANK) : aucun texte ne doit déborder ni être coupé. Les tailles de police d'une mise
en page ne valent pas forcément pour l'autre.

### 5. Écrans d'info / champs alternatifs
- Ordre exact et contenu de chaque écran (comparer aux figures).
- Écran par défaut ou écran personnalisé à configurer sur l'appareil (ex. GF99 sur Garmin) : le
  préciser dans les notes.

### 6. Paliers de décompression
- Ancre GF bas, comme dans Subsurface (`gf_low_pressure_this_dive`) : plafond GF bas le plus profond
  de la plongée, non arrondi, au moins 1 bar sous la surface (`updateAnchor`, `this.anchor`), mise à
  jour aussi pendant la remontée simulée par `planAscent`. Elle ne fait que descendre : ni plafond ni
  palier ne remontent tant qu'on reste au fond. **Ne jamais ramener l'ancre à la profondeur du
  plongeur** : la durée d'un palier ne doit jamais augmenter à l'arrivée.
- Affichage du palier : profondeur, durée (minutes seules ou mm:ss, arrondi), durée totale (TTS/DTR),
  plafond continu ou paliers de 3 m (le D5 raisonne en plafond continu).
- Indicateur d'approche (ex. Perdix 2 : jaune + ↑ à moins de 5,1 m ; Garmin : « Approaching Deco
  Stop » à moins de 3 m).
- Fenêtre « au palier » (`stopWindow`) : ex. Perdix 2 jusqu'à 1,5 m plus profond, Garmin 0,6 m.
- **Au-dessus du palier** : référence (`violationRef` : profondeur du palier par défaut, plafond pour
  le D5), marge (`ceilingMargin`), alarme (texte exact, couleurs), et ce que devient le calcul :
  chronomètre en pause (Garmin), calcul ou désaturation stoppés (D5, Puck Pro → `withPausedDeco`).
- Conséquences d'un palier manqué : seuils de durée et de distance, verrouillage (`lockAfter`,
  `lockHours`), mode profondimètre, SOS (G2 : > 3 min au-dessus de 0,8 m avec une obligation), GF de
  secours, affichage du verrouillage en surface et à la plongée suivante.
- Fin des paliers : message (« Decompression Cleared »…), palier de sécurité qui démarre ensuite.
- Deep stops (conditions, profondeur, durée, facultatifs ou non) et options du type CEIL-CON.

### 7. Palier de sécurité (`safetyStop`, `safetySeconds`)
Profondeur de déclenchement, profondeur de départ du décompte, fenêtre, remise à zéro, durées
possibles, adaptatif, pause et couleurs, remontée avant la fin, obligatoire après une violation.

### 8. Vitesse de remontée
Seuils (éventuellement selon la profondeur), affichage (flèches, segments, %), couleurs, délai
avant alarme, conséquences (pénalités, verrouillage).

### 9. NDL et avertissements
Plafonnement (99), avertissements (ex. 2, 3, 5 ou 10 min), libellés.

### 10. Valeurs de GF (si l'appareil les affiche)
GF99, SurfGF (et son libellé exact), @+5, Δ+5, taux d'évolution… Définition exacte, règles de
couleur (ex. Perdix 2 : SurGF prend la couleur de GF99 ; Quad Ci : GF RATE jaune ou bleu),
« On Gas » / « On-Gassing » (`leadingOnGas`).

### 11. Gaz et oxygène
O₂ %, ppO₂ de la MOD, alarmes ppO₂, seuils et couleurs du CNS, OTU. Émetteur : nom, temps restant
(GTR, ATR, RBT, TTR) avec sa définition et ses délais (ex. « wait » les 2 premières minutes),
réserve, consommation.

### 12. Surface et après la plongée
Durée du mode surfacing, intervalle de surface, interdiction de vol, désaturation, dernière plongée,
pénalités de plongées successives, carnet.

### 13. Alarmes
Reprendre **toute** la table des alarmes du manuel : texte exact, priorité, couleurs, acquittement
par un bouton ou non.

## Vérifier avant de rendre la main

1. `npm run build`.
2. `npm run exercises` : « ✓ every exercise passed on every computer ».
3. `npm run stops -- <id>` : « ✓ stops OK », plus les réactions au-dessus du palier de 6 m
   conformes au manuel (niveau d'alarme, verrouillage ou non après 3 min).
4. **Mise en page** (`npm run dev`, puis dans la console de la page, après avoir mis la simulation en
   pause) : `__divesim.layout.sweep(['decoDeep', 'safetyActive'], '<id>')` passe l'ordinateur dans
   chaque mise en page, métrique et impérial, et chaque écran accessible par ses boutons, et signale
   tout texte qui déborde de sa case ou de l'écran, en chevauche un autre ou est recouvert.
   Les situations disponibles sont dans `__divesim.layout.states` (`src/dev/layoutCheck.ts`) :
   les balayer toutes, quelques-unes par appel (c'est lent). `__divesim.layout.show(state, id,
   { layout, units, presses })` reproduit un cas pour le regarder. **Confirmer chaque signalement à
   l'écran** : certains sont voulus (alerte en surimpression sur le Garmin, libellé « N2 » sous la
   barre du Quad Ci, jambages des lettres).
5. Dans le navigateur, afficher chaque écran dans les états de la section 4 (ex. 40 m / 25 min puis
   remontée) et **comparer aux figures du manuel**. Fermer les onglets et arrêter le serveur ensuite.
6. Mettre à jour le tableau des modèles (et le texte) dans les deux README : `README.md` (anglais) et `README.fr.md` (français).
7. Compte rendu : ce qui a été vérifié (avec les sections du manuel), ce qui ne l'est pas, les écarts
   restants.
