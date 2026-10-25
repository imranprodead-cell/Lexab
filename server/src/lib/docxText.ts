/**
 * Текст DOCX таким, каким его видит человек в Word (аудит загрузок 2026-10-18).
 *
 * mammoth.extractRawText терял то, на чём держится договор: автонумерацию
 * пунктов («1.1.», «3.2.», «а)»), сноски («но не более 10% от цены»),
 * колонтитулы, а таблицу раскладывал по ячейке на строку. Модель не могла
 * сослаться на «п. 3.1», не видела ограничения из сноски, а «Сравнение» того же
 * договора в DOCX и PDF находило правки, которых нет.
 *
 * Здесь DOCX разбирается напрямую:
 *  - номера пунктов вычисляются по numbering.xml так же, как это делает Word:
 *    счётчики общие для списков с одним abstractNum, startOverride начинает
 *    счёт заново, нумерация может приходить из стиля абзаца (Заголовок 1);
 *  - таблица — строка на строку, ячейки через « | »;
 *  - сноски — метки [1], [2] в тексте и их тексты в конце;
 *  - колонтитулы — один раз, без повторов;
 *  - текст надписей (text box) — один раз (дубль из mc:Fallback пропускается),
 *    скрытый текст и источник перемещения (moveFrom) — не берутся.
 * Непринятые исправления (режим правок Word) видны ОБЕИМИ версиями:
 * «неустойку [удалено: 0,1%][добавлено: 0,5%]», а в начале текста — пометка,
 * что в файле есть непринятые исправления. Раньше (mammoth) предложение
 * контрагента читалось как окончательный текст, а исходная редакция пропадала.
 *
 * Возвращает null, если разобрать не вышло (ZIP64, нестандартное имя части,
 * пустой результат) — вызывающий откатывается на mammoth.
 */
import zlib from 'node:zlib';
import { looksRussian } from './format.ts';

/** Потолок распаковки одной части — как у защиты от ZIP-бомбы в extract.ts. */
const MAX_PART_BYTES = 120 * 1024 * 1024;

/** Нужные части архива (имя → XML). null — архив не разобрать. */
export function readZipParts(buffer: Buffer, want: (name: string) => boolean): Map<string, string> | null {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const LOCAL_SIG = 0x04034b50;
  let eocd = -1;
  const from = Math.max(0, buffer.length - (22 + 0xffff));
  for (let i = buffer.length - 22; i >= from; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > buffer.length) return null;
  let offset = buffer.readUInt32LE(eocd + 16);
  const count = buffer.readUInt16LE(eocd + 10);
  if (offset === 0xffffffff || count === 0xffff) return null; // ZIP64
  const parts = new Map<string, string>();
  let budget = MAX_PART_BYTES; // на ВСЕ нужные части вместе, а не на каждую
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CD_SIG) return null;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOff = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    if (compSize === 0xffffffff || localOff === 0xffffffff) return null;
    if (localOff + 30 > buffer.length || buffer.readUInt32LE(localOff) !== LOCAL_SIG) return null;
    const dataStart = localOff + 30 + buffer.readUInt16LE(localOff + 26) + buffer.readUInt16LE(localOff + 28);
    if (dataStart + compSize > buffer.length) return null;
    const data = buffer.subarray(dataStart, dataStart + compSize);
    let raw: Buffer;
    if (method === 0) raw = data;
    else if (method === 8) raw = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, budget) });
    else return null;
    budget -= raw.length;
    if (budget < 0) return null;
    parts.set(name, raw.toString('utf8'));
  }
  return parts;
}

// ── Минимальный разбор XML: теги и текст по порядку ────────────────────────
//
// Разбор идёт строго вперёд, без возвратов: регулярное выражение по всему
// документу на испорченном файле («<a<a<a…» без «>») перебирало бы хвост
// заново с каждого «<» — квадратичное время, и сервер висел бы для всех.

const TAG_INNER = /^(\/?)([\w.:-]+)([\s\S]*?)(\/?)$/;

