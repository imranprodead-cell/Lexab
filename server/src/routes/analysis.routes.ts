/**
 * POST /analysis | GET /analysis/:id | PATCH /analysis/:id/redlines/:rid
 *
 * POST accepts either JSON { fileName, fileSize } (the shape the frontend
 * sends — the file itself arrives beforehand via POST /uploads) or a direct
 * multipart `file` field. With `Accept: text/event-stream` it emits `step`
 * events (parse → law-check → report) and a final `result` event; otherwise
 * it responds with the plain AnalysisResult JSON the frontend expects.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db.ts';
import { ALLOWED_EXTENSIONS, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { assertAiAllowance, assertDocumentAllowance, bumpUsage } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { assertCanEdit, resolveAnalysisAccess, resolveDocumentAccess } from '../lib/teamAccess.ts';
import { formatSize } from '../lib/format.ts';
import { buildSimplePdf } from '../lib/pdf.ts';
import { newId } from '../lib/ids.ts';
import { openSSE, wantsSSE } from '../lib/sse.ts';
import { asObject, optionalString, requireOneOf, requireString } from '../lib/validate.ts';
import { generateAnalysis, type GeneratedAnalysis } from '../llm.ts';
import { readFileBytes, saveFile } from '../storage.ts';
import type { AnalysisResult, DocBlock, Redline } from '../types.ts';

const ANALYSIS_STEPS = [
  'Parsing document structure',
  'Checking against UK statute & case law',
  'Building risk report',
];

const RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

interface AnalysisRow {
  id: string;
  file_name: string;
  file_size: string;
  summary: string;
  risk_score: number;
  risk_level: 'Low' | 'Elevated' | 'High';
  clauses_reviewed: number;
  document_blocks: DocBlock[] | string;
}

async function loadAnalysis(db: Db, userId: string, id: string): Promise<AnalysisResult> {
  // Owner, or an active team member when the linked document is shared.
  const access = await resolveAnalysisAccess(db, userId, id);
  const canEdit = access.access === 'owner' || access.access === 'admin' || access.access === 'editor';
  const res = await db.query<AnalysisRow>(
    `SELECT id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks
     FROM analyses WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw notFound('Analysis not found');

  const findings = await db.query<{ id: string; severity: 'High' | 'Medium' | 'Low'; title: string; citation: string }>(
    'SELECT id, severity, title, citation FROM findings WHERE analysis_id = $1 ORDER BY ord',
    [id],
  );
  const redlines = await db.query<Redline & { del_text: string; ins_text: string }>(
    'SELECT id, del_text, ins_text, severity, status FROM redlines WHERE analysis_id = $1 ORDER BY ord',
    [id],
  );
  const blocks = typeof row.document_blocks === 'string' ? JSON.parse(row.document_blocks) : row.document_blocks;

  return {
    id: row.id,
    fileName: row.file_name,
    fileSize: row.file_size,
    summary: row.summary,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    clausesReviewed: row.clauses_reviewed,
    findings: findings.rows,
    redlines: redlines.rows.map((r) => ({
      id: r.id,
      delText: r.del_text,
      insText: r.ins_text,
      severity: r.severity,
      status: r.status,
    })),
    document: blocks,
    canEdit,
  };
}

export interface AnalysisSource {
  fileName: string;
  fileSizeLabel: string;
  sizeBytes: number;
  text: string | null;
  pdf: Buffer | null;
  /** Default jurisdiction from the user's country selector (e.g. "German law"). */
  jurisdiction?: string | null;
  /** Re-analysis of a shared document: persist under this user (the owner). */
  ownerUserId?: string;
}

/** Render document blocks to plain text with the CURRENT redline states applied
 *  (accepted → new wording, otherwise the original) — the visible draft. */
function blocksToDraftText(blocks: DocBlock[], redlines: Redline[]): string {
  const byId = new Map(redlines.map((r) => [r.id, r]));
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      lines.push(block.text ?? '');
      continue;
    }
    let text = '';
    for (const seg of block.segments ?? []) {
      if (typeof seg === 'string') {
        text += seg;
      } else {
        const rl = byId.get(seg.redlineId);
        if (!rl) continue;
        text += rl.status === 'accepted' ? rl.insText : rl.delText;
      }
    }
    lines.push(text);
  }
  return lines.join('\n\n');
}

