/**
 * Text extraction for uploaded contracts.
 * - .txt/.md      → UTF-8 text
 * - .docx         → mammoth raw text
 * - .pdf          → text layer via pdf-parse (digital PDFs). Scanned PDFs have
 *                   no text layer — those are still analysed by Claude, which
 *                   reads the pages visually (built-in OCR) when the PDF bytes
 *                   are passed as a native document block.
 * - .doc (legacy) → unsupported; analysis proceeds from the file name only
 */
import path from 'node:path';

export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ≤ ~10 MB per the handoff

export function fileExtension(name: string): string {
  return path.extname(name).toLowerCase();
}

export async function extractText(buffer: Buffer, fileName: string): Promise<string | null> {
  const ext = fileExtension(fileName);
  if (ext === '.txt' || ext === '.md') {
    return buffer.toString('utf8');
  }
  if (ext === '.docx') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value || null;
    } catch {
      return null;
    }
  }
  if (ext === '.pdf') {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      await parser.destroy();
      const text = result.text?.trim();
      return text && text.length > 20 ? text : null; // scans yield empty/near-empty text
    } catch {
      return null;
    }
  }
  return null;
}
