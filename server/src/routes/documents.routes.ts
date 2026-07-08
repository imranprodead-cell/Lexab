/**
 * GET /documents (search/filter/sort/paginate, total via X-Total-Count)
 * GET /documents/:id | GET /documents/:id/versions
 * POST /documents/:id/export { format: 'docx' | 'pdf' } → binary download
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { formatSize, toIso } from '../lib/format.ts';
import { buildSimplePdf } from '../lib/pdf.ts';
import { asObject, requireOneOf } from '../lib/validate.ts';
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
        // Accepted → insertion; rejected → original; pending → accept the suggestion.
        text += rl.status === 'rejected' ? rl.delText : rl.insText;
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
    const total = await db.query<{ count: string | number }>(
      `SELECT count(*) AS count FROM documents WHERE ${whereSql}`,
      params,
    );
    const rows = await db.query<DocumentRow>(
      `SELECT id, name, counterparty, status, risk, jurisdiction, size_bytes, updated_at
       FROM documents WHERE ${whereSql}
       ORDER BY ${column} ${dir}
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );

    reply.header('X-Total-Count', String(Number(total.rows[0]?.count ?? 0)));
    return rows.rows.map(toDocument);
  });

  app.get('/documents/:id', { preHandler: [app.authenticate] }, async (req): Promise<ContractDocument> => {
    const { id } = req.params as { id: string };
    const res = await db.query<DocumentRow>(
      `SELECT id, name, counterparty, status, risk, jurisdiction, size_bytes, updated_at
       FROM documents WHERE id = $1 AND user_id = $2`,
      [id, req.currentUser.id],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Document not found');
    return toDocument(row);
  });

  app.get('/documents/:id/versions', { preHandler: [app.authenticate] }, async (req): Promise<DocumentVersion[]> => {
    const { id } = req.params as { id: string };
    const owner = await db.query('SELECT 1 FROM documents WHERE id = $1 AND user_id = $2', [id, req.currentUser.id]);
    if (!owner.rows[0]) throw notFound('Document not found');
    const res = await db.query<{ id: string; label: string; author: string; note: string; created_at: Date | string }>(
      `SELECT id, label, author, note, created_at FROM document_versions
       WHERE document_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return res.rows.map((r) => ({ id: r.id, label: r.label, author: r.author, createdAt: toIso(r.created_at), note: r.note }));
  });

  app.post('/documents/:id/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    const format = requireOneOf(body, 'format', ['docx', 'pdf'] as const);

    const docRes = await db.query<DocumentRow>(
      `SELECT id, name, counterparty, status, risk, jurisdiction, size_bytes, updated_at
       FROM documents WHERE id = $1 AND user_id = $2`,
      [id, req.currentUser.id],
    );
    const doc = docRes.rows[0];
    if (!doc) throw notFound('Document not found');

    // Latest analysis for this document → resolved clause text with redlines applied.
    const analysisRes = await db.query<{ id: string; document_blocks: DocBlock[] | string }>(
      `SELECT id, document_blocks FROM analyses WHERE document_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [id, req.currentUser.id],
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

    // Word-compatible HTML (same approach as the frontend's local export).
    const htmlBody = sections
      .map((s) => (s.heading !== undefined ? `<h3>${escapeHtml(s.heading)}</h3>` : `<p>${escapeHtml(s.text ?? '')}</p>`))
      .join('\n');
    const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(doc.name)}</title>
<style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.6;} h3{font-size:13pt;}</style></head>
<body><h2>${escapeHtml(doc.name)}</h2>${htmlBody}</body></html>`;
    reply.header('Content-Type', 'application/msword');
    reply.header('Content-Disposition', `attachment; filename="${baseName}.doc"`);
    return reply.send(Buffer.from(html, 'utf8'));
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