export interface Tag {
  close: boolean;
  selfClose: boolean;
  /** Имя без префикса пространства имён… */
  local: string;
  /** …и сам префикс («w», «mc», …). */
  prefix: string;
  attrs: string;
}

export function* tokens(xml: string): Generator<Tag | string> {
  let pos = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    if (lt === -1) {
      yield xml.slice(pos);
      return;
    }
    if (lt > pos) yield xml.slice(pos, lt);
    // Комментарии, CDATA, <?xml …?>, <!DOCTYPE …> — пропускаются целиком.
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) return;
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) return;
      yield xml.slice(lt + 9, end).replace(/&/g, '&amp;').replace(/</g, '&lt;'); // текст как есть (decodeXml вернёт исходное)
      pos = end + 3;
      continue;
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const end = xml.indexOf('>', lt + 2);
      if (end === -1) return;
      pos = end + 1;
      continue;
    }
    // Конец тега: «>» вне кавычек. Незакрытый тег или кавычка — дальше не разбираем.
    let i = lt + 1;
    let quote = 0;
    for (; i < xml.length; i++) {
      const c = xml.charCodeAt(i);
      if (quote) {
        if (c === quote) quote = 0;
      } else if (c === 0x22 || c === 0x27) quote = c;
      else if (c === 0x3e) break;
    }
    if (i >= xml.length) return;
    pos = i + 1;
    const m = TAG_INNER.exec(xml.slice(lt + 1, i));
    if (!m) continue;
    const full = m[2];
    const colon = full.indexOf(':');
    yield {
      close: m[1] === '/',
      selfClose: m[4] === '/',
      local: colon === -1 ? full : full.slice(colon + 1),
      prefix: colon === -1 ? '' : full.slice(0, colon),
      attrs: m[3],
    };
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] !== '#') return ENTITIES[e] ?? whole;
    try {
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    } catch {
      return whole;
    }
  });
}

/** Значение атрибута по локальному имени (w:val, w:id, …). */
export function attr(attrs: string, local: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${local}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeXml(m[2] ?? m[3] ?? '') : undefined;
}

/** Флаг вида <w:vanish/>, <w:isLgl w:val="0"/>: есть и не выключен. */
function flagOn(attrs: string): boolean {
  const v = attr(attrs, 'val');
  return v === undefined || !['0', 'false', 'off'].includes(v.toLowerCase());
}

// ── Нумерация списков (numbering.xml + стили) ─────────────────────────────

interface Level {
  start: number;
  fmt: string;
  text: string;
  isLgl: boolean;
  pStyle?: string;
}

const RU_LETTERS = 'абвгдежзиклмнопрстуфхцчшщэюя'; // как в Word: без ё, й, ъ, ы, ь
const LATIN_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** Word: после «z» идут «aa», «bb» (буква повторяется), а не «ab». */
function letter(n: number, alphabet: string): string {
  if (n <= 0) return String(n);
  return alphabet[(n - 1) % alphabet.length].repeat(Math.floor((n - 1) / alphabet.length) + 1);
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n);
    case 'upperRoman':
      return roman(n);
    case 'lowerRoman':
      return roman(n).toLowerCase();
    case 'upperLetter':
      return letter(n, LATIN_LETTERS).toUpperCase();
    case 'lowerLetter':
      return letter(n, LATIN_LETTERS);
    case 'russianUpper':
      return letter(n, RU_LETTERS).toUpperCase();
    case 'russianLower':
      return letter(n, RU_LETTERS);
    case 'none':
      return '';
    default:
      return String(n); // decimal и всё экзотическое — арабскими цифрами
  }
}

class Numbering {
  private abstracts = new Map<string, Map<number, Level>>();
  private nums = new Map<string, { abs: string; overrides: Map<number, { start?: number; level?: Level }> }>();
  private styles = new Map<string, { numId?: string; ilvl?: number; basedOn?: string }>();
  private counters = new Map<string, (number | undefined)[]>();
  private started = new Set<string>();

