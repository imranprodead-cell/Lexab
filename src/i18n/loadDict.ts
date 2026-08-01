import { hasExtraLanguage, registerExtraLanguage, type Language } from './messages';

/**
 * Ленивые словари интерфейса: каждый — отдельный чанк Vite (~47-54KB
 * исходника), в главный бандл не входит. ru/en живут в messages.ts.
 */
const LOADERS: Partial<Record<Language, () => Promise<{ default: Record<string, string> }>>> = {
  ar: () => import('./translations/ar'),
  de: () => import('./translations/de'),
  kk: () => import('./translations/kk'),
  uz: () => import('./translations/uz'),
};

const pending = new Map<Language, Promise<void>>();

/** Гарантирует словарь в реестре; ru/en и уже загруженные — resolve сразу. */
export function ensureDict(lang: Language): Promise<void> {
  if (hasExtraLanguage(lang)) return Promise.resolve();
  const loader = LOADERS[lang];
  if (!loader) return Promise.resolve();
  let p = pending.get(lang);
  if (!p) {
    p = loader().then(
      (m) => {
        registerExtraLanguage(lang, m.default);
        pending.delete(lang);
      },
      (err) => {
        // Упавший промис не кэшируем — повторный вызов сделает новый import().
        pending.delete(lang);
        throw err;
      },
    );
    pending.set(lang, p);
  }
  return p;
}

/**
 * Тёплый кэш всех словарей после первой отрисовки (App.tsx): переключение
 * языка в меню остаётся мгновенным, как при статической сборке.
 */
export function prefetchDicts(): void {
  for (const lang of Object.keys(LOADERS) as Language[]) void ensureDict(lang).catch(() => undefined);
}
