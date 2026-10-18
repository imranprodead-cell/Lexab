/**
 * Полный текст договора с принятыми правками — ОДНА логика для «чистого»
 * экспорта файлом и для «Весь договор» в рабочей области: что на экране, то и
 * в файле (аудит загрузок 2026-10-18 — раньше «Весь договор» показывал лишь
 * 0–5 пунктов, которые ИИ процитировал в разборе).
 */
import type { Db } from '../db.ts';
import type { DocBlock, Redline } from '../types.ts';
import { decJsonFromJsonb, decText } from './docCrypto.ts';
import { looksRussian } from './format.ts';
import { readableUploadText, type OcrStatus } from './ocr.ts';

export interface SourceText {
  /** Текст исходного файла (у PDF — без служебных пометок; у скана — null или распознанный ИИ). */
  text: string | null;
  ocrStatus: OcrStatus | null;
  /** Строка uploads, из которой сделан разбор (null — черновик из промпта или файл удалён). */
  uploadId: string | null;
}

/** Строка начинает новый абзац: номер пункта, значок списка, «Статья 5», ЗАГОЛОВОК. */
const BLOCK_START =
  /^(?:\d+(?:\.\d+)*[.)]\s|\d+(?:\.\d+)+\s|[а-яёa-z]\)\s|[IVXLC]+\.\s|[•▪◦●\-–—*]\s|(?:статья|глава|раздел|приложение|пункт|article|section|chapter|annex|appendix)\s+\S)/iu;

/**
 * Текст из PDF → абзацы. pdf-parse отдаёт ВИЗУАЛЬНЫЕ строки страницы, и в
 * скачанном договоре каждая строка становилась отдельным абзацем — в Word такой
 * файл не отредактировать (аудит загрузок 2026-10-18). Строки склеиваются
 * обратно осторожно: новый абзац — после КОРОТКОЙ строки (последняя строка
 * абзаца), перед номером пункта / значком / «Статья N» / заголовком ЗАГЛАВНЫМИ
 * и на пустой строке. Строки таблицы и реквизиты короткие — остаются строками.
 * Только для показа и экспорта: в модель идёт текст как есть.
 */
export function reflowPdfText(text: string): string {
  const lines = text.split('\n').map((l) => l.trim());
  const lengths = lines.filter(Boolean).map((l) => l.length).sort((a, b) => a - b);
  if (lengths.length < 4) return text;
  // «Полная» строка — длиннее большинства (короткие строки таблиц не тянут вниз).
  const full = lengths[Math.floor(lengths.length * 0.8)];
  const isHeading = (l: string) => l.length < full * 0.8 && /\p{Lu}/u.test(l) && l === l.toUpperCase();
  const paragraphs: string[] = [];
  let current = '';
  let prevEndsParagraph = false;
  let prevEndsSentence = false;
  for (const line of lines) {
    if (!line) {
      if (current) paragraphs.push(current);
      current = '';
      prevEndsParagraph = false;
      continue;
    }
    // Конец предложения на краю строки + заглавная/цифра дальше — тоже граница
    // (в худшем случае длинный абзац разделится на два по предложению).
    const startsSentence = prevEndsSentence && /^[\p{Lu}\d«"„(]/u.test(line);
    if (current && (prevEndsParagraph || startsSentence || BLOCK_START.test(line) || isHeading(line))) {
      paragraphs.push(current);
      current = '';
    }
    if (!current) current = line;
    else if (current.endsWith('\u00ad')) current = current.slice(0, -1) + line; // мягкий перенос — склеить слово
    else if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(line)) current += line; // «северо-» + «западный» — без пробела
    else current = `${current} ${line}`;
    prevEndsParagraph = line.length < full * 0.8 || isHeading(line);
    prevEndsSentence = /[.;:!?…»)]$/u.test(line);
  }
  if (current) paragraphs.push(current);
  return paragraphs.join('\n\n');
}

/**
 * Исходный текст файла, из которого сделан разбор: ТА САМАЯ загрузка
 * (analyses.upload_id). Для старых разборов без привязки — последняя загрузка
 * с тем же именем, как было раньше, но ТОЛЬКО если это разбор договора
 * (nameFallback): у договора, созданного по запросу, файла нет вовсе, и
 * одноимённая загрузка подсунула бы чужой текст вместо него.
 */
