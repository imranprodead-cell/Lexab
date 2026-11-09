/**
 * Карта связей между нормами (этап 1 «графа», решение владельца 2026-11-08).
 *
 * Связи строит КОД из официального текста — никакой генерации и никакого ИИ:
 * у каждой связи есть цитата-основание (фрагмент текста нормы-источника), а цель
 * обязана существовать в базе — иначе связь не пишется (fail-closed, как
 * резолвер цитат). Чистые функции — покрыты юнит-тестами (test/links.test.ts).
 *
 * Виды связей:
 *  - refers     — статья ссылается на статью: «в порядке части первой статьи 416
 *                 настоящего Кодекса», «статьей 327 Гражданского кодекса»;
 *  - interprets — пункт Пленума называет статью, которую разъясняет:
 *                 «В соответствии со статьей 326 ГК суд… вправе уменьшить»;
 *  - cocited    — две статьи названы в ОДНОМ пункте Пленума (правило ГК +
 *                 спецзакон: «законную неустойку (ст. 263 ГК)» и «статьи 25 —
 *                 32 Закона»). Связь симметричная, основание — сам пункт.
 *
 * Замер, ради которого это делается (uz-multihop, 08.11): статьи, связанные
 * ПРЯМОЙ ссылкой, поиск уже находит сам; проваливаются норма, на которую
 * ссылается найденный Пленум (ст. 356 ГК), и спецзакон рядом с общей нормой ГК.
 */
import { parseRuCitation } from './retrieve.ts';

export type LinkKind = 'refers' | 'interprets' | 'cocited';

export interface RawRef {
  /** Номера статей в том виде, как они хранятся в базе («383-1»). */
  numbers: string[];
  /** Текст сразу после номеров (до следующей ссылки или конца предложения). */
  tail: string;
  /** Предложение-основание (до 300 символов). */
  quote: string;
}

const NUM = String.raw`\d{1,4}(?:-\d{1,2})?`;
// «статья/статьи/статьей/статьями/статьях», «ст.», «ст.ст.». Левая граница руками:
// JS \b кириллицу не видит. Список номеров ограничен {0,12} — без катастрофического
// перебора на длинных текстах.
const REF_RE = new RegExp(
  String.raw`(?<![А-Яа-яЁёA-Za-z])(?:стать(?:я|и|е|ей|ю|ями|ях|ям)|ст\.(?:\s*ст\.)?)\s*(${NUM}(?:(?:\s*,\s*|\s+и\s+|\s+или\s+|\s*[—–]\s*|\s+-\s+)${NUM}){0,12})`,
  'giu',
);
const NEXT_REF_RE = /(?<![А-Яа-яЁёA-Za-z])(?:стать[а-яё]{0,3}|ст\.)\s*\d/iu;

/** Номера из списка «12, 13 и 15» / диапазона «25 — 32». Дефис БЕЗ пробелов —
 *  это вставная статья («383-1», так её пишет ингест), тире или дефис с
 *  пробелами — диапазон (разворачиваем, но не длиннее 20 статей). */
export function expandNumbers(list: string): string[] {
  const out: string[] = [];
  const parts = list.split(/(\s*,\s*|\s+и\s+|\s+или\s+|\s*[—–]\s*|\s+-\s+)/u);
  for (let i = 0; i < parts.length; i += 2) {
    const n = parts[i].trim();
    if (!n) continue;
    const sep = parts[i - 1] ?? '';
    const prev = out[out.length - 1];
    if (prev && /[—–]|\s-\s/u.test(sep) && /^\d+$/.test(prev) && /^\d+$/.test(n)) {
      const a = Number(prev);
      const b = Number(n);
      if (b > a && b - a <= 20) {
        for (let k = a + 1; k <= b; k++) out.push(String(k));
        continue;
      }
    }
    out.push(n);
  }
  return [...new Set(out)];
}

/** Цитата-основание: предложение со ссылкой; длинное предложение — окно
 *  ~300 символов ВОКРУГ ссылки (иначе сама ссылка в цитату не попадала). */
