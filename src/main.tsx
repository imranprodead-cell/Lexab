import { createRoot } from 'react-dom/client';
import App from './App';
import { ensureDict } from './i18n/loadDict';
import { hasExtraLanguage, loadLang } from './i18n/messages';
import './styles/global.css';

// Error monitoring — enabled only when VITE_SENTRY_DSN is set.
// Инициализация отложена в idle: чанк Sentry (~95KB после tree-shake обёртки
// @/lib/sentry) не конкурирует за сеть/CPU со стартом приложения. Ошибки до
// инициализации не теряются — мини-буфер ниже доотправляет их после init.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  const early: unknown[] = [];
  const onErr = (e: ErrorEvent) => {
    if (early.length < 20) early.push(e.error ?? e.message);
  };
  const onRej = (e: PromiseRejectionEvent) => {
    if (early.length < 20) early.push(e.reason);
  };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onRej);
  const start = () =>
    void import('./lib/sentry')
      .then((S) => {
        S.init({ dsn: sentryDsn, tracesSampleRate: 0.1 });
        // Слушатели снимаются ДО слива буфера: после init глобальные ошибки
        // ловит сам Sentry — иначе каждая пришла бы дважды.
        window.removeEventListener('error', onErr);
        window.removeEventListener('unhandledrejection', onRej);
        for (const err of early) S.captureException(err);
        early.length = 0;
      })
      .catch(() => undefined);
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 5000 });
  else setTimeout(start, 3000);
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

// No <StrictMode>: its dev-only double mounting re-ran every page's data
// fetch twice (abort + retry), which doubled perceived navigation latency.
const boot = () => createRoot(container).render(<App />);

// Словари uz/ar/kk/de грузятся лениво (не входят в главный чанк). Для
// сохранённого async-языка ждём словарь ДО первого рендера — пререндеренный
// снапшот остаётся на экране, вспышки русского/английского нет. Потолок 3с:
// если сеть легла — рендер с EN-фолбэком, I18nProvider доберёт словарь фоном.
// Для ru/en (основной рынок) путь остаётся прежним, строго синхронным.
const initialLang = loadLang();
if (hasExtraLanguage(initialLang)) {
  boot();
} else {
  void Promise.race([ensureDict(initialLang), new Promise((r) => setTimeout(r, 3000))])
    .catch(() => undefined)
    .then(boot);
}
