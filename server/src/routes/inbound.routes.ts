/**
 * POST /inbound/email — webhook for e-mail intake ("send a contract to
 * contracts@your-domain and it appears in LexAI, analysed").
 *
 * Provider-agnostic JSON shape (map your provider's inbound webhook to it):
 *   { "from": "user@firm.com", "subject": "...", "timestamp": 1700000000,
 *     "spf": "pass", "dkim": "pass",
 *     "attachments": [{ "filename": "NDA.pdf", "contentBase64": "..." }] }
 *
 * Security (defence in depth):
 *  - Enabled only when INBOUND_EMAIL_TOKEN is set; provider sends it as the
 *    `X-Inbound-Token` header (compared in constant time).
 *  - If INBOUND_EMAIL_SIGNING_SECRET is set, every call must carry a valid
 *    `X-Inbound-Signature` = HMAC-SHA256(`${timestamp}.${from}.${sha256(contents)}`)
 *    within a 5-minute window — so a LEAKED static token alone can't inject a
 *    document under a spoofed sender, and captured calls can't be replayed with
 *    swapped attachments.
 *  - If INBOUND_REQUIRE_SPF_DKIM=true, the provider-asserted DMARC result must
 *    be "pass" (DMARC is what enforces header-From alignment) — the routing
 *    `from` is only trusted after that.
 *  - Each attachment's bytes are validated against its extension.
 * The sender must match a registered user's email — otherwise the message is
 * acknowledged and dropped.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { ALLOWED_EXTENSIONS, extractText, fileExtension, MAX_UPLOAD_BYTES, verifyFileSignature } from '../extract.ts';
import { badRequest, HttpError, notFound, unauthorized } from '../lib/errors.ts';
import { encText } from '../lib/docCrypto.ts';
import { formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { withAiRequest, withStorageReservation } from '../lib/limits.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { generateAnalysis } from '../llm.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import { deleteFile, saveFile } from '../storage.ts';
import { persistAnalysis } from './analysis.routes.ts';

function headerStr(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function authResultPass(v: unknown): boolean {
  return typeof v === 'string' && v.trim().toLowerCase() === 'pass';
}

export function inboundRoutes(app: FastifyInstance, db: Db): void {
  app.post(
    '/inbound/email',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!config.inboundEmailToken) throw notFound('Inbound e-mail is not enabled');
      // Constant-time token compare — no timing oracle on the shared secret.
      if (!safeEqual(headerStr(req.headers['x-inbound-token']), config.inboundEmailToken)) {
        throw unauthorized('Invalid inbound token');
      }

      const body = asObject(req.body);
      const from = requireString(body, 'from', { min: 3, max: 320 }).toLowerCase();
      const attachments = body.attachments;
      if (!Array.isArray(attachments) || attachments.length === 0) {
        throw badRequest('No attachments in the message');
      }

      // Optional HMAC signature: proves the request came from OUR provider
      // mapping (not just someone who learned the static token) and pins it to
      // this sender + payload inside a 5-minute window (anti-spoof + anti-replay).
      if (config.inboundEmailSigningSecret) {
        const sig = headerStr(req.headers['x-inbound-signature']);
        const ts = Number(body.timestamp);
        if (!sig || !Number.isFinite(ts)) throw unauthorized('Missing inbound signature');
        if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) throw unauthorized('Inbound signature expired');
        const contentSha = crypto
          .createHash('sha256')
          .update(attachments.map((a) => String(a?.contentBase64 ?? '')).join('\n'))
          .digest('hex');
        const expected = crypto
          .createHmac('sha256', config.inboundEmailSigningSecret)
          .update(`${ts}.${from}.${contentSha}`)
          .digest('hex');
        if (!safeEqual(sig, expected)) throw unauthorized('Bad inbound signature');
      }

      // Optional sender-authentication gate. Require DMARC pass specifically —
      // it is the only result that guarantees the *header From* (which we route
      // on) is aligned with an authenticated domain. SPF authenticates only the
      // envelope sender, and DKIM only proves *some* domain signed it, so either
      // alone would let an attacker forge From: victim@firm.com.
      if (config.inboundRequireAuth && !authResultPass(body.dmarc)) {
        throw unauthorized('Sender authentication (DMARC alignment) did not pass');
      }

      const user = await getUserByEmail(db, from);
      if (!user) {
        // Unknown sender — acknowledge so the provider doesn't retry, do nothing.
        return reply.code(202).send({ status: 'ignored', reason: 'unknown sender' });
      }

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
        // Bytes must match the declared extension — a renamed binary/script must
        // never be stored as a "contract".
        if (!verifyFileSignature(buffer, fileName)) {
          results.push({ fileName, error: 'content does not match file type' });
          continue;
        }

        // Per-attachment isolation: one bad file (e.g. a scanned PDF the Free
        // DeepSeek path honestly 422s, OR a storage/AI quota 402) must not abort
        // the rest of the batch — report it like the other per-file errors.
        try {
          const stored = await saveFile(buffer, fileName);
          const text = await extractText(buffer, fileName);
          // Encrypted at rest with the inbound user's data key.
          const storedText = text === null ? null : await encText(db, user.id, text);
          // Storage counts against the plan quota, same as POST /uploads — a
          // rejected reservation deletes the just-saved bytes (no orphan).
          await withStorageReservation(
            db,
            user.id,
            buffer.length,
            (tx) =>
              tx
                .query(
                  `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
                   VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)`,
                  [newId('up'), user.id, fileName, buffer.length, stored.storage, stored.key, stored.url, storedText],
                )
                .then(() => undefined),
            () => deleteFile(stored.storage, stored.key),
          );

          const source = {
            fileName,
            fileSizeLabel: formatSize(buffer.length),
            sizeBytes: buffer.length,
            text,
            pdf: fileExtension(fileName) === '.pdf' ? buffer : null,
          };
          // AI usage counts against the monthly quota, same as the interactive
          // path — email intake must not be a free-analysis bypass.
          const analysis = await withAiRequest(db, user.id, async (plan) => {
            const gen = await generateAnalysis({ fileName, text: source.text, pdf: source.pdf, plan });
            return persistAnalysis(db, user.id, source, gen);
          });
          results.push({ fileName, analysisId: analysis.id });
        } catch (err) {
          req.log.warn(err, `inbound: analysis failed for ${fileName}`);
          // Only deliberate HttpErrors carry a message written for exposure
          // (incl. the 402 quota messages); anything else stays in the logs.
          results.push({ fileName, error: err instanceof HttpError ? err.message : 'analysis failed' });
        }
      }

      return reply.code(201).send({ status: 'processed', results });
    },
  );
}
