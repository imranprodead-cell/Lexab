/**
 * GET /documents (search/filter/sort/paginate, total via X-Total-Count)
 * GET /documents/:id | GET /documents/:id/versions
 * POST /documents/:id/export { format: 'docx' | 'pdf' } → binary download
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { assertFeature } from '../lib/limits.ts';
import { canEdit, resolveDocumentAccess } from '../lib/teamAccess.ts';
import { formatSize, toIso } from '../lib/format.ts';
import { buildSimplePdf } from '../lib/pdf.ts';
import { asObject, requireOneOf } from '../lib/validate.ts';
import { deleteFile } from '../storage.ts';
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

/** Resolve document blocks + redline states into export sections. */
function resolveSections(blocks: DocBlock[], redlines: Redline[]): { heading?: string; text?: string }[] {
  const byId = new Map(redlines.map((r) => [r.id, r]));
  const sections: { heading?: string; text?: string }[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      sections.push({ heading: block.text ?? '' });
      continue;
    }
    let text = '';
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') {
        text += seg;
      } else {
        const rl = byId.get(seg.redlineId);
        if (!rl) continue;
        // Only accepted suggestions are applied; pending keeps the original —
        // same convention as the draft builder and the signing page.
        text += rl.status === 'accepted' ? rl.insText : rl.delText;
      }
    }
    sections.push({ text });
  }
  return sections;
}

export function documentRoutes(app: FastifyInstance, db: Db): void {
  app.get('/documents', { preHandler: [app.authenticate] }, async (req, reply): Promise<ContractDocument[]> => {
    const q = req.query as Record<string, string | undefined>;
    const params: unknown[] = [req.currentUser.id];
    const where: string[] = ['user_id = $1'];

    if (q.search?.trim()) {
      params.push(`%${q.search.trim()}%`);
      const p = `$${params.length}`;
      // Full-content search: file name, counterparty, AI summary, clause text
      // and the extracted text of the uploaded source file.
      where.push(
        `(name ILIKE ${p} OR counterparty ILIKE ${p}
          OR EXISTS (SELECT 1 FROM analyses a WHERE a.document_id = documents.id
                     AND (a.summary ILIKE ${p} OR a.document_blocks::text ILIKE ${p}))
          OR EXISTS (SELECT 1 FROM uploads u WHERE u.user_id = documents.user_id
                     AND u.file_name = documents.name AND u.extracted_text ILIKE ${p}))`,
      );
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
      `UPDATE documents SET team_shared = $3 WHERE id = $1 AND user_id = $2
       RETURNING id, name, counterparty, status, risk, jurisdiction, size_bytes, updated_at, team_shared`,
      [id, req.currentUser.id, body.teamShared],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Document not found');
    return { ...toDocument(row), canEdit: true, mine: true };
  });

  // Owner deletes a document with everything attached to it.
  app.delete('/documents/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await db.query<{ name: string }>(
      'SELECT name FROM documents WHERE id = $1 AND user_id = $2',
      [id, req.currentUser.id],
    );
    const doc = res.rows[0];
    if (!doc) throw notFound('Document not found');
    // Remember where the bytes live BEFORE the rows are gone.
    const files = await db.query<{ storage: 's3' | 'local' | 'supabase'; storage_key: string }>(
      'SELECT storage, storage_key FROM uploads WHERE user_id = $1 AND file_name = $2',
      [req.currentUser.id, doc.name],
    );
    // Analyses reference the document with ON DELETE SET NULL — remove them
    // explicitly (findings/redlines cascade), then the document (versions cascade),
    // then the stored uploads so the storage quota is freed. All atomic: a
    // partial delete never leaves dangling analyses or orphaned uploads.
    // NOTE: uploads are still matched by (user_id, file_name); a stable
    // document_id link is a documented follow-up (filename→id migration).
    await db.withTx(async (tx) => {
      await tx.query('DELETE FROM analyses WHERE document_id = $1 AND user_id = $2', [id, req.currentUser.id]);
      await tx.query('DELETE FROM documents WHERE id = $1', [id]);
      await tx.query('DELETE FROM uploads WHERE user_id = $1 AND file_name = $2', [req.currentUser.id, doc.name]);
    });
    // Best effort: a failed storage delete must not resurrect the DB rows.
    for (const row of files.rows) {
      try {
        await deleteFile(row.storage, row.storage_key);
      } catch (err) {
        req.log.warn({ err, key: row.storage_key }, 'storage: delete failed');
      }
    }
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

  app.post('/documents/:id/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    const format = requireOneOf(body, 'format', ['docx', 'pdf'] as const);
    if (format === 'docx') await assertFeature(db, req.currentUser.id, 'docxExport');

    const { doc } = await resolveDocumentAccess(db, req.currentUser.id, id);

    // Latest analysis for this document → resolved clause text with redlines applied.
    const analysisRes = await db.query<{ id: string; document_blocks: DocBlock[] | string }>(
      `SELECT id, document_blocks FROM analyses WHERE document_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    let sections: { heading?: string; text?: string }[];
    if (analysisRes.rows[0]) {
      const a = analysisRes.rows[0];
      const blocks: DocBlock[] = typeof a.document_blocks === 'string' ? JSON.parse(a.document_blocks) : a.document_blocks;
      const redlinesRes = await db.query<{ id: string; del_text: string; ins_text: string; severity: Redline['severity']; status: Redline['status'] }>(
        'SELECT id, del_text, ins_text, severity, status FROM redlines WHERE analysis_id = $1 ORDER BY ord',
        [a.id],
      );
      sections = resolveSections(
        blocks,
        redlinesRes.rows.map((r) => ({ id: r.id, delText: r.del_text, insText: r.ins_text, severity: r.severity, status: r.status })),
      );
    } else {
      sections = [{ text: `No AI review has been run for “${doc.name}” yet — export the document after running an analysis.` }];
    }

    const baseName = doc.name.replace(/\.[^.]+$/, '') || 'document';
    if (format === 'pdf') {
      const pdf = buildSimplePdf(doc.name, sections);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
      return reply.send(pdf);
    }

    // Real .docx via the docx library.
    const paragraphs: Paragraph[] = [
      new Paragraph({ text: doc.name, heading: HeadingLevel.HEADING_1 }),
      ...sections.map((s) =>
        s.heading !== undefined
          ? new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
          : new Paragraph({ children: [new TextRun(s.text ?? '')], spacing: { after: 160 } }),
      ),
    ];
    const file = new Document({ sections: [{ children: paragraphs }] });
    const buffer = await Packer.toBuffer(file);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('Content-Disposition', `attachment; filename="${baseName}.docx"`);
    return reply.send(buffer);
  });
}
