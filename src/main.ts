// Entry point: restores the preferences, wires the interface modules (src/app/), then starts the
// simulation. Each module only declares at load time; everything runs from here, in this order.
import './style.css';
import { setupBoat } from './app/boat';
import { setupCompare } from './app/compare';
import { installDevHook } from './app/devHook';
import { showIntro, setupDialogs } from './app/dialogs';
import { setView, setupDiveControls } from './app/diveControls';
import { setupDevice } from './app/device';
import { setupTour } from './app/guidedTour';
import { applyI18n, setupLanguage } from './app/language';
import { renderLog, setupLogbook } from './app/logbook';
import { startLoop } from './app/loop';
import { applyPrefs } from './app/prefs';
import { refresh } from './app/render';
import { setupRescue } from './app/rescue';
import { renderControls, setupSettings } from './app/settings';
import { app, computers, session } from './app/state';
import { setupTabs } from './app/tabs';
import { setupTissues } from './app/tissues';

applyPrefs();

session.on((e) => {
  for (const c of computers) {
    if (e === 'start') c.onDiveStart(session);
    else c.onDiveEnd(session);
  }
  if (e === 'end') {
    app.selectedLog = session.log.length - 1;
    renderLog();
  }
  renderControls();
});

setupSettings();
setupDiveControls();
setupDialogs();
setupLanguage();
setupTabs();
setupTour();
setupDevice();
setupTissues();
setupLogbook();
setupCompare();
setupRescue();
setupBoat();
if (import.meta.env.DEV) installDevHook();

applyI18n();
refresh(true);
showIntro();
if (app.view === '3d') void setView('3d');
startLoop();
