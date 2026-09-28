// Side panel tabs (Settings, Compare, Tissues, Logbook). On phones (compactMq) the tabs sit in a
// bottom bar and open a sheet over the water column: closed at start, a tap on the open tab (or ✕)
// closes it.
import { refresh } from './render';
import { $, app, compactMq } from './state';

export function showTabs(redraw = true): void {
  const open = app.sheetOpen || !compactMq.matches;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((x) => x.classList.toggle('on', open && x.dataset.tab === app.activeTab));
  document.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = !open || p.dataset.pane !== app.activeTab));
  $('sheet').classList.toggle('open', open);
  if (redraw) refresh();
}

/** Is the given tab's pane on screen? */
export function paneShown(tab: string): boolean {
  return app.activeTab === tab && (app.sheetOpen || !compactMq.matches);
}

/** The sheet covers the water column exactly, never the computer. */
function placeSheet(): void {
  const sp = document.querySelector('.scene-panel')!.getBoundingClientRect();
  const pr = document.querySelector('.side-panel')!.getBoundingClientRect();
  const st = $('sheet').style;
  st.setProperty('--sheet-left', `${sp.left - pr.left}px`);
  st.setProperty('--sheet-w', `${sp.width}px`);
  st.setProperty('--sheet-h', `${pr.top - sp.top}px`);
}

export function setupTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      app.sheetOpen = !(compactMq.matches && app.sheetOpen && app.activeTab === b.dataset.tab);
      app.activeTab = b.dataset.tab!;
      showTabs();
    }),
  );
  $('sheet-close').addEventListener('click', () => {
    app.sheetOpen = false;
    showTabs();
  });
  compactMq.addEventListener('change', () => showTabs());
  showTabs(false);
  new ResizeObserver(placeSheet).observe(document.querySelector('.scene-panel')!);

  // Phones: the notice under the device and the algorithm notes are cut to one line; a tap unfolds them.
  $('device-caption').addEventListener('click', () => $('device-caption').classList.toggle('unfold'));
}
