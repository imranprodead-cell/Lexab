/**
 * Текст из Excel (.xlsx) и PowerPoint (.pptx) для вложений чата.
 *
 * Оба формата — ZIP с XML внутри, как .docx, поэтому распаковка и разбор XML
 * общие с docxText.ts: части читаются с общим потолком распаковки (защита от
 * ZIP-бомбы), XML разбирается строго вперёд, без возвратов.
 *
 * Excel: каждый лист — «## Лист: имя», строка таблицы — ячейки через « | »
 * (пустые ячейки в середине строки сохраняются, чтобы столбцы не съезжали).
 * Даты Excel хранит числом дней — по формату ячейки они превращаются обратно
 * в 2026-10-25, иначе модель видела бы «46320» вместо срока поставки.
 * PowerPoint: слайды в порядке показа, «## Слайд N», абзац — строка.
 *
 * null — разобрать не вышло (не тот архив, ZIP64, нет нужных частей).
 */
import { attr, decodeXml, readZipParts, tokens } from './docxText.ts';

/** Потолок текста одного файла — как MAX_TEXT_CHARS в extract.ts. */
const MAX_CHARS = 5_000_000;
/** Больше строк с одного листа модели всё равно не прочитать. */
const MAX_ROWS_PER_SHEET = 20_000;