  constructor(numberingXml: string | undefined, stylesXml: string | undefined) {
    if (numberingXml) this.parseNumbering(numberingXml);
    if (stylesXml) this.parseStyles(stylesXml);
  }

  private parseNumbering(xml: string) {
    let abs: Map<number, Level> | null = null;
    let num: { abs: string; overrides: Map<number, { start?: number; level?: Level }> } | null = null;
    let override: { start?: number; level?: Level } | null = null;
    let lvl: (Level & { ilvl: number }) | null = null;
    for (const tok of tokens(xml)) {
      if (typeof tok === 'string' || tok.prefix !== 'w') continue;
      const { local, close, selfClose, attrs } = tok;
      if (close) {
        if (local === 'abstractNum') abs = null;
        else if (local === 'num') num = null;
        else if (local === 'lvlOverride') override = null;
        else if (local === 'lvl' && lvl) {
          const { ilvl, ...level } = lvl;
          if (override) override.level = level;
          else abs?.set(ilvl, level);
          lvl = null;
        }
        continue;
      }
      if (local === 'abstractNum') {
        abs = new Map();
        this.abstracts.set(attr(attrs, 'abstractNumId') ?? '', abs);
      } else if (local === 'num' && !selfClose) {
        num = { abs: '', overrides: new Map() };
        this.nums.set(attr(attrs, 'numId') ?? '', num);
      } else if (local === 'abstractNumId' && num) {
        num.abs = attr(attrs, 'val') ?? '';
      } else if (local === 'lvlOverride' && num && !selfClose) {
        override = {};
        num.overrides.set(Number(attr(attrs, 'ilvl') ?? 0), override);
      } else if (local === 'startOverride' && override) {
        override.start = Number(attr(attrs, 'val') ?? 1);
      } else if (local === 'lvl' && !selfClose) {
        lvl = { ilvl: Number(attr(attrs, 'ilvl') ?? 0), start: 1, fmt: 'decimal', text: '', isLgl: false };
      } else if (lvl) {
        if (local === 'start') lvl.start = Number(attr(attrs, 'val') ?? 1);
        else if (local === 'numFmt') lvl.fmt = attr(attrs, 'val') ?? 'decimal';
        else if (local === 'lvlText') lvl.text = attr(attrs, 'val') ?? '';
        else if (local === 'isLgl') lvl.isLgl = flagOn(attrs);
        else if (local === 'pStyle') lvl.pStyle = attr(attrs, 'val');
      }
    }
  }

  private parseStyles(xml: string) {
    let style: { numId?: string; ilvl?: number; basedOn?: string } | null = null;
    for (const tok of tokens(xml)) {
      if (typeof tok === 'string' || tok.prefix !== 'w') continue;
      if (tok.local === 'style') {
        if (tok.close) style = null;
        else if (!tok.selfClose) {
          style = {};
          this.styles.set(attr(tok.attrs, 'styleId') ?? '', style);
        }
      } else if (style && !tok.close) {
        if (tok.local === 'basedOn') style.basedOn = attr(tok.attrs, 'val');
        else if (tok.local === 'numId') style.numId = attr(tok.attrs, 'val');
        else if (tok.local === 'ilvl') style.ilvl = Number(attr(tok.attrs, 'val') ?? 0);
      }
    }
  }

  private levelOf(numId: string, ilvl: number): Level | undefined {
    const num = this.nums.get(numId);
    if (!num) return undefined;
    return num.overrides.get(ilvl)?.level ?? this.abstracts.get(num.abs)?.get(ilvl);
  }

