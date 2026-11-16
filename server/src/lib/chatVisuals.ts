/**
 * Наглядные блоки в ответе ИИ (2026-11-16): план действий, шкала сроков, норма
 * закона, график. ИИ вызывает инструмент show_*, а КОД проверяет данные:
 *  - даты шкалы считает сам (от опорной даты + дни/месяцы/годы);
 *  - текст нормы в блок не кладётся вовсе — только id нормы из базы, текст
 *    интерфейс берёт из корпуса (правило №1: текст закона не генерируется);
 *  - каждое число графика должно встретиться в калькуляторе, вопросе
 *    пользователя или прочитанных документах этого ответа.
 * В ответ ложится служебный блок ```lexab-<вид>``` (JSON), интерфейс рисует из
 * него карточку. Место — метка [[lexab:N]] в тексте; без метки — в конце.
 */

export type VisualKind = 'steps' | 'timeline' | 'law' | 'chart';

export const VISUAL_FENCE: Record<VisualKind, string> = {
  steps: 'lexab-steps',
  timeline: 'lexab-timeline',
  law: 'lexab-law',
  chart: 'lexab-chart',
};

/** Не больше блоков на ответ: наглядность, а не витрина. */
export const MAX_VISUALS = 4;

export interface StepsVisual {
  title?: string;
  steps: { title: string; detail?: string; when?: string; date?: string; who?: string; docs?: string[] }[];
}

export interface TimelineVisual {
  title?: string;
  /** По возрастанию даты; date — YYYY-MM-DD, посчитана кодом. */
  events: { label: string; date: string; note?: string }[];
}

export interface LawVisual {
  /** id нормы в корпусе — текст интерфейс берёт из базы. */
  unitId: string;
  /** Подпись нормы, как в Sources («ст. 333 ГК РУз»). */
  label: string;
  /** Зачем эта норма в ответе — одна фраза ИИ (не текст закона). */
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

export const visualMarker = (n: number): string => `[[lexab:${n}]]`;

/** Служебный блок для текста ответа. «`» → \u0060: не закроет блок раньше времени. */
export function visualBlock(v: Visual): string {
  return `\`\`\`${VISUAL_FENCE[v.kind]}\n${JSON.stringify(v.data).replace(/`/g, '\\u0060')}\n\`\`\``;
}

/**
 * Метки [[lexab:N]] → блоки на своём месте (отдельным абзацем). Блок без метки
 * — в конец ответа; повторная или чужая метка просто убирается.
 */
export function placeVisuals(reply: string, visuals: Visual[]): string {
  if (!visuals.length && !reply.includes('[[lexab:')) return reply;
  const used = new Set<number>();
  // Метка забирает пробелы и переводы строк вокруг себя — блок встаёт
  // отдельным абзацем, а остальной текст (и документы в нём) не меняется.
  let out = reply.replace(/\s*\[\[lexab:(\d+)\]\]\s*/g, (m, n: string) => {
    const i = Number(n) - 1;
    const v = visuals[i];
    const gap = m.includes('\n') ? '\n\n' : ' ';
    if (!v || used.has(i)) return gap;
    used.add(i);
    return `\n\n${visualBlock(v)}\n\n`;
  });
  const rest = visuals.filter((_, i) => !used.has(i)).map(visualBlock);
  if (rest.length) out = `${out.trimEnd()}\n\n${rest.join('\n\n')}`;
  return out.trim();
}

/* ── проверка чисел графика ─────────────────────────────────────────────── */

/**
 * Все числа текста: «240 000 000», «1 234.5», «12,5», «0.5%», «-3». Запятая с
 * тремя цифрами после неё («1,234») неоднозначна — берутся оба прочтения.
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /-?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/[ \u00a0\u202f]/g, '');
    const comma = /^-?\d+,(\d+)$/.exec(raw);
    if (comma && comma[1].length === 3) out.push(Number(raw.replace(',', '')));
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Масштабы подписи: суммы в тысячах/миллионах/миллиардах, доли ↔ проценты. */
const SCALES = [1, 1e-3, 1e-6, 1e-9, 100, 0.01];

