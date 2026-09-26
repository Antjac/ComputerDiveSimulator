# Computer dive simulation — consignes pour Claude

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
```

## Architecture en bref

- `src/engine/buhlmann.ts` : ZHL-16C + GF (méthode d'Erik Baker), `planAscent`, `firstStop`, `ndl`.
- `src/engine/session.ts` : état **physique** du plongeur (profondeur, tissus, gaz, bloc). Les
  ordinateurs le lisent, ne le modifient jamais. Les tissus sont **partagés** par tous les modèles.
- `src/computers/base.ts` : classe `DiveComputer` (paliers, palier de sécurité, violations,
  verrouillage, `compute()` → `ComputerView`). Un fichier par modèle dans `src/computers/`,
  enregistré dans `src/computers/index.ts`.
- `src/main.ts` : contrôles, onglets (Réglages, Comparer, Tissus, Carnet), boucle de simulation.

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

### 5. Écrans d'info / champs alternatifs
- Ordre exact et contenu de chaque écran (comparer aux figures).
- Écran par défaut ou écran personnalisé à configurer sur l'appareil (ex. GF99 sur Garmin) : le
  préciser dans les notes.

### 6. Paliers de décompression
- Premier palier et ancre GF bas : premier palier atteint en remontant au GF bas, conservé ensuite
  (`firstStop` + `this.anchor`). **Ne jamais ramener l'ancre à la profondeur du plongeur** : la durée
  d'un palier ne doit jamais augmenter à l'arrivée.
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
2. `npm run stops -- <id>` : « ✓ stops OK », plus les réactions au-dessus du palier de 6 m
   conformes au manuel (niveau d'alarme, verrouillage ou non après 3 min).
3. Dans le navigateur (`npm run dev`, hook `window.__divesim`), afficher chaque écran dans les états
   de la section 4 (ex. 40 m / 25 min puis remontée) et **comparer aux figures du manuel**. Fermer les
   onglets et arrêter le serveur ensuite.
4. Mettre à jour le tableau des modèles du README si besoin.
5. Compte rendu : ce qui a été vérifié (avec les sections du manuel), ce qui ne l'est pas, les écarts
   restants.
