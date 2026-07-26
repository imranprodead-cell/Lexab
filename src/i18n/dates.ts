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
