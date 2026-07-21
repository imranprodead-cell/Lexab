/**
 * GET /documents (search/filter/sort/paginate, total via X-Total-Count)
 * GET /documents/:id | GET /documents/:id/versions
 * POST /documents/:id/export { format: 'docx' | 'pdf' } → binary download
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { buildDocxParagraphs, DOCX_NUMBERING, type DocxMode } from '../lib/docxExport.ts';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { deleteFile } from '../storage.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { decJsonFromJsonb, decText, encryptionEnabled } from '../lib/docCrypto.ts';
import { assertFeature } from '../lib/limits.ts';
import { canEdit, resolveDocumentAccess } from '../lib/teamAccess.ts';
import { attachmentDisposition, formatSize, looksRussian, toIso } from '../lib/format.ts';
import { buildSimplePdf } from '../lib/pdf.ts';
import { asObject, requireOneOf, requireString } from '../lib/validate.ts';
import { audit } from '../lib/audit.ts';
import type { ContractDocument, DocBlock, DocumentVersion, Redline } from '../types.ts';

interface DocumentRow {
  id: string;
  name: string;
  counterparty: string;
  status: ContractDocument['status'];
  risk: ContractDocument['risk'];
  jurisdiction: string;
  size_bytes: number;
  updated_at: Date | string;
  team_shared?: boolean;
  shared_by?: string | null;
}

function toDocument(row: DocumentRow): ContractDocument {
  return {
    id: row.id,
    name: row.name,
    counterparty: row.counterparty,
    status: row.status,
    risk: row.risk,
    jurisdiction: row.jurisdiction,
    size: formatSize(Number(row.size_bytes)),
    updatedAt: toIso(row.updated_at),
    teamShared: Boolean(row.team_shared),
    ...(row.shared_by ? { sharedBy: row.shared_by } : {}),
  };
}

const SORT_COLUMNS: Record<string, string> = {
  name: 'name',
  counterparty: 'counterparty',
  status: 'status',
  risk: 'risk',
  size: 'size_bytes',
  updatedAt: 'updated_at',
};

/** Resolve document blocks + redline states into export sections. Formatting
 *  marks are flattened (the simple PDF is plain text); list items get a marker
 *  prefix so numbered/bulleted structure survives. */
function resolveSections(blocks: DocBlock[], redlines: Redline[]): { heading?: string; text?: string }[] {
  const byId = new Map(redlines.map((r) => [r.id, r]));
  const sections: { heading?: string; text?: string }[] = [];
  let numberedCount = 0;
  for (const block of blocks) {
    if (block.type !== 'numbered') numberedCount = 0;
    if (block.type === 'heading') {
      sections.push({ heading: block.text ?? '' });
      continue;
    }
    let text = '';
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') {
        text += seg;
      } else if ('redlineId' in seg) {
        const rl = byId.get(seg.redlineId);
        if (!rl) continue;
        // Only accepted suggestions are applied; pending keeps the original —
        // same convention as the draft builder and the signing page.
        text += rl.status === 'accepted' ? rl.insText : rl.delText;
      } else {
        text += seg.text; // formatted run — marks dropped for the plain PDF
      }
    }
    if (block.type === 'bullet') text = `• ${text}`;
    if (block.type === 'numbered') text = `${++numberedCount}. ${text}`;
    sections.push({ text });
  }
  return sections;
}

/** Hard ceiling on the app-side decrypt scan per request — a runaway corpus
 *  can't turn one search into an unbounded event-loop stall. Beyond this the
 *  content match is skipped (name/counterparty still match in SQL) and logged. */
const SEARCH_SCAN_CAP = 400;

/**
 * Full-content search over ENCRYPTED columns. SQL cannot ILIKE ciphertext, so
 * the candidate set — the caller's own (quota-bounded) documents — is scanned
 * app-side in small batches: decrypt, lowercase, substring match (the same
 * strings the old SQL `ILIKE '%needle%'` scanned: summary, blocks JSON, source
 * text). Buffers drop per batch (bounded memory) and the loop yields to the
 * event loop between batches (bounded latency for other tenants). Only used
 * when encryption is ON — otherwise the caller runs plain SQL ILIKE.
 */
