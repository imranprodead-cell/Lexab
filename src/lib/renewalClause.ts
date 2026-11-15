import { isRedlineSlot, isTextRun, type AnalysisResult } from '@/types/domain';

/**
 * Пункт договора о продлении — ДОСЛОВНО из текста договора (без ИИ): ищем
 * предложение, где есть слово о продлении и срок уведомления. Не нашли
 * уверенно — возвращаем null, и карточка просто не показывает цитату.
 */
const RENEW = /продл|пролонг|возобнов|renew|prolong|uzaytir|muddati uzaytiril/i;
const NOTICE = /уведом|извещ|заяв|notice|notify|xabardor|ogohlantir/i;
const MAX_QUOTE = 600;

/** Исходный текст договора по блокам разбора (на месте правки — исходные слова). */
export function contractParagraphs(a: Pick<AnalysisResult, 'document' | 'redlines'>): string[] {
  const del = new Map(a.redlines.map((r) => [r.id, r.delText]));
  return (a.document ?? [])
    .map((b) => {
      if (b.text) return b.text;
      return (b.segments ?? [])
        .map((s) => (typeof s === 'string' ? s : isRedlineSlot(s) ? (del.get(s.redlineId) ?? '') : isTextRun(s) ? s.text : ''))
        .join('');
    })
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function sentences(paragraph: string): string[] {
  if (paragraph.length <= MAX_QUOTE) return [paragraph];
  return paragraph.split(/(?<=[.!?;])\s+(?=[«"A-ZА-ЯЁЎҚҒҲ0-9])/u).filter(Boolean);
}

export function findRenewalClause(paragraphs: string[], noticeDays: number | null): string | null {
  const num = noticeDays != null ? new RegExp(`(^|[^\\d])${noticeDays}([^\\d]|$)`) : null;
  let best: { text: string; score: number } | null = null;
  for (const p of paragraphs) {
    for (const s of sentences(p)) {
      if (s.length > MAX_QUOTE || !RENEW.test(s)) continue;
      let score = 2;
      if (num?.test(s)) score += 3;
      if (NOTICE.test(s)) score += 1;
      if (!best || score > best.score) best = { text: s, score };
    }
  }
  // Без числа дней — только если срок уведомления в договоре не найден вовсе.
  if (!best) return null;
  if (noticeDays != null && best.score < 5) return null;
  return best.text;
}

/** Где в цитате срок уведомления — для подсветки («30 (тридцать) дней»). */
export function noticeSpan(text: string, noticeDays: number | null): [number, number] | null {
  if (noticeDays == null) return null;
  const re = new RegExp(`(^|[^\\d])(${noticeDays}(\\s*\\([^)]{1,40}\\))?(\\s+[а-яёa-z']+){0,2}\\s*(дн[а-яё.]*|day[s]?|kun))`, 'iu');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[1].length;
  return [start, start + m[2].length];
}
