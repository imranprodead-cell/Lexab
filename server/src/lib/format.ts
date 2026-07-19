/** Formatting helpers matching the display strings the frontend expects. */

/**
 * Build a safe `Content-Disposition: attachment` header value. `baseName` is
 * untrusted (upload filename): the ASCII fallback strips it to `[\w.-]` so a
 * quote can't break out and inject header params, and the RFC 5987 `filename*`
 * carries the original (Cyrillic etc.) percent-encoded so a Russian document
 * downloads with its real name instead of "____.pdf".
 */
export function attachmentDisposition(baseName: string, ext: string): string {
  const ascii = (baseName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'document') + `.${ext}`;
  const original = (baseName.replace(/\.[^.]+$/, '') || 'document') + `.${ext}`;
  // RFC 5987: percent-encode, but keep the encodeURIComponent-safe set.
  const encoded = encodeURIComponent(original).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 49152 → "48 KB" (mirrors the seed data style). */
export function formatSize(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Relative time in Russian, matching the notification seed strings. */
export function relativeTimeRu(date: Date, now = new Date()): string {
  const ms = now.getTime() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Вчера';
  if (days < 7) return `${days} дн назад`;
  return date.toISOString().slice(0, 10);
}

export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return new Date().toISOString();
}

/** Кириллицы больше, чем латиницы → текст русский (для локализации рамок
 *  PDF/DOCX-экспорта по языку КОНТЕНТА, а не UI). */
export function looksRussian(s: string): boolean {
  const cyr = (s.match(/[а-яё]/gi) ?? []).length;
  const lat = (s.match(/[a-z]/gi) ?? []).length;
  return cyr > lat;
}

/** Латиница с узбекскими маркерами (oʻ/gʻ и частотные слова) → узбекский текст.
 *  Нужен для выбора языка рамки PDF-отчёта: для узбекского контента рамка
 *  русская (решение продукта), а не английская. */
export function looksUzbekLatin(s: string): boolean {
  if (looksRussian(s)) return false;
  return /o['ʻ’]|g['ʻ’]/.test(s) || /\b(?:va|yoki|uchun|bilan|shartnoma|tomonlar|xizmat|majburiyat|bo['ʻ’]yicha|qonun)\b/i.test(s);
}
