/**
 * DOCX paragraph builder for document export.
 *
 * mode='tracked' emits REAL Word tracked changes (w:ins / w:del) so the
 * counterparty can accept or reject each redline inside Word itself — the
 * table-stakes deliverable for legal work. mode='clean' produces the final
 * text with accepted changes applied (the old flatten behaviour).
 *
 * User formatting from the in-app editor is honored: inline marks (bold/italic/
 * underline/strikethrough), hyperlinks, alignment, headings and bullet/numbered
 * lists all carry into the Word file. Redline runs themselves stay plain (a
 * tracked change is about wording, not styling).
 *
 * Redline → runs:
 *   pending  | accepted → DeletedTextRun(delText) + InsertedTextRun(insText)
 *   rejected           → plain original text (the change was declined)
 * In clean mode: accepted → insText, everything else → original text.
 */
import {
  AlignmentType,
  ExternalHyperlink,
  HeadingLevel,
  InsertedTextRun,
  DeletedTextRun,
  LevelFormat,
  Paragraph,
  TextRun,
} from 'docx';
import type { DocBlock, Redline, TextRun as ModelRun } from '../types.ts';

export type DocxMode = 'tracked' | 'clean';

const REVISION_AUTHOR = 'LexAI';
const NUMBERED_REF = 'lx-numbered';

/** Numbering config referenced by numbered-list paragraphs — pass to Document. */
export const DOCX_NUMBERING = {
  config: [
    {
      reference: NUMBERED_REF,
      levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }],
    },
  ],
};

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
};

/** One formatted run → a docx TextRun (or a hyperlink wrapping one). */
function runFrom(run: ModelRun): TextRun | ExternalHyperlink {
  const marks = new Set(run.marks ?? []);
  const opts = {
    text: run.text,
    bold: marks.has('b') || undefined,
    italics: marks.has('i') || undefined,
    strike: marks.has('s') || undefined,
    underline: marks.has('u') || run.href ? {} : undefined,
  };
  if (run.href) {
    return new ExternalHyperlink({ children: [new TextRun({ ...opts, style: 'Hyperlink' })], link: run.href });
  }
  return new TextRun(opts);
}

export function buildDocxParagraphs(
  docName: string,
  blocks: DocBlock[],
  redlines: Redline[],
  mode: DocxMode,
  revisionDate: string,
): Paragraph[] {
  const byId = new Map(redlines.map((r) => [r.id, r]));
  let revId = 1; // unique per revision within the document
  // Each run of consecutive numbered items gets its own numbering instance so a
  // second list restarts at 1 (matching the PDF export), instead of continuing.
  let numInstance = 0;
  const paragraphs: Paragraph[] = [new Paragraph({ text: docName, heading: HeadingLevel.HEADING_1 })];

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (block.type === 'numbered' && (bi === 0 || blocks[bi - 1].type !== 'numbered')) {
      numInstance++; // a new numbered list starts here
    }
    if (block.type === 'heading') {
      paragraphs.push(
        new Paragraph({
          text: block.text ?? '',
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          alignment: block.align ? ALIGN[block.align] : undefined,
          spacing: { before: 240, after: 120 },
        }),
      );
      continue;
    }

    const children: (TextRun | InsertedTextRun | DeletedTextRun | ExternalHyperlink)[] = [];
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') {
        if (seg) children.push(new TextRun(seg));
        continue;
      }
      if (!('redlineId' in seg)) {
        // A formatted text run.
        if (seg.text) children.push(runFrom(seg));
        continue;
      }
      const rl = byId.get(seg.redlineId);
      if (!rl) continue;

      if (mode === 'clean') {
        const text = rl.status === 'accepted' ? rl.insText : rl.delText;
        if (text) children.push(new TextRun(text));
        continue;
      }

      // tracked
      if (rl.status === 'rejected') {
        if (rl.delText) children.push(new TextRun(rl.delText));
      } else {
        if (rl.delText) {
          children.push(new DeletedTextRun({ text: rl.delText, id: revId++, author: REVISION_AUTHOR, date: revisionDate }));
        }
        if (rl.insText) {
          children.push(new InsertedTextRun({ text: rl.insText, id: revId++, author: REVISION_AUTHOR, date: revisionDate }));
        }
      }
    }

    paragraphs.push(
      new Paragraph({
        children: children.length ? children : [new TextRun('')],
        alignment: block.align ? ALIGN[block.align] : undefined,
        spacing: { after: 160 },
        ...(block.type === 'bullet' ? { bullet: { level: 0 } } : {}),
        ...(block.type === 'numbered' ? { numbering: { reference: NUMBERED_REF, level: 0, instance: numInstance } } : {}),
      }),
    );
  }
  return paragraphs;
}
