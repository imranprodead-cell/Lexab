/**
 * Противоречия внутри договора (ui-test 2026-11-15): находка с conflict {a, b}
 * — две цитаты договора, которые расходятся (сумма цифрами и прописью, два
 * разных срока оплаты, два суда…). Правило проекта: текст договора в продукте
 * только ДОСЛОВНЫЙ. Модель могла пересказать — поэтому каждую цитату ищем в
 * тексте договора; не нашли обе — пометка «противоречие» снимается, находка
 * остаётся обычной (и проходит обычную проверку ссылки).
 */
export const TOPICS = ['penalty', 'termination', 'disputes', 'payment', 'acceptance', 'other'] as const;
export type FindingTopic = (typeof TOPICS)[number];

export function parseTopic(v: unknown): FindingTopic | null {
  return typeof v === 'string' && (TOPICS as readonly string[]).includes(v) ? (v as FindingTopic) : null;
}

/** Сравнение цитаты с текстом: регистр, кавычки, тире, «ё», пробелы и переносы не важны. */
export function normQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»“”„"']/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_QUOTE = 4;
const MAX_QUOTE = 400;

/** Сырые {a, b} от модели → чистая пара или null (пусто, слишком длинно, одинаково). */
export function parseConflict(v: unknown): { a: string; b: string } | null {
  if (!v || typeof v !== 'object') return null;
  const { a, b } = v as Record<string, unknown>;
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  const ta = a.trim().replace(/^[«"“]+|[»"”]+$/g, '').trim();
  const tb = b.trim().replace(/^[«"“]+|[»"”]+$/g, '').trim();
  if (ta.length < MIN_QUOTE || tb.length < MIN_QUOTE || ta.length > MAX_QUOTE || tb.length > MAX_QUOTE) return null;
  if (normQuote(ta) === normQuote(tb)) return null;
  return { a: ta, b: tb };
}

/**
 * Оставляет conflict только там, где обе цитаты дословно есть в тексте
 * договора. Нет текста (скан без текстового слоя) — проверить нечем, снимаем.
 */
export function verifyConflicts<F extends { conflict?: { a: string; b: string } | null }>(findings: F[], contractText: string | null | undefined): F[] {
  const hay = contractText ? normQuote(contractText) : '';
  return findings.map((f) => {
    if (!f.conflict) return f;
    const ok = hay && hay.includes(normQuote(f.conflict.a)) && hay.includes(normQuote(f.conflict.b));
    return ok ? f : { ...f, conflict: null };
  });
}
