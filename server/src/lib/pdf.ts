/**
 * PDF writer for document/report export. Built on pdf-lib with an embedded
 * Unicode font (Noto Sans, OFL — assets/fonts/), so Cyrillic (RU/UZ/KZ) and
 * other non-Latin text render correctly instead of turning into '?'. A4, single
 * font family (regular + bold). Arabic is out of scope for now (no PDF surface
 * emits it — UAE reports are in English); such glyphs fall back to the font's
 * default and are not shaped RTL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

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
  const fontFor = (isBold: boolean) => (isBold ? bold : regular);

  // Build the flat list of laid-out lines.
  const lines: Line[] = [];
  for (const l of wrap(title, bold, TITLE_SIZE)) lines.push({ text: l, bold: true, size: TITLE_SIZE, gapBefore: 0 });
  for (const section of sections) {
    if (section.heading) {
      for (const l of wrap(section.heading, bold, HEAD_SIZE)) {
        lines.push({ text: l, bold: true, size: HEAD_SIZE, gapBefore: LINE_H });
      }
    }
    if (section.text) {
      let first = true;
      for (const l of wrap(section.text, regular, BODY_SIZE)) {
        lines.push({ text: l, bold: false, size: BODY_SIZE, gapBefore: first ? 6 : 0 });
        first = false;
      }
    }
  }

  // Paginate + draw.
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  for (const line of lines) {
    const advance = line.gapBefore + LINE_H;
    if (y - advance < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    y -= advance;
    if (line.text) {
      page.drawText(line.text, { x: MARGIN, y, size: line.size, font: fontFor(line.bold), color: rgb(0.05, 0.05, 0.08) });
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
