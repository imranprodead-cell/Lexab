/**
 * Локаль для форматирования дат по языку интерфейса. Раньше везде стоял
 * тернарник ru→'ru-RU', иначе 'en-GB' — немецкий/казахский/узбекский
 * пользователи получали английские названия месяцев.
 */
const LOCALES: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-GB',
  de: 'de-DE',
  ar: 'ar',
  kk: 'kk',
  uz: 'uz',
};

export function localeFor(lang: string): string {
  return LOCALES[lang] ?? 'en-GB';
}

/**
 * «10 мин. назад», «вчера», «3 дн. назад» на языке интерфейса. В английском —
 * самая короткая форма («10m ago»), в остальных — короткая: узкая русская
 * выглядит как «-10 мин».
 */
export function relativeTime(iso: string, lang: string, justNow: string, now = Date.now()): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), {
    numeric: 'auto',
    style: lang === 'en' ? 'narrow' : 'short',
  });
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return justNow;
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  const months = Math.floor(days / 30);
  if (months < 12) return rtf.format(-months, 'month');
  return rtf.format(-Math.floor(days / 365), 'year');
}
