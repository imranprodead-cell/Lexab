/**
 * PUBLIC e-signing (no account needed):
 *   GET  /sign/:token          — request details + document text for review
 *   POST /sign/:token { name } — capture the signature; Completed when all signed
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { decJsonFromJsonb, decText, decTextStrict } from '../lib/docCrypto.ts';
import { toIso } from '../lib/format.ts';
import { notify } from '../lib/notify.ts';
import { escapeMailHtml, mailLayout, sendMail } from '../mail.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { getUserByEmail } from '../plugins/auth.ts';
import { buildSimplePdf } from '../lib/pdf.ts';
import { saveFile } from '../storage.ts';
import type { DocBlock, Redline } from '../types.ts';

interface RecipientRow {
  id: number | string;
  request_id: string;
  name: string;
  email: string;
  signed: boolean;
  signed_at: Date | string | null;
  document_name: string;
  status: string;
  content_snapshot: string | null;
  document_id: string | null;
  owner_id: string;
  owner_name: string;
  owner_firm: string;
  owner_email: string;
}

async function findByToken(db: Db, token: string): Promise<RecipientRow | null> {
  const res = await db.query<RecipientRow>(
    `SELECT r.ord AS id, r.request_id, r.name, r.email, r.signed, r.signed_at,
            q.document_name, q.status, q.content_snapshot, q.document_id,
            u.id AS owner_id, u.name AS owner_name, u.firm AS owner_firm, u.email AS owner_email
     FROM signature_recipients r
     JOIN signature_requests q ON q.id = r.request_id
     JOIN users u ON u.id = q.user_id
     WHERE r.token = $1 AND q.created_at > now() - interval '30 days'`,
    [token],
  );
  return res.rows[0] ?? null;
}

/**
 * Render the owner's document text (redlines applied) for signing. Captured
 * ONCE at request creation into signature_requests.content_snapshot; the
 * GET/POST handlers serve that frozen snapshot so a signer can't be shown one
 * text and recorded as signing another. This live renderer is the fallback for
 * requests created before snapshots existed.
 */
export async function renderSignableText(db: Db, ownerId: string, fileName: string): Promise<string | null> {
  const a = await db.query<{ id: string; document_blocks: DocBlock[] | string }>(
    `SELECT id, document_blocks FROM analyses
     WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1`,
    [ownerId, fileName],
  );
  const row = a.rows[0];
  if (!row) return null;
  // Owner-key decryption: the token-holder route works because the SERVER holds
  // the master key — the signer needs no account.
  const blocks = (await decJsonFromJsonb(db, ownerId, row.document_blocks)) as DocBlock[] | null;
  if (blocks === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
  const redlines = await db.query<{ id: string; del_text: string; ins_text: string; status: Redline['status'] }>(
    'SELECT id, del_text, ins_text, status FROM redlines WHERE analysis_id = $1 ORDER BY ord',
    [row.id],
  );
  const byId = new Map<string, { del_text: string; ins_text: string; status: Redline['status'] }>();
  for (const r of redlines.rows) {
    const delText = await decText(db, ownerId, r.del_text);
    const insText = await decText(db, ownerId, r.ins_text);
    if (delText === null || insText === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
    byId.set(r.id, { del_text: delText, ins_text: insText, status: r.status });
  }
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      lines.push(`## ${block.text ?? ''}`);
      continue;
    }
    let text = '';
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') text += seg;
      else if ('redlineId' in seg) {
        const rl = byId.get(seg.redlineId);
        // Only ACCEPTED suggestions are applied; pending keeps the original —
        // nobody signs AI edits the owner has not approved.
        if (rl) text += rl.status === 'accepted' ? rl.ins_text : rl.del_text;
      } else {
        text += seg.text; // formatted run — plain text for the signing page
      }
    }
    lines.push(text);
  }
  return lines.join('\n\n');
}

