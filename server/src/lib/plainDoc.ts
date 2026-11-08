/**
 * Документ из боковой панели чата (претензия, допсоглашение, протокол
 * разногласий) — простой текст, который ИИ пишет с лёгкой markdown-разметкой.
 * Раньше выгрузка в Word/PDF клала каждую строку абзацем как есть: таблица
 * протокола разногласий уходила рядами «| … | … |», заголовки — с «#»,
 * жирное — со «**». Здесь текст разбирается на заголовки, абзацы и таблицы,
 * и Word получает НАСТОЯЩУЮ таблицу (решение владельца 2026-10-31: протокол
 * разногласий подписывают и отправляют контрагенту именно в Word).
 */
import { BorderStyle, Document, HeadingLevel, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from 'docx';

export type PlainBlock =
  | { kind: 'heading'; text: string; level: 1 | 2 | 3 }
  | { kind: 'para'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] };

const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l) && (l.match(/\|/g) ?? []).length >= 3;
const isSeparator = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);

/** «| a | b \| c |» → ['a', 'b | c'] (экранированная \| остаётся в ячейке). */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

/** Текст документа → заголовки, абзацы (по строке) и таблицы. */
export function parsePlainDoc(content: string): PlainBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const out: PlainBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Таблица: строка-шапка, строка-разделитель «|---|---|», дальше строки.
    if (isTableLine(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && isTableLine(lines[j]); j++) {
        const r = cells(lines[j]);
        rows.push(header.map((_, k) => r[k] ?? ''));
      }
      out.push({ kind: 'table', header, rows });
      i = j - 1;
      continue;
    }
    const h = /^\s*(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      out.push({ kind: 'heading', text: h[2], level: h[1].length as 1 | 2 | 3 });
      continue;
    }
    out.push({ kind: 'para', text: line });
  }
  return out;
}

/** «**жирный**» → отрезки с пометкой жирности. «__» НЕ разметка: в договорах
 *  подчёркивания — поля для подписи и даты («___» ________ 2026 г.). */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length ? out : [{ text, bold: false }];
}

const stripBold = (text: string) => boldRuns(text).map((r) => r.text).join('');

const runs = (text: string, bold = false) => boldRuns(text).map((r) => new TextRun({ text: r.text, bold: bold || r.bold }));

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
/** Ширина текста страницы (A4, поля по 2,54 см) в twips; Letter чуть шире — влезет. */
const TEXT_WIDTH = 9000;

/** Ширины колонок по содержимому: «№» и короткие — узкие, текстовые — широкие.
 *  Точные ширины + фиксированная раскладка: проценты часть программ не понимает
 *  и сжимает колонки в нитку (видено в предпросмотре macOS 2026-10-31). */
export function columnWidths(t: { header: string[]; rows: string[][] }): number[] {
  const texts = (k: number) => [t.header[k], ...t.rows.map((r) => r[k] ?? '')].map((c) => stripBold(c.replace(/<br\s*\/?>/gi, ' ')));
  // Не уже самого длинного слова колонки (иначе шапка «Пункт» рвётся на «Пун-кт»):
  // ~130 twips на букву 11-го кегля + поля ячейки.
  const mins = t.header.map((_, k) => {
    const longest = Math.max(1, ...texts(k).flatMap((c) => c.split(/\s+/)).map((w) => Math.min(w.length, 18)));
    return Math.min(2400, Math.max(400, longest * 130 + 160));
  });
  // Остальное место — по объёму текста в колонке.
  const weights = t.header.map((_, k) => {
    const lens = texts(k).map((c) => c.length);
    return Math.min(Math.max(lens.reduce((a, b) => a + b, 0) / lens.length, 3), 80);
  });
  const minSum = mins.reduce((a, b) => a + b, 0);
  if (minSum >= TEXT_WIDTH) return mins.map((m) => Math.floor((m * TEXT_WIDTH) / minSum));
  const free = TEXT_WIDTH - minSum;
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  return mins.map((m, k) => Math.floor(m + (free * weights[k]) / wSum));
}

function docxTable(t: { header: string[]; rows: string[][] }): Table {
  const widths = columnWidths(t);
  // «<br>» в ячейке — перенос строки (так ИИ пишет многострочные ячейки).
  const cell = (text: string, header: boolean, k: number) =>
    new TableCell({
      width: { size: widths[k], type: WidthType.DXA },
      ...(header ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EDEDED' } } : {}),
      children: text.split(/<br\s*\/?>/i).map((part) => new Paragraph({ children: runs(part.trim(), header) })),
    });
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER },
    rows: [
      new TableRow({ tableHeader: true, children: t.header.map((h, k) => cell(h, true, k)) }),
      ...t.rows.map((r) => new TableRow({ children: r.map((c, k) => cell(c, false, k)) })),
    ],
  });
}

/** Word-документ: заголовок, абзацы с жирным, настоящие таблицы. */
export function plainDocToDocx(title: string, content: string): Document {
  const blocks = parsePlainDoc(content);
  // Документ сам начинается с того же заголовка — второй раз его не ставим.
  const first = blocks.find((b) => b.kind !== 'para' || b.text.trim());
  const norm = (x: string) => stripBold(x).replace(/\s+/g, ' ').trim().toLowerCase();
  const repeatsTitle = first !== undefined && first.kind !== 'table' && norm(first.text) === norm(title);
  const children: (Paragraph | Table)[] = repeatsTitle ? [] : [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 })];
  for (const b of blocks) {
    if (repeatsTitle && b === first) {
      children.push(new Paragraph({ children: runs(b.text, true), heading: HeadingLevel.HEADING_1 }));
      continue;
    }
    if (b.kind === 'heading') {
      children.push(new Paragraph({ children: runs(b.text, true), heading: b.level === 1 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3 }));
    } else if (b.kind === 'table') {
      children.push(docxTable(b));
      children.push(new Paragraph({ children: [] })); // отступ после таблицы
    } else {
      children.push(new Paragraph({ children: runs(b.text) }));
    }
  }
  return new Document({ sections: [{ children }] });
}

/** PDF: таблица — построчно «колонка: значение» (сборщик PDF таблиц не рисует). */
export function plainDocToPdfSections(content: string): { heading?: string; text?: string }[] {
  const out: { heading?: string; text?: string }[] = [];
  for (const b of parsePlainDoc(content)) {
    if (b.kind === 'heading') out.push({ heading: stripBold(b.text) });
    else if (b.kind === 'para') {
      if (b.text.trim()) out.push({ text: stripBold(b.text) });
    } else {
      for (const r of b.rows) {
        out.push({ heading: stripBold(`${b.header[0] ? `${b.header[0]} ` : ''}${r[0]}`.trim()) });
        for (let k = 1; k < b.header.length; k++) {
          const v = stripBold(r[k].replace(/<br\s*\/?>/gi, ' ')).trim();
          if (v) out.push({ text: `${stripBold(b.header[k])}: ${v}` });
        }
      }
    }
  }
  return out;
}
