/**
 * POST /uploads — multipart `file` → { fileName, fileSize }.
 * POST /uploads/photos — фото договора (до 20 страниц) → один PDF-«скан».
 * GET /files/:key — serves locally stored uploads (decrypts via readFileBytes).
 * Provider URLs (Supabase/S3) are NEVER stored or returned: with encryption at
 * rest they point at the LEXAIENC1 ciphertext envelope — anyone opening one
 * would download a corrupt file. All byte-serving goes through our endpoints.
 */
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { ATTACHMENT_EXTENSIONS, assertValidFileContent, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { scanUpload } from '../lib/scan.ts';
import { assertStorageAllowance, featureLocked, planHasFeature, quotaOwnerFor, withStorageReservation } from '../lib/limits.ts';
import { MAX_PHOTO_BYTES, MAX_PHOTOS, photosToPdf } from '../lib/photos.ts';
import { encText } from '../lib/docCrypto.ts';
import { attachmentDisposition, formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { deleteFile, readFileBytes, saveFile, type StoredFile } from '../storage.ts';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv; charset=utf-8',
};

/** Все снимки одной загрузки вместе: 20 фото по 15 МБ держать в памяти нельзя,
 *  а реальный договор с телефона — это 20–80 МБ. */
const MAX_PHOTOS_TOTAL_BYTES = 100 * 1024 * 1024;

/** Имя документа из фото: клиент присылает локализованное «Фото договора …».
 *  Убираем разделители путей и управляющие символы, расширение — всегда .pdf. */
export function photoDocName(raw: string): string {
  const base = raw
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .replace(/\.(pdf|jpe?g|png|webp|heic|heif)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return `${base || `Photos ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-')}`}.pdf`;
}

/** Строка uploads для уже сохранённого файла — с резервом квоты хранилища
 *  (при сбое вставки файл удаляется, чтобы не осиротеть). */
async function recordUpload(
  db: Db,
  userId: string,
  file: { fileName: string; sizeBytes: number; mime: string | undefined; stored: StoredFile; text: string | null },
): Promise<string> {
  // Contract text is encrypted at rest with the owner's data key.
  const storedText = file.text === null ? null : await encText(db, userId, file.text);
  const id = newId('up');
  await withStorageReservation(
    db,
    userId,
    file.sizeBytes,
    (tx) =>
      tx
        .query(
          `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
          [id, userId, file.fileName, file.sizeBytes, file.mime, file.stored.storage, file.stored.key, storedText],
        )
        .then(() => undefined),
    () => deleteFile(file.stored.storage, file.stored.key),
  );
  return id;
}

export function uploadRoutes(app: FastifyInstance, db: Db): void {
  app.post(
    '/uploads',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!req.isMultipart()) throw badRequest('Expected multipart/form-data with a "file" field');
      const part = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!part) throw badRequest('Expected a multipart "file" field');

      const fileName = part.filename || 'document';
      const ext = fileExtension(fileName);
      if (!ATTACHMENT_EXTENSIONS.includes(ext)) {
        throw badRequest(`Unsupported file type. Allowed: ${ATTACHMENT_EXTENSIONS.join(', ')}`);
      }
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        throw badRequest('File exceeds the 10 MB limit');
      }
      assertValidFileContent(buffer, fileName);

      // Антивирус (clamd, если настроен): заражённый файл нельзя сохранять —
      // он будет отдан коллегам, согласующим и подписантам.
      const scan = await scanUpload(buffer);
      if (scan.status === 'infected') {
        await audit(db, req, {
          type: 'file.scan_failed',
          target: { type: 'upload', id: fileName, label: fileName },
          metadata: { signature: scan.signature ?? 'unknown' },
        });
        throw new HttpError(422, `Файл отклонён антивирусом (${scan.signature}). / File rejected by antivirus.`);
      }
      if (scan.status === 'clean') {
        await audit(db, req, {
          type: 'file.scan_passed',
          target: { type: 'upload', id: fileName, label: fileName },
          metadata: { bytes: buffer.length },
        });
      }

      await assertStorageAllowance(db, req.currentUser.id, buffer.length);
      const stored = await saveFile(buffer, fileName, part.mimetype);
      let text: string | null;
      try {
        text = await extractText(buffer, fileName);
      } catch (err) {
        // extractText can reject on a malformed / "bomb" file AFTER the bytes are
        // already saved. withStorageReservation only compensates an INSERT
        // failure, so delete the just-saved object here to avoid an orphan.
        await deleteFile(stored.storage, stored.key).catch(() => {});
        throw err;
      }
      const id = await recordUpload(db, req.currentUser.id, {
        fileName,
        sizeBytes: buffer.length,
        mime: part.mimetype,
        stored,
        text,
      });

      await audit(db, req, {
        type: 'file.uploaded',
        target: { type: 'document', id, label: fileName },
        metadata: { sizeBytes: buffer.length },
      });
      reply.code(201);
      return { id, fileName, fileSize: formatSize(buffer.length) };
    },
  );

  /**
   * Фото договора с телефона: снимки по порядку страниц → один PDF-«скан»,
   * дальше тот же путь, что у загруженного PDF (анализ читает его «глазами»).
   * Тариф проверяется ДО приёма файлов: бесплатному не нужно ждать загрузку
   * двадцати снимков ради отказа. Тариф — тот, по которому пойдёт анализ
   * (у участника платной команды — тариф владельца).
   *
   * Антивирус исходным снимкам не нужен: они не сохраняются вовсе, в хранилище
   * попадает только PDF из заново закодированных пикселей.
   */
  app.post(
    '/uploads/photos',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!req.isMultipart()) throw badRequest('Expected multipart/form-data with photo files');
      const { plan } = await quotaOwnerFor(db, req.currentUser.id);
      if (!planHasFeature(plan, 'scans')) throw featureLocked('scans', plan);

      const photos: { name: string; buffer: Buffer }[] = [];
      let requestedName = '';
      let total = 0;
      try {
        for await (const part of req.parts({ limits: { files: MAX_PHOTOS, fileSize: MAX_PHOTO_BYTES } })) {
          if (part.type === 'field') {
            if (part.fieldname === 'name' && typeof part.value === 'string') requestedName = part.value;
            continue;
          }
          const buffer = await part.toBuffer();
          total += buffer.length;
          if (total > MAX_PHOTOS_TOTAL_BYTES) {
            throw new HttpError(413, 'Фото слишком много по объёму — разделите договор на части. / The photos are too large in total.');
          }
          photos.push({ name: part.filename || `photo-${photos.length + 1}`, buffer });
        }
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'FST_FILES_LIMIT') {
          throw new HttpError(413, `Не больше ${MAX_PHOTOS} фото за раз. / At most ${MAX_PHOTOS} photos at a time.`);
        }
        if (code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new HttpError(413, 'Одно из фото больше 15 МБ. / One of the photos exceeds 15 MB.');
        }
        throw err;
      }

      const pdf = await photosToPdf(photos);
      const fileName = photoDocName(requestedName);
      await assertStorageAllowance(db, req.currentUser.id, pdf.length);
      const stored = await saveFile(pdf, fileName, 'application/pdf');
      const id = await recordUpload(db, req.currentUser.id, {
        fileName,
        sizeBytes: pdf.length,
        mime: 'application/pdf',
        stored,
        text: null,
      });
      await audit(db, req, {
        type: 'file.uploaded',
        target: { type: 'document', id, label: fileName },
        metadata: { sizeBytes: pdf.length, photos: photos.length },
      });
      reply.code(201);
      return { id, fileName, fileSize: formatSize(pdf.length), pages: photos.length };
    },
  );

  app.get('/files/:key', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const safe = path.basename(key);

    // Authorize before serving: the key must belong to an upload the caller owns
    // (or a teammate on a document shared from it). Without this, anyone holding
    // a (loggable, shareable) URL could download another tenant's contract.
    // Only 'local' storage is served here — S3/Supabase use provider signed URLs.
    const found = await db.query<{ id: string; user_id: string; file_name: string }>(
      `SELECT id, user_id, file_name FROM uploads WHERE storage = 'local' AND storage_key = $1`,
      [safe],
    );
    const upload = found.rows[0];
    if (!upload) throw notFound('File not found');
    if (upload.user_id !== req.currentUser.id) {
      // Доступ участника команды — по ИДЕНТИЧНОСТИ загрузки (analyses.upload_id),
      // а не по совпадению ИМЕНИ файла. Со сравнением имён участник, у которого
      // есть доступ к расшаренному «Договор.pdf» владельца, скачивал ЛЮБОЙ
      // приватный файл владельца с тем же именем (аудит 2026-08-03).
      const shared = await db.query(
        `SELECT 1 FROM analyses a
           JOIN documents d ON d.id = a.document_id
           JOIN team_members tm
             ON tm.owner_user_id = d.user_id AND tm.member_user_id = $1 AND tm.status = 'active'
          WHERE a.upload_id = $2 AND d.team_shared = true AND d.deleted_at IS NULL
          LIMIT 1`,
        [req.currentUser.id, upload.id],
      );
      if (shared.rows.length === 0) throw notFound('File not found');
    }

    // readFileBytes transparently decrypts the at-rest envelope (legacy
    // plaintext files pass through) — never serve ciphertext to the browser.
    let data: Buffer;
    try {
      data = await readFileBytes('local', safe);
    } catch {
      throw notFound('File not found');
    }
    const ext = fileExtension(safe);
    reply.header('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    // storage_key is sanitized to ASCII, so building the name from it hands a
    // Cyrillic document back as "_.pdf". Use the real uploads.file_name via
    // RFC 5987 (attachmentDisposition), keeping the inline disposition so PDFs
    // still preview in-browser.
    reply.header(
      'Content-Disposition',
      attachmentDisposition(upload.file_name, ext.replace(/^\./, '')).replace(/^attachment/, 'inline'),
    );
    reply.header('Cache-Control', 'no-store'); // расшифрованный контент не кэшируем
    return reply.send(data);
  });
}