export async function loadSourceText(
  db: Db,
  ownerId: string,
  analysis: { fileName: string; uploadId: string | null; nameFallback: boolean },
): Promise<SourceText> {
  if (!analysis.uploadId && !analysis.nameFallback) return { text: null, ocrStatus: null, uploadId: null };
  const res = analysis.uploadId
    ? await db.query<{ id: string; extracted_text: string | null; ocr_status: OcrStatus | null }>(
        'SELECT id, extracted_text, ocr_status FROM uploads WHERE id = $1 AND user_id = $2',
        [analysis.uploadId, ownerId],
      )
    : await db.query<{ id: string; extracted_text: string | null; ocr_status: OcrStatus | null }>(
        'SELECT id, extracted_text, ocr_status FROM uploads WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1',
        [ownerId, analysis.fileName],
      );
  const row = res.rows[0];
  if (!row) return { text: null, ocrStatus: null, uploadId: null };
  const decrypted = row.extracted_text === null ? null : await decText(db, ownerId, row.extracted_text);
  const text = await readableUploadText(db, { id: row.id, fileName: analysis.fileName, stored: row.extracted_text }, decrypted);
  // Текстовый слой PDF — визуальные строки; распознанный ИИ текст скана уже по абзацам.
  const isPdfLayer = text !== null && row.ocr_status !== 'done' && /\.pdf$/i.test(analysis.fileName);
  return { text: isPdfLayer ? reflowPdfText(text) : text, ocrStatus: row.ocr_status, uploadId: row.id };
}

type AcceptableRedline = Pick<Redline, 'delText' | 'insText' | 'status'>;

// ── Поиск формулировки в тексте: пробелы — нестрого, время — линейное ──────
//
// Раньше формулировка искалась регулярным выражением «слово\s+слово…». На
// нарочно повторяющемся тексте такое выражение перебирает варианты часами и
// вешает сервер для всех; теперь пробелы схлопываются заранее, а поиск — KMP:
// один проход по тексту при любом содержимом. Смысл сравнения тот же: любой
// пробельный промежуток (перенос строки, двойной пробел, NBSP) = один пробел.

/** Тот же набор, что \s в регулярных выражениях JS. */
function isSpace(c: number): boolean {
  return (
    c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  );
}

/** Текст со схлопнутыми пробелами + откуда в исходнике каждый его символ
 *  (at[k] — начало k-го символа, at[flat.length] — конец текста). */
function collapseSpaces(text: string): { flat: string; at: Int32Array } {
  const flat = text.replace(/\s+/g, ' ');
  const at = new Int32Array(flat.length + 1);
  let i = 0;
  for (let k = 0; k < flat.length; k++) {
    at[k] = i;
    if (isSpace(text.charCodeAt(i))) while (i < text.length && isSpace(text.charCodeAt(i))) i++;
    else i++;
  }
  at[flat.length] = text.length;
  return { flat, at };
}

/** Начала вхождений needle в hay (без наложений), KMP — O(|hay| + |needle|). */
function findOccurrences(hay: string, needle: string, from = 0): Generator<number> {
  const m = needle.length;
  const fail = new Int32Array(m);
  for (let i = 1, k = 0; i < m; i++) {
    while (k > 0 && needle.charCodeAt(i) !== needle.charCodeAt(k)) k = fail[k - 1];
    if (needle.charCodeAt(i) === needle.charCodeAt(k)) k++;
    fail[i] = k;
  }
  return (function* () {
    for (let i = from, k = 0; i < hay.length; i++) {
      while (k > 0 && hay.charCodeAt(i) !== needle.charCodeAt(k)) k = fail[k - 1];
      if (hay.charCodeAt(i) === needle.charCodeAt(k)) k++;
      if (k === m) {
        yield i - m + 1;
        k = 0; // без наложений: следующее вхождение — после этого
      }
    }
  })();
}

/** Заменить ВСЕ вхождения формулировки (пробелы — нестрого). */
function replaceAllLoose(text: string, needle: string, replacement: string): { text: string; hit: boolean } {
  const pattern = needle.replace(/\s+/g, ' ');
  if (!pattern.trim()) return { text, hit: false };
  const { flat, at } = collapseSpaces(text);
  let out = '';
  let prev = 0;
  let hit = false;
  for (const start of findOccurrences(flat, pattern)) {
    out += text.slice(prev, at[start]) + replacement;
    prev = at[start + pattern.length];
    hit = true;
  }
  return hit ? { text: out + text.slice(prev), hit } : { text, hit };
}