/** «B12» → номер столбца с нуля (B → 1). */
function columnIndex(ref: string): number | null {
  const m = /^([A-Z]+)\d*$/i.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Путь части из Target связи: «worksheets/sheet1.xml» или «/xl/worksheets/sheet1.xml». */
function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `${base}/${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function relationships(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const tok of tokens(xml)) {
    if (typeof tok === 'string' || tok.close || tok.local !== 'Relationship') continue;
    const id = attr(tok.attrs, 'Id');
    const target = attr(tok.attrs, 'Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

const partNumber = (name: string): number => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

/** Ссылка на связь — r:id. У <p:sldId id="256" r:id="rId2"/> есть и свой
 *  id без префикса, поэтому общий attr(…, 'id') взял бы не тот. */
function relId(attrs: string): string | undefined {
  const m = /(?:^|\s)[\w.-]+:id\s*=\s*("([^"]*)"|'([^']*)')/.exec(attrs);
  return m ? decodeXml(m[2] ?? m[3] ?? '') : undefined;
}

// ── Excel ──────────────────────────────────────────────────────────────────

function sharedStrings(xml: string | undefined): string[] {
  const out: string[] = [];
  if (!xml) return out;
  let cur: string[] | null = null;
  let inText = false;
  let phonetic = 0; // <rPh> — подсказки чтения (японский), не текст ячейки
  for (const tok of tokens(xml)) {
    if (typeof tok === 'string') {
      if (cur && inText && !phonetic) cur.push(decodeXml(tok));
      continue;
    }
    if (tok.local === 'si') {
      if (tok.selfClose) out.push('');
      else if (tok.close) {
        out.push(cur ? cur.join('') : '');
        cur = null;
      } else cur = [];
    } else if (tok.local === 't') {
      inText = !tok.close && !tok.selfClose;
    } else if (tok.local === 'rPh' && !tok.selfClose) {
      phonetic += tok.close ? -1 : 1;
    }
  }
  return out;
}

/** Встроенные форматы дат Excel (numFmtId) — ECMA-376, 18.8.30. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Похож ли пользовательский формат на дату: d/m/y/h вне кавычек и [цвет]. */
function isDateFormatCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(bare) && !/[#0?]/.test(bare.replace(/[dmyhs]/gi, ''));
}

/** Индексы стилей ячеек (s="N"), у которых формат — дата. */
function dateStyles(xml: string | undefined): Set<number> {
  const result = new Set<number>();
  if (!xml) return result;
  const custom = new Map<number, string>();
  let inCellXfs = false;
  let xfIndex = 0;
  for (const tok of tokens(xml)) {
    if (typeof tok === 'string') continue;
    if (tok.local === 'numFmt' && !tok.close) {
      const id = Number(attr(tok.attrs, 'numFmtId'));
      const code = attr(tok.attrs, 'formatCode');
      if (Number.isFinite(id) && code) custom.set(id, code);
    } else if (tok.local === 'cellXfs') {
      inCellXfs = !tok.close && !tok.selfClose;
    } else if (inCellXfs && tok.local === 'xf' && !tok.close) {
      const id = Number(attr(tok.attrs, 'numFmtId') ?? 0);
      const code = custom.get(id);
      if (BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && isDateFormatCode(code))) result.add(xfIndex);
      xfIndex++;
    }
  }
  return result;
}

/** Порядковый номер дня Excel (система 1900) → «2026-10-25» (+ время, если есть). */
function excelDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Math.round((serial - 25569) * 86_400_000); // 25569 = 1970-01-01
  const iso = new Date(ms).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

function sheetRows(xml: string, shared: string[], dates: Set<number>): string[] {
  const lines: string[] = [];
  let row: string[] | null = null;
  let cellCol = 0;
  let nextCol = 0;
  let cellType = '';
  let cellStyle = -1;
  let value: string[] | null = null; // текст <v> или <is><t>
  let inValue = false;
  let inInline = false;
  let rows = 0;

  const commitCell = () => {
    if (!row || !value) return;
    let text = value.join('');
    if (cellType === 's') text = shared[Number(text)] ?? '';
    else if (cellType === 'b') text = text === '1' ? 'TRUE' : 'FALSE';
    else if (!cellType || cellType === 'n') {
      if (dates.has(cellStyle)) text = excelDate(Number(text)) ?? text;
    }
    text = text.replace(/\s*\n\s*/g, ' ').trim();
    if (text) {
      while (row.length < cellCol) row.push('');
      row[cellCol] = text;
    }
  };

  for (const tok of tokens(xml)) {
    if (typeof tok === 'string') {
      if (value && (inValue || inInline)) value.push(decodeXml(tok));
      continue;
    }
    switch (tok.local) {
      case 'row':
        if (tok.close || tok.selfClose) {
          if (row && row.some(Boolean)) {
            lines.push(row.join(' | ').replace(/(?: \| )+$/, ''));
            rows++;
          }
          row = null;
          if (rows >= MAX_ROWS_PER_SHEET) return lines;
        } else {
          row = [];
          nextCol = 0;
        }
        break;
      case 'c':
        if (tok.close) {
          commitCell();
          value = null;
        } else {
          const ref = attr(tok.attrs, 'r');
          cellCol = (ref ? columnIndex(ref) : null) ?? nextCol;
          nextCol = cellCol + 1;
          cellType = attr(tok.attrs, 't') ?? '';
          cellStyle = Number(attr(tok.attrs, 's') ?? -1);
          value = tok.selfClose ? null : [];
        }
        break;
      case 'v':
        inValue = !tok.close && !tok.selfClose;
        break;
      case 'is':
        inInline = !tok.close && !tok.selfClose;
        break;
      default:
        break;
    }
  }
  return lines;
}

export function xlsxToText(buffer: Buffer): string | null {
  const parts = readZipParts(
    buffer,
    (n) =>
      n === 'xl/workbook.xml' ||
      n === 'xl/_rels/workbook.xml.rels' ||
      n === 'xl/sharedStrings.xml' ||
      n === 'xl/styles.xml' ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(n),
  );
  if (!parts || !parts.has('xl/workbook.xml')) return null;
  const shared = sharedStrings(parts.get('xl/sharedStrings.xml'));
  const dates = dateStyles(parts.get('xl/styles.xml'));
  const rels = relationships(parts.get('xl/_rels/workbook.xml.rels'));

  // Листы в порядке книги (а не по номеру файла — его Excel не переименовывает).
  const sheets: { name: string; path: string; hidden: boolean }[] = [];
  for (const tok of tokens(parts.get('xl/workbook.xml') ?? '')) {
    if (typeof tok === 'string' || tok.close || tok.local !== 'sheet') continue;
    const target = rels.get(relId(tok.attrs) ?? '');
    if (!target) continue;
    sheets.push({
      name: attr(tok.attrs, 'name') ?? '',
      path: resolveTarget('xl', target),
      hidden: (attr(tok.attrs, 'state') ?? 'visible') !== 'visible',
    });
  }
  if (!sheets.length) {
    for (const name of [...parts.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => partNumber(a) - partNumber(b))) {
      sheets.push({ name: `Sheet${partNumber(name)}`, path: name, hidden: false });
    }
  }

  const out: string[] = [];
  let size = 0;
  for (const sheet of sheets) {
    const xml = parts.get(sheet.path);
    if (!xml) continue;
    const rows = sheetRows(xml, shared, dates);
    if (!rows.length) continue;
    const block = `## Лист: ${sheet.name}${sheet.hidden ? ' (скрытый)' : ''}\n${rows.join('\n')}`;
    out.push(block);
    size += block.length;
    if (size > MAX_CHARS) break;
  }
  const text = out.join('\n\n').slice(0, MAX_CHARS).trim();
  return text || null;
}

