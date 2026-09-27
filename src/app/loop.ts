// Simulation loop. The simulation runs on a timer driven by real elapsed time, so the dive keeps going
// when the tab is in the background (requestAnimationFrame is paused there). Drawing uses
// requestAnimationFrame.
import { placeBoatBubble } from './boat';
import { refresh, scene } from './render';
import { app, computers, session } from './state';

/** Simulated seconds not drawn yet (the scenes animate the diver over them). */
let pendingSimDt = 0;

/** Advances the session and every computer by `seconds`, in steps of at most `maxStep`. */
export function advance(seconds: number, maxStep = 1): void {
  let left = seconds;
  while (left > 1e-9) {
    const dt = Math.min(maxStep, left);
    session.step(dt);
    for (const c of computers) c.tick(session, dt);
    left -= dt;
    if (session.emergency) break; // rescue alert: the simulation stops here
  }
}

export function startLoop(): void {
  let lastTick = performance.now();
  let sinceRefresh = 0;
  setInterval(() => {
    const now = performance.now();
    const realDt = Math.min(60, (now - lastTick) / 1000);
    lastTick = now;
    if (!app.paused && !session.emergency) {
      const simDt = realDt * app.speed;
      // Coarser steps for big jumps (background tab, surface interval): Schreiner stays exact on
      // linear segments, only the kinematics and timers get less granular.
      advance(simDt, !session.inDive ? 5 : simDt > 30 ? 1 : 0.5);
      pendingSimDt += simDt;
    }
    sinceRefresh += realDt;
    if (sinceRefresh >= 0.2) {
      sinceRefresh = 0;
      refresh();
    }
  }, 50);

  let lastFrame = performance.now();
  const frame = (now: number): void => {
    const realDt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (app.view === '3d' && app.scene3d) app.scene3d.draw(pendingSimDt, realDt);
    else scene.draw(pendingSimDt, realDt);
    pendingSimDt = 0;
    placeBoatBubble();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
