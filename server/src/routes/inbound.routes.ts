/**
 * POST /inbound/email — webhook for e-mail intake ("send a contract to
 * contracts@your-domain and it appears in LexAI, analysed").
 *
 * Provider-agnostic JSON shape (map your provider's inbound webhook to it):
 *   { "from": "user@firm.com", "subject": "...",
 *     "attachments": [{ "filename": "NDA.pdf", "contentBase64": "..." }] }
 *
 * Security: enabled only when INBOUND_EMAIL_TOKEN is set; the provider must
 * send it in the `X-Inbound-Token` header. The sender must match a registered
 * user's email — otherwise the message is acknowledged and dropped.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { ALLOWED_EXTENSIONS, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import { badRequest, notFound, unauthorized } from '../lib/errors.ts';
import { formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { planFor } from '../lib/limits.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { generateAnalysis } from '../llm.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import { saveFile } from '../storage.ts';
import { persistAnalysis } from './analysis.routes.ts';

export function inboundRoutes(app: FastifyInstance, db: Db): void {
  app.post(
    '/inbound/email',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!config.inboundEmailToken) throw notFound('Inbound e-mail is not enabled');
      if (req.headers['x-inbound-token'] !== config.inboundEmailToken) {
        throw unauthorized('Invalid inbound token');
      }

      const body = asObject(req.body);
      const from = requireString(body, 'from', { min: 3, max: 320 }).toLowerCase();
      const attachments = body.attachments;
      if (!Array.isArray(attachments) || attachments.length === 0) {
        throw badRequest('No attachments in the message');
      }

      const user = await getUserByEmail(db, from);
      if (!user) {
        // Unknown sender — acknowledge so the provider doesn't retry, do nothing.
        return reply.code(202).send({ status: 'ignored', reason: 'unknown sender' });
      }

      const plan = await planFor(db, user.id);
      const results: { fileName: string; analysisId?: string; error?: string }[] = [];
      for (const raw of attachments.slice(0, 3)) {
        const att = asObject(raw, 'attachment');
        const fileName = requireString(att, 'filename', { min: 1, max: 300 });
        if (!ALLOWED_EXTENSIONS.includes(fileExtension(fileName))) {
          results.push({ fileName, error: 'unsupported type' });
          continue;
        }
        const buffer = Buffer.from(requireString(att, 'contentBase64', { min: 4 }), 'base64');
        if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
          results.push({ fileName, error: 'empty or over 10 MB' });
          continue;
        }

        const stored = await saveFile(buffer, fileName);
        const text = await extractText(buffer, fileName);
        await db.query(
          `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
           VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)`,
          [newId('up'), user.id, fileName, buffer.length, stored.storage, stored.key, stored.url, text],
        );

        const source = {
          fileName,
          fileSizeLabel: formatSize(buffer.length),
          sizeBytes: buffer.length,
          text,
          pdf: fileExtension(fileName) === '.pdf' ? buffer : null,
        };
        // Per-attachment isolation: one bad file (e.g. a scanned PDF that the
        // Free-plan DeepSeek path honestly rejects with 422) must not abort
        // the rest of the batch — report it like the other per-file errors.
        try {
          const gen = await generateAnalysis({ fileName, text: source.text, pdf: source.pdf, plan });
          const analysis = await persistAnalysis(db, user.id, source, gen);
          results.push({ fileName, analysisId: analysis.id });
        } catch (err) {
          req.log.warn(err, `inbound: analysis failed for ${fileName}`);
          results.push({ fileName, error: err instanceof Error ? err.message : 'analysis failed' });
        }
      }

      return reply.code(201).send({ status: 'processed', results });
    },
  );
}
