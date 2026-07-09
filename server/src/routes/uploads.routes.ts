/**
 * POST /uploads — multipart `file` → { fileName, fileSize, url }.
 * GET /files/:key — serves locally stored uploads (S3 objects are served by
 * S3 itself via the returned url).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { ALLOWED_EXTENSIONS, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { assertStorageAllowance } from '../lib/limits.ts';
import { formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { saveFile } from '../storage.ts';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

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
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw badRequest(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
      }
      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch {
        throw badRequest('File exceeds the 10 MB limit');
      }

      await assertStorageAllowance(db, req.currentUser.id, buffer.length);
      const stored = await saveFile(buffer, fileName, part.mimetype);
      const text = await extractText(buffer, fileName);
      const id = newId('up');
      await db.query(
        `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, req.currentUser.id, fileName, buffer.length, part.mimetype, stored.storage, stored.key, stored.url, text],
      );

      reply.code(201);
      return { id, fileName, fileSize: formatSize(buffer.length), url: stored.url };
    },
  );

  app.get('/files/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    const safe = path.basename(key);
    const filePath = path.join(config.dataDir, 'uploads', safe);
    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch {
      throw notFound('File not found');
    }
    const ext = fileExtension(safe);
    reply.header('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="${safe.split('__').slice(1).join('__') || safe}"`);
    return reply.send(data);
  });
}
