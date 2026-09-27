// Guided tour ("How to use it?" button and intro notice). Time is paused while it runs; the tab, the
// phone sheet and the settings scroll are put back as they were at the end.
import { t, type I18nKey } from '../i18n';
import { Tour, type TourStep } from '../ui/tour';
import { renderControls } from './settings';
import { $, app, compactMq, q } from './state';
import { showTabs } from './tabs';

const tour = new Tour(() => ({
  prev: t('tourPrev'),
  next: t('tourNext'),
  done: t('tourDone'),
  close: t('close'),
  counter: (i, n) => `${i} / ${n}`,
}));

const tabStep = (tab: string, title: I18nKey, body: I18nKey, targets?: () => (Element | null)[]): TourStep => ({
  before: () => {
    app.activeTab = tab;
    app.sheetOpen = true;
    showTabs();
  },
  targets: targets ?? (() => [q(`[data-tab="${tab}"]`), q(`[data-pane="${tab}"]`)]),
  title: () => t(title),
  body: () => t(body),
});

const TOUR: TourStep[] = [
  { title: () => t('tourWelcomeT'), body: () => t('tourWelcomeB') },
  { targets: () => [q('.header-actions .field')], title: () => t('tourComputerT'), body: () => t('tourComputerB') },
  { targets: () => [q('.scene-panel')], title: () => t('tourSceneT'), body: () => t('tourSceneB') },
  { targets: () => [q('.scene-ctl:not(.turn)')], title: () => t('tourRateT'), body: () => t('tourRateB') },
  { targets: () => [q('.scene-top')], title: () => t('tourViewT'), body: () => t('tourViewB') },
  { targets: () => [$('device'), $('spg'), $('device-alarms')], title: () => t('tourDeviceT'), body: () => t('tourDeviceB') },
  { targets: () => [q('.profile-box')], optional: true, title: () => t('tourProfileT'), body: () => t('tourProfileB') },
  // Phones: the tab is in the bottom bar, below the sheet, and would stretch the spotlight over the
  // time controls (next step).
  tabStep('settings', 'tourSettingsT', 'tourSettingsB', () =>
    [compactMq.matches ? null : q('[data-tab="settings"]'), $('algo-info'), $('advanced')]),
  tabStep('settings', 'tourTimeT', 'tourTimeB', () => [$('speed-group').parentElement, q('[data-pane="settings"] .button-row')]),
  tabStep('compare', 'tourCompareT', 'tourCompareB'),
  tabStep('tissues', 'tourTissuesT', 'tourTissuesB'),
  tabStep('log', 'tourLogT', 'tourLogB'),
  { targets: () => [$('tour-open')], title: () => t('tourEndT'), body: () => t('tourEndB') },
];

export function startTour(): void {
  if (tour.running) return;
  const saved = { paused: app.paused, activeTab: app.activeTab, sheetOpen: app.sheetOpen, scroll: q('[data-pane="settings"]')!.scrollTop };
  app.paused = true;
  renderControls();
  tour.start(TOUR, () => {
    app.paused = saved.paused;
    app.activeTab = saved.activeTab;
    app.sheetOpen = saved.sheetOpen;
    showTabs();
    q('[data-pane="settings"]')!.scrollTop = saved.scroll;
    renderControls();
    $('tour-open').focus();
  });
}

export function setupTour(): void {
  $('tour-open').addEventListener('click', startTour);
}
