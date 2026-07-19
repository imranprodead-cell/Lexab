/**
 * PDF writer for document/report export. Built on pdf-lib with embedded
 * Unicode fonts (Noto Sans + Noto Naskh Arabic, OFL — assets/fonts/), so
 * Cyrillic (RU/UZ/KZ) and Arabic render correctly. A4, regular + bold.
 * Арабские строки проходят contextual shaping (презентационные формы) и
 * выводятся в визуальном RTL-порядке с выравниванием вправо — см.
 * lib/arabicShaper.ts (pdf-lib сам этого не умеет).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { hasArabic, shapeArabic, toVisualRtl } from './arabicShaper.ts';

interface Section {
  heading?: string;
  text?: string;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const BODY_SIZE = 11;
const HEAD_SIZE = 13;
const TITLE_SIZE = 16;
const LINE_H = 16;
const MAX_W = PAGE_W - 2 * MARGIN;

interface Line {
  text: string;
  bold: boolean;
  size: number;
  gapBefore: number;
  /** Строка содержит арабский текст → шейпинг + RTL-отрисовка. */
  arabic?: boolean;
}

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');
let cachedFonts: { regular: Buffer; bold: Buffer } | null = null;
function loadFontBytes(): { regular: Buffer; bold: Buffer } | null {
  if (cachedFonts) return cachedFonts;
  try {
    cachedFonts = {
      regular: fs.readFileSync(path.join(FONT_DIR, 'NotoSans-Regular.ttf')),
      bold: fs.readFileSync(path.join(FONT_DIR, 'NotoSans-Bold.ttf')),
    };
    return cachedFonts;
  } catch {
    // Missing font files must not crash export — fall back to the built-in
    // Helvetica (Latin-only), which is exactly the old behaviour.
    return null;
  }
}

let cachedArabicFonts: { regular: Buffer; bold: Buffer } | null | undefined;
function loadArabicFontBytes(): { regular: Buffer; bold: Buffer } | null {
  if (cachedArabicFonts !== undefined) return cachedArabicFonts;
  try {
    cachedArabicFonts = {
      regular: fs.readFileSync(path.join(FONT_DIR, 'NotoNaskhArabic-Regular.ttf')),
      bold: fs.readFileSync(path.join(FONT_DIR, 'NotoNaskhArabic-Bold.ttf')),
    };
  } catch {
    cachedArabicFonts = null; // без файла арабские строки останутся как раньше
  }
  return cachedArabicFonts;
}

/** Word-wrap using the actual embedded-font metrics (not a fixed char width),
 *  so Cyrillic and mixed text wrap correctly. Long single words are hard-split. */
