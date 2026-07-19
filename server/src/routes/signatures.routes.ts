/** GET /signatures | POST /signatures — e-signature request tracking. */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { encText } from '../lib/docCrypto.ts';
import { attachmentDisposition, toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { dropboxSignEnabled, downloadSignedPdf, sendSignatureRequest, verifyWebhook } from '../lib/esign.ts';
import { assertFeature } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import { renderSignableText } from './sign.routes.ts';
import { activeStorageBackend, readFileBytes, saveFile } from '../storage.ts';
import type { SignatureRecipient, SignatureRequest } from '../types.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RequestRow {
  id: string;
  document_name: string;
  status: SignatureRequest['status'];
  sent_at: Date | string | null;
}

export function signatureRoutes(app: FastifyInstance, db: Db): void {
  /** Подписанный провайдером PDF: расшифровка через readFileBytes, только
   *  владельцу и только для завершённых запросов. */
  app.get('/signatures/:id/signed.pdf', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await db.query<{ signed_file_key: string | null; document_name: string; status: string }>(
      'SELECT signed_file_key, document_name, status FROM signature_requests WHERE id = $1 AND user_id = $2',
      [id, req.currentUser.id],
    );
    const sr = row.rows[0];
    if (!sr || sr.status !== 'Completed' || !sr.signed_file_key) {
      throw notFound('Подписанный PDF недоступен / Signed PDF is not available');
    }
    const bytes = await readFileBytes(activeStorageBackend(), sr.signed_file_key);
    await audit(db, req, {
      type: 'file.downloaded',
      target: { type: 'document', id, label: `${sr.document_name} (signed).pdf` },
    });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', attachmentDisposition(`${sr.document_name} (signed)`, 'pdf'));
    reply.header('Cache-Control', 'no-store');
    return reply.send(bytes);
  });

  app.get('/signatures', { preHandler: [app.authenticate] }, async (req): Promise<SignatureRequest[]> => {
    const requests = await db.query<RequestRow>(
      `SELECT id, document_name, status, sent_at FROM signature_requests
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.currentUser.id],
    );
    // All recipients in ONE query (was an N+1: one query per request row).
    const ids = requests.rows.map((r) => r.id);
    const recipients = ids.length
      ? await db.query<SignatureRecipient & { request_id: string; signed_at?: Date | string | null }>(
          `SELECT request_id, name, email, signed, token, signed_at FROM signature_recipients
           WHERE request_id = ANY($1::text[]) ORDER BY request_id, ord`,
          [ids],
        )
      : { rows: [] };
    const byRequest = new Map<string, (typeof recipients.rows)[number][]>();
    for (const r of recipients.rows) {
      const list = byRequest.get(r.request_id) ?? [];
      list.push(r);
      byRequest.set(r.request_id, list);
    }
    return requests.rows.map((row) => ({
      id: row.id,
      documentName: row.document_name,
      status: row.status,
      recipients: (byRequest.get(row.id) ?? []).map((r) => ({
        name: r.name,
        email: r.email,
        signed: r.signed,
        ...(r.token ? { token: r.token } : {}),
        ...(r.signed_at ? { signedAt: toIso(r.signed_at) } : {}),
      })),
      sentAt: row.sent_at ? toIso(row.sent_at) : null,
    }));
  });

  app.post('/signatures', { preHandler: [app.authenticate] }, async (req, reply): Promise<SignatureRequest> => {
    await assertFeature(db, req.currentUser.id, 'signatures');
    const body = asObject(req.body);
    const documentName = requireString(body, 'documentName', { min: 1, max: 300 });
    // The document must actually belong to the caller — don't let a free-text
    // name create a signature request for a document they don't own.
    const owned = await db.query<{ id: string }>(
      'SELECT id FROM documents WHERE user_id = $1 AND name = $2 ORDER BY updated_at DESC LIMIT 1',
      [req.currentUser.id, documentName],
    );
    if (!owned.rows[0]) {
      throw badRequest('Документ с таким названием не найден среди ваших. / No document of yours has that name.');
    }
    const documentId = owned.rows[0].id;
    // Freeze the exact reviewed text at send time — signers see/sign this, not a
    // version the owner might edit afterward (bait-and-switch prevention).
    const contentSnapshot = await renderSignableText(db, req.currentUser.id, documentName);
    // Stored encrypted (owner's key); the sign-by-token page decrypts server-side.
    const storedSnapshot = contentSnapshot === null ? null : await encText(db, req.currentUser.id, contentSnapshot);
    const rawRecipients = body.recipients;
    if (!Array.isArray(rawRecipients) || rawRecipients.length === 0) {
      throw badRequest('Field "recipients" must be a non-empty array of { name, email }');
    }
    const recipients = rawRecipients.map((r, i) => {
      const obj = asObject(r, `recipients[${i}]`);
      const email = requireString(obj, 'email', { min: 3, max: 320 });
      // Same format check as approvals/team — a malformed address would only
      // surface later as a silent mail-provider failure.
      if (!EMAIL_RE.test(email)) throw badRequest(`recipients[${i}].email is not a valid email address`);
      return {
        name: requireString(obj, 'name', { min: 1, max: 200 }),
        email,
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
          `INSERT INTO signature_requests (id, user_id, document_name, status, sent_at, provider, provider_request_id, content_snapshot, document_id)
           VALUES ($1, $2, $3, 'Sent', now(), 'dropbox_sign', $4, $5, $6)`,
          [id, req.currentUser.id, documentName, sent.requestId, storedSnapshot, documentId],
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
        `INSERT INTO signature_requests (id, user_id, document_name, status, sent_at, content_snapshot, document_id)
         VALUES ($1, $2, $3, 'Sent', now(), $4, $5)`,
        [id, req.currentUser.id, documentName, storedSnapshot, documentId],
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

    // Replay protection. Dropbox Sign's hash covers only (event_time+event_type),
    // NOT the signature_request_id — so a captured callback could be replayed,
    // or its request id swapped, to flip a different request. Reject stale
    // events to bound that window; completion below is additionally gated on the
    // provider's authoritative signed-PDF download (a replay for a request that
    // isn't really complete can't fetch a PDF, so it can't fake completion).
    const eventTs = Number(ev.event_time);
    if (!Number.isFinite(eventTs) || Math.abs(Math.floor(Date.now() / 1000) - eventTs) > 600) {
      req.log.warn('esign webhook: stale/invalid event_time — ignored');
      return reply.send('Hello API Event Received');
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
          // Authoritative gate: only the provider can serve the final signed PDF,
          // and only for a genuinely completed request. If we can't fetch it, we
          // do NOT flip our state on the say-so of a (possibly replayed) payload —
          // Dropbox Sign will retry the webhook when it's truly ready.
          let signedKey: string;
          try {
            const pdf = await downloadSignedPdf(sr.signature_request_id);
            signedKey = (await saveFile(pdf, `${request.document_name} (signed).pdf`, 'application/pdf')).key;
          } catch (err) {
            req.log.warn(err, 'esign: signed PDF unavailable — completion deferred');
            return reply.send('Hello API Event Received');
          }
          // Idempotent: only the first real completion transitions and notifies.
          const done = await db.query(
            "UPDATE signature_requests SET status = 'Completed', signed_file_key = $2 WHERE id = $1 AND status <> 'Completed' RETURNING id",
            [request.id, signedKey],
          );
          if (done.rows.length) {
            await notify(db, request.user_id, 'esign', 'Документ подписан', 'Document signed', {
              bodyRu: request.document_name,
              bodyEn: request.document_name,
              action: { kind: 'open', data: '/signatures' },
            });
          }
        }
      }
    }
    return reply.send('Hello API Event Received');
  });
}
