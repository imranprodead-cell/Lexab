/**
 * Text extraction for uploaded contracts.
 * - .txt/.md      → UTF-8 text
 * - .docx         → свой разбор (lib/docxText.ts: номера пунктов, сноски, таблицы,
 *                   непринятые исправления обеими версиями), страховка — mammoth
 * - .pdf          → text layer via pdf-parse (digital PDFs). Scanned PDFs have
 *                   no text layer — those are still analysed by Claude, which
 *                   reads the pages visually (built-in OCR) when the PDF bytes
 *                   are passed as a native document block.
 * - .doc (Word 97–2003) → свой разбор (lib/docText.ts); под паролем или Word 6/95 —
 *                   понятный отказ «сохраните как .docx» сразу при загрузке
 */
import path from 'node:path';
import zlib from 'node:zlib';
import { badRequest } from './lib/errors.ts';
import { docxToText } from './lib/docxText.ts';
import { DocEncryptedError, docToText } from './lib/docText.ts';

export const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // ≤ ~10 MB per the handoff
/** Cap on a docx's total DEcompressed size — a ZIP that expands past this is a
 *  decompression bomb (a few MB → many GB), so it's rejected before mammoth
 *  ever inflates it. Generous vs a real 10 MB contract (~12× ratio). */
const MAX_DECOMPRESSED_BYTES = 120 * 1024 * 1024;
/** Hard ceiling on extracted text length — bounds memory for any pathological
 *  input and is far above any real contract (~1M chars ≈ hundreds of pages). */
const MAX_TEXT_CHARS = 5_000_000;
/** Служебная строка pdf-parse 2.x между страницами: «-- 2 of 5 --». */
const PDF_PAGE_MARKER = /^[ \t]*-- \d+ of (\d+) --[ \t]*$/gm;
/** Меньше букв на страницу в среднем — у PDF по сути нет текстового слоя:
 *  это скан, на котором есть разве что штамп сканера («Scanned with
 *  CamScanner») или номер страницы. Страница настоящего договора — сотни букв. */
const MIN_LETTERS_PER_PAGE = 40;

/** Сколько букв в тексте (без массива из миллионов совпадений). */
function countLetters(s: string): number {
  return s.replace(/[^\p{L}]+/gu, '').length;
}

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

/**
 * Текстовый слой PDF → текст для модели, или null, если это скан.
 *
 * pdf-parse 2.x по умолчанию вставляет между страницами «-- 1 of 2 --», и у
 * скана из 2+ страниц одни эти пометки проходили старый порог «> 20 символов»:
 * скан считался текстовым — распознавание не запускалось, чат, экспорт и
 * повторный анализ видели пустой договор. Поэтому пометки вырезаются, а скан
 * определяется по буквам на страницу. Принимает и текст, сохранённый в базе до
 * исправления (пометки внутри, число страниц берётся из них).
 */
export function usablePdfText(raw: string | null, pages?: number): string | null {
  if (raw === null) return null;
  let markedPages = 0;
  const text = raw
    .replace(PDF_PAGE_MARKER, (_line, total: string) => {
      markedPages = Math.max(markedPages, Number(total));
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const pageCount = Math.max(1, pages ?? markedPages);
  return countLetters(text) >= pageCount * MIN_LETTERS_PER_PAGE ? text : null;
}

/**
 * TXT без BOM: UTF-8, а если это не UTF-8 — старая кодировка Windows.
 * Блокнот, выгрузки из 1С и «Сохранить как текст» в старом Word пишут
 * кириллицу в Windows-1251; раньше такой файл читался как UTF-8 и вместо
 * договора модель получала сплошные «�����» (аудит загрузок 2026-10-18).
 * Западноевропейский текст (Windows-1252: «café», «Müller») отличается по
 * словам, где латиница смешалась с кириллицей, — у верной кодировки их нет.
 */
export function decodeTextWithoutBom(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    /* не UTF-8 — ниже старые кодировки Windows */
  }
  const cyrillic = new TextDecoder('windows-1251').decode(buffer);
  const latin = new TextDecoder('windows-1252').decode(buffer);
  const mixedWords = (s: string) => (s.match(/\p{L}+/gu) ?? []).filter((w) => /\p{Script=Latin}/u.test(w) && /\p{Script=Cyrillic}/u.test(w)).length;
  return mixedWords(latin) < mixedWords(cyrillic) ? latin : cyrillic;
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
    return decodeTextWithoutBom(buffer);
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
    // Свой разбор (docxText.ts) сохраняет номера пунктов, сноски, колонтитулы
    // и таблицы — mammoth всё это терял. mammoth остаётся страховкой: если в
    // нашем тексте заметно меньше букв, значит необычная разметка что-то
    // спрятала от разбора, и лучше прежний текст, чем неполный.
    let own: string | null = null;
    try {
      own = docxToText(buffer);
    } catch {
      own = null;
    }
    let plain: string | null = null;
    try {
      const mammoth = await import('mammoth');
      plain = (await mammoth.extractRawText({ buffer })).value || null;
    } catch {
      plain = null;
    }
    const text = own && (!plain || countLetters(own) >= countLetters(plain) * 0.97) ? own : plain;
    return text ? text.slice(0, MAX_TEXT_CHARS) : null;
  }
  if (ext === '.doc') {
    // Раньше .doc принимался, а текста из него не было: файл занимал место, а
    // анализ падал с неверным «похоже, PDF-скан». Теперь — текст, а если его
    // не достать, честный отказ сразу, с подсказкой, что сделать.
    let text: string | null = null;
    try {
      text = docToText(buffer);
    } catch (err) {
      if (err instanceof DocEncryptedError) {
        throw badRequest(
          'Файл .doc защищён паролем — снимите пароль в Word или сохраните документ без пароля как .docx. / ' +
            'The .doc file is password-protected — remove the password in Word or save it as .docx.',
        );
      }
      text = null;
    }
    if (!text?.trim()) {
      throw badRequest(
        'Не удалось прочитать этот файл .doc (очень старая версия Word 6/95 или файл повреждён) — откройте его в Word и сохраните как .docx. / ' +
          'Could not read this .doc file (Word 6/95 or a damaged file) — open it in Word and save it as .docx.',
      );
    }
    return text.slice(0, MAX_TEXT_CHARS);
  }
  if (ext === '.pdf') {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      // pageJoiner '' — без служебных «-- 1 of 2 --» между страницами.
      const result = await parser.getText({ pageJoiner: '' });
      await parser.destroy();
      // Скан (букв почти нет) → null; остальное — с потолком по памяти.
      const text = usablePdfText(result.text ?? '', result.total);
      return text === null ? null : text.slice(0, MAX_TEXT_CHARS);
    } catch {
      return null;
    }
  }
  return null;
}
