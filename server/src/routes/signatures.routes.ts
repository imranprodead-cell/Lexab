/** GET /signatures | POST /signatures — e-signature request tracking. */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { badRequest } from '../lib/errors.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { dropboxSignEnabled, downloadSignedPdf, sendSignatureRequest, verifyWebhook } from '../lib/esign.ts';
import { assertFeature } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import { readFileBytes, saveFile } from '../storage.ts';
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
    // The document must actually belong to the caller — don't let a free-text
    // name create a signature request for a document they don't own.
    const owned = await db.query('SELECT 1 FROM documents WHERE user_id = $1 AND name = $2 LIMIT 1', [
      req.currentUser.id,
      documentName,
    ]);
    if (!owned.rows[0]) {
      throw badRequest('Документ с таким названием не найден среди ваших. / No document of yours has that name.');
    }
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
    const withTokens = recipients.map((r, i) => ({ ...r, ord: i, token: crypto.randomBytes(24).toString('base64url') }));

    // ── Real e-signature via Dropbox Sign (when configured) ──────────────────
    // The provider hosts the signing page, emails the signers, and produces a
    // signed PDF + audit trail; our webhook updates status. Without a key we
    // fall through to the in-app typed-name simulation below.
    if (dropboxSignEnabled()) {
      const up = await db.query<{ storage: 's3' | 'local' | 'supabase'; storage_key: string; mime: string | null }>(
        'SELECT storage, storage_key, mime FROM uploads WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1',
        [req.currentUser.id, documentName],
      );
      if (!up.rows[0]) {
        throw badRequest('Файл документа не найден в хранилище — загрузите его снова. / Document file not found in storage.');
      }
      const fileBuffer = await readFileBytes(up.rows[0].storage, up.rows[0].storage_key);
      const sent = await sendSignatureRequest({
        title: documentName,
        subject: `Подпишите документ: ${documentName}`,
        message: `${req.currentUser.name} (${req.currentUser.firm}) отправляет вам документ на подпись.`,
        signers: recipients.map((r) => ({ name: r.name, email: r.email })),
        file: { name: documentName, buffer: fileBuffer, contentType: up.rows[0].mime ?? 'application/pdf' },
      });

      await db.withTx(async (tx) => {
        await tx.query(
          `INSERT INTO signature_requests (id, user_id, document_name, status, sent_at, provider, provider_request_id)
           VALUES ($1, $2, $3, 'Sent', now(), 'dropbox_sign', $4)`,
          [id, req.currentUser.id, documentName, sent.requestId],
        );
        for (const r of withTokens) {
          const sig = sent.signatures.find((s) => s.email.toLowerCase() === r.email.toLowerCase());
          await tx.query(
            'INSERT INTO signature_recipients (request_id, ord, name, email, signed, token, provider_signature_id) VALUES ($1, $2, $3, $4, false, $5, $6)',
            [id, r.ord, r.name, r.email, r.token, sig?.signatureId ?? null],
          );
        }
      });

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
        recipients: withTokens.map((r) => ({ name: r.name, email: r.email, signed: false, token: r.token })),
        sentAt: new Date().toISOString(),
      };
    }

    // ── In-app simulation (no provider key) ──────────────────────────────────
    // The request and all its recipient rows commit together, so a request can
    // never end up with only some of its signers. Emails/notifications follow.
    await db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO signature_requests (id, user_id, document_name, status, sent_at)
         VALUES ($1, $2, $3, 'Sent', now())`,
        [id, req.currentUser.id, documentName],
      );
      for (const r of withTokens) {
        await tx.query(
          'INSERT INTO signature_recipients (request_id, ord, name, email, signed, token) VALUES ($1, $2, $3, $4, false, $5)',
          [id, r.ord, r.name, r.email, r.token],
        );
      }
    });

    for (const r of withTokens) {
      const signUrl = `${config.appBaseUrl}/sign/${r.token}`;
      void sendMail({
        to: r.email,
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
      const signerUser = await getUserByEmail(db, r.email.toLowerCase());
      if (signerUser && signerUser.id !== req.currentUser.id) {
        await notify(db, signerUser.id, 'esign', 'Вас просят подписать документ', 'Signature requested', {
          bodyRu: `${documentName} · от ${req.currentUser.name}`,
          bodyEn: `${documentName} · from ${req.currentUser.name}`,
          action: { kind: 'open', data: `/sign/${r.token}` },
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
      recipients: withTokens.map((r) => ({ name: r.name, email: r.email, signed: false, token: r.token })),
      sentAt: new Date().toISOString(),
    };
  });

  /**
   * Dropbox Sign webhook (public — the provider calls it). The event's
   * `event_hash` is verified with our API key, so forged callbacks are
   * rejected. Dropbox Sign requires the exact body "Hello API Event Received".
   */
  app.post('/signatures/webhook', async (req, reply) => {
    // The event arrives as multipart/form-data with a `json` field.
    let payload = '';
    try {
      if (req.isMultipart()) {
        for await (const part of req.parts()) {
          if (part.type === 'field' && part.fieldname === 'json') payload = String(part.value);
        }
      }
    } catch (err) {
      req.log.warn(err, 'esign webhook parse failed');
    }
    if (!payload) return reply.send('Hello API Event Received');

    let event: {
      event?: { event_time?: string; event_type?: string; event_hash?: string };
      signature_request?: {
        signature_request_id?: string;
        is_complete?: boolean;
        signatures?: { signature_id?: string; status_code?: string }[];
      };
    };
    try {
      event = JSON.parse(payload);
    } catch {
      return reply.send('Hello API Event Received');
    }

    const ev = event.event ?? {};
    if (!verifyWebhook(ev.event_time ?? '', ev.event_type ?? '', ev.event_hash ?? '')) {
      req.log.warn('esign webhook: invalid event_hash — ignored');
      return reply.code(400).send('bad signature');
    }

    const sr = event.signature_request;
    if (sr?.signature_request_id) {
      const found = await db.query<{ id: string; user_id: string; document_name: string }>(
        'SELECT id, user_id, document_name FROM signature_requests WHERE provider_request_id = $1',
        [sr.signature_request_id],
      );
      const request = found.rows[0];
      if (request) {
        // Sync each signer's signed state from the event.
        for (const s of sr.signatures ?? []) {
          if (s.signature_id && s.status_code === 'signed') {
            await db.query(
              'UPDATE signature_recipients SET signed = true, signed_at = now() WHERE request_id = $1 AND provider_signature_id = $2',
              [request.id, s.signature_id],
            );
          }
        }
        if (sr.is_complete && ev.event_type === 'signature_request_all_signed') {
          let signedKey: string | null = null;
          try {
            const pdf = await downloadSignedPdf(sr.signature_request_id);
            const stored = await saveFile(pdf, `${request.document_name} (signed).pdf`, 'application/pdf');
            signedKey = stored.key;
          } catch (err) {
            req.log.warn(err, 'esign: signed PDF download/store failed');
          }
          await db.query("UPDATE signature_requests SET status = 'Completed', signed_file_key = $2 WHERE id = $1", [
            request.id,
            signedKey,
          ]);
          await notify(db, request.user_id, 'esign', 'Документ подписан', 'Document signed', {
            bodyRu: request.document_name,
            bodyEn: request.document_name,
            action: { kind: 'open', data: '/signatures' },
          });
        }
      }
    }
    return reply.send('Hello API Event Received');
  });
}
