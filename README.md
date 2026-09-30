# Dive Computers simulator

**English** | [Français](README.fr.md)

Educational dive computer simulator. You steer a diver in the water column and watch, in real time and side by side, how different dive computers react: NDL, stops, ascent rate, alarms, tissue loading, gas consumption, oxygen toxicity.

User interface in English and French, metric or imperial units.

> [!WARNING]
> **Educational tool only. Never use it to plan or conduct a real dive.**
> Calculations are approximations and may differ significantly from those of a real dive computer. Always follow your training, your tables and your equipment manufacturer's instructions.

## Simulated computers

| Model | Algorithm | Fidelity |
| --- | --- | --- |
| Shearwater Perdix 2 (Recreational mode) | Bühlmann ZHL-16C + GF | Public algorithm, reproduced |
| Shearwater Peregrine TX (Air / Nitrox modes) | Bühlmann ZHL-16C + GF | Public algorithm, reproduced |
| Garmin Descent Mk3i | Bühlmann ZHL-16C + GF | Public algorithm, reproduced |
| Suunto D5 | Fused RGBM 2 | Approximation (≈) |
| Suunto Zoop Novo | Suunto RGBM | Approximation (≈) |
| Mares Puck Pro | Mares RGBM | Approximation (≈) |
| Mares Quad Ci | Bühlmann ZH-L16C + GF | Public algorithm, reproduced (R1, R2, T1, T2 interpolated) |
| Mares Quad Air | Mares RGBM | Approximation (≈) |
| Mares Genius | Bühlmann ZH-L16C + GF | Public algorithm, reproduced (R2, T1, T2 interpolated) |
| Scubapro Galileo 2 (G2) | ZH-L16 ADT MB | Approximation (≈) |
| Scubapro Luna 2.0 AI | ZH-L16 ADT MB or ZH-L16C + GF | Approximation (≈) for ADT MB, reproduced for ZH-L16C + GF |
| Cressi Goa | Cressi RGBM | Approximation (≈) |
| Cressi Donatello | Cressi RGBM | Approximation (≈) |

Proprietary algorithms (RGBM, ZH-L16 ADT MB) are unpublished: they are approximated from Bühlmann ZHL-16C with gradient factors and penalties calibrated on published values. Displays and rules (alarms, stops, lockouts…) are inspired by each model's public user manual.

In the app, a notice is shown on every visit (educational use, approximated algorithms, no affiliation), and a ✓ / ≈ caption above each computer reminds you that it is an unofficial interpretation.

> [!NOTE]
> **The displays are interpretations, not reproductions.** They are inspired by the listed models and may differ from them in many ways: layout, colours, fonts, texts, menus, behaviour, alarms, available settings or computed values. Only part of each device's modes and features is simulated, and manufacturers may update their products (firmware, display) without this simulator being updated. When in doubt, the official manual and the real device prevail.

## Getting started

Requirements: Node.js 18 or later.

```bash
npm install
npm run dev       # Vite development server
npm run build     # TypeScript check + production build in dist/
npm run preview   # serves the production build
```

Command-line analysis scripts:

```bash
npm run calib     # NDL tables by depth and GF (calibration)
npm run scenario  # replays a dive profile on every computer
npm run stops     # checks each computer's behaviour at deco stops
```

## Controls

