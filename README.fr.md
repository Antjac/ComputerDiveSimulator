# Simulateur d'ordinateurs de plongée

[English](README.md) | **Français**

Simulateur pédagogique d'ordinateurs de plongée. On pilote un plongeur dans la colonne d'eau et on voit, en temps réel et côte à côte, comment différents ordinateurs réagissent : NDL, paliers, vitesse de remontée, alarmes, saturation, consommation de gaz, toxicité de l'oxygène.

Interface disponible en français et en anglais, unités métriques ou impériales.

> [!WARNING]
> **Outil pédagogique uniquement. Ne l'utilisez jamais pour planifier ou conduire une vraie plongée.**
> Les calculs sont des approximations et peuvent différer sensiblement de ceux d'un ordinateur réel. Suivez toujours votre formation, vos tables et les instructions du fabricant de votre équipement.

## Ordinateurs simulés

| Modèle | Algorithme | Fidélité |
| --- | --- | --- |
| Aqualung i330R (mode Dive) | Bühlmann ZHL-16C + GF | Algorithme public, reproduit |
| Aqualung i770R (mode Dive) | Pelagic Z+ | Approximation (≈) |
| Shearwater Perdix 2 (mode Recreational) | Bühlmann ZHL-16C + GF | Algorithme public, reproduit |
| Shearwater Peregrine TX (modes Air / Nitrox) | Bühlmann ZHL-16C + GF | Algorithme public, reproduit |
| Garmin Descent Mk3i | Bühlmann ZHL-16C + GF | Algorithme public, reproduit |
| Suunto D5 | Fused RGBM 2 | Approximation (≈) |
| Suunto Zoop Novo | Suunto RGBM | Approximation (≈) |
| Mares Puck Pro | Mares RGBM | Approximation (≈) |
| Mares Quad Ci | Bühlmann ZH-L16C + GF | Algorithme public, reproduit (R1, R2, T1, T2 interpolés) |
| Mares Quad Air | Mares RGBM | Approximation (≈) |
| Mares Genius | Bühlmann ZH-L16C + GF | Algorithme public, reproduit (R2, T1, T2 interpolés) |
| Scubapro Galileo 2 (G2) | ZH-L16 ADT MB | Approximation (≈) |
| Scubapro Luna 2.0 AI | ZH-L16 ADT MB ou ZH-L16C + GF | Approximation (≈) pour ADT MB, reproduit pour ZH-L16C + GF |
| Cressi Goa | Cressi RGBM | Approximation (≈) |
| Cressi Donatello | Cressi RGBM | Approximation (≈) |

Les algorithmes propriétaires (RGBM, ZH-L16 ADT MB, Pelagic Z+) ne sont pas publiés : ils sont approchés à partir de Bühlmann ZHL-16C avec des facteurs de gradient et des pénalités calibrés sur des valeurs publiées. Les écrans et les règles (alarmes, paliers, verrouillages…) s'inspirent des manuels utilisateurs publics de chaque modèle.