export function signRoutes(app: FastifyInstance, db: Db): void {
  app.get('/sign/:token', async (req) => {
    const { token } = req.params as { token: string };
    const row = await findByToken(db, token);
    if (!row) throw notFound('Ссылка недействительна или запрос отозван');

    // First open moves the request from Sent to Viewed.
    if (row.status === 'Sent') {
      await db.query(`UPDATE signature_requests SET status = 'Viewed' WHERE id = $1 AND status = 'Sent'`, [
        row.request_id,
      ]);
    }

    return {
      documentName: row.document_name,
      ownerName: row.owner_name,
      ownerFirm: row.owner_firm,
      recipient: { name: row.name, email: row.email },
      signed: row.signed,
      signedAt: row.signed_at ? toIso(row.signed_at) : null,
      // A present-but-undecryptable snapshot must FAIL, not silently fall back
      // to a live render — the signer must see exactly the frozen text.
      documentText:
        row.content_snapshot !== null
          ? await decTextStrict(db, row.owner_id, row.content_snapshot)
          : await renderSignableText(db, row.owner_id, row.document_name),
    };
  });

  app.post('/sign/:token', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const body = asObject(req.body);
    const name = requireString(body, 'name', { min: 2, max: 200 });

    const row = await findByToken(db, token);
    if (!row) throw notFound('Ссылка недействительна или запрос отозван');
    if (row.signed) throw badRequest('Документ уже подписан этой ссылкой');

    // Atomic single-shot claim: the `AND signed = false` guard makes two
    // concurrent POSTs for the same token collapse to one — only the request
    // that flips the row proceeds; the loser gets 0 rows and stops, so the
    // completion side effects (emails/notifications) can't fire twice.
    const claimed = await db.query(
      `UPDATE signature_recipients SET signed = true, signed_at = now(), signature_name = $2
       WHERE token = $1 AND signed = false RETURNING ord`,
      [token, name],
    );
    if (claimed.rows.length === 0) throw badRequest('Документ уже подписан этой ссылкой');

    const left = await db.query<{ count: string | number }>(
      'SELECT count(*) AS count FROM signature_recipients WHERE request_id = $1 AND signed = false',
      [row.request_id],
    );
    const remaining = Number(left.rows[0]?.count ?? 0);

    // Frozen snapshot (or live-render fallback) of the signed text — computed
    // once, reused for the completion PDF below and the signer's emailed copy.
    // Подпись уже проставлена выше (атомарный claim) — нерасшифровываемый
    // снимок (ротация ключа, порча строки) НЕ должен ронять запрос: иначе
    // полностью подписанный запрос навсегда зависает без Completed. Честный
    // компромисс: завершаем без текста (PDF/письмо без тела, всё остальное —
    // статусы, уведомления, аудит — выполняется).
    let text: string | null = null;
    try {
      text =
        row.content_snapshot !== null
          ? await decTextStrict(db, row.owner_id, row.content_snapshot)
          : await renderSignableText(db, row.owner_id, row.document_name);
    } catch (err) {
      req.log.error(err, 'esign: frozen snapshot undecryptable — completing without the text body');
      try {
        text = await renderSignableText(db, row.owner_id, row.document_name);
      } catch {
        text = null;
      }
    }

    if (remaining === 0) {
      // Idempotent completion: if the two last signers POST at once, both can
      // observe remaining===0 — only the request that actually flips to
      // Completed runs the one-time side effects (PDF build, owner email,
      // notify, audit, document status), so nothing fires twice. Mirrors the
      // Dropbox Sign webhook path.
      const done = await db.query(
        `UPDATE signature_requests SET status = 'Completed' WHERE id = $1 AND status <> 'Completed' RETURNING id`,
        [row.request_id],
      );
      if (done.rows.length) {
        // Built-in (typed-name) flow: no provider produces a signed PDF, so we
        // generate one here and store its key in the SAME column the webhook
        // uses (signed_file_key) — that makes GET /signatures/:id/signed.pdf
        // work in the built-in mode. A PDF failure must NOT undo completion;
        // the request stays Completed and the download simply isn't offered.
        try {
          const signers = await db.query<{
            name: string;
            signature_name: string | null;
            signed_at: Date | string | null;
          }>(
            'SELECT name, signature_name, signed_at FROM signature_recipients WHERE request_id = $1 ORDER BY ord',
            [row.request_id],
          );
          const sections: { heading?: string; text?: string }[] = [];
          if (text) sections.push({ text });
          sections.push({ heading: 'Подписи / Signatures' });
          for (const s of signers.rows) {
            const who = s.signature_name ?? s.name;
            const when = s.signed_at ? toIso(s.signed_at) : '';
            sections.push({
              text: `${who}${when ? ` — ${when}` : ''} · подписано электронически / signed electronically`,
            });
          }
          const pdf = await buildSimplePdf(row.document_name, sections);
          const saved = await saveFile(pdf, `${row.document_name} (signed).pdf`, 'application/pdf');
          await db.query('UPDATE signature_requests SET signed_file_key = $2 WHERE id = $1', [
            row.request_id,
            saved.key,
          ]);
        } catch (err) {
          req.log.warn(err, 'esign: signed PDF generation failed — request stays Completed without a downloadable PDF');
        }
        // Mark THIS document signed — by id when the request is bound to one, so a
        // different document that merely shares the name isn't touched.
        if (row.document_id) {
          await db.query(`UPDATE documents SET status = 'Signed', updated_at = now() WHERE id = $1`, [row.document_id]);
        } else {
          await db.query(
            `UPDATE documents SET status = 'Signed', updated_at = now() WHERE user_id = $1 AND name = $2`,
            [row.owner_id, row.document_name],
          );
        }
        await audit(db, req, {
          type: 'signature.completed',
          teamOwnerId: row.owner_id,
          actorId: null,
          actorLabel: name,
          target: { type: 'document', id: row.document_id ?? undefined, label: row.document_name },
        });
        await notify(db, row.owner_id, 'esign', 'Все подписи получены', 'All signatures collected', {
          bodyRu: `${row.document_name} · последняя подпись: ${name}`,
          bodyEn: `${row.document_name} · last signed by ${name}`,
          action: { kind: 'open', data: '/signatures' },
        });
        // Email the owner that the document is fully signed.
        void sendMail({
          to: row.owner_email,
          subject: `Документ подписан: ${row.document_name}`,
          html: mailLayout(
            'Все подписи получены',
            `<p>Документ <strong>${escapeMailHtml(row.document_name)}</strong> подписан всеми получателями.</p>
             <p>Последняя подпись: <strong>${escapeMailHtml(name)}</strong>. Статус запроса в LexAI — «Completed».</p>`,
            'Открыть раздел «Подписи»',
            `${config.appBaseUrl}/signatures`,
          ),
        });
      }
    } else {
      await notify(db, row.owner_id, 'esign', 'Получена подпись', 'Signature received', {
        bodyRu: `${row.document_name} · ${name}`,
        bodyEn: `${row.document_name} · ${name}`,
        action: { kind: 'open', data: '/signatures' },
      });
    }

    // Signer's copy: confirmation + the EXACT text they agreed to (the frozen
    // snapshot computed above, not a possibly-since-edited live render).
    const docHtml = text
      ? `<div style="margin-top:14px;padding:16px 18px;border:1px solid #e6e3f2;border-radius:12px;background:#faf9fe;font-family:Georgia,serif;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#3b3552;">${escapeMailHtml(text.slice(0, 20000))}</div>`
      : '';
    void sendMail({
      to: row.email,
      subject: `Ваша подпись зафиксирована: ${row.document_name}`,
      html: mailLayout(
        'Вы подписали документ',
        `<p>Подтверждаем: <strong>${escapeMailHtml(name)}</strong>, вы подписали документ <strong>${escapeMailHtml(row.document_name)}</strong>, отправленный ${escapeMailHtml(row.owner_name)} (${escapeMailHtml(row.owner_firm)}).</p>
         <p>Дата и время подписи зафиксированы. Копия текста на момент подписания — ниже.</p>${docHtml}`,
      ),
    });

    // Registered signer: the confirmation also lands in their bell.
    const signerUser = await getUserByEmail(db, row.email.toLowerCase());
    if (signerUser) {
      await notify(db, signerUser.id, 'check', 'Ваша подпись зафиксирована', 'Your signature is recorded', {
        bodyRu: `${row.document_name} · копия отправлена на почту`,
        bodyEn: `${row.document_name} · a copy was emailed to you`,
      });
    }

    return { ok: true, remaining };
  });
}