export function sentenceAround(text: string, start: number, end: number, max = 300): string {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const from = Math.max(text.lastIndexOf('. ', start) + 2, text.lastIndexOf('\n', start) + 1, 0);
  const dot = text.indexOf('. ', end);
  const to = dot === -1 ? text.length : dot + 1;
  if (to - from <= max) return clean(text.slice(from, to));
  const a = Math.max(from, start - Math.floor(max * 0.4));
  const b = Math.min(to, a + max);
  return `${a > from ? '…' : ''}${clean(text.slice(a, b))}${b < to ? '…' : ''}`;
}

/** Все упоминания статей в тексте нормы. */
export function findArticleRefs(text: string): RawRef[] {
  const out: RawRef[] = [];
  for (const m of text.matchAll(REF_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    let tail = text.slice(end, end + 160);
    const next = tail.search(NEXT_REF_RE);
    if (next >= 0) tail = tail.slice(0, next);
    const stop = tail.search(/[;]|\.\s|\.$/u);
    if (stop >= 0) tail = tail.slice(0, stop);
    out.push({ numbers: expandNumbers(m[1]), tail: tail.replace(/\s+/g, ' '), quote: sentenceAround(text, start, end) });
  }
  return out;
}

/** «…статьи 416 настоящего Кодекса» — ссылка внутри того же акта. */
export function isInternalTail(tail: string): boolean {
  return /^\s{0,3}(?:\([^)]{0,40}\)\s*)?настоящ\S*\s+(?:Кодекс|Закон)/iu.test(tail);
}

/** Сокращения, которые вводит сам документ: «Закона "О договорно-правовой
 *  базе…" (далее — Закон)». Ключ — сокращение, значение — название в кавычках. */
