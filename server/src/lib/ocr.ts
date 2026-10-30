/**
 * Распознавание текста скана или фото договора — для чата, поиска и повторного
 * анализа (решение владельца 2026-10-17).
 *
 * Анализ скана на платном тарифе читает PDF «глазами», но всё остальное живёт
 * на uploads.extracted_text, а у скана он пуст: чат видел только итог разбора и
 * ключевые пункты. Поэтому при первом анализе (или первом вопросе в чате по
 * старому скану) дешёвая модель ОДИН РАЗ переписывает текст со страниц.
 *
 * Свойства:
 *  - ровно один запуск на загрузку: статус занимается атомарным UPDATE, второй
 *    анализ или вопрос в чате, пришедший в это время, ничего не запускает;
 *  - анализ на модели с «глазами» (Claude) распознавание не ждёт — оно идёт в
 *    фоне и пишет результат в базу; на текстовой модели (Free, DeepSeek) анализ
 *    сперва дожидается текста (transcribeScanNow) и разбирает уже его;
 *  - «вечный pending» после перезапуска сервера снимается через 10 минут,
 *    неудача повторяется не чаще раза в час (иначе каждый вопрос в чате по
 *    нераспознаваемому скану стоил бы новых денег);
 *  - текст шифруется ключом ВЛАДЕЛЬЦА загрузки, как и текст обычных файлов.
 */
import type { Db } from '../db.ts';
import { fileExtension, usablePdfText } from '../extract.ts';
import { transcribeScan } from '../llm.ts';
import { readFileBytes } from '../storage.ts';
import { decText, encText } from './docCrypto.ts';

/** Потолок текста — тот же, что у извлечения из файлов (extract.ts). */
const MAX_TEXT_CHARS = 5_000_000;
/** Меньше — значит, на страницах нет текста (фото не договора). */
const MIN_TEXT_CHARS = 20;

export type OcrStatus = 'pending' | 'done' | 'failed';

interface Claimed {
  user_id: string;
  storage: 's3' | 'local' | 'supabase';
  storage_key: string;
}

/**
 * Сохранённый текст загрузки → текст для модели. У PDF — без служебных пометок
 * страниц и null, если это по сути скан (usablePdfText). Многостраничные сканы,
 * загруженные до исправления, хранят «текст» из одних пометок «-- 1 of 2 --»:
 * такой мусор стирается из базы — распознавание ждёт extracted_text IS NULL и
 * иначе не запустилось бы для них никогда. Стирается только та самая
 * шифровка, что прочитана (гонка с распознаванием её не заденет).
 */
export async function readableUploadText(
  db: Db,
  upload: { id: string; fileName: string; stored: string | null },
  decrypted: string | null,
): Promise<string | null> {
  if (decrypted === null || fileExtension(upload.fileName) !== '.pdf') return decrypted;
  const text = usablePdfText(decrypted);
  if (text === null && upload.stored !== null) {
    await db
      .query('UPDATE uploads SET extracted_text = NULL WHERE id = $1 AND extracted_text = $2 AND ocr_status IS NULL', [
        upload.id,
        upload.stored,
      ])
      .catch(() => undefined);
  }
  return text;
}

/**
 * Запустить распознавание загрузки, если оно нужно и ещё не идёт. Возвращает
 * true, если запуск состоялся. Само распознавание идёт в фоне и никогда не
 * бросает наружу: сбой пишется в лог и в ocr_status='failed'.
 */
export async function startScanOcr(
  db: Db,
  uploadId: string,
  opts: { pdf?: Buffer | null; log?: (msg: string) => void } = {},
): Promise<boolean> {
  const log = opts.log ?? (() => undefined);
  const claimed = await claimOcr(db, uploadId, log);
  if (!claimed) return false;
  void runOcr(db, uploadId, claimed, opts.pdf ?? null, log);
  return true;
}

/** Сколько ждать распознавания той же загрузки, запущенного другим запросом. */
const WAIT_OTHER_OCR_MS = 3 * 60_000;
const POLL_MS = 1_500;

/**
 * Распознать скан и ДОЖДАТЬСЯ текста. Нужно тарифу, чья модель читает только
 * текст (Free на DeepSeek, решение владельца 2026-10-30): без распознанного
 * текста ей нечего разбирать. Если ту же загрузку уже распознаёт другой запрос
 * (вопрос в чате), ждём его результата, а не платим второй раз.
 * null — текста нет (сбой, пустые страницы, повтор раньше часа после сбоя):
 * анализ тогда честно отказывает, а не гадает.
 */
export async function transcribeScanNow(
  db: Db,
  uploadId: string,
  opts: { pdf?: Buffer | null; log?: (msg: string) => void } = {},
): Promise<string | null> {
  const log = opts.log ?? (() => undefined);
  const claimed = await claimOcr(db, uploadId, log);
  if (claimed) return runOcr(db, uploadId, claimed, opts.pdf ?? null, log);
  const deadline = Date.now() + WAIT_OTHER_OCR_MS;
  for (;;) {
    const row = (
      await db.query<{ user_id: string; extracted_text: string | null; ocr_status: OcrStatus | null }>(
        'SELECT user_id, extracted_text, ocr_status FROM uploads WHERE id = $1',
        [uploadId],
      )
    ).rows[0];
    if (!row) return null;
    if (row.ocr_status === 'done' && row.extracted_text !== null) return decText(db, row.user_id, row.extracted_text);
    if (row.ocr_status !== 'pending' || Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Атомарно занять распознавание загрузки. Строка — запуск наш; undefined — не нужен или уже идёт. */
async function claimOcr(db: Db, uploadId: string, log: (msg: string) => void): Promise<Claimed | undefined> {
  try {
    const res = await db.query<Claimed>(
      `UPDATE uploads SET ocr_status = 'pending', ocr_started_at = now()
        WHERE id = $1 AND extracted_text IS NULL AND lower(file_name) LIKE '%.pdf'
          AND (ocr_status IS NULL
               OR (ocr_status = 'pending' AND ocr_started_at < now() - interval '10 minutes')
               OR (ocr_status = 'failed' AND ocr_started_at < now() - interval '1 hour'))
        RETURNING user_id, storage, storage_key`,
      [uploadId],
    );
    return res.rows[0];
  } catch (err) {
    log(`scan OCR claim failed for ${uploadId}: ${(err as Error).message}`);
    return undefined;
  }
}

/** Распознать и сохранить. Возвращает текст или null при сбое; наружу не бросает. */
async function runOcr(
  db: Db,
  uploadId: string,
  claimed: Claimed,
  pdf: Buffer | null,
  log: (msg: string) => void,
): Promise<string | null> {
  try {
    const bytes = pdf ?? (await readFileBytes(claimed.storage, claimed.storage_key));
    const text = (await transcribeScan(bytes)).slice(0, MAX_TEXT_CHARS);
    const meaningful = text.replace(/\[(illegible|signature|stamp)\]/gi, '').trim();
    if (meaningful.length < MIN_TEXT_CHARS) throw new Error('no text recognized on the pages');
    const enc = await encText(db, claimed.user_id, text);
    await db.query(
      `UPDATE uploads SET extracted_text = $2, ocr_status = 'done'
        WHERE id = $1 AND ocr_status = 'pending' AND extracted_text IS NULL`,
      [uploadId, enc],
    );
    return text;
  } catch (err) {
    log(`scan OCR failed for ${uploadId}: ${(err as Error).message}`);
    await db
      .query(`UPDATE uploads SET ocr_status = 'failed' WHERE id = $1 AND ocr_status = 'pending'`, [uploadId])
      .catch(() => undefined);
    return null;
  }
}
