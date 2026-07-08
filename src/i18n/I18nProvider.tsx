import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { MESSAGES, type Language } from './messages';

const STORAGE_KEY = 'lexai.lang';

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
    if (stored === 'ru' || stored === 'en') return stored;
  } catch {
    /* ignore */
  }
  // Default to Russian; fall back to English for non-RU browsers.
  return typeof navigator !== 'undefined' && navigator.language.startsWith('en') ? 'en' : 'ru';
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(loadLang);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute('lang', next);
  }, []);

  const t = useCallback(
    (key: string, params?: TParams) => {
      const entry = MESSAGES[key];
      if (!entry) return key; // surface missing keys instead of crashing
      return interpolate(entry[lang], params);
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