function wrap(text: string, font: PDFFont, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  const widthOf = (s: string) => font.widthOfTextAtSize(s, size);
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (widthOf(next) > MAX_W && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    // Hard-split a single word longer than the line.
    while (widthOf(current) > MAX_W && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && widthOf(current.slice(0, cut)) > MAX_W) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export async function buildSimplePdf(title: string, sections: Section[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const bytes = loadFontBytes();
  let regular: PDFFont;
  let bold: PDFFont;
  if (bytes) {
    // subset:false — полный шрифт (~0.5 МБ на начертание). Subset-режим
    // @pdf-lib/fontkit ТЕРЯЕТ глифы NotoSans при рендере (текстовый слой цел,
    // а на странице «выпавшие буквы») — воспроизведено на кириллице 2026-07-19.
    regular = await doc.embedFont(bytes.regular, { subset: false });
    bold = await doc.embedFont(bytes.bold, { subset: false });
  } else {
    regular = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }

  // Арабские шрифты встраиваются только когда в контенте есть арабский текст.
  const anyArabic = hasArabic(title) || sections.some((s) => hasArabic(s.heading ?? '') || hasArabic(s.text ?? ''));
  let arRegular: PDFFont | null = null;
  let arBold: PDFFont | null = null;
  if (anyArabic) {
    const arBytes = loadArabicFontBytes();
    if (arBytes) {
      arRegular = await doc.embedFont(arBytes.regular, { subset: false });
      arBold = await doc.embedFont(arBytes.bold, { subset: false });
    }
  }
  const fontFor = (isBold: boolean, arabic: boolean) =>
    arabic && arRegular && arBold ? (isBold ? arBold : arRegular) : isBold ? bold : regular;

  // В NotoNaskhArabic нет латинских глифов, поэтому смешанные строки рисуются
  // ПОСЕГМЕНТНО: арабские куски — арабским шрифтом, латиница/цифры — NotoSans.
  const AR_SEG = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
  const segment = (s: string): { text: string; ar: boolean }[] => {
    const segs: { text: string; ar: boolean }[] = [];
    for (const ch of s) {
      const ar = AR_SEG.test(ch);
      const last = segs[segs.length - 1];
      // Пробелы и простая пунктуация липнут к текущему сегменту; скобки,
      // тире и кавычки — всегда латинским шрифтом (в NotoNaskhArabic их
      // глифов нет: тофу с нулевой шириной → каскад наложений).
      if (last && (last.ar === ar || /[\s.,:;!?%'-]/.test(ch))) last.text += ch;
      else segs.push({ text: ch, ar: /[()\[\]{}<>«»"„“”—–…]/.test(ch) ? false : ar });
    }
    return segs;
  };
  const mixedWidth = (s: string, isBold: boolean, size: number): number =>
    segment(s).reduce((w, seg) => w + fontFor(isBold, seg.ar).widthOfTextAtSize(seg.text, size), 0);

  // Build the flat list of laid-out lines. Арабский текст шейпится ДО переноса
  // (соединение букв не пересекает пробелы, поэтому перенос по словам безопасен).
  const lines: Line[] = [];
  const pushWrapped = (text: string, isBold: boolean, size: number, firstGap: number, restGap = 0): void => {
    const arabic = hasArabic(text) && arRegular !== null;
    const shaped = arabic ? shapeArabic(text) : text;
    const measure = arabic
      ? ({ widthOfTextAtSize: (s: string, sz: number) => mixedWidth(s, isBold, sz) } as unknown as PDFFont)
      : fontFor(isBold, false);
    let first = true;
    for (const l of wrap(shaped, measure, size)) {
      lines.push({ text: l, bold: isBold, size, gapBefore: first ? firstGap : restGap, arabic });
      first = false;
    }
  };
  pushWrapped(title, true, TITLE_SIZE, 0);
  for (const section of sections) {
    if (section.heading) pushWrapped(section.heading, true, HEAD_SIZE, LINE_H, LINE_H);
    if (section.text) pushWrapped(section.text, false, BODY_SIZE, 6);
  }

  // Paginate + draw. Последней строке документа даётся «льгота» в одну строку
  // ниже поля — чтобы одинокое слово не уезжало на пустую страницу.
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const advance = line.gapBefore + LINE_H;
    const isLast = i === lines.length - 1;
    if (y - advance < MARGIN && !(isLast && y - advance >= MARGIN - LINE_H)) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    y -= advance;
    if (line.text) {
      const color = rgb(0.05, 0.05, 0.08);
      if (line.arabic && arRegular) {
        // RTL: визуальный порядок, посегментная отрисовка двумя шрифтами,
        // выравнивание по правому полю.
        const display = toVisualRtl(line.text);
        let x = MARGIN + Math.max(0, MAX_W - mixedWidth(display, line.bold, line.size));
        for (const seg of segment(display)) {
          const font = fontFor(line.bold, seg.ar);
          page.drawText(seg.text, { x, y, size: line.size, font, color });
          x += font.widthOfTextAtSize(seg.text, line.size);
        }
      } else {
        page.drawText(line.text, { x: MARGIN, y, size: line.size, font: fontFor(line.bold, false), color });
      }
    }
  }
  if (doc.getPageCount() === 0) doc.addPage([PAGE_W, PAGE_H]);

  // useObjectStreams:false keeps the PDF's cross-reference table and object
  // dictionaries uncompressed (readable), which the widest range of PDF tools
  // and archival workflows accept — a fair trade for a slightly larger file on
  // a short report.
  const out = await doc.save({ useObjectStreams: false });
  return Buffer.from(out);
}