Dans l'application, un avertissement s'affiche à chaque visite (usage pédagogique, algorithmes approchés, absence d'affiliation) et une légende ✓ / ≈ au-dessus de chaque ordinateur rappelle qu'il s'agit d'une interprétation non officielle.

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
- Pause et vitesse du temps (×1 à ×300) dans la barre sous la colonne d'eau (ou la vue 3D), toujours visible ; au clavier, `+` / `−` pour accélérer ou ralentir le temps, `Espace` pour mettre en pause.
- **Comment s'en servir ?** (à côté du titre, ou « Visite guidée » dans l'avertissement d'accueil) lance une visite guidée de l'interface.
- Les boutons des ordinateurs sont cliquables, avec appui long quand le modèle en a un. Au survol de la souris, une info-bulle indique la fonction réelle de chaque bouton pendant la plongée (d'après le manuel du fabricant) et précise ce qui n'est pas simulé ; les boutons sans aucune fonction simulée apparaissent grisés.

- 🔇 / 🔊 (dans l'en-tête) active ou coupe les sons des alarmes des ordinateurs (coupés par défaut, le choix est mémorisé). Chaque modèle sonne comme le décrit son manuel : bips (Mares, Scubapro, Cressi, Aqualung), sons et vibrations (Garmin, Suunto), vibrations seules pour le Perdix 2 et le Peregrine TX. Une vibration est jouée comme un bourdonnement, fait trembler l'ordinateur à l'écran et, sur les téléphones qui le permettent (Android), vibre vraiment. Les alarmes qui se répètent jusqu'à acquittement s'arrêtent quand on appuie sur un bouton de l'ordinateur (SELECT sur le Perdix 2, l'un ou l'autre bouton sur le Peregrine TX). Les réglages de chaque modèle comprennent son propre interrupteur (ALRM, All silent, Silent diving…).
- **Alertes** : chaque ordinateur affiche toutes les alarmes, avertissements et notifications de son manuel (texte, couleurs, sons, acquittement). Celles qui se règlent sur l'appareil (profondeur, durée, NDL, CNS, pression du bloc : réserve, demi-bloc, demi-tour…) sont dans « Réglages avancés › Réglage des alertes », avec les possibilités et les valeurs par défaut de son manuel. Les réglages avancés sont rangés par thème : plongée, algorithme et paliers, alertes, sons et vibrations, affichage.
- **ⓘ Détails de la simulation** (onglet Réglages) ouvre une fenêtre qui présente le modèle : ce qui est simulé d'après le manuel, les valeurs supposées ou déduites quand le manuel ne les donne pas, ce qui n'est pas simulé, et ses alertes réglables avec les valeurs en cours.

## Exercices

L'onglet **Exercices** propose des situations à provoquer et observer, pour un élève en autonomie : arriver au bout du temps sans palier, remonter trop vite, faire le palier de sécurité, faire ses paliers de décompression, passer au-dessus d'un palier, dépasser la profondeur maximale du mélange, faire une plongée successive. Chaque exercice remet la plongée à zéro et démarre, en pause, dans une situation décrite (par exemple « à 25 m depuis 10 min ») ; le simulateur vérifie l'état du plongeur pour savoir s'il est réussi. Le bilan liste ce que l'ordinateur choisi a signalé et quand, et ce que disent ses règles (d'après son manuel). Les exercices portent sur les comportements (quel signal, quand, quelles conséquences), pas sur les durées de palier, qui ne sont qu'approchées pour les algorithmes propriétaires. Les exercices réussis sont mémorisés dans le navigateur, par ordinateur : refaire un exercice avec un autre modèle montre à quel point leurs réactions diffèrent.

## Surface, bateau et plongées successives

Le bloc n'est pas rempli automatiquement entre deux plongées. Cinq secondes après être remonté en surface au cours d'une plongée (bloc sous 90 %), un bateau vient se placer près du plongeur et propose un bloc plein, dans une bulle de BD, en vue 2D comme en 3D. **Oui** : le plongeur remonte à bord, la plongée est terminée et le bloc est rempli ; la descente suivante est une nouvelle plongée. **Non** : le bateau repart. Après une remontée clairement trop rapide (plus de 15 m/min en moyenne sur ses 10 derniers mètres, le critère de l'alerte secours, quel que soit l'ordinateur), le bateau vient même si le bloc est plein et signale d'abord que la remontée était trop rapide et qu'il faut déclencher la procédure adaptée selon sa formation. La plongée est aussi clôturée après 3 minutes en surface. Les tissus restent chargés d'une plongée à l'autre ; le carnet indique le type de chaque plongée : consécutive (moins de 15 min d'intervalle surface), successive (moins de 12 h) ou simple.

## Vue 3D

Le bouton **2D | 3D** en haut de la zone de plongée bascule vers une vue 3D ludique, avec trois environnements : récif corallien (platier, tombant vers le sable et patates de corail), épave (colonisée par les coraux) et tombant (plateau et paroi plongeant dans le bleu). Le plongeur nage librement : glisser horizontalement, les flèches ◀ / ▶ du clavier ou les boutons à l'écran le font tourner (tour complet possible), glisser verticalement change la profondeur visée. Clic droit ou Maj + glisser pour pivoter la caméra, double-clic pour la recentrer. Le fond, l'épave, les rochers et les coraux sont solides : le plongeur les longe au lieu de les traverser et se pose dessus s'il descend ; ils ne le font jamais remonter, le profil reste entièrement sous le contrôle de l'utilisateur. Rendu : caustiques, lumière qui s'assombrit et bleuit avec la profondeur (une lampe prend le relais), fenêtre de Snell, coraux, herbiers et algues ondulants. Faune : bancs de poissons, tortue, anémones dont les poissons-clowns se cachent à l'approche du plongeur, étoiles de mer et oursins, méduses qui pulsent, raies aigles qui planent et requins de récif qui gardent leurs distances. La simulation est identique dans les deux vues ; three.js n'est chargé qu'à la première ouverture de la vue 3D.

## Structure

```
src/engine/      moteur : Bühlmann ZHL-16C + GF, gaz, toxicité O2 (CNS/OTU), session de plongée
src/computers/   un dossier par ordinateur simulé (regroupés par marque quand ils partagent des
                 règles : mares/, scubapro/, cressi/, suunto/) : rules.ts (règles propres au modèle),
                 index.ts (affichage et boutons), sa feuille de style ; base/ et common/ sont partagés
src/app/         interface : réglages, onglets, dialogues, visite guidée, carnet, exercices, boucle de simulation
src/ui/          scène 2D (colonne d'eau), vue 3D (scene3d/, three.js), graphiques, jauges, visite
src/styles/      feuilles de style de la page (celles des ordinateurs sont à côté de leur code)
scripts/         scripts de calibration, de scénarios et de non-régression (snapshot)
```

## Marques et affiliation

Ce projet est indépendant et **n'est ni affilié, ni approuvé, ni sponsorisé** par les fabricants cités. Aqualung, Aqua Lung, Shearwater, Perdix, Peregrine, Garmin, Descent, Suunto, Zoop, Mares, Puck, Quad, Genius, Scubapro, Galileo, Luna, Cressi, Goa et Donatello sont des marques de leurs propriétaires respectifs ; elles sont citées uniquement pour identifier les modèles dont les interfaces sont inspirées. Aucun logo, code ou élément graphique des fabricants n'est inclus.

Si vous représentez l'un de ces fabricants et souhaitez qu'un élément soit modifié ou retiré, ouvrez une issue.

## Licence

Copyright © 2026 Antoine ALEXANDRE — [https://github.com/Antjac/DiveComputerSimulator](https://github.com/Antjac/DiveComputerSimulator)

Logiciel libre sous [licence publique générale GNU Affero v3.0](LICENSE) (GNU AGPL) ou, à votre choix, toute version ultérieure.

- **Chacun peut utiliser librement le simulateur**, y compris les moniteurs, les clubs et les centres de plongée commerciaux.
- **Vous pouvez étudier, modifier et redistribuer le code**, à condition de conserver cette mention de copyright et de diffuser votre version sous la même licence, avec son code source complet.
- **Cela vaut aussi en ligne :** quiconque met une version modifiée à disposition sous forme de site ou de service doit proposer à ses utilisateurs le code source complet de cette version (AGPL, article 13).

Le logiciel est fourni « tel quel », sans aucune garantie. Les auteurs ne sauraient être tenus responsables de son utilisation.