// ── PowerPoint ─────────────────────────────────────────────────────────────

function slideParagraphs(xml: string): string[] {
  const lines: string[] = [];
  let para: string[] | null = null;
  let inText = false;
  for (const tok of tokens(xml)) {
    if (typeof tok === 'string') {
      if (para && inText) para.push(decodeXml(tok));
      continue;
    }
    if (tok.local === 'p' && tok.prefix === 'a') {
      if (tok.selfClose) continue;
      if (tok.close) {
        const line = (para ?? []).join('').replace(/[ \t]+/g, ' ').trim();
        if (line) lines.push(line);
        para = null;
      } else para = [];
    } else if (tok.local === 't' && tok.prefix === 'a') {
      inText = !tok.close && !tok.selfClose;
    } else if (tok.local === 'br' && tok.prefix === 'a' && para) {
      para.push('\n');
    } else if (tok.local === 'tab' && tok.prefix === 'a' && para) {
      para.push('\t');
    }
  }
  return lines;
}

export function pptxToText(buffer: Buffer): string | null {
  const parts = readZipParts(
    buffer,
    (n) => n === 'ppt/presentation.xml' || n === 'ppt/_rels/presentation.xml.rels' || /^ppt\/slides\/[^/]+\.xml$/.test(n),
  );
  if (!parts || !parts.has('ppt/presentation.xml')) return null;
  const rels = relationships(parts.get('ppt/_rels/presentation.xml.rels'));

  // Порядок показа — из списка слайдов презентации, а не по номеру файла.
  let order: string[] = [];
  for (const tok of tokens(parts.get('ppt/presentation.xml') ?? '')) {
    if (typeof tok === 'string' || tok.close || tok.local !== 'sldId') continue;
    const target = rels.get(relId(tok.attrs) ?? '');
    if (target) order.push(resolveTarget('ppt', target));
  }
  if (!order.length) {
    order = [...parts.keys()].filter((n) => n.startsWith('ppt/slides/')).sort((a, b) => partNumber(a) - partNumber(b));
  }

  const out: string[] = [];
  let size = 0;
  order.forEach((path, i) => {
    const xml = parts.get(path);
    if (!xml || size > MAX_CHARS) return;
    const lines = slideParagraphs(xml);
    const block = `## Слайд ${i + 1}${lines.length ? `\n${lines.join('\n')}` : ''}`;
    out.push(block);
    size += block.length;
  });
  const text = out.join('\n\n').slice(0, MAX_CHARS).trim();
  // Одни заголовки «## Слайд N» без текста — читать нечего.
  return text.replace(/^## Слайд \d+$/gm, '').trim() ? text : null;
}
