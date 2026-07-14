/**
 * DOCX paragraph builder for document export.
 *
 * mode='tracked' emits REAL Word tracked changes (w:ins / w:del) so the
 * counterparty can accept or reject each redline inside Word itself — the
 * table-stakes deliverable for legal work. mode='clean' produces the final
 * text with accepted changes applied (the old flatten behaviour).
 *
 * Redline → runs:
 *   pending  | accepted → DeletedTextRun(delText) + InsertedTextRun(insText)
 *                         (a proposed revision the recipient resolves in Word)
 *   rejected           → plain original text (the change was declined)
 * In clean mode: accepted → insText, everything else → original text.
 */
import { HeadingLevel, InsertedTextRun, DeletedTextRun, Paragraph, TextRun } from 'docx';
import type { DocBlock, Redline } from '../types.ts';

export type DocxMode = 'tracked' | 'clean';

const REVISION_AUTHOR = 'LexAI';

export function buildDocxParagraphs(
  docName: string,
  blocks: DocBlock[],
  redlines: Redline[],
  mode: DocxMode,
  revisionDate: string,
): Paragraph[] {
  const byId = new Map(redlines.map((r) => [r.id, r]));
  let revId = 1; // unique per revision within the document
  const paragraphs: Paragraph[] = [new Paragraph({ text: docName, heading: HeadingLevel.HEADING_1 })];

  for (const block of blocks) {
    if (block.type === 'heading') {
      paragraphs.push(
        new Paragraph({ text: block.text ?? '', heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }),
      );
      continue;
    }

    const children: (TextRun | InsertedTextRun | DeletedTextRun)[] = [];
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') {
        if (seg) children.push(new TextRun(seg));
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
        // pending or accepted → a real Word revision (deletion + insertion)
        if (rl.delText) {
          children.push(new DeletedTextRun({ text: rl.delText, id: revId++, author: REVISION_AUTHOR, date: revisionDate }));
        }
        if (rl.insText) {
          children.push(new InsertedTextRun({ text: rl.insText, id: revId++, author: REVISION_AUTHOR, date: revisionDate }));
        }
      }
    }
    paragraphs.push(new Paragraph({ children: children.length ? children : [new TextRun('')], spacing: { after: 160 } }));
  }
  return paragraphs;
}