/** Re-analysis: build the source from an existing analysis' current draft.
 *  Requires edit rights; the result is persisted under the document owner. */
async function sourceFromAnalysis(db: Db, userId: string, analysisId: string): Promise<AnalysisSource> {
  const access = await resolveAnalysisAccess(db, userId, analysisId, true);
  const a = await loadAnalysis(db, userId, analysisId);
  return {
    fileName: a.fileName,
    fileSizeLabel: a.fileSize,
    sizeBytes: 0,
    text: blocksToDraftText(a.document, a.redlines),
    pdf: null,
    ownerUserId: access.analysisUserId,
  };
}

/** Resolve the contract content for JSON-mode requests from the uploads table. */
async function resolveUploadedContent(db: Db, userId: string, fileName: string): Promise<{ text: string | null; pdf: Buffer | null; sizeBytes: number }> {
  const res = await db.query<{ storage: 's3' | 'local' | 'supabase'; storage_key: string; extracted_text: string | null; size_bytes: number }>(
    `SELECT storage, storage_key, extracted_text, size_bytes FROM uploads
     WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1`,
    [userId, fileName],
  );
  const row = res.rows[0];
  if (!row) return { text: null, pdf: null, sizeBytes: 0 };
  let pdf: Buffer | null = null;
  if (fileExtension(fileName) === '.pdf') {
    try {
      pdf = await readFileBytes(row.storage, row.storage_key);
    } catch {
      pdf = null; // stored file unavailable — analyse from name only
    }
  }
  return { text: row.extracted_text, pdf, sizeBytes: Number(row.size_bytes) };
}

async function readSource(db: Db, req: FastifyRequest): Promise<AnalysisSource> {
  if (req.isMultipart()) {
    const part = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!part) throw badRequest('Expected a multipart "file" field');
    const fileName = part.filename || 'document';
    if (!ALLOWED_EXTENSIONS.includes(fileExtension(fileName))) {
      throw badRequest(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }
    const buffer = await part.toBuffer();
    await saveFile(buffer, fileName, part.mimetype);
    return {
      fileName,
      fileSizeLabel: formatSize(buffer.length),
      sizeBytes: buffer.length,
      text: await extractText(buffer, fileName),
      pdf: fileExtension(fileName) === '.pdf' ? buffer : null,
    };
  }

  const body = asObject(req.body);
  const jurisdiction = optionalString(body, 'jurisdiction')?.slice(0, 60) ?? null;

  // Re-analysis of an existing review: { analysisId } instead of a file.
  const analysisId = optionalString(body, 'analysisId');
  if (analysisId) {
    const source = await sourceFromAnalysis(db, req.currentUser.id, analysisId);
    return { ...source, jurisdiction };
  }

  const fileName = requireString(body, 'fileName', { min: 1, max: 300 });
  const fileSizeLabel = requireString(body, 'fileSize', { min: 1, max: 50 });
  const uploaded = await resolveUploadedContent(db, req.currentUser.id, fileName);
  return { fileName, fileSizeLabel, sizeBytes: uploaded.sizeBytes, text: uploaded.text, pdf: uploaded.pdf, jurisdiction };
}

/** Persist the generated analysis and all side effects; return the wire shape.
 *  Exported for the inbound-email pipeline. */
