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
import zlib from 'node:zlib';
import { badRequest } from './lib/errors.ts';

export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ≤ ~10 MB per the handoff
/** Cap on a docx's total DEcompressed size — a ZIP that expands past this is a
 *  decompression bomb (a few MB → many GB), so it's rejected before mammoth
 *  ever inflates it. Generous vs a real 10 MB contract (~12× ratio). */
const MAX_DECOMPRESSED_BYTES = 120 * 1024 * 1024;
/** Hard ceiling on extracted text length — bounds memory for any pathological
 *  input and is far above any real contract (~1M chars ≈ hundreds of pages). */
const MAX_TEXT_CHARS = 5_000_000;

/**
 * A docx IS a ZIP, so a decompression bomb (a few compressed MB → many GB) can
 * OOM-crash the process when mammoth inflates it. The ZIP's *declared* sizes are
 * attacker-controlled and cannot be trusted — so this ACTUALLY inflates each
 * stored stream with a hard per-run output ceiling (Node zlib `maxOutputLength`)
 * and returns the REAL total decompressed size, or `Infinity` the moment it
 * provably crosses the cap. Peak memory stays bounded (≤ the cap) because the
 * inflater aborts instead of allocating gigabytes.
 *
 * Returns `null` when the layout can't be parsed (ZIP64 / corruption) — the
 * caller then falls back to the raw 10 MB input cap. Fail-open on ambiguity is
 * deliberate: a parsing quirk must never reject a legitimate contract, while a
 * real bomb is still caught because inflation, not metadata, is what trips it.
 */
export function zipRealDecompressedSize(buffer: Buffer): number | null {
  const EOCD_SIG = 0x06054b50;
  const CD_SIG = 0x02014b50;
  const LOCAL_SIG = 0x04034b50;
  let eocd = -1;
  const from = Math.max(0, buffer.length - (22 + 0xffff));
  for (let i = buffer.length - 22; i >= from; i--) {
    if (i >= 0 && buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0 || eocd + 20 > buffer.length) return null;
  let offset = buffer.readUInt32LE(eocd + 16); // start of central directory
  const count = buffer.readUInt16LE(eocd + 10);
  if (offset === 0xffffffff || count === 0xffff) return null; // ZIP64 — bail out

  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CD_SIG) return null;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const localOff = buffer.readUInt32LE(offset + 42);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    if (compSize === 0xffffffff || localOff === 0xffffffff) return null; // ZIP64 entry

    // Find the compressed bytes via the local file header (its name/extra
    // lengths can differ from the central directory's).
    if (localOff + 30 > buffer.length || buffer.readUInt32LE(localOff) !== LOCAL_SIG) return null;
    const lNameLen = buffer.readUInt16LE(localOff + 26);
    const lExtraLen = buffer.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buffer.length) return null;

    if (method === 0) {
      total += compSize; // stored — output equals input
    } else if (method === 8) {
      const data = buffer.subarray(dataStart, dataStart + compSize);
      const budget = MAX_DECOMPRESSED_BYTES - total + 1; // enough to detect the crossing
      try {
        total += zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).length;
      } catch (err) {
        // Output exceeded the ceiling → it's a bomb (RangeError/ERR_BUFFER_TOO_LARGE).
        // Any other inflate error → treat as unparseable and fall back.
        if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          return Infinity;
        }
        return null;
      }
    } else {
      return null; // unknown compression method — don't guess
    }
    if (total > MAX_DECOMPRESSED_BYTES) return Infinity;
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

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
    // Reject a decompression bomb BEFORE mammoth inflates it (OOM protection).
    // This actually inflates (capped) rather than trusting declared sizes.
    const decompressed = zipRealDecompressedSize(buffer);
    if (decompressed !== null && decompressed > MAX_DECOMPRESSED_BYTES) {
      throw badRequest(
        'Файл слишком большой в распакованном виде (возможно, повреждён). / File is too large when decompressed.',
      );
    }
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value ? result.value.slice(0, MAX_TEXT_CHARS) : null;
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
      // scans yield empty/near-empty text; cap the rest to bound memory.
      return text && text.length > 20 ? text.slice(0, MAX_TEXT_CHARS) : null;
    } catch {
      return null;
    }
  }
  return null;
}
