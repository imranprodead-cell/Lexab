/**
 * Вложения сообщений чата (2026-10-25).
 *
 * Файлы прикрепляются к полю ввода и уходят вместе с вопросом: модель
 * отвечает по их тексту, и следующие вопросы того же чата тоже видят их
 * (как в ChatGPT). Сам текст лежит в uploads, зашифрованный ключом владельца;
 * в сообщении хранятся только ссылки { uploadId, name, size }.
 *
 * Лимит за раз: Free — 2 файла, платные тарифы — 5. Объём текста для модели
 * ограничен общим бюджетом символов, который делится между файлами поровну:
 * пять договоров не раздувают стоимость ответа сверх одного большого.
 */
import type { Db } from '../db.ts';
import { decTextStrict } from './docCrypto.ts';
import { badRequest } from './errors.ts';
import { formatSize } from './format.ts';
import { planHasFeature } from './limits.ts';
import { readableUploadText, startScanOcr, type OcrStatus } from './ocr.ts';
import { canTranscribeScans } from '../llm.ts';

export interface StoredAttachment {
  uploadId: string;
  name: string;
  size: string;
}

/** Сколько файлов можно прикрепить к одному сообщению. */
export function maxAttachments(plan: string | null | undefined): number {
  return !plan || plan === 'Free' ? 2 : 5;
}

/** Сколько последних файлов чата модель видит в каждом ответе. */
export const MAX_CONTEXT_FILES = 5;
/** Бюджет символов на текст всех вложений (общий потолок контекста — 100k). */
export const ATTACHMENTS_BUDGET = 90_000;

/** uploadIds из тела запроса: массив строк-id, без повторов, не больше лимита тарифа. */
export function parseUploadIds(raw: unknown, plan: string | null | undefined): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string' || !v || v.length > 60)) {
    throw badRequest('uploadIds must be an array of upload ids');
  }
  const ids = [...new Set(raw as string[])];
  const max = maxAttachments(plan);
  if (ids.length > max) {
    throw badRequest(
      `Можно прикрепить не больше ${max} файлов к одному сообщению на вашем тарифе. / ` +
        `You can attach up to ${max} files per message on your plan.`,
    );
  }
  return ids;
}

/** Свои загрузки пользователя по id — в порядке запроса. Чужой или
 *  несуществующий id — 400: молча отвечать без файла нельзя (модель
 *  «ответила бы по договору», которого не видела). */
export async function loadOwnAttachments(db: Db, userId: string, ids: string[]): Promise<StoredAttachment[]> {
  if (!ids.length) return [];
  const res = await db.query<{ id: string; file_name: string; size_bytes: number | string }>(
    'SELECT id, file_name, size_bytes FROM uploads WHERE id = ANY($1::text[]) AND user_id = $2',
    [ids, userId],
  );
  const byId = new Map(res.rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw badRequest('Attached file not found — attach it again.');
    return { uploadId: row.id, name: row.file_name, size: formatSize(Number(row.size_bytes)) };
  });
}

/** Значение колонки attachments (jsonb приходит объектом, иногда строкой). */
export function readAttachmentsColumn(value: unknown): StoredAttachment[] {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.filter(
    (a): a is StoredAttachment =>
      !!a && typeof a === 'object' && typeof a.uploadId === 'string' && typeof a.name === 'string' && typeof a.size === 'string',
  );
}

/** Последние файлы чата: новые первыми, без повторов. */
export async function sessionAttachments(db: Db, sessionId: string): Promise<StoredAttachment[]> {
  const res = await db.query<{ attachments: unknown }>(
    `SELECT attachments FROM chat_messages
     WHERE session_id = $1 AND attachments IS NOT NULL
     ORDER BY created_at DESC`,
    [sessionId],
  );
  const seen = new Set<string>();
  const out: StoredAttachment[] = [];
  for (const row of res.rows) {
    for (const a of readAttachmentsColumn(row.attachments)) {
      if (seen.has(a.uploadId)) continue;
      seen.add(a.uploadId);
      out.push(a);
      if (out.length >= MAX_CONTEXT_FILES) return out;
    }
  }
  return out;
}

/**
 * Текст вложений для модели. Нет текста (скан без распознавания) — честная
 * пометка, чтобы модель не додумывала содержимое. Скан на тарифе с
 * распознаванием запускает его: этот ответ ещё без текста, следующий — с ним.
 */
export async function buildAttachmentsContext(
  db: Db,
  userId: string,
  attachments: StoredAttachment[],
  opts: { plan?: string; budget?: number; log?: (msg: string) => void } = {},
): Promise<string | undefined> {
  if (!attachments.length) return undefined;
  const budget = opts.budget ?? ATTACHMENTS_BUDGET;
  const perFile = Math.floor(budget / attachments.length);
  const blocks: string[] = [];
  for (const [i, a] of attachments.entries()) {
    const res = await db.query<{ id: string; extracted_text: string | null; ocr_status: OcrStatus | null }>(
      'SELECT id, extracted_text, ocr_status FROM uploads WHERE id = $1 AND user_id = $2',
      [a.uploadId, userId],
    );
    const row = res.rows[0];
    const header = `=== File ${i + 1}: ${a.name} (${a.size}) ===`;
    if (!row) {
      blocks.push(`${header}\n[The file was deleted — its contents are no longer available.]`);
      continue;
    }
    const decrypted = row.extracted_text === null ? null : await decTextStrict(db, userId, row.extracted_text);
    const text = await readableUploadText(db, { id: row.id, fileName: a.name, stored: row.extracted_text }, decrypted);
    if (text?.trim()) {
      const clean = text.trim();
      const shown = clean.length > perFile ? clean.slice(0, perFile) : clean;
      const cut =
        clean.length > perFile
          ? `\n[Text truncated: showing the first ${perFile} of ${clean.length} characters. Say so if the answer may depend on the rest.]`
          : '';
      blocks.push(`${header}\n${shown}${cut}`);
      continue;
    }
    let status = row.ocr_status;
    if (opts.plan && planHasFeature(opts.plan, 'scans') && canTranscribeScans()) {
      if (await startScanOcr(db, row.id, { log: opts.log })) status = 'pending';
    }
    blocks.push(
      `${header}\n` +
        (status === 'pending'
          ? '[Scanned file — its text is still being recognized. Say the text will be ready in about a minute; never invent its contents.]'
          : '[No readable text in this file (a scan without a text layer). Say so; never invent its contents.]'),
    );
  }
  return [
    `The user attached ${attachments.length === 1 ? 'a file' : `${attachments.length} files`} to this conversation (newest first). Answer from their contents and name the file you rely on.`,
    ...blocks,
  ].join('\n\n');
}
