/** GET /signatures | POST /signatures — e-signature request tracking. */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest } from '../lib/errors.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { asObject, requireString } from '../lib/validate.ts';
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
      const recipients = await db.query<SignatureRecipient>(
        'SELECT name, email, signed FROM signature_recipients WHERE request_id = $1 ORDER BY ord',
        [row.id],
      );
      result.push({
        id: row.id,
        documentName: row.document_name,
        status: row.status,
        recipients: recipients.rows,
        sentAt: row.sent_at ? toIso(row.sent_at) : null,
      });
    }
    return result;
  });

  app.post('/signatures', { preHandler: [app.authenticate] }, async (req, reply): Promise<SignatureRequest> => {
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
    for (let i = 0; i < recipients.length; i++) {
      await db.query(
        'INSERT INTO signature_recipients (request_id, ord, name, email, signed) VALUES ($1, $2, $3, $4, false)',
        [id, i, recipients[i].name, recipients[i].email],
      );
    }
    await db.query(`INSERT INTO notifications (id, user_id, icon, title) VALUES ($1, $2, 'esign', $3)`, [
      newId('n'),
      req.currentUser.id,
      `${documentName}: отправлен на подпись`,
    ]);

    reply.code(201);
    return {
      id,
      documentName,
      status: 'Sent',
      recipients: recipients.map((r) => ({ ...r, signed: false })),
      sentAt: new Date().toISOString(),
    };
  });
}