/**
 * Применить каждую ПРИНЯТУЮ правку к полному тексту — так, чтобы старая
 * (рискованная) формулировка не уехала молча:
 *  • ВСЕ вхождения (а не первое) — повторённый пункт исправлен целиком;
 *  • пробелы сравниваются нестрого (\s+) — модель цитирует нормализованный
 *    текст, а извлечение из PDF/DOCX хранит переносы и двойные пробелы;
 *  • замена ФУНКЦИЕЙ — `$&`, `$$` в новой формулировке вставляются буквально.
 * Что не встало (пустой delText = чистая вставка, или формулировка не найдена
 * даже нестрого) — возвращается в `unapplied`, а не теряется без следа.
 */
export function applyAcceptedRedlines<R extends AcceptableRedline>(source: string, redlines: R[]): { text: string; unapplied: R[] } {
  const unapplied: R[] = [];
  let text = source;
  for (const r of redlines) {
    if (r.status !== 'accepted') continue;
    if (!r.delText.trim()) {
      unapplied.push(r);
      continue;
    }
    const replaced = replaceAllLoose(text, r.delText, r.insText);
    if (replaced.hit) text = replaced.text;
    else unapplied.push(r);
  }
  return { text, unapplied };
}

/** Видимая приписка к экспорту: правки, которые не удалось вставить в текст. */
export function unappliedNote(text: string, unapplied: AcceptableRedline[], unplacedEdits: ManualEdit[] = []): string {
  const items = [...unplacedEdits, ...unapplied.map((r) => ({ was: r.delText, now: r.insText }))];
  if (!items.length) return '';
  const ru = looksRussian(text);
  let note = ru
    ? '\n\n— Правки, которые не удалось автоматически вставить в исходный текст (внесите вручную):'
    : '\n\n— Edits that could not be merged into the source text automatically (apply manually):';
  for (const { was, now } of items) {
    if (!was.trim()) note += `\n• ${ru ? 'Добавить' : 'Add'}: «${now}»`;
    else if (!now.trim()) note += `\n• ${ru ? 'Удалить' : 'Remove'}: «${was}»`;
    else note += `\n• ${ru ? 'Было' : 'Was'}: «${was}» → ${ru ? 'Стало' : 'Now'}: «${now}»`;
  }
  return note;
}

// ── Ручные правки абзацев (аудит загрузок 2026-10-18) ─────────────────────

/** Ручная правка пункта, которую не удалось найти в полном тексте. */
export interface ManualEdit {
  was: string;
  now: string;
}

/** Текст пункта разбора «как в договоре»: на месте правки ИИ — исходная
 *  формулировка (delText), оформление — обычным текстом. */
export function blockSourceText(block: DocBlock, delTextById: Map<string, string>): string {
  if (block.type === 'heading') return (block.text ?? '').trim();
  return (block.segments ?? [])
    .map((seg) => (typeof seg === 'string' ? seg : 'redlineId' in seg ? (delTextById.get(seg.redlineId) ?? '') : seg.text))
    .join('')
    .trim();
}

