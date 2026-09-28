// Simulation loop. The simulation runs on a timer driven by real elapsed time, so the dive keeps going
// when the tab is in the background (requestAnimationFrame is paused there). Drawing uses
// requestAnimationFrame.
import { placeBoatBubble } from './boat';
import { refresh, scene } from './render';
import { app, compactMq, computers, session } from './state';

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

  // Frame rate (battery, heat): the 2D scene only has slow movements (waves, bubbles, diver), 30 fps
  // everywhere; the 3D one runs at full rate on a computer, 30 fps on phones. While the simulation
  // is stopped only the fins, the bubbles and the boat still move: 15 fps in 2D, 30 fps in 3D (the
  // camera can still be dragged around).
  let lastFrame = performance.now();
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const stopped = app.paused || !!session.emergency;
    const is3d = app.view === '3d' && !!app.scene3d;
    const minGap = stopped ? 1000 / (is3d ? 30 : 15) : !is3d || compactMq.matches ? 1000 / 30 : 0;
    // 2 ms slack: rAF timestamps jitter around the display's refresh period.
    if (now - lastFrame < minGap - 2) return;
    const realDt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (is3d) app.scene3d!.draw(pendingSimDt, realDt);
    else scene.draw(pendingSimDt, realDt);
    pendingSimDt = 0;
    placeBoatBubble();
  };
  requestAnimationFrame(frame);
}
