import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLanguage, isRtl, resolveMessage, type Language } from './messages';

const STORAGE_KEY = 'lexai.lang';

/** Keep the document's language + text direction in sync (RTL for Arabic). */
function applyDocumentLang(lang: Language) {
  const root = document.documentElement;
  root.setAttribute('lang', lang);
  root.setAttribute('dir', isRtl(lang) ? 'rtl' : 'ltr');
}

type TParams = Record<string, string | number>;

interface I18nValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: TParams) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function loadLang(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    /* ignore */
  }
  // First visit: follow the browser locale. Map each supported language to its
  // locale prefix; Russian stays the default fallback for the CIS market.
  try {
    const locales = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
    for (const locale of locales) {
      if (/^ru\b/i.test(locale)) return 'ru';
      if (/^en\b/i.test(locale)) return 'en';
      if (/^ar\b/i.test(locale)) return 'ar';
      if (/^de\b/i.test(locale)) return 'de';
      if (/^kk\b/i.test(locale)) return 'kk';
      if (/^uz\b/i.test(locale)) return 'uz';
      // Other Russian-speaking locales still land on RU.
      if (/^(be|ky|tg)\b/i.test(locale)) return 'ru';
    }
    return locales.length > 0 ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(loadLang);

  // Apply the initial language's dir/lang on mount (e.g. Arabic → rtl).
  useEffect(() => {
    applyDocumentLang(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyDocumentLang(next);
  }, []);

  const t = useCallback(
    (key: string, params?: TParams) => {
      const text = resolveMessage(key, lang);
      if (text === undefined) return key; // surface missing keys instead of crashing
      return interpolate(text, params);
    },
    [lang],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Convenience hook when only the translate fn is needed. */
export function useT() {
  return useI18n().t;
}
