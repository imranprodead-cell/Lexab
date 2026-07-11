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
import { badRequest } from './lib/errors.ts';

export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ≤ ~10 MB per the handoff

export function fileExtension(name: string): string {
  return path.extname(name).toLowerCase();
}

/** A byte-order mark identifies a legitimate text encoding (UTF-8/16/32) —
 *  UTF-16 text is full of NUL bytes but is perfectly valid. */
function hasBom(b: Buffer): boolean {
  return (
    (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) || // UTF-8
    (b[0] === 0xff && b[1] === 0xfe) || // UTF-16/32 LE
    (b[0] === 0xfe && b[1] === 0xff) // UTF-16 BE
  );
}

/** A .txt/.md file is treated as real text if it carries a text BOM, or has no
 *  NUL bytes in its head (a renamed binary payload does). */
function looksLikeText(buffer: Buffer): boolean {
  if (hasBom(buffer)) return true;
  return !buffer.subarray(0, 8192).includes(0x00);
}

/**
 * Verify a file's actual bytes match its declared extension by magic number —
 * the client-supplied filename/MIME is not trustworthy, so a renamed
 * executable/script must not be accepted as a contract.
 */
export function verifyFileSignature(buffer: Buffer, fileName: string): boolean {
  if (buffer.length === 0) return false;
  switch (fileExtension(fileName)) {
    case '.pdf':
      // Real readers scan the first bytes for "%PDF" rather than requiring it at
      // offset 0 (a leading BOM or whitespace is tolerated).
      return buffer.subarray(0, 1024).includes(Buffer.from('%PDF'));
    case '.docx': // ZIP container: "PK" + 03/05/07
      return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]);
    case '.doc': // legacy OLE compound file
      return buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
    case '.txt':
    case '.md':
      return looksLikeText(buffer);
    default:
      return false;
  }
}

/** Reject an upload whose bytes don't match its extension (400). */
export function assertValidFileContent(buffer: Buffer, fileName: string): void {
  if (!verifyFileSignature(buffer, fileName)) {
    throw badRequest(
      `Содержимое файла «${fileName}» не соответствует его расширению (${fileExtension(fileName)}). ` +
        `The file content does not match its ${fileExtension(fileName)} extension.`,
    );
  }
}

export async function extractText(buffer: Buffer, fileName: string): Promise<string | null> {
  const ext = fileExtension(fileName);
  if (ext === '.txt' || ext === '.md') {
    // Decode by BOM so a UTF-16 file (e.g. Windows Notepad "Unicode") isn't mangled.
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      // UTF-16 BE → swap to LE, then decode.
      const swapped = Buffer.from(buffer.subarray(2));
      swapped.swap16();
      return swapped.toString('utf16le');
    }
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
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