- Tap or click (and drag) in the water, or use the mouse wheel, to go to a depth (at the last chosen speed; 9 m/min ascending and 18 m/min descending by default).
- ▲ / ▼ (buttons or arrow keys) to set the ascent or descent speed in 1 m/min steps; ■ or `0` to hold depth.
- `+` / `−` to speed up or slow down time, `Space` to pause.
- **How to use it?** (next to the title, or "Take the tour" in the welcome notice) starts a guided tour of the interface.
- The computers' buttons can be clicked, with a long press when the model has one. A tooltip shows each button's real function during the dive (from the manufacturer's manual) and what is not simulated; buttons with no simulated function are greyed out.

- 🔇 / 🔊 (in the header) turns the computers' alarm sounds on or off (off by default, the choice is remembered). Each model sounds as its manual describes: beeps (Mares, Scubapro, Cressi), tones and vibration (Garmin, Suunto), vibration only for the Perdix 2 and the Peregrine TX. A vibration is played as a buzzing sound, shakes the computer on screen and, on phones that allow it (Android), really vibrates. Alarms that repeat until acknowledged stop when a button of the computer is pressed (SELECT on the Perdix 2, either button on the Peregrine TX). Each model's settings include its own switch (ALRM, All silent, Silent diving…).

## Exercises

The **Exercises** tab offers situations to provoke and observe, for a student on their own: run out of no-deco time, ascend too fast, do the safety stop, do decompression stops, go above a stop, go past the gas's maximum depth, make a repetitive dive. Each exercise resets the dive and starts, paused, from a described situation (e.g. "at 25 m for 10 min"); the simulator checks the diver's state to tell whether it is passed. The debrief lists what the chosen computer signalled and when, and what its rules say (from its manual). Exercises are about behaviour (which signal, when, what follows), not about stop times, which are only approximated for proprietary algorithms. Passed exercises are remembered in the browser, per computer: doing one again with another model shows how differently they react.

## Surface, boat and repetitive dives

The tank is not refilled automatically between dives. Five seconds after surfacing during a dive (tank below 90 %), a boat comes alongside the diver and offers a full tank in a comic speech bubble, in both the 2D and 3D views. **Yes**: the diver climbs aboard, the dive ends and the tank is refilled; the next descent is a new dive. **No**: the boat leaves. A dive is also closed after 3 minutes at the surface. Tissues stay loaded from one dive to the next; the logbook shows each dive's type: consecutive (surface interval under 15 min), repetitive (under 12 h) or single.

## 3D view

The **2D | 3D** button at the top of the dive area switches to a playful 3D view with three environments: coral reef (reef flat, slope down to the sand and coral heads), wreck (overgrown with corals) and wall (plateau and a wall dropping into the blue). The diver swims freely: drag horizontally, use the ◀ / ▶ arrow keys or the on-screen buttons to turn (full turns allowed), drag vertically to change the target depth. Right-click or Shift + drag to orbit the camera, double-click to recentre it. The seabed, the wreck, the rocks and the corals are solid: the diver swims along them instead of through them and rests on them when descending; they never lift the diver, so the depth profile stays entirely under the user's control. Rendering: caustics, light getting darker and bluer with depth (a torch takes over), Snell's window, swaying corals, seagrass and algae. Sea life: schools of fish, a turtle, anemones whose clownfish hide when the diver comes close, starfish and sea urchins, pulsing jellyfish, gliding eagle rays and reef sharks keeping their distance. The simulation is the same in both views; three.js is only loaded the first time the 3D view is opened.

## Structure

```
src/engine/      engine: Bühlmann ZHL-16C + GF, gases, O2 toxicity (CNS/OTU), dive session
src/computers/   one folder per simulated computer (grouped by brand when they share rules:
                 mares/, scubapro/, cressi/, suunto/): rules.ts (model-specific rules),
                 index.ts (display and buttons), its style sheet; base/ and common/ are shared
src/app/         interface: settings, tabs, dialogs, guided tour, logbook, exercises, simulation loop
src/ui/          2D scene (water column), 3D view (scene3d/, three.js), charts, gauges, tour
src/styles/      page style sheets (the computers' sheets live next to their code)
scripts/         calibration, scenario and regression (snapshot) scripts
```

## Trademarks and affiliation

This project is independent and **is not affiliated with, endorsed or sponsored by** the manufacturers mentioned. Shearwater, Perdix, Peregrine, Garmin, Descent, Suunto, Zoop, Mares, Puck, Quad, Genius, Scubapro, Galileo, Luna, Cressi, Goa and Donatello are trademarks of their respective owners; they are only mentioned to identify the models whose displays inspired this simulator. No manufacturer logo, code or artwork is included.

If you represent one of these manufacturers and would like something changed or removed, please open an issue.

## Licence

Copyright © 2026 Antoine ALEXANDRE — [https://github.com/Antjac/DiveComputerSimulator](https://github.com/Antjac/DiveComputerSimulator)

Free software under the [GNU Affero General Public License v3.0](LICENSE) or (at your option) any later version.

- **Everyone may use the simulator freely**, including dive instructors, clubs and commercial dive centres.
- **You may study, modify and redistribute the code**, provided that you keep this copyright notice and distribute your version under the same licence, with its complete source code.
- **This also applies online:** anyone who makes a modified version available as a website or service must offer its users the complete source code of that version (AGPL, section 13).

The software is provided "as is", without any warranty. The authors cannot be held liable for its use.