async function searchDocumentContent(db: Db, userId: string, needle: string, log: (m: string) => void): Promise<string[]> {
  const want = needle.toLowerCase();
  const matched = new Set<string>();
  const all = await db.query<{ id: string; name: string }>(
    'SELECT id, name FROM documents WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC',
    [userId],
  );
  const docs = all.rows.slice(0, SEARCH_SCAN_CAP);
  if (all.rows.length > SEARCH_SCAN_CAP) {
    log(`content search scanned the ${SEARCH_SCAN_CAP} most-recent of ${all.rows.length} documents (older ones matched by name only)`);
  }
  const BATCH = 10;
  for (let i = 0; i < docs.length; i += BATCH) {
    if (i > 0) await new Promise<void>((r) => setImmediate(r)); // yield between batches
    const slice = docs.slice(i, i + BATCH);
    const analyses = await db.query<{ document_id: string; summary: string; document_blocks: unknown }>(
      'SELECT document_id, summary, document_blocks FROM analyses WHERE document_id = ANY($1::text[])',
      [slice.map((d) => d.id)],
    );
    for (const a of analyses.rows) {
      if (matched.has(a.document_id)) continue;
      const summary = await decText(db, userId, a.summary);
      if (summary !== null && summary.toLowerCase().includes(want)) {
        matched.add(a.document_id);
        continue;
      }
      const blocks = await decJsonFromJsonb(db, userId, a.document_blocks);
      if (blocks !== null && JSON.stringify(blocks).toLowerCase().includes(want)) matched.add(a.document_id);
    }
    const idByName = new Map(slice.map((d) => [d.name, d.id]));
    const uploads = await db.query<{ file_name: string; extracted_text: string | null }>(
      'SELECT file_name, extracted_text FROM uploads WHERE user_id = $1 AND file_name = ANY($2::text[])',
      [userId, slice.map((d) => d.name)],
    );
    for (const u of uploads.rows) {
      const docId = idByName.get(u.file_name);
      if (!docId || matched.has(docId)) continue;
      const text = await decText(db, userId, u.extracted_text);
      if (text !== null && text.toLowerCase().includes(want)) matched.add(docId);
    }
  }
  return [...matched];
}

