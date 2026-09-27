# Computer dive simulation

Simulateur pédagogique d'ordinateurs de plongée. On pilote un plongeur dans la colonne d'eau et on voit, en temps réel et côte à côte, comment différents ordinateurs réagissent : NDL, paliers, vitesse de remontée, alarmes, saturation, consommation de gaz, toxicité de l'oxygène.

Interface disponible en français et en anglais, unités métriques ou impériales.

> [!WARNING]
> **Outil pédagogique uniquement. Ne l'utilisez jamais pour planifier ou conduire une vraie plongée.**
> Les calculs sont des approximations et peuvent différer sensiblement de ceux d'un ordinateur réel. Suivez toujours votre formation, vos tables et les instructions du fabricant de votre équipement.

## Ordinateurs simulés

| Modèle | Algorithme | Fidélité |
| --- | --- | --- |
| Shearwater Perdix 2 (mode Recreational) | Bühlmann ZHL-16C + GF | Algorithme public, reproduit |
| Garmin Descent Mk3i | Bühlmann ZHL-16C + GF | Algorithme public, reproduit |
| Suunto D5 | Fused RGBM 2 | Approximation (≈) |
| Mares Puck Pro | Mares RGBM | Approximation (≈) |
| Mares Quad Ci | Bühlmann ZH-L16C + GF | Algorithme public, reproduit (R1, R2, T1, T2 interpolés) |
| Mares Quad Air | Mares RGBM | Approximation (≈) |
| Mares Genius | Bühlmann ZH-L16C + GF | Algorithme public, reproduit (R2, T1, T2 interpolés) |
| Scubapro Galileo 2 (G2) | ZH-L16 ADT MB | Approximation (≈) |
| Cressi Goa | Cressi RGBM | Approximation (≈) |

Les algorithmes propriétaires (RGBM, ZH-L16 ADT MB) ne sont pas publiés : ils sont approchés à partir de Bühlmann ZHL-16C avec des facteurs de gradient et des pénalités calibrés sur des valeurs publiées. Les écrans et les règles (alarmes, paliers, verrouillages…) s'inspirent des manuels utilisateurs publics de chaque modèle.

Dans l'application, un avertissement s'affiche à la première visite (usage pédagogique, algorithmes approchés, absence d'affiliation) et une légende ✓ / ≈ au-dessus de chaque ordinateur rappelle qu'il s'agit d'une interprétation non officielle.

> [!NOTE]
> **Les interfaces sont des interprétations, pas des reproductions.** Elles sont inspirées des modèles cités et peuvent en différer sur de nombreux points : disposition, couleurs, polices, textes, menus, comportements, alarmes, réglages disponibles ou valeurs calculées. Seule une partie des modes et des fonctions de chaque appareil est simulée, et les fabricants peuvent faire évoluer leurs produits (firmware, affichage) sans que ce simulateur soit mis à jour. En cas de doute, le manuel officiel et l'appareil réel font foi.

## Démarrage

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm run dev       # serveur de développement Vite
npm run build     # vérification TypeScript + build de production dans dist/
npm run preview   # sert le build de production
```

Scripts d'analyse en ligne de commande :

```bash
npm run calib     # tables de NDL par profondeur et par GF (calibration)
npm run scenario  # rejoue un profil de plongée sur tous les ordinateurs
npm run stops     # contrôle le comportement aux paliers de déco de chaque ordinateur
```

## Commandes

- Toucher ou cliquer (et glisser) dans l'eau, ou la molette, pour aller à une profondeur (à la dernière vitesse choisie ; 9 m/min en montée et 18 m/min en descente par défaut).
- ▲ / ▼ (boutons ou flèches du clavier) pour régler la vitesse de montée ou de descente par pas de 1 m/min ; ■ ou `0` pour se stabiliser.
- `+` / `−` pour accélérer ou ralentir le temps, `Espace` pour mettre en pause.
- Les boutons des ordinateurs sont cliquables, avec appui long quand le modèle en a un. Une info-bulle indique la fonction réelle de chaque bouton pendant la plongée (d'après le manuel du fabricant) et précise ce qui n'est pas simulé ; les boutons sans aucune fonction simulée apparaissent grisés.

## Vue 3D

Le bouton **2D | 3D** en haut de la zone de plongée bascule vers une vue 3D ludique, avec trois environnements : récif corallien (platier, tombant vers le sable et patates de corail), épave (colonisée par les coraux) et tombant (plateau et paroi plongeant dans le bleu). Le plongeur nage librement : glisser horizontalement, les flèches ◀ / ▶ du clavier ou les boutons à l'écran le font tourner (tour complet possible), glisser verticalement change la profondeur visée. Clic droit ou Maj + glisser pour pivoter la caméra, double-clic pour la recentrer. Le fond, l'épave, les rochers et les coraux sont solides : le plongeur les longe au lieu de les traverser et se pose dessus s'il descend ; ils ne le font jamais remonter, le profil reste entièrement sous le contrôle de l'utilisateur. Rendu : caustiques, lumière qui s'assombrit et bleuit avec la profondeur (une lampe prend le relais), fenêtre de Snell, poissons animés, coraux et herbiers ondulants. La simulation est identique dans les deux vues ; three.js n'est chargé qu'à la première ouverture de la vue 3D.

## Structure

```
src/engine/      moteur : Bühlmann ZHL-16C + GF, gaz, toxicité O2 (CNS/OTU), session de plongée
src/computers/   un fichier par ordinateur simulé (affichage + règles propres au modèle)
src/ui/          scène 2D (colonne d'eau), vue 3D (three.js), graphiques, jauges
scripts/         scripts de calibration et de scénarios
```

## Marques et affiliation

Ce projet est indépendant et **n'est ni affilié, ni approuvé, ni sponsorisé** par les fabricants cités. Shearwater, Perdix, Garmin, Descent, Suunto, Mares, Puck, Quad, Genius, Scubapro, Galileo, Cressi et Goa sont des marques de leurs propriétaires respectifs ; elles sont citées uniquement pour identifier les modèles dont les interfaces sont inspirées. Aucun logo, code ou élément graphique des fabricants n'est inclus.

Si vous représentez l'un de ces fabricants et souhaitez qu'un élément soit modifié ou retiré, ouvrez une issue.

## Licence

[MIT](LICENSE). Le logiciel est fourni « tel quel », sans aucune garantie. Les auteurs ne sauraient être tenus responsables de son utilisation.