  /** Метка пункта («1.2.», «б)», «•») или '' — двигает счётчики, как Word. */
  label(p: { numId?: string; ilvl?: number; style?: string }): string {
    let { numId, ilvl } = p;
    if (numId === undefined && p.style) {
      // Нумерация из стиля (и его родителей), прямые свойства абзаца главнее.
      let s = this.styles.get(p.style);
      for (let depth = 0; s && depth < 10; depth++) {
        if (s.numId !== undefined) {
          numId = s.numId;
          if (ilvl === undefined) ilvl = s.ilvl;
          break;
        }
        s = s.basedOn ? this.styles.get(s.basedOn) : undefined;
      }
    }
    if (numId === undefined || numId === '0') return '';
    const num = this.nums.get(numId);
    if (!num) return '';
    if (ilvl === undefined) {
      // Уровень, привязанный к стилю абзаца (Заголовок 2 → уровень 1), иначе 0.
      ilvl = 0;
      for (const [l, def] of this.abstracts.get(num.abs) ?? []) {
        if (p.style && def.pStyle === p.style) ilvl = l;
      }
    }
    const def = this.levelOf(numId, ilvl);
    if (!def) return '';

    // Списки с одним abstractNum считаются вместе («продолжить нумерацию»),
    // а startOverride в w:num при первом появлении начинает счёт заново.
    let c = this.counters.get(num.abs);
    if (!c) {
      c = [];
      this.counters.set(num.abs, c);
    }
    if (!this.started.has(numId)) {
      this.started.add(numId);
      for (const [l, ov] of num.overrides) {
        if (ov.start === undefined) continue;
        c[l] = ov.start - 1;
        for (let d = l + 1; d < 9; d++) c[d] = undefined;
      }
    }
    c[ilvl] = (c[ilvl] ?? def.start - 1) + 1;
    for (let d = ilvl + 1; d < 9; d++) c[d] = undefined;

    if (def.fmt === 'bullet') return '•';
    const counters = c;
    return def.text.replace(/%([1-9])/g, (_m, d: string) => {
      const l = Number(d) - 1;
      const levelDef = this.levelOf(numId, l);
      const value = counters[l] ?? levelDef?.start ?? 1;
      return formatNumber(value, def.isLgl ? 'decimal' : (levelDef?.fmt ?? 'decimal'));
    });
  }
}

// ── Обход WordprocessingML ────────────────────────────────────────────────

/** Регионы, текст которых в итоговом виде документа не виден или задублирован. */
const SKIP = new Set(['Fallback', 'pPrChange', 'rPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange', 'numberingChange', 'moveFrom']);

/** Метки правок на время обхода (язык подписей известен только в конце):
 *  символы из частной области Unicode, в тексте договора их нет. */
const DEL_OPEN = '\uE000';
const INS_OPEN = '\uE001';
const MARK_CLOSE = '\uE002';
const MARKS = /[\uE000-\uE002]/g;

class Notes {
  readonly order: { kind: 'footnote' | 'endnote'; id: string }[] = [];
  private seen = new Map<string, number>();
  ref(kind: 'footnote' | 'endnote', id: string): number {
    const key = `${kind}:${id}`;
    let n = this.seen.get(key);
    if (n === undefined) {
      this.order.push({ kind, id });
      n = this.order.length;
      this.seen.set(key, n);
    }
    return n;
  }
}