export async function persistAnalysis(db: Db, userId: string, source: AnalysisSource, gen: GeneratedAnalysis): Promise<AnalysisResult> {
  const analysisId = newId('an');

  // Upsert the document row backing the Documents page.
  const existingDoc = await db.query<{ id: string }>(
    'SELECT id FROM documents WHERE user_id = $1 AND name = $2 ORDER BY updated_at DESC LIMIT 1',
    [userId, source.fileName],
  );
  let documentId: string;
  if (existingDoc.rows[0]) {
    documentId = existingDoc.rows[0].id;
    await db.query(
      `UPDATE documents SET status = 'In review', risk = $2, size_bytes = GREATEST(size_bytes, $3), updated_at = now() WHERE id = $1`,
      [documentId, gen.riskLevel, source.sizeBytes],
    );
  } else {
    documentId = newId('d');
    await db.query(
      `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, size_bytes)
       VALUES ($1, $2, $3, '—', 'In review', $4, 'UK', $5)`,
      [documentId, userId, source.fileName, gen.riskLevel, source.sizeBytes],
    );
    await bumpUsage(db, userId, { docs: 1 });
    await db.query(
      `INSERT INTO document_versions (id, document_id, label, author, note)
       VALUES ($1, $2, 'v1 — original', 'Upload', 'Initial draft received.')`,
      [newId('v'), documentId],
    );
  }
  await db.query(
    `INSERT INTO document_versions (id, document_id, label, author, note)
     VALUES ($1, $2, 'AI review', 'LexAI', $3)`,
    [newId('v'), documentId, `Risk score ${gen.riskScore}/100 — ${gen.findings.length} findings.`],
  );

  await db.query(
    `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      analysisId,
      userId,
      documentId,
      source.fileName,
      source.fileSizeLabel,
      gen.summary,
      gen.riskScore,
      gen.riskLevel,
      gen.clausesReviewed,
      JSON.stringify(gen.document),
    ],
  );
  for (let i = 0; i < gen.findings.length; i++) {
    const f = gen.findings[i];
    await db.query(
      'INSERT INTO findings (analysis_id, id, ord, severity, title, citation) VALUES ($1, $2, $3, $4, $5, $6)',
      [analysisId, `f${i + 1}`, i, f.severity, f.title, f.citation],
    );
  }
  for (let i = 0; i < gen.redlines.length; i++) {
    const r = gen.redlines[i];
    await db.query(
      `INSERT INTO redlines (analysis_id, id, ord, del_text, ins_text, severity, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [analysisId, r.id, i, r.delText, r.insText, r.severity],
    );
  }

  // Analytics + notification side effects.
  await db.query('INSERT INTO review_events (id, user_id, risk_score) VALUES ($1, $2, $3)', [
    newId('re'),
    userId,
    gen.riskScore,
  ]);
  const bump = { High: 0, Medium: 0, Low: 0 };
  for (const f of gen.findings) bump[f.severity]++;
  await db.query(
    `UPDATE user_stats SET findings_high = findings_high + $2, findings_medium = findings_medium + $3,
     findings_low = findings_low + $4, hours_saved_minutes = hours_saved_minutes + 90 WHERE user_id = $1`,
    [userId, bump.High, bump.Medium, bump.Low],
  );
  await bumpUsage(db, userId, { ai: 1 });
  await notify(db, userId, 'check', 'Анализ готов', 'Analysis ready', {
    bodyRu: source.fileName,
    bodyEn: source.fileName,
    action: { kind: 'open', data: '/documents' },
  });
  if (gen.riskLevel === 'High') {
    await notify(db, userId, 'alert', 'Найден высокий риск', 'High risk found', {
      bodyRu: source.fileName,
      bodyEn: source.fileName,
      action: { kind: 'open', data: '/documents' },
    });
  }

  return {
    id: analysisId,
    fileName: source.fileName,
    fileSize: source.fileSizeLabel,
    summary: gen.summary,
    riskScore: gen.riskScore,
    riskLevel: gen.riskLevel,
    clausesReviewed: gen.clausesReviewed,
    findings: gen.findings.map((f, i) => ({ id: `f${i + 1}`, ...f })),
    redlines: gen.redlines.map((r) => ({ ...r, status: 'pending' as const })),
    document: gen.document,
  };
}

