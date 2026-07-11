/**
 * POST /feedback { message, page?, category?, attachments? } — product feedback
 * from the settings menu. Saved to user_feedback AND emailed to the founder
 * (config.contactEmail) with any screenshots attached.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { badRequest } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { asObject, optionalString, requireString } from '../lib/validate.ts';
import { escapeMailHtml, mailLayout, sendMail, type MailAttachment } from '../mail.ts';

/** Feedback categories offered by the form (legal-AI specific). */
const CATEGORIES: Record<string, string> = {
  general: 'Общие замечания',
  bug: 'Проблема или ошибка в работе',
  legal: 'Неточность в правовой информации',
  quality: 'Качество ответов ИИ',
  feature: 'Предложение функции',
  billing: 'Тарифы и оплата',
};

const MAX_FILES = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per screenshot
const MAX_TOTAL_BYTES = 8 * 1024 * 1024; // keep the JSON body under the 12 MB app limit

/** Allowed image types → canonical file extension (the ONLY source of the
 *  delivered extension, so an attacker-supplied name can't smuggle .svg/.html). */
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Verify the decoded bytes' magic number matches the declared image type —
 *  the declared MIME alone is attacker-controlled and not trustworthy. */
function magicMatches(type: string, buf: Buffer): boolean {
  if (buf.length < 12) return false;
  switch (type) {
    case 'image/png':
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/gif':
      return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38; // "GIF8"
    case 'image/webp':
      return (
        buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // "WEBP"
      );
    default:
      return false;
  }
}

/** Decoded byte length of a base64 string (accounts for '=' padding). */
function base64Bytes(data: string): number {
  const pad = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - pad;
}

/** Validate the attachments array from the request body → Resend format. */
function parseAttachments(raw: unknown): MailAttachment[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest('Field "attachments" must be an array');
  if (raw.length > MAX_FILES) throw badRequest(`No more than ${MAX_FILES} attachments`);
  let totalBytes = 0;
  return raw.map((item, i) => {
    const obj = asObject(item, `attachments[${i}]`);
    const type = requireString(obj, 'type', { max: 60 });
    const ext = IMAGE_EXT[type];
    if (!ext) throw badRequest('Attachments must be images (PNG, JPG, WebP, GIF)');
    const data = requireString(obj, 'data', { min: 4 });
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw badRequest(`attachments[${i}].data must be base64`);
    const bytes = base64Bytes(data);
    if (bytes > MAX_FILE_BYTES) throw badRequest('Each attachment must be at most 2 MB');
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw badRequest('Attachments must total at most 8 MB');
    // The declared MIME is attacker-controlled: verify the actual bytes are an image.
    if (!magicMatches(type, Buffer.from(data, 'base64'))) {
      throw badRequest(`attachments[${i}] is not a valid ${type} image`);
    }
    // The delivered extension ALWAYS comes from the validated MIME type — the
    // supplied name is reduced to a safe base and can never inject .svg/.html/.exe.
    const base = requireString(obj, 'name', { min: 1, max: 200 })
      .replace(/[/\\]/g, '_')
      .replace(/\.[^.]*$/, '') // drop the attacker's extension
      .replace(/[^\w\- ()Ѐ-ӿ]/g, '_')
      .slice(0, 80)
      .trim();
    return { filename: `${base || 'screenshot'}.${ext}`, content: data };
  });
}

export function feedbackRoutes(app: FastifyInstance, db: Db): void {
  app.post(
    '/feedback',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = asObject(req.body);
      const message = requireString(body, 'message', { min: 3, max: 2000 });
      const page = optionalString(body, 'page');
      const category = optionalString(body, 'category');
      // hasOwnProperty (not `in`): `in` matches inherited prototype keys like
      // "toString"/"__proto__", which would bypass the allowlist and crash below.
      if (category !== undefined && !Object.prototype.hasOwnProperty.call(CATEGORIES, category)) {
        throw badRequest(`Field "category" must be one of: ${Object.keys(CATEGORIES).join(', ')}`);
      }
      const attachments = parseAttachments(body.attachments);

      await db.query(
        `INSERT INTO user_feedback (id, user_id, user_email, message, page, category) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          newId('fb'),
          req.currentUser.id,
          req.currentUser.email,
          message,
          page?.slice(0, 200) ?? null,
          category ?? null,
        ],
      );

      // Deliver to the founder's inbox. Best effort: the feedback is already
      // stored, so a mail outage must not fail the request.
      const u = req.currentUser;
      const label = category ? CATEGORIES[category] : 'Без категории';
      const result = await sendMail({
        to: config.contactEmail,
        subject: `Отзыв LexAI: ${label} — ${u.name}`,
        html: mailLayout(
          'Новый отзыв о продукте',
          `<p><strong>${escapeMailHtml(u.name)}</strong>${u.firm ? ` из ${escapeMailHtml(u.firm)}` : ''} · <a href="mailto:${escapeMailHtml(u.email)}">${escapeMailHtml(u.email)}</a></p>
           <p>Тип: <strong>${escapeMailHtml(label)}</strong>${page ? ` · Страница: ${escapeMailHtml(page.slice(0, 200))}` : ''}${attachments.length ? ` · Вложений: ${attachments.length}` : ''}</p>
           <p style="white-space:pre-wrap;border-left:3px solid #8b7cf6;padding-left:12px;margin-top:14px;">${escapeMailHtml(message)}</p>`,
        ),
        attachments,
      });
      if (!result.sent) req.log.warn('feedback: email delivery failed (saved to DB)');

      reply.code(204);
    },
  );
}
