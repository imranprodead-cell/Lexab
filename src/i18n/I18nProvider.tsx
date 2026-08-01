import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { hasExtraLanguage, isRtl, loadLang, resolveMessage, type Language } from './messages';
import { ensureDict } from './loadDict';

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

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(loadLang);
  // ru/en — сразу true; async-языки — true, если словарь уже в реестре
  // (bootstrap в main.tsx обычно грузит его ДО первого рендера, так что gate
  // ниже почти никогда не срабатывает). После первого true не сбрасывается.
  const [dictReady, setDictReady] = useState<boolean>(() => hasExtraLanguage(lang));
  // Растёт при (до)загрузке словаря — пересоздаёт t, тексты обновляются.
  const [dictVersion, setDictVersion] = useState(0);

  // Apply the initial language's dir/lang on mount (e.g. Arabic → rtl).
  useEffect(() => {
    applyDocumentLang(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Страховочный gate: сюда попадаем, только если bootstrap не успел (таймаут
  // 3с в main.tsx) или упал. Ошибка сети → рендер с EN-фолбэком, повтор ниже.
  useEffect(() => {
    if (dictReady) return;
    let cancelled = false;
    ensureDict(lang).then(
      () => {
        if (!cancelled) {
          setDictVersion((v) => v + 1);
          setDictReady(true);
        }
      },
      () => {
        if (!cancelled) setDictReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lang, dictReady]);

  // Словарь так и не приехал (offline/пропавший чанк старого деплоя) — тихо
  // добираем в фоне: интерфейс с EN-фолбэка сам станет родным.
  useEffect(() => {
    if (!dictReady || hasExtraLanguage(lang)) return;
    let cancelled = false;
    const timer = setInterval(() => {
      ensureDict(lang).then(
        () => {
          if (!cancelled) {
            clearInterval(timer);
            setDictVersion((v) => v + 1);
          }
        },
        () => undefined,
      );
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dictReady, lang, dictVersion]);

  const setLang = useCallback((next: Language) => {
    const commit = () => {
      setLangState(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      applyDocumentLang(next);
    };
    // ru/en и прогретые словари — прежний синхронный путь (обычный случай:
    // prefetchDicts в App.tsx греет все словари после первой отрисовки).
    if (hasExtraLanguage(next)) {
      commit();
      return;
    }
    // Холодный словарь: сначала await import, потом атомарный commit — никаких
    // промежуточных состояний. Сеть легла → переключаемся с EN-фолбэком,
    // фоновый повтор выше доберёт словарь.
    void ensureDict(next)
      .catch(() => undefined)
      .then(() => {
        setDictVersion((v) => v + 1);
        commit();
      });
  }, []);

  const t = useCallback(
    (key: string, params?: TParams) => {
      const text = resolveMessage(key, lang);
      if (text === undefined) return key; // surface missing keys instead of crashing
      return interpolate(text, params);
    },
    // dictVersion намеренно в deps: дозагрузка словаря обязана пересоздать t,
    // иначе consumers не узнают, что resolveMessage отдаёт родные строки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, dictVersion],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  // Gate только для async-языка без словаря (bootstrap не успел): держим
  // пустоту вместо вспышки EN/RU. dictReady никогда не падает обратно в false.
  return <I18nContext.Provider value={value}>{dictReady ? children : null}</I18nContext.Provider>;
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