/**
 * Значения графика, которых нет среди известных чисел. Допуск — только на
 * округление: 0,05% для числа как есть, 0,5% — когда сумма показана в
 * тысячах/миллионах (36,1 млн из 36 123 456). 36 100 000 вместо посчитанных
 * 36 000 000 — уже не округление, а выдумка.
 */
export function unverifiedValues(values: number[], known: number[]): number[] {
  return values.filter((v) => {
    if (v === 0) return false;
    return !known.some((k) =>
      SCALES.some((s) => Math.abs(k * s - v) <= Math.max(0.006, Math.abs(v) * (s === 1 ? 0.0005 : 0.005))),
    );
  });
}

/* ── нормализация входа инструментов ────────────────────────────────────── */

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Ошибка входа — уходит модели текстом, чтобы она исправила вызов. */
export class VisualInputError extends Error {}

function str(v: unknown, key: string, max: number, required = false): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw new VisualInputError(`${key} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new VisualInputError(`${key} must be a string`);
  const s = squash(v);
  if (!s) {
    if (required) throw new VisualInputError(`${key} is required`);
    return undefined;
  }
  if (s.length > max) throw new VisualInputError(`${key} is longer than ${max} characters`);
  return s;
}

function list(v: unknown, key: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v)) throw new VisualInputError(`${key} must be an array`);
  if (v.length < min || v.length > max) throw new VisualInputError(`${key} must have ${min}–${max} items`);
  return v;
}

const obj = (v: unknown, key: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new VisualInputError(`${key} must be an object`);
  return v as Record<string, unknown>;
};

/** План действий: 2–10 шагов; дату шага (если есть) разбирает вызывающий. */
export function normalizeSteps(
  input: Record<string, unknown>,
  parseDate: (s: string) => string,
): StepsVisual {
  const steps = list(input.steps, 'steps', 2, 10).map((raw, i) => {
    const s = obj(raw, `steps[${i}]`);
    const dateIn = str(s.date, `steps[${i}].date`, 20);
    const detail = str(s.detail, `steps[${i}].detail`, 500);
    const when = str(s.when, `steps[${i}].when`, 80);
    const who = str(s.who, `steps[${i}].who`, 80);
    const docs = s.docs === undefined ? undefined : list(s.docs, `steps[${i}].docs`, 0, 6).map((d, j) => str(d, `steps[${i}].docs[${j}]`, 100, true) as string);
    return {
      title: str(s.title, `steps[${i}].title`, 160, true) as string,
      ...(detail ? { detail } : {}),
      ...(when ? { when } : {}),
      ...(dateIn ? { date: parseDate(dateIn) } : {}),
      ...(who ? { who } : {}),
      ...(docs?.length ? { docs } : {}),
    };
  });
  const title = str(input.title, 'title', 120);
  return { ...(title ? { title } : {}), steps };
}

/**
 * Шкала сроков: у каждого события — date, ИЛИ after (номер более раннего
 * события, с 1) + years/months/days. Даты считает код (календарные дни).
 */
export function normalizeTimeline(
  input: Record<string, unknown>,
  parseDate: (s: string) => Date,
  addPeriod: (d: Date, y: number, m: number, days: number) => Date,
): TimelineVisual {
  const raw = list(input.events, 'events', 2, 12).map((r, i) => obj(r, `events[${i}]`));
  const dates: (Date | null)[] = raw.map(() => null);
  const int = (v: unknown, key: string, lim: number): number => {
    if (v === undefined || v === null) return 0;
    if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > lim) throw new VisualInputError(`${key} must be an integer up to ${lim}`);
    return v;
  };
  raw.forEach((e, i) => {
    const date = str(e.date, `events[${i}].date`, 20);
    if (date) {
      dates[i] = parseDate(date);
      return;
    }
    if (e.after === undefined) throw new VisualInputError(`events[${i}] needs a date, or «after» with years/months/days`);
    const after = e.after;
    if (typeof after !== 'number' || !Number.isInteger(after) || after < 1 || after > i) {
      throw new VisualInputError(`events[${i}].after must be the number (1–${i}) of an EARLIER event`);
    }
    const base = dates[after - 1];
    if (!base) throw new VisualInputError(`events[${after - 1}] has no date`);
    dates[i] = addPeriod(base, int(e.years, `events[${i}].years`, 50), int(e.months, `events[${i}].months`, 600), int(e.days, `events[${i}].days`, 20_000));
  });
  const events = raw
    .map((e, i) => {
      const note = str(e.note, `events[${i}].note`, 240);
      return {
        label: str(e.label, `events[${i}].label`, 140, true) as string,
        date: (dates[i] as Date).toISOString().slice(0, 10),
        ...(note ? { note } : {}),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const title = str(input.title, 'title', 120);
  return { ...(title ? { title } : {}), events };
}

/** График: bar — один ряд, line — до трёх; 2–24 точки; конечные числа. */
export function normalizeChart(input: Record<string, unknown>): ChartVisual {
  const kind = input.kind === 'line' ? 'line' : input.kind === 'bar' ? 'bar' : null;
  if (!kind) throw new VisualInputError('kind must be bar or line');
  const labels = list(input.labels, 'labels', 2, 24).map((l, i) => {
    if (typeof l === 'number') return String(l);
    return str(l, `labels[${i}]`, 40, true) as string;
  });
  const series = list(input.series, 'series', 1, kind === 'bar' ? 1 : 3).map((r, i) => {
    const s = obj(r, `series[${i}]`);
    const values = list(s.values, `series[${i}].values`, labels.length, labels.length).map((v, j) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new VisualInputError(`series[${i}].values[${j}] must be a number`);
      return v;
    });
    return { name: str(s.name, `series[${i}].name`, 60) ?? '', values };
  });
  const unit = str(input.unit, 'unit', 24);
  return { title: str(input.title, 'title', 120, true) as string, kind, ...(unit ? { unit } : {}), labels, series };
}

/* ── выключатель и текст для замеров ────────────────────────────────────── */

/** VISUALS=off — без наглядных блоков (замер «до / после», быстрый откат). */
export const visualsOn = (): boolean => process.env.VISUALS !== 'off';

export const VISUAL_TOOL_NAMES = ['show_steps', 'show_timeline', 'show_law', 'show_chart'];

const dmy = (iso: string) => iso.split('-').reverse().join('.');

/** Блок обычным текстом — как его видит человек (для оценки ответов в замере). */
export function visualAsPlainText(v: Visual): string {
  switch (v.kind) {
    case 'steps':
      return [v.data.title ?? '', ...v.data.steps.map((s, i) => [`${i + 1}. ${s.title}`, s.detail, s.when, s.date ? dmy(s.date) : '', s.who, s.docs?.join(', ')].filter(Boolean).join(' — '))]
        .filter(Boolean)
        .join('\n');
    case 'timeline':
      return [v.data.title ?? '', ...v.data.events.map((e) => `${dmy(e.date)} — ${e.label}${e.note ? ` (${e.note})` : ''}`)].filter(Boolean).join('\n');
    case 'law':
      return `${v.data.label}${v.data.note ? ` — ${v.data.note}` : ''}`;
    case 'chart':
      return [v.data.title, ...v.data.labels.map((l, i) => `${l}: ${v.data.series.map((s) => `${s.name ? `${s.name} ` : ''}${s.values[i]}${v.data.unit ? ` ${v.data.unit}` : ''}`).join(', ')}`)].join('\n');
  }
}