/** Абзацы и таблицы одной части (тело, колонтитул, сноска) → блоки текста. */
function walk(xml: string, numbering: Numbering | null, notes: Notes | null): string[] {
  const blocks: string[] = [];
  /** Куда складываются готовые абзацы: тело или текущая ячейка таблицы. */
  const containers: string[][] = [blocks];
  const tables: string[][][] = [];
  const paras: { text: string; numId?: string; ilvl?: number; style?: string }[] = [];
  /** Открытые правки (w:ins / w:del): чей абзац и где начинается метка. */
  const revisions: { para: { text: string }; pos: number; kind: 'ins' | 'del' }[] = [];
  let skip = 0;
  let inPPr = 0;
  let runDepth = 0;
  let runHidden = false;
  let inText = false;

  for (const tok of tokens(xml)) {
    if (typeof tok === 'string') {
      if (!skip && inText && !runHidden && paras.length) paras[paras.length - 1].text += decodeXml(tok).replace(MARKS, '');
      continue;
    }
    const { local, prefix, close, selfClose, attrs } = tok;
    if ((prefix === 'w' || prefix === 'mc') && SKIP.has(local)) {
      if (!selfClose) skip += close ? -1 : 1;
      continue;
    }
    if (skip || prefix !== 'w') continue;
    const para = paras[paras.length - 1];

    if (close) {
      switch (local) {
        case 't':
        case 'delText':
          inText = false;
          break;
        case 'ins':
        case 'del': {
          const rev = revisions.pop();
          if (!rev) break;
          const inner = rev.para.text.slice(rev.pos + 1);
          // Правка без текста (только формат, ссылка) — метка не нужна.
          if (inner.trim()) rev.para.text += MARK_CLOSE;
          else rev.para.text = rev.para.text.slice(0, rev.pos) + (rev.kind === 'ins' ? inner : '');
          break;
        }
        case 'pPr':
          inPPr = Math.max(0, inPPr - 1);
          break;
        case 'r':
          runDepth = Math.max(0, runDepth - 1);
          if (!runDepth) runHidden = false;
          break;
        case 'p': {
          const p = paras.pop();
          if (!p) break;
          const label = numbering ? numbering.label(p) : '';
          const text = p.text.replace(/\s+$/, '');
          if (text.trim()) containers[containers.length - 1].push(label ? `${label} ${text.replace(/^\s+/, '')}` : text);
          break;
        }
        case 'tc': {
          const cell = containers.length > 1 ? containers.pop() : undefined;
          const row = tables[tables.length - 1]?.[tables[tables.length - 1].length - 1];
          if (cell && row) row.push(cell.join(' ').replace(/\s+/g, ' ').trim());
          break;
        }
        case 'tbl': {
          const rows = tables.pop();
          const text = (rows ?? [])
            .map((cells) => cells.join(' | '))
            .filter((line) => line.replace(/[|\s]/g, ''))
            .join('\n');
          if (text) containers[containers.length - 1].push(text);
          break;
        }
      }
      continue;
    }

    switch (local) {
      case 'p':
        if (!selfClose) paras.push({ text: '' });
        break;
      case 'pPr':
        if (!selfClose) inPPr++;
        break;
      case 'pStyle':
        if (inPPr && para) para.style = attr(attrs, 'val');
        break;
      case 'numId':
        if (inPPr && para) para.numId = attr(attrs, 'val');
        break;
      case 'ilvl':
        if (inPPr && para) para.ilvl = Number(attr(attrs, 'val') ?? 0);
        break;
      case 'r':
        if (!selfClose) runDepth++;
        break;
      case 'vanish':
        if (runDepth && !inPPr && flagOn(attrs)) runHidden = true;
        break;
      case 't':
      case 'delText':
        if (!selfClose) inText = true;
        break;
      case 'ins':
      case 'del':
        // Обёртка вокруг текста; пустые w:ins/w:del в свойствах (абзац или
        // строка таблицы целиком) — самозакрытые и меток не дают.
        if (!selfClose && para) {
          para.text += local === 'del' ? DEL_OPEN : INS_OPEN;
          revisions.push({ para, pos: para.text.length - 1, kind: local });
        }
        break;
      case 'tab':
        if (runDepth && !inPPr && para && !runHidden) para.text += '\t';
        break;
      case 'br':
      case 'cr':
        if (runDepth && para && !runHidden) para.text += '\n';
        break;
      case 'noBreakHyphen':
        if (runDepth && para && !runHidden) para.text += '-';
        break;
      case 'footnoteReference':
      case 'endnoteReference':
        if (notes && para) {
          const id = attr(attrs, 'id');
          if (id !== undefined) para.text += `[${notes.ref(local === 'footnoteReference' ? 'footnote' : 'endnote', id)}]`;
        }
        break;
      case 'tbl':
        if (!selfClose) tables.push([]);
        break;
      case 'tr':
        if (!selfClose) tables[tables.length - 1]?.push([]);
        break;
      case 'tc':
        if (!selfClose) containers.push([]);
        break;
    }
  }
  return blocks;
}