export function findAbbreviations(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /[«"]([^«»"]{4,160})[»"][^()«»"]{0,60}\(\s*далее\s*(?:по\s+тексту\s*)?[—–-]+\s*([^)]{1,40})\)/giu;
  for (const m of text.matchAll(re)) {
    const key = m[2].replace(/[«»"]/g, '').trim();
    if (key && !map.has(key)) map.set(key, m[1].trim());
  }
  return map;
}

/** Пленум, посвящённый ОДНОМУ закону, часто не вводит «(далее — Закон)», а
 *  пишет просто «статьи 25 Закона»: тогда закон берём из официального названия
 *  самого постановления («…применения … Закона Республики Узбекистан «О
 *  договорно-правовой базе…»»). Если в названии законов несколько — не угадываем. */
export function abbreviationFromTitle(docTitle: string): string | null {
  const titles = [...docTitle.matchAll(/Закон[а-яё]*\s+(?:Республики\s+Узбекистан\s+)?[«"]([^«»"]{4,160})[»"]/giu)].map((m) => m[1].trim());
  return titles.length === 1 ? titles[0] : null;
}

/** Хвост ссылки → название акта для parseRuCitation: сокращение документа
 *  («Закона» при «(далее — Закон)») заменяется полным названием в кавычках. */
export function expandAbbreviation(tail: string, abbreviations: Map<string, string>): string {
  for (const [key, title] of abbreviations) {
    const re = new RegExp(`^\\s{0,3}${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[а-яё]{0,3}(?![А-Яа-яЁёA-Za-z])`, 'iu');
    if (re.test(tail)) return `«${title}»`;
  }
  return tail;
}

export interface CorpusDoc {
  id: string;
  title: string;
  docType: string;
}

/** ILIKE-шаблон резолвера («%О залоге%», «Гражданский кодекс%») → RegExp. */
function likeToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('')
    .map((c) => (c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'isu');
}

/**
 * Резолвер ссылок в памяти — ТО ЖЕ правило, что SQL в resolveCitationText:
 * акты по ILIKE-шаблону, только законы/кодексы (не указы и не Пленумы), у
 * которых есть статья с этим номером; порядок — точное название, затем самое
 * короткое, затем id. Обе части ГК нумеруются сквозь — номер выбирает часть.
 */
export class LinkResolver {
  private readonly units = new Map<string, string>(); // `${docId}|${number}` → unit id
  private readonly docs: CorpusDoc[];
  constructor(docs: CorpusDoc[], units: { id: string; documentId: string; number: string | null }[]) {
    this.docs = docs;
    for (const u of units) if (u.number) this.units.set(`${u.documentId}|${u.number}`, u.id);
  }

  unitIn(docId: string, number: string): string | null {
    return this.units.get(`${docId}|${number}`) ?? null;
  }

  /** Ссылка «настоящего Кодекса»: сначала тот же документ, затем вторая часть
   *  того же кодекса (ГК хранится двумя документами: ч.2 ссылается на ст.327 ч.1). */
  internal(docId: string, number: string): string | null {
    const own = this.unitIn(docId, number);
    if (own) return own;
    const doc = this.docs.find((d) => d.id === docId);
    const family = doc?.title.match(/^(.*?)\s*\(часть\s/u)?.[1];
    if (!family) return null;
    for (const d of this.docs) {
      if (d.id !== docId && d.title.startsWith(family)) {
        const hit = this.unitIn(d.id, number);
        if (hit) return hit;
      }
    }
    return null;
  }

  external(number: string, tail: string, jurisdiction: string): string | null {
    const parsed = parseRuCitation(`ст. ${number} ${tail}`, jurisdiction);
    if (!parsed) return null;
    const re = likeToRegExp(parsed.titlePattern);
    const exact = parsed.titlePattern.replace(/^%|%$/g, '').toLowerCase();
    const candidates = this.docs
      .filter((d) => !['decree', 'resolution', 'plenum'].includes(d.docType) && re.test(d.title) && this.unitIn(d.id, parsed.number))
      .sort(
        (a, b) =>
          Number(b.title.toLowerCase() === exact) - Number(a.title.toLowerCase() === exact) ||
          a.title.length - b.title.length ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    return candidates[0] ? this.unitIn(candidates[0].id, parsed.number) : null;
  }
}

export interface SourceUnit {
  id: string;
  documentId: string;
  docType: string;
  text: string;
}

export interface Link {
  from: string;
  to: string;
  kind: LinkKind;
  quote: string;
  via: string | null;
}

/** Связи одной нормы-источника. Пленум → статья = interprets; закон/кодекс/
 *  указ → статья = refers. Ссылки на саму себя и нерезолвящиеся — отбрасываются. */
export function linksFromUnit(
  unit: SourceUnit,
  resolver: LinkResolver,
  abbreviations: Map<string, string>,
  jurisdiction: string,
): Link[] {
  const kind: LinkKind = unit.docType === 'plenum' ? 'interprets' : 'refers';
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const ref of findArticleRefs(unit.text)) {
    const internal = unit.docType !== 'plenum' && isInternalTail(ref.tail);
    const tail = expandAbbreviation(ref.tail, abbreviations);
    for (const n of ref.numbers) {
      const to = internal ? resolver.internal(unit.documentId, n) : resolver.external(n, tail, jurisdiction);
      if (!to || to === unit.id || seen.has(to)) continue;
      seen.add(to);
      out.push({ from: unit.id, to, kind, quote: ref.quote, via: null });
    }
  }
  return out;
}

/** Совместное упоминание в одном пункте Пленума: каждая пара названных в нём
 *  статей связывается в обе стороны. Пункт-перечень (больше `maxTargets`
 *  статей) пропускаем — там связь размыта. */
export function cocitedLinks(plenumPoint: SourceUnit, targets: Link[], maxTargets = 6): Link[] {
  const ids = [...new Set(targets.map((t) => t.to))];
  if (ids.length < 2 || ids.length > maxTargets) return [];
  // Основание пары — оба упоминания из пункта Пленума (одно, если в одной фразе).
  const quoteOf = new Map<string, string>();
  for (const t of targets) if (!quoteOf.has(t.to)) quoteOf.set(t.to, t.quote);
  const out: Link[] = [];
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const qa = quoteOf.get(a) ?? '';
      const qb = quoteOf.get(b) ?? '';
      out.push({ from: a, to: b, kind: 'cocited', quote: qa === qb ? qa : `${qa} … ${qb}`, via: plenumPoint.id });
    }
  }
  return out;
}