export function documentRoutes(app: FastifyInstance, db: Db): void {
  app.get('/documents', { preHandler: [app.authenticate] }, async (req, reply): Promise<ContractDocument[]> => {
    const q = req.query as Record<string, string | undefined>;
    const params: unknown[] = [req.currentUser.id];
    const where: string[] = ['user_id = $1', 'deleted_at IS NULL'];

    if (q.search?.trim()) {
      const needle = q.search.trim();
      params.push(`%${needle}%`);
      const p = `$${params.length}`;
      if (encryptionEnabled()) {
        // Content columns are ciphertext: name/counterparty stay in SQL; the
        // summary/clauses/source-text match runs app-side over decrypted content
        // (bounded, yields the loop). Skip the scan for 1-char needles — too
        // broad to be useful and the most expensive.
        const contentIds =
          needle.length >= 2 ? await searchDocumentContent(db, req.currentUser.id, needle, (m) => req.log.info(m)) : [];
        params.push(contentIds);
        where.push(`(name ILIKE ${p} OR counterparty ILIKE ${p} OR id = ANY($${params.length}::text[]))`);
      } else {
        // Plaintext columns: match entirely inside Postgres (off the event loop).
        where.push(
          `(name ILIKE ${p} OR counterparty ILIKE ${p}
            OR EXISTS (SELECT 1 FROM analyses a WHERE a.document_id = documents.id
                       AND (a.summary ILIKE ${p} OR a.document_blocks::text ILIKE ${p}))
            OR EXISTS (SELECT 1 FROM uploads u WHERE u.user_id = documents.user_id
                       AND u.file_name = documents.name AND u.extracted_text ILIKE ${p}))`,
        );
      }
    }
    if (q.status && q.status !== 'All') {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    if (q.risk && q.risk !== 'All') {
      params.push(q.risk);
      where.push(`risk = $${params.length}`);
    }

    let sort = q.sort ?? '-updatedAt';
    let dir = 'ASC';
    if (sort.startsWith('-')) {
      dir = 'DESC';
      sort = sort.slice(1);
    }
    const column = SORT_COLUMNS[sort];
    if (!column) throw badRequest(`Invalid sort field. Allowed: ${Object.keys(SORT_COLUMNS).join(', ')}`);

    const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 200);
    const page = Math.max(Number(q.page) || 1, 1);

    const whereSql = where.join(' AND ');
    const totalQ = db.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM documents WHERE ${whereSql}`,
      params,
    );
    const rowsQ = db.query<DocumentRow>(
      `SELECT id, name, counterparty, status, risk, jurisdiction, size_bytes, updated_at, team_shared
       FROM documents WHERE ${whereSql}
       ORDER BY ${column} ${dir}
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );

    // Documents shared with me by teams I belong to (active member).
    const sharedParams: unknown[] = [req.currentUser.id];
    const sharedWhere: string[] = [
      `documents.team_shared`,
      `documents.deleted_at IS NULL`,
      `documents.user_id IN (
         SELECT owner_user_id FROM team_members
         WHERE member_user_id = $1 AND status = 'active')`,
    ];
    if (q.search?.trim()) {
      sharedParams.push(`%${q.search.trim()}%`);
      sharedWhere.push(`(documents.name ILIKE $${sharedParams.length} OR documents.counterparty ILIKE $${sharedParams.length})`);
    }
    if (q.status && q.status !== 'All') {
      sharedParams.push(q.status);
      sharedWhere.push(`documents.status = $${sharedParams.length}`);
    }
    if (q.risk && q.risk !== 'All') {
      sharedParams.push(q.risk);
      sharedWhere.push(`documents.risk = $${sharedParams.length}`);
    }
    const sharedQ = db.query<DocumentRow>(
      `SELECT documents.id, documents.name, documents.counterparty, documents.status, documents.risk,
              documents.jurisdiction, documents.size_bytes, documents.updated_at,
              documents.team_shared, u.name AS shared_by
       FROM documents JOIN users u ON u.id = documents.user_id
       WHERE ${sharedWhere.join(' AND ')}
       ORDER BY documents.updated_at DESC LIMIT 100`,
      sharedParams,
    );
    // One DB round-trip of latency instead of three (the pool runs them together).
    const [total, rows, shared] = await Promise.all([totalQ, rowsQ, sharedQ]);

    reply.header('X-Total-Count', String(Number(total.rows[0]?.count ?? 0) + shared.rows.length));
    return [...rows.rows, ...shared.rows]
      .sort((a, b) => new Date(b.updated_at as string).getTime() - new Date(a.updated_at as string).getTime())
      .map(toDocument);
  });

  app.get('/documents/:id', { preHandler: [app.authenticate] }, async (req): Promise<ContractDocument> => {
    const { id } = req.params as { id: string };
    const { doc, access, ownerName } = await resolveDocumentAccess(db, req.currentUser.id, id);
    return {
      ...toDocument(doc as unknown as DocumentRow),
      ...(access !== 'owner' && ownerName ? { sharedBy: ownerName } : {}),
      canEdit: canEdit(access),
      mine: access === 'owner',
    };
  });

  // Owner shares / unshares a document with their team.
  app.patch('/documents/:id', { preHandler: [app.authenticate] }, async (req): Promise<ContractDocument> => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    if (typeof body.teamShared !== 'boolean') throw badRequest('Field "teamShared" must be a boolean');
    if (body.teamShared) await assertFeature(db, req.currentUser.id, 'team');
    const res = await db.query<DocumentRow>(
      `UPDATE documents SET team_shared = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING id, name, counterparty, status, risk, jurisdiction, size_bytes, updated_at, team_shared`,
      [id, req.currentUser.id, body.teamShared],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Document not found');
    await audit(db, req, {
      type: body.teamShared ? 'document.shared' : 'document.unshared',
      target: { type: 'document', id, label: row.name },
    });
    return { ...toDocument(row), canEdit: true, mine: true };
  });

  // Owner deletes a document with everything attached to it.
  app.delete('/documents/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.query<{ name: string }>(
      'SELECT name FROM documents WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.currentUser.id],
    );
    const doc = res.rows[0];
    if (!doc) throw notFound('Document not found');
    // Soft-delete (retention policy — Этап 5): the document is hidden everywhere
    // and unshared immediately, but its rows + bytes are kept for the retention
    // window so an accidental delete can be recovered. checkRetention() then
    // crypto-shreds it for good (rows + file bytes) past config.dataRetentionDays.
    await db.query('UPDATE documents SET deleted_at = now(), team_shared = false, updated_at = now() WHERE id = $1', [id]);
    // Активные согласования удаляемого документа отменяются: внешняя ссылка
    // /approve/:token перестаёт показывать текст, напоминания прекращаются.
    await db.query("UPDATE approval_flows SET status = 'cancelled' WHERE document_id = $1 AND status = 'active'", [id]);
    await audit(db, req, { type: 'document.deleted', target: { type: 'document', id, label: doc.name } });
    reply.code(204);
  });

  app.get('/documents/:id/versions', { preHandler: [app.authenticate] }, async (req): Promise<DocumentVersion[]> => {
    const { id } = req.params as { id: string };
    await assertFeature(db, req.currentUser.id, 'versions');
    // The workspace passes the ANALYSIS id — resolve either kind to a document.
    let documentId: string;
    try {
      const { doc } = await resolveDocumentAccess(db, req.currentUser.id, id);
      documentId = doc.id;
    } catch {
      const viaAnalysis = await db.query<{ document_id: string | null }>(
        'SELECT document_id FROM analyses WHERE id = $1',
        [id],
      );
      const resolved = viaAnalysis.rows[0]?.document_id;
      if (!resolved) throw notFound('Document not found');
      const { doc } = await resolveDocumentAccess(db, req.currentUser.id, resolved);
      documentId = doc.id;
    }
    const res = await db.query<{ id: string; label: string; author: string; note: string; created_at: Date | string }>(
      `SELECT id, label, author, note, created_at FROM document_versions
       WHERE document_id = $1 ORDER BY created_at DESC`,
      [documentId],
    );
    return res.rows.map((r) => ({ id: r.id, label: r.label, author: r.author, createdAt: toIso(r.created_at), note: r.note }));
  });

  /** Универсальный DOCX из простого текста (шаблоны, черновики): старый трюк
   *  «HTML с расширением .doc» не открывается на телефонах и в мессенджерах —
   *  отдаём настоящий Word-файл. */
  app.post('/export/docx', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = asObject(req.body);
    const title = requireString(body, 'title', { min: 1, max: 300 });
    const content = requireString(body, 'content', { min: 1, max: 500_000 });
    const paragraphs = [
      new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
      ...content.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })),
    ];
    const file = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(file);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('Content-Disposition', attachmentDisposition(title, 'docx'));
    reply.header('Cache-Control', 'no-store');
    return reply.send(buffer);
  });

  app.post('/documents/:id/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    const format = requireOneOf(body, 'format', ['docx', 'pdf'] as const);
    // DOCX may be exported with real Word tracked changes (default) or as a
    // clean final document. Ignored for PDF (always flattened).
    const mode: DocxMode = body.mode === 'clean' ? 'clean' : 'tracked';
    if (format === 'docx') await assertFeature(db, req.currentUser.id, 'docxExport');

    const { doc } = await resolveDocumentAccess(db, req.currentUser.id, id);

    // Latest analysis for this document → blocks + redline states.
    const analysisRes = await db.query<{ id: string; document_blocks: DocBlock[] | string; upload_id: string | null }>(
      `SELECT id, document_blocks, upload_id FROM analyses WHERE document_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    let blocks: DocBlock[] = [];
    let redlines: Redline[] = [];
    let uploadId: string | null = null;
    if (analysisRes.rows[0]) {
      const a = analysisRes.rows[0];
      uploadId = a.upload_id;
      // Decrypt with the document OWNER's key (a teammate exports shared docs).
      const decBlocks = (await decJsonFromJsonb(db, doc.user_id, a.document_blocks)) as DocBlock[] | null;
      if (decBlocks === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
      blocks = decBlocks;
      const redlinesRes = await db.query<{ id: string; del_text: string; ins_text: string; severity: Redline['severity']; status: Redline['status'] }>(
        'SELECT id, del_text, ins_text, severity, status FROM redlines WHERE analysis_id = $1 ORDER BY ord',
        [a.id],
      );
      redlines = await Promise.all(
        redlinesRes.rows.map(async (r) => {
          const delText = await decText(db, doc.user_id, r.del_text);
          const insText = await decText(db, doc.user_id, r.ins_text);
          if (delText === null || insText === null) {
            throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
          }
          return { id: r.id, delText, insText, severity: r.severity, status: r.status };
        }),
      );
    }

    // ПОЛНЫЙ исходный текст договора (пока файл ещё в базе): экспорт должен
    // отдавать весь документ на языке оригинала, а не только клаузы с
    // правками из анализа. Принятые правки применяются к полному тексту.
    // Берём тот САМЫЙ upload, из которого сделан анализ (analyses.upload_id) —
    // иначе при двух файлах с одним именем взяли бы чужой (новейший) текст.
    // Старые анализы без upload_id → откат к поиску по имени файла (как раньше).
    const uploadRes = uploadId
      ? await db.query<{ extracted_text: string | null }>(
          'SELECT extracted_text FROM uploads WHERE id = $1 AND user_id = $2',
          [uploadId, doc.user_id],
        )
      : await db.query<{ extracted_text: string | null }>(
          'SELECT extracted_text FROM uploads WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1',
          [doc.user_id, doc.name],
        );
    const rawFull = uploadRes.rows[0]?.extracted_text ?? null;
    let fullText = rawFull === null ? null : await decText(db, doc.user_id, rawFull);
    if (fullText) {
      // Apply every ACCEPTED redline to the full source text — robustly, so the
      // clean export can't silently ship the old (risky) wording:
      //  • ALL occurrences (not just the first) — a repeated clause is fully fixed;
      //  • whitespace-tolerant match (\s+) — the model quotes normalised text
      //    while PDF/DOCX extraction keeps newlines/double spaces inside a clause;
      //  • a FUNCTION replacement — so `$&`, `$$` etc. in the new wording are
      //    inserted literally, never interpreted as replacement patterns.
      // Anything that still can't be placed (empty delText = a pure insertion, or
      // wording not found even fuzzily) is collected and appended as a visible
      // note rather than dropped without a trace.
      const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const unapplied: Redline[] = [];
      let text: string = fullText;
      for (const r of redlines) {
        if (r.status !== 'accepted') continue;
        if (!r.delText.trim()) {
          unapplied.push(r);
          continue;
        }
        const pattern = new RegExp(escapeRe(r.delText).replace(/\s+/g, '\\s+'), 'g');
        let hit = false;
        const next = text.replace(pattern, () => {
          hit = true;
          return r.insText;
        });
        if (hit) text = next;
        else unapplied.push(r);
      }
      if (unapplied.length) {
        const ru = looksRussian(text);
        const header = ru
          ? '\n\n— Принятые изменения, которые не удалось автоматически вставить в исходный текст (примените вручную):'
          : '\n\n— Accepted changes that could not be merged into the source text automatically (apply manually):';
        text += header;
        for (const r of unapplied) {
          text += r.delText.trim()
            ? `\n• ${ru ? 'Было' : 'Was'}: «${r.delText}» → ${ru ? 'Стало' : 'Now'}: «${r.insText}»`
            : `\n• ${ru ? 'Добавить' : 'Add'}: «${r.insText}»`;
        }
      }
      fullText = text;
    }

    // Audit under the document owner's team scope (a teammate exporting a shared
    // doc logs against the owner, not themselves).
    await audit(db, req, {
      type: 'document.exported',
      teamOwnerId: doc.user_id,
      target: { type: 'document', id, label: doc.name },
      metadata: { format, ...(format === 'docx' ? { mode } : {}) },
    });

    // Пометка «исходник утрачен» — на языке контента: без неё экспорт из
    // клауз разбора выглядит как «скачалось что-то не то».
    const blocksSample = blocks
      .map((b) => (b.type === 'heading' ? (b.text ?? '') : (b.segments ?? []).filter((s): s is string => typeof s === 'string').join(' ')))
      .join(' ')
      .slice(0, 2000);
    const noSourceNote =
      blocks.length && !fullText
        ? looksRussian(`${doc.name} ${blocksSample}`)
          ? 'Внимание: исходный файл этого документа отсутствует в хранилище, поэтому ниже приведены только пункты из ИИ-разбора с правками. Загрузите файл заново и запустите анализ, чтобы экспортировать полный договор.'
          : 'Note: the source file of this document is no longer in storage, so only the clauses from the AI review are included below. Re-upload the file and run an analysis to export the full contract.'
        : null;

    if (format === 'pdf') {
      // PDF — always the flattened final document: the FULL original text with
      // accepted redlines applied; only the review excerpt when the source
      // upload is gone.
      const sections = fullText
        ? fullText.split(/\n{2,}/).map((t) => ({ text: t.trim() })).filter((s) => s.text)
        : blocks.length
          ? [...(noSourceNote ? [{ text: noSourceNote }] : []), ...resolveSections(blocks, redlines)]
          : [{ text: `No AI review has been run for “${doc.name}” yet — export the document after running an analysis.` }];
      const pdf = await buildSimplePdf(doc.name, sections);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', attachmentDisposition(doc.name, 'pdf'));
      reply.header('Cache-Control', 'no-store');
      return reply.send(pdf);
    }

    // Real .docx. 'clean' = ПОЛНЫЙ финальный документ (оригинальный текст с
    // применёнными принятыми правками); 'tracked' = клаузы анализа с
    // настоящими w:ins/w:del для Word (выжимка правок — так и задумано).
    const paragraphs: Paragraph[] =
      mode === 'clean' && fullText
        ? [
            new Paragraph({ text: doc.name, heading: HeadingLevel.HEADING_1 }),
            ...fullText.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })),
          ]
        : blocks.length
          ? [
              ...(noSourceNote ? [new Paragraph({ children: [new TextRun({ text: noSourceNote, italics: true })] })] : []),
              ...buildDocxParagraphs(doc.name, blocks, redlines, mode, new Date().toISOString()),
            ]
          : [
              new Paragraph({ text: doc.name, heading: HeadingLevel.HEADING_1 }),
              new Paragraph({ children: [new TextRun(`No AI review has been run for “${doc.name}” yet — export the document after running an analysis.`)] }),
            ];
    const file = new Document({ numbering: DOCX_NUMBERING, sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(file);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('Content-Disposition', attachmentDisposition(doc.name, 'docx'));
    reply.header('Cache-Control', 'no-store');
    return reply.send(buffer);
  });
}

/**
 * Retention purge (Этап 5): crypto-shred documents soft-deleted longer ago than
 * config.dataRetentionDays — destroy the rows (analyses/findings/redlines/
 * versions/contract terms cascade) and the stored file bytes, so the ciphertext
 * is gone for good. Idempotent; runs on a daily interval (index.ts).
 */
export async function checkRetention(db: Db): Promise<void> {
  const due = await db.query<{ id: string; user_id: string; name: string; deleted_at: Date | string }>(
    `SELECT id, user_id, name, deleted_at FROM documents
     WHERE deleted_at IS NOT NULL AND deleted_at < now() - ($1 || ' days')::interval
     LIMIT 500`,
    [String(config.dataRetentionDays)],
  );
  for (const doc of due.rows) {
    // Delete the document + its analyses FIRST, then crypto-shred exactly the
    // uploads this document owned and nobody else still needs. An upload is
    // shredded iff it (a) matches this user+file_name, (b) was created no later
    // than the document was trashed (a same-name file uploaded AFTER belongs to
    // a re-upload / fresh pre-analysis file, never this doc), and (c) is NOT
    // referenced by any SURVIVING analysis's upload_id (a live re-analysed doc,
    // or another soft-deleted copy still inside its own retention window, keeps
    // its bytes). This restores the crypto-shred guarantee (old ciphertext IS
    // destroyed) without ever touching bytes a still-present document relies on.
    // Row deletions (analyses, document, uploads) commit as ONE transaction so a
    // crash can never leave the document gone but its uploads row (and quota)
    // dangling — the subquery over surviving analyses stays correct because the
    // doc's own analyses are already deleted within the tx. Only the file-bytes
    // delete is best-effort AFTER commit (storage is not transactional).
    const files = await db.withTx(async (tx) => {
      await tx.query('DELETE FROM analyses WHERE document_id = $1', [doc.id]);
      await tx.query('DELETE FROM documents WHERE id = $1', [doc.id]);
      // An upload is shredded iff it belongs to this doc's era (same user+name,
      // created no later than the trash timestamp) AND nothing still needs it —
      // no surviving analysis and no queued batch item references its id.
      const toShred = await tx.query<{ id: string; storage: 's3' | 'local' | 'supabase'; storage_key: string }>(
        `SELECT id, storage, storage_key FROM uploads
         WHERE user_id = $1 AND file_name = $2 AND created_at <= $3
           AND id NOT IN (SELECT upload_id FROM analyses WHERE upload_id IS NOT NULL AND user_id = $1)
           AND id NOT IN (SELECT upload_id FROM batch_items WHERE upload_id IS NOT NULL)`,
        [doc.user_id, doc.name, doc.deleted_at],
      );
      if (toShred.rows.length) {
        await tx.query('DELETE FROM uploads WHERE id = ANY($1::text[])', [toShred.rows.map((f) => f.id)]);
      }
      return toShred.rows;
    });
    for (const row of files) {
      try {
        await deleteFile(row.storage, row.storage_key);
      } catch (err) {
        // File bytes couldn't be removed — the row is already gone, so log it:
        // the ciphertext lingers until a manual sweep (crypto-shred incomplete).
        console.warn(`[retention] storage delete failed for ${row.storage_key}: ${(err as Error).message}`);
      }
    }
    await audit(db, null, {
      type: 'document.retention_purged',
      teamOwnerId: doc.user_id,
      actorId: null,
      target: { type: 'document', id: doc.id, label: doc.name },
    });
  }
}