/** Тексты сносок/концевых сносок по id (без служебных разделителей). */
function noteTexts(xml: string | undefined, element: 'footnote' | 'endnote'): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) return out;
  // Поиск начала и конца каждой сноски — indexOf строго вперёд (регулярное
  // выражение по всему файлу на незакрытых сносках было бы квадратичным).
  const open = `<w:${element}`;
  const close = `</w:${element}>`;
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(open, pos);
    if (start === -1) break;
    const after = xml[start + open.length];
    const headEnd = xml.indexOf('>', start);
    if (headEnd === -1) break;
    if (after !== ' ' && after !== '>' && after !== '/' && after !== '\t' && after !== '\n' && after !== '\r') {
      pos = start + open.length; // <w:footnotePr> и т.п. — не сноска
      continue;
    }
    const head = xml.slice(start + open.length, headEnd);
    if (head.endsWith('/')) {
      pos = headEnd + 1; // пустая самозакрытая сноска
      continue;
    }
    const end = xml.indexOf(close, headEnd);
    if (end === -1) break;
    pos = end + close.length;
    const type = attr(head, 'type');
    if (type && type !== 'normal') continue; // separator, continuationSeparator, …
    const id = attr(head, 'id');
    if (id === undefined) continue;
    out.set(id, walk(xml.slice(headEnd + 1, end), null, null).join(' ').replace(/\s+/g, ' ').trim());
  }
  return out;
}

const partOrder = (name: string): number => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

export function docxToText(buffer: Buffer): string | null {
  const parts = readZipParts(buffer, (name) =>
    /^word\/(document|numbering|styles|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name),
  );
  const documentXml = parts?.get('word/document.xml');
  if (!parts || !documentXml) return null;

  const numbering = new Numbering(parts.get('word/numbering.xml'), parts.get('word/styles.xml'));
  const notes = new Notes();
  const body = walk(documentXml, numbering, notes);
  if (!body.length) return null;

  // Колонтитулы: один раз (в каждом разделе обычно повторяются), только с буквами.
  const edge = (kind: 'header' | 'footer'): string[] => {
    const seen = new Set<string>();
    const names = [...parts.keys()].filter((n) => n.startsWith(`word/${kind}`)).sort((a, b) => partOrder(a) - partOrder(b));
    for (const name of names) {
      const text = walk(parts.get(name) ?? '', null, null).join('\n').trim();
      if (/\p{L}{2}/u.test(text)) seen.add(text);
    }
    return [...seen];
  };

  const out = [...edge('header'), ...body, ...edge('footer')];
  if (notes.order.length) {
    const footnotes = noteTexts(parts.get('word/footnotes.xml'), 'footnote');
    const endnotes = noteTexts(parts.get('word/endnotes.xml'), 'endnote');
    const lines = notes.order.map(
      (n, i) => `[${i + 1}] ${(n.kind === 'footnote' ? footnotes : endnotes).get(n.id) ?? ''}`.trimEnd(),
    );
    out.push(`${looksRussian(body.join(' ').slice(0, 2000)) ? 'Сноски' : 'Notes'}:\n${lines.join('\n')}`);
  }
  let text = out.join('\n\n');
  // Непринятые исправления: подписи меток — на языке договора, и пометка
  // сверху, чтобы ни модель, ни человек не приняли предложение за итог.
  if (text.includes(DEL_OPEN) || text.includes(INS_OPEN)) {
    const ru = looksRussian(text.replace(MARKS, '').slice(0, 4000));
    const [del, ins, note] = ru
      ? ['[удалено: ', '[добавлено: ', '[В файле есть непринятые исправления (режим правок Word): удалённый текст помечен «[удалено: …]», добавленный — «[добавлено: …]».]']
      : ['[deleted: ', '[inserted: ', '[The file contains unaccepted tracked changes (Word Track Changes): deleted text is marked “[deleted: …]”, inserted text “[inserted: …]”.]'];
    text = `${note}\n\n${text.replaceAll(DEL_OPEN, del).replaceAll(INS_OPEN, ins).replaceAll(MARK_CLOSE, ']')}`;
  }
  return text;
}
