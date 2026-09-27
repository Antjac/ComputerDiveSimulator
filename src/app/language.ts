// Interface language: the static texts of the page (data-i18n attributes) and the FR / EN buttons.
import { isI18nKey, lang, setLang, t } from '../i18n';
import { renderLog } from './logbook';
import { profileChart, refresh, tissueChart } from './render';
import { renderControls } from './settings';

export function applyI18n(): void {
  document.documentElement.lang = lang();
  document.title = t('title');
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n!;
    if (isI18nKey(key)) el.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle!;
    if (isI18nKey(key)) {
      el.title = t(key);
      el.setAttribute('aria-label', t(key));
    }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang()));
  profileChart.labels = { time: t('time'), depth: t('depth'), ceiling: t('ceiling') };
  tissueChart.labels = lang() === 'fr' ? { compartment: 'Compartiment', halfTime: 'Période' } : { compartment: 'Compartment', halfTime: 'Half-time' };
  renderControls();
  renderLog();
}

export function setupLanguage(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      setLang(b.dataset.lang as 'fr' | 'en');
      applyI18n();
      refresh(true);
    }),
  );
}