export function analysisRoutes(app: FastifyInstance, db: Db): void {
  app.post('/analysis', { preHandler: [app.authenticateReal], config: RATE_LIMIT }, async (req, reply) => {
    // Plan limits: AI allowance always; document allowance when this file
    // would create a NEW document row.
    await assertAiAllowance(db, req.currentUser.id);
    const source = await readSource(db, req);
    const existingDoc = await db.query(
      'SELECT 1 FROM documents WHERE user_id = $1 AND name = $2 LIMIT 1',
      [req.currentUser.id, source.fileName],
    );
    if (!existingDoc.rows[0]) await assertDocumentAllowance(db, req.currentUser.id);

    if (wantsSSE(req)) {
      const sse = openSSE(req, reply);
      try {
        sse.send('step', { index: 0, label: ANALYSIS_STEPS[0] });
        sse.send('step', { index: 1, label: ANALYSIS_STEPS[1] });
        const gen = await generateAnalysis({ fileName: source.fileName, text: source.text, pdf: source.pdf, jurisdiction: source.jurisdiction });
        sse.send('step', { index: 2, label: ANALYSIS_STEPS[2] });
        const result = await persistAnalysis(db, source.ownerUserId ?? req.currentUser.id, source, gen);
        sse.send('result', result);
      } catch (err) {
        req.log.error(err, 'analysis failed');
        sse.send('error', { message: 'Analysis failed. Please try again.' });
      } finally {
        sse.close();
      }
      return reply;
    }

    const gen = await generateAnalysis({ fileName: source.fileName, text: source.text, pdf: source.pdf, jurisdiction: source.jurisdiction });
    reply.code(201);
    return persistAnalysis(db, source.ownerUserId ?? req.currentUser.id, source, gen);
  });

  app.get('/analysis/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    return loadAnalysis(db, req.currentUser.id, id);
  });

  // Latest analysis for a document — powers "Open workspace" on the detail page.
  app.get('/documents/:id/analysis', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    await resolveDocumentAccess(db, req.currentUser.id, id);
    const res = await db.query<{ id: string }>(
      'SELECT id FROM analyses WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
      [id],
    );
    if (!res.rows[0]) throw notFound('No analysis for this document yet');
    return loadAnalysis(db, req.currentUser.id, res.rows[0].id);
  });

  // Live editor: replace the document blocks after manual edits.
  app.patch('/analysis/:id/document', { preHandler: [app.authenticate] }, async (req): Promise<AnalysisResult> => {
    const { id } = req.params as { id: string };
    const body = asObject(req.body);
    const blocks = body.document;
    if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 500) {
      throw badRequest('Field "document" must be a non-empty array of blocks');
    }
    for (const b of blocks) {
      const block = b as DocBlock;
      if (block.type !== 'heading' && block.type !== 'paragraph') {
        throw badRequest('Each block must have type "heading" or "paragraph"');
      }
    }
    await resolveAnalysisAccess(db, req.currentUser.id, id, true);
    await db.query('UPDATE analyses SET document_blocks = $2 WHERE id = $1', [id, JSON.stringify(blocks)]);
    return loadAnalysis(db, req.currentUser.id, id);
  });

  // Branded PDF report: summary, findings, redlines — ready to send to a client.
  app.get('/analysis/:id/report.pdf', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = await loadAnalysis(db, req.currentUser.id, id);

    const sections: { heading?: string; text?: string }[] = [
      { text: `File: ${a.fileName} (${a.fileSize}) · Risk score: ${a.riskScore}/100 (${a.riskLevel}) · Clauses reviewed: ${a.clausesReviewed}` },
      { heading: 'Summary' },
      { text: a.summary },
      { heading: `Findings (${a.findings.length})` },
      ...a.findings.map((f, i) => ({ text: `${i + 1}. [${f.severity}] ${f.title} — ${f.citation}` })),
      { heading: `Suggested redlines (${a.redlines.length})` },
      ...a.redlines.map((r, i) => ({
        text: `${i + 1}. [${r.severity}] Replace "${r.delText}" with "${r.insText}" — status: ${r.status}.`,
      })),
      { heading: 'About this report' },
      { text: 'Generated by LexAI contract intelligence. This report is an AI-assisted review and does not constitute legal advice.' },
    ];
    const pdf = buildSimplePdf(`LexAI — Contract Review Report`, sections);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="LexAI_Report_${a.fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')}.pdf"`);
    return reply.send(pdf);
  });

  app.patch('/analysis/:id/redlines/:rid', { preHandler: [app.authenticate] }, async (req): Promise<Redline> => {
    const { id, rid } = req.params as { id: string; rid: string };
    const body = asObject(req.body);
    const status = requireOneOf(body, 'status', ['accepted', 'rejected'] as const);

    // Owner or team member with edit rights.
    await resolveAnalysisAccess(db, req.currentUser.id, id, true);

    const res = await db.query<{ id: string; del_text: string; ins_text: string; severity: 'High' | 'Medium' | 'Low'; status: 'pending' | 'accepted' | 'rejected' }>(
      `UPDATE redlines SET status = $3 WHERE analysis_id = $1 AND id = $2
       RETURNING id, del_text, ins_text, severity, status`,
      [id, rid, status],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Redline not found');
    return { id: row.id, delText: row.del_text, insText: row.ins_text, severity: row.severity, status: row.status };
  });
}
