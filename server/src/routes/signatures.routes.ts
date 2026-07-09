/** GET /signatures | POST /signatures — e-signature request tracking. */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { badRequest } from '../lib/errors.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { assertFeature } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import type { SignatureRecipient, SignatureRequest } from '../types.ts';

interface RequestRow {
  id: string;
  document_name: string;
  status: SignatureRequest['status'];
  sent_at: Date | string | null;
}

export function signatureRoutes(app: FastifyInstance, db: Db): void {
  app.get('/signatures', { preHandler: [app.authenticate] }, async (req): Promise<SignatureRequest[]> => {
    const requests = await db.query<RequestRow>(
      `SELECT id, document_name, status, sent_at FROM signature_requests
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.currentUser.id],
    );
    const result: SignatureRequest[] = [];
    for (const row of requests.rows) {
      const recipients = await db.query<SignatureRecipient & { signed_at?: Date | string | null }>(
        'SELECT name, email, signed, token, signed_at FROM signature_recipients WHERE request_id = $1 ORDER BY ord',
        [row.id],
      );
      result.push({
        id: row.id,
        documentName: row.document_name,
        status: row.status,
        recipients: recipients.rows.map((r) => ({
          name: r.name,
          email: r.email,
          signed: r.signed,
          ...(r.token ? { token: r.token } : {}),
          ...(r.signed_at ? { signedAt: toIso(r.signed_at) } : {}),
        })),
        sentAt: row.sent_at ? toIso(row.sent_at) : null,
      });
    }
    return result;
  });

  app.post('/signatures', { preHandler: [app.authenticate] }, async (req, reply): Promise<SignatureRequest> => {
    await assertFeature(db, req.currentUser.id, 'signatures');
    const body = asObject(req.body);
    const documentName = requireString(body, 'documentName', { min: 1, max: 300 });
    const rawRecipients = body.recipients;
    if (!Array.isArray(rawRecipients) || rawRecipients.length === 0) {
      throw badRequest('Field "recipients" must be a non-empty array of { name, email }');
    }
    const recipients = rawRecipients.map((r, i) => {
      const obj = asObject(r, `recipients[${i}]`);
      return {
        name: requireString(obj, 'name', { min: 1, max: 200 }),
        email: requireString(obj, 'email', { min: 3, max: 320 }),
      };
    });

    const id = newId('s');
    await db.query(
      `INSERT INTO signature_requests (id, user_id, document_name, status, sent_at)
       VALUES ($1, $2, $3, 'Sent', now())`,
      [id, req.currentUser.id, documentName],
    );
    const tokens: string[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const token = crypto.randomBytes(24).toString('base64url');
      tokens.push(token);
      await db.query(
        'INSERT INTO signature_recipients (request_id, ord, name, email, signed, token) VALUES ($1, $2, $3, $4, false, $5)',
        [id, i, recipients[i].name, recipients[i].email, token],
      );
      const signUrl = `${config.appBaseUrl}/sign/${token}`;
      void sendMail({
        to: recipients[i].email,
        subject: `Подпишите документ: ${documentName}`,
        html: mailLayout(
          'Вас просят подписать документ',
          `<p><strong>${escapeMailHtml(req.currentUser.name)}</strong> (${escapeMailHtml(req.currentUser.firm)}) отправляет вам на подпись документ <strong>${escapeMailHtml(documentName)}</strong>.</p>
           <p>Откройте ссылку, просмотрите документ и подпишите — регистрация не нужна.</p>`,
          'Открыть и подписать',
          signUrl,
        ),
      });
      // Registered signers also get the request in their bell, with an Open button.
      const signerUser = await getUserByEmail(db, recipients[i].email.toLowerCase());
      if (signerUser && signerUser.id !== req.currentUser.id) {
        await notify(db, signerUser.id, 'esign', 'Вас просят подписать документ', 'Signature requested', {
          bodyRu: `${documentName} · от ${req.currentUser.name}`,
          bodyEn: `${documentName} · from ${req.currentUser.name}`,
          action: { kind: 'open', data: `/sign/${token}` },
        });
      }
    }
    await notify(db, req.currentUser.id, 'esign', 'Запрос на подпись отправлен', 'Signature request sent', {
      bodyRu: documentName,
      bodyEn: documentName,
      action: { kind: 'open', data: '/signatures' },
    });

    reply.code(201);
    return {
      id,
      documentName,
      status: 'Sent',
      recipients: recipients.map((r, i) => ({ ...r, signed: false, token: tokens[i] })),
      sentAt: new Date().toISOString(),
    };
  });
}
