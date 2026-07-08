/**
 * Minimal PDF writer for the document-export endpoint — single font family
 * (Helvetica), A4, WinAnsi text only (non-encodable characters become '?').
 * Kept dependency-free on purpose; the frontend can also export locally.
 */

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

interface Line {
  text: string;
  bold: boolean;
  size: number;
  gapBefore: number;
}

function latin1(s: string): string {
  return s.replace(/[^\x20-\xFF]/g, '?');
}

function escPdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text: string, size: number): string[] {
  const maxChars = Math.floor((PAGE_W - 2 * MARGIN) / (size * 0.5));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function buildSimplePdf(title: string, sections: Section[]): Buffer {
  const lines: Line[] = [];
  for (const l of wrap(title, TITLE_SIZE)) lines.push({ text: l, bold: true, size: TITLE_SIZE, gapBefore: 0 });
  for (const section of sections) {
    if (section.heading) {
      for (const l of wrap(section.heading, HEAD_SIZE)) {
        lines.push({ text: l, bold: true, size: HEAD_SIZE, gapBefore: LINE_H });
      }
    }
    if (section.text) {
      let first = true;
      for (const l of wrap(section.text, BODY_SIZE)) {
        lines.push({ text: l, bold: false, size: BODY_SIZE, gapBefore: first ? 6 : 0 });
        first = false;
      }
    }
  }

  // Paginate.
  const pages: Line[][] = [];
  let page: Line[] = [];
  let y = PAGE_H - MARGIN;
  for (const line of lines) {
    const advance = line.gapBefore + LINE_H;
    if (y - advance < MARGIN && page.length) {
      pages.push(page);
      page = [];
      y = PAGE_H - MARGIN;
    }
    y -= advance;
    page.push(line);
  }
  if (page.length) pages.push(page);
  if (!pages.length) pages.push([{ text: '', bold: false, size: BODY_SIZE, gapBefore: 0 }]);

  // Object layout: 1 catalog, 2 pages, 3 F1, 4 F2, then [page, content] pairs.
  const objects: string[] = [];
  const pageObjNums = pages.map((_, i) => 5 + i * 2);
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  for (const pageLines of pages) {
    const ops: string[] = ['BT', `1 0 0 1 ${MARGIN} ${PAGE_H - MARGIN} Tm`];
    for (const line of pageLines) {
      ops.push(`0 ${-(line.gapBefore + LINE_H)} Td`);
      ops.push(`/${line.bold ? 'F2' : 'F1'} ${line.size} Tf`);
      ops.push(`(${escPdf(latin1(line.text))}) Tj`);
    }
    ops.push('ET');
    const stream = ops.join('\n');
    const pageNum = objects.length + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNum + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
