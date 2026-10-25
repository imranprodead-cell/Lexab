/**
 * Таблица → настоящий файл Excel (.xlsx) и CSV — без сторонних «экселевских»
 * библиотек: у SheetJS версия в npm устарела и с уязвимостями, а формат
 * простой. Книга из одного листа: жирная закреплённая шапка, перенос текста,
 * ширина столбцов по содержимому, числа — числами.
 */
export interface SheetData {
  title: string;
  header: string[];
  rows: string[][];
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Экранирование для XML + выброс символов, запрещённых в XML 1.0. */
function esc(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A, B, …, Z, AA, AB … — буквы столбцов как в Excel. */
export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** «1 200 000», «15», «0,5», «-3.25» → число; «10 000 000 сум», «5%» — текст. */
export function asNumber(cell: string): number | null {
  const t = cell.trim().replace(/\s/g, ''); // \s ловит и неразрывный пробел
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function sheetName(title: string): string {
  const s = title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return s || 'Sheet1';
}

function sheetXml({ header, rows }: SheetData): string {
  const all = [header, ...rows];
  const widths = header.map((_, c) =>
    Math.min(60, Math.max(8, ...all.map((r) => Math.min(60, (r[c] ?? '').length + 2)))),
  );
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const body = all
    .map((r, ri) => {
      const cells = header
        .map((_, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          const v = r[ci] ?? '';
          if (!v) return '';
          const num = ri > 0 ? asNumber(v) : null;
          // Целые — с разделителем тысяч (стиль 3, «# ##0»), дроби — как есть.
          if (num !== null) return `<c r="${ref}" s="${Number.isInteger(num) ? 3 : 2}"><v>${num}</v></c>`;
          return `<c r="${ref}" t="inlineStr" s="${ri === 0 ? 1 : 2}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  return (
    XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`
  );
}

const STYLES =
  XML_HEAD +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F1EF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
  '</cellXfs></styleSheet>';

export async function buildXlsx(data: SheetData): Promise<Blob> {
  // jszip грузится только при скачивании — страницу чата не утяжеляет.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    XML_HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${esc(sheetName(data.title))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
  );
  zip.file('xl/styles.xml', STYLES);
  zip.file('xl/worksheets/sheet1.xml', sheetXml(data));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
}

/**
 * CSV для Excel: UTF-8 с BOM (иначе кириллица — «кракозябры»), CRLF.
 * Разделитель — «;» для языков, где Excel так ожидает (RU/DE/KK/UZ), иначе «,».
 */
export function toCsv({ header, rows }: SheetData, delimiter: ',' | ';'): Blob {
  const q = (v: string) => (/["\n\r,;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const text = [header, ...rows].map((r) => header.map((_, i) => q(r[i] ?? '')).join(delimiter)).join('\r\n');
  return new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
}

/** Текст для буфера обмена: столбцы через Tab — вставляется в Excel и Google Sheets по ячейкам. */
export function toTsv({ header, rows }: SheetData): string {
  return [header, ...rows].map((r) => header.map((_, i) => (r[i] ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
}

export function fileSafe(title: string, ext: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `Lexab — ${safe || 'export'}.${ext}`;
}
