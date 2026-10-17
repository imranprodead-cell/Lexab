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
 *  - анализ распознавание не ждёт — оно идёт в фоне и пишет результат в базу;
 *  - «вечный pending» после перезапуска сервера снимается через 10 минут,
 *    неудача повторяется не чаще раза в час (иначе каждый вопрос в чате по
 *    нераспознаваемому скану стоил бы новых денег);
 *  - текст шифруется ключом ВЛАДЕЛЬЦА загрузки, как и текст обычных файлов.
 */
import type { Db } from '../db.ts';
import { transcribeScan } from '../llm.ts';
import { readFileBytes } from '../storage.ts';
import { encText } from './docCrypto.ts';

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
  let claimed: Claimed | undefined;
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
    claimed = res.rows[0];
  } catch (err) {
    log(`scan OCR claim failed for ${uploadId}: ${(err as Error).message}`);
    return false;
  }
  if (!claimed) return false;
  void runOcr(db, uploadId, claimed, opts.pdf ?? null, log);
  return true;
}

async function runOcr(db: Db, uploadId: string, claimed: Claimed, pdf: Buffer | null, log: (msg: string) => void) {
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
  } catch (err) {
    log(`scan OCR failed for ${uploadId}: ${(err as Error).message}`);
    await db
      .query(`UPDATE uploads SET ocr_status = 'failed' WHERE id = $1 AND ocr_status = 'pending'`, [uploadId])
      .catch(() => undefined);
  }
}
