/*
 * Наглядные блоки в ответе ИИ (2026-11-16): план действий, шкала сроков, норма
 * закона, график. Сервер (server/src/lib/chatVisuals.ts) проверяет данные и
 * кладёт в текст ответа блок ```lexab-<вид>``` с JSON; здесь — разбор блока
 * (с проверкой: битый блок не рисуется), метки во время написания и текст
 * для копирования и озвучки.
 */

export interface StepsVisual {
  title?: string;
  steps: { title: string; detail?: string; when?: string; date?: string; who?: string; docs?: string[] }[];
}
export interface TimelineVisual {
  title?: string;
  events: { label: string; date: string; note?: string }[];
}
export interface LawVisual {
  unitId: string;
  label: string;
  note?: string;
}
export interface ChartVisual {
  title: string;
  kind: 'bar' | 'line';
  unit?: string;
  labels: string[];
  series: { name: string; values: number[] }[];
}

export type Visual =
  | { kind: 'steps'; data: StepsVisual }
  | { kind: 'timeline'; data: TimelineVisual }
  | { kind: 'law'; data: LawVisual }
  | { kind: 'chart'; data: ChartVisual };

const KINDS: Record<string, Visual['kind']> = {
  'lexab-steps': 'steps',
  'lexab-timeline': 'timeline',
  'lexab-law': 'law',
  'lexab-chart': 'chart',
};

/** Язык блока — наглядный? */
export const isVisualFence = (lang: string): boolean => lang in KINDS;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const optStr = (v: unknown) => v === undefined || typeof v === 'string';

/** Разбор блока; null — блок битый или чужой (тогда его не видно вовсе). */
export function parseVisual(lang: string, raw: string): Visual | null {
  const kind = KINDS[lang];
  if (!kind) return null;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (kind === 'steps') {
    const steps = o.steps;
    if (!Array.isArray(steps) || steps.length < 1 || !optStr(o.title)) return null;
    const ok = steps.every(
      (s) =>
        s && typeof s === 'object' && isStr((s as Record<string, unknown>).title) &&
        ((s as Record<string, unknown>).date === undefined || isIso((s as Record<string, unknown>).date)) &&
        ((s as Record<string, unknown>).docs === undefined || (Array.isArray((s as Record<string, unknown>).docs) && ((s as Record<string, unknown>).docs as unknown[]).every(isStr))),
    );
    return ok ? { kind, data: o as unknown as StepsVisual } : null;
  }
  if (kind === 'timeline') {
    const ev = o.events;
    if (!Array.isArray(ev) || ev.length < 1 || !optStr(o.title)) return null;
    const ok = ev.every((e) => e && typeof e === 'object' && isStr((e as Record<string, unknown>).label) && isIso((e as Record<string, unknown>).date));
    return ok ? { kind, data: o as unknown as TimelineVisual } : null;
  }
  if (kind === 'law') {
    return isStr(o.unitId) && isStr(o.label) && optStr(o.note) ? { kind, data: o as unknown as LawVisual } : null;
  }
  const labels = o.labels;
  const series = o.series;
  if (!isStr(o.title) || (o.kind !== 'bar' && o.kind !== 'line') || !Array.isArray(labels) || !Array.isArray(series) || !series.length) return null;
  if (!labels.every((l) => typeof l === 'string')) return null;
  const ok = series.every((s) => {
    const v = s && typeof s === 'object' ? (s as Record<string, unknown>).values : null;
    return Array.isArray(v) && v.length === labels.length && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  });
  return ok ? { kind, data: o as unknown as ChartVisual } : null;
}

/** Пока ответ пишется, на месте будущих карточек стоят метки [[lexab:N]] — не показываем их. */
export const stripVisualMarkers = (text: string): string => text.replace(/[ \t]*\[\[lexab:\d+\]\][ \t]*/g, '');

const FENCE = /```(lexab-(?:steps|timeline|law|chart))[^\n]*\n([\s\S]*?)\n?```/g;

const dmy = (iso: string) => iso.split('-').reverse().join('.');

/** Блок обычным текстом — для «Копировать» и озвучки. */
export function visualAsText(v: Visual, fmt: (n: number) => string = (n) => String(n)): string {
  switch (v.kind) {
    case 'steps':
      return [
        v.data.title ?? '',
        ...v.data.steps.map((s, i) => {
          const when = [s.when, s.date ? dmy(s.date) : ''].filter(Boolean).join(', ');
          const tail = [when, s.who].filter(Boolean).join('; ');
          return `${i + 1}. ${s.title}${tail ? ` (${tail})` : ''}${s.detail ? `. ${s.detail}` : ''}${s.docs?.length ? `. ${s.docs.join(', ')}` : ''}`;
        }),
      ]
        .filter(Boolean)
        .join('\n');
    case 'timeline':
      return [v.data.title ?? '', ...v.data.events.map((e) => `${dmy(e.date)} — ${e.label}${e.note ? ` (${e.note})` : ''}`)].filter(Boolean).join('\n');
    case 'law':
      return `${v.data.label}${v.data.note ? ` — ${v.data.note}` : ''}`;
    case 'chart': {
      const unit = v.data.unit ? ` ${v.data.unit}` : '';
      const rows = v.data.labels.map((l, i) => `${l}: ${v.data.series.map((s) => `${s.name ? `${s.name} ` : ''}${fmt(s.values[i])}${unit}`).join(', ')}`);
      return [v.data.title, ...rows].join('\n');
    }
  }
}

/** Текст ответа, где наглядные блоки заменены их текстом (битые — убраны). */
export function visualsToText(text: string, fmt?: (n: number) => string): string {
  return stripVisualMarkers(text).replace(FENCE, (_m, lang: string, raw: string) => {
    const v = parseVisual(lang, raw);
    return v ? visualAsText(v, fmt) : '';
  });
}

/** Деления оси графика: «круглые» шаги 1/2/2,5/5×10ⁿ, ноль всегда на оси. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}