/** Тексты пунктов до первой ручной правки (null — правок не было). */
export async function loadOriginalBlockTexts(db: Db, ownerId: string, analysisId: string): Promise<string[] | null> {
  const res = await db.query<{ original_blocks: unknown }>('SELECT original_blocks FROM analyses WHERE id = $1', [analysisId]);
  const raw = res.rows[0]?.original_blocks;
  if (raw === null || raw === undefined) return null;
  const value = await decJsonFromJsonb(db, ownerId, raw);
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Сопоставление пунктов «было → стало» (редактор не меняет число пунктов —
 *  тогда по номеру; иначе — по общей подпоследовательности неизменных). */
function alignBlocks(before: string[], after: string[]): [number | null, number | null][] {
  if (before.length === after.length) return before.map((_, i) => [i, i]);
  const n = before.length;
  const m = after.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = norm(before[i]) === norm(after[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const pairs: [number | null, number | null][] = [];
  const gapA: number[] = [];
  const gapB: number[] = [];
  // Внутри «окна» между неизменными пунктами пары — по сходству слов (а не по
  // порядку): вставленный заголовок не должен «забрать» правку соседнего пункта.
  const words = (s: string) => new Set(norm(s).toLowerCase().split(' ').filter(Boolean));
  const similarity = (x: string, y: string) => {
    const a = words(x);
    const b = words(y);
    let common = 0;
    for (const w of a) if (b.has(w)) common++;
    return a.size + b.size ? (2 * common) / (a.size + b.size) : 0;
  };
  const flush = () => {
    const usedB = new Set<number>();
    for (const ia of gapA) {
      let best: number | null = null;
      let bestScore = 0.3; // меньше — это уже другой пункт, а не правка этого
      for (const jb of gapB) {
        if (usedB.has(jb)) continue;
        const score = similarity(before[ia], after[jb]);
        if (score > bestScore) {
          best = jb;
          bestScore = score;
        }
      }
      if (best !== null) usedB.add(best);
      pairs.push([ia, best]);
    }
    for (const jb of gapB) if (!usedB.has(jb)) pairs.push([null, jb]);
    gapA.length = 0;
    gapB.length = 0;
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(before[i]) === norm(after[j])) {
      flush();
      pairs.push([i++, j++]);
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) gapA.push(i++);
    else gapB.push(j++);
  }
  while (i < n) gapA.push(i++);
  while (j < m) gapB.push(j++);
  flush();
  return pairs;
}

/**
 * Перенести ручные правки пунктов в полный текст договора: исходная редакция
 * каждого пункта ищется в ИСХОДНОМ тексте (пробелы — нестрого, первое
 * свободное вхождение), и все замены делаются разом — новая редакция одного
 * пункта не может «поймать» поиск другого. Что найти не удалось — в
 * `unplaced`, чтобы правка не пропала молча, а встала в список «внесите вручную».
 */
export function applyManualEdits(
  source: string,
  originalTexts: string[] | null,
  blocks: DocBlock[],
  delTextById: Map<string, string>,
): { text: string; unplaced: ManualEdit[] } {
  if (!originalTexts) return { text: source, unplaced: [] };
  const current = blocks.map((b) => blockSourceText(b, delTextById));
  const unplaced: ManualEdit[] = [];
  const { flat, at } = collapseSpaces(source);
  const claimed: { start: number; end: number; now: string }[] = [];
  for (const [a, b] of alignBlocks(originalTexts, current)) {
    const was = a === null ? '' : originalTexts[a];
    const now = b === null ? '' : current[b];
    if (norm(was) === norm(now)) continue;
    const pattern = norm(was);
    if (!pattern) {
      unplaced.push({ was: '', now });
      continue;
    }
    let place: { start: number; end: number } | null = null;
    for (const s of findOccurrences(flat, pattern)) {
      const e = s + pattern.length;
      if (!claimed.some((c) => s < c.end && e > c.start)) {
        place = { start: s, end: e };
        break;
      }
    }
    if (place) claimed.push({ ...place, now });
    else unplaced.push({ was, now });
  }
  // С конца к началу — индексы ещё не тронутых мест не сдвигаются.
  let text = source;
  for (const c of claimed.sort((x, y) => y.start - x.start)) {
    text = text.slice(0, at[c.start]) + c.now + text.slice(at[c.end]);
  }
  return { text, unplaced };
}

/**
 * Итоговый текст договора: исходный файл → ручные правки пунктов → принятые
 * правки ИИ. Одна точка для «Весь договор», экспорта и согласования.
 */
export async function finalContractText<R extends AcceptableRedline & { id: string }>(
  db: Db,
  ownerId: string,
  analysisId: string,
  source: string,
  blocks: DocBlock[],
  redlines: R[],
): Promise<{ text: string; unapplied: R[]; unplacedEdits: ManualEdit[] }> {
  const delTextById = new Map(redlines.map((r) => [r.id, r.delText]));
  const edited = applyManualEdits(source, await loadOriginalBlockTexts(db, ownerId, analysisId), blocks, delTextById);
  const merged = applyAcceptedRedlines(edited.text, redlines);
  return { text: merged.text, unapplied: merged.unapplied, unplacedEdits: edited.unplaced };
}
