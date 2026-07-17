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
import { ALLOWED_EXTENSIONS, assertValidFileContent, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { assertDocumentAllowance, assertFeature, assertStorageAllowance, bumpUsage, releaseAiRequest, reserveAiRequest, reserveDocument, withStorageReservation, withAiRequest } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { assertCanEdit, resolveAnalysisAccess, resolveDocumentAccess } from '../lib/teamAccess.ts';
import { attachmentDisposition, formatSize } from '../lib/format.ts';
import { buildSimplePdf } from '../lib/pdf.ts';
import { newId } from '../lib/ids.ts';
import { openSSE, wantsSSE } from '../lib/sse.ts';
import { asObject, optionalString, requireOneOf, requireString } from '../lib/validate.ts';
import { generateAnalysis, generateContractDraft, type GeneratedAnalysis } from '../llm.ts';
import { jurisdictionCode, retrieveLegalContext } from '../rag/retrieve.ts';
import type { RetrievedChunk } from '../rag/types.ts';
import { validateFindings } from '../rag/validate-citations.ts';
import { audit } from '../lib/audit.ts';
import { decJsonFromJsonb, decText, decTextStrict, encJsonForJsonb, encText } from '../lib/docCrypto.ts';
import { deleteFile, readFileBytes, saveFile } from '../storage.ts';
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
  const res = await db.query<AnalysisRow & { document_id: string; user_id: string }>(
    `SELECT id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks
     FROM analyses WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw notFound('Analysis not found');
  // Encrypted values are keyed by the analysis OWNER's data key (a teammate
  // reading a shared document decrypts with the owner's key, not their own).
  const ownerId = row.user_id;

  const findings = await db.query<{ id: string; severity: 'High' | 'Medium' | 'Low'; title: string; citation: string; unit_id: string | null; redline_id: string | null; unverified: boolean }>(
    'SELECT id, severity, title, citation, unit_id, redline_id, unverified FROM findings WHERE analysis_id = $1 ORDER BY ord',
    [id],
  );
  const redlines = await db.query<Redline & { del_text: string; ins_text: string }>(
    'SELECT id, del_text, ins_text, severity, status FROM redlines WHERE analysis_id = $1 ORDER BY ord',
    [id],
  );
  const blocks = (await decJsonFromJsonb(db, ownerId, row.document_blocks)) as DocBlock[] | null;
  if (blocks === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
  const summary = await decText(db, ownerId, row.summary);
  if (summary === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');

  const decRedlines: Redline[] = [];
  for (const r of redlines.rows) {
    const delText = await decText(db, ownerId, r.del_text);
    const insText = await decText(db, ownerId, r.ins_text);
    if (delText === null || insText === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
    decRedlines.push({ id: r.id, delText, insText, severity: r.severity, status: r.status });
  }

  return {
    id: row.id,
    documentId: row.document_id,
    fileName: row.file_name,
    fileSize: row.file_size,
    summary,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    clausesReviewed: row.clauses_reviewed,
    findings: findings.rows.map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      citation: f.citation,
      unitId: f.unit_id,
      redlineId: f.redline_id,
      unverified: f.unverified,
    })),
    redlines: decRedlines,
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
      } else if ('redlineId' in seg) {
        const rl = byId.get(seg.redlineId);
        if (!rl) continue;
        text += rl.status === 'accepted' ? rl.insText : rl.delText;
      } else {
        text += seg.text;
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
    } catch (err) {
      // A DECRYPTION failure must fail loud (never analyse a contract from its
      // name alone while masking the real cause); a genuinely missing file
      // keeps the pre-existing tolerant behaviour (analyse from name only).
      if (err instanceof Error && /decrypt|DATA_ENCRYPTION|integrity/i.test(err.message)) throw err;
      pdf = null;
    }
  }
  // Decrypt BEFORE any prompt building — the model must see the exact
  // plaintext it always saw (answers may not change because of encryption).
  // A PRESENT-but-undecryptable value throws (decTextStrict), so a corrupted
  // row can't silently downgrade the model input to "from the file name only".
  const text = row.extracted_text === null ? null : await decTextStrict(db, userId, row.extracted_text);
  return { text, pdf, sizeBytes: Number(row.size_bytes) };
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
    assertValidFileContent(buffer, fileName);
    // Optional law context sent alongside the file (multipart fields must
    // precede the file part — later fields are not parsed by req.file()).
    const jurisdictionField = (part.fields as Record<string, unknown> | undefined)?.jurisdiction as
      | { value?: unknown }
      | { value?: unknown }[]
      | undefined;
    const rawJurisdiction = Array.isArray(jurisdictionField) ? jurisdictionField[0]?.value : jurisdictionField?.value;
    const jurisdiction = typeof rawJurisdiction === 'string' ? rawJurisdiction.slice(0, 60) : null;
    // Same bookkeeping as POST /uploads: the stored bytes count against the
    // plan's storage quota and show up in the usage numbers.
    await assertStorageAllowance(db, req.currentUser.id, buffer.length);
    const stored = await saveFile(buffer, fileName, part.mimetype);
    const text = await extractText(buffer, fileName);
    // Only the DB param is encrypted — the local `text` stays plaintext and is
    // what the LLM receives below (answers unchanged by encryption).
    const storedText = text === null ? null : await encText(db, req.currentUser.id, text);
    await withStorageReservation(
      db,
      req.currentUser.id,
      buffer.length,
      (tx) =>
        tx
          .query(
            `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [newId('up'), req.currentUser.id, fileName, buffer.length, part.mimetype || null, stored.storage, stored.key, stored.url, storedText],
          )
          .then(() => undefined),
      () => deleteFile(stored.storage, stored.key),
    );
    return {
      fileName,
      fileSizeLabel: formatSize(buffer.length),
      sizeBytes: buffer.length,
      text,
      pdf: fileExtension(fileName) === '.pdf' ? buffer : null,
      jurisdiction,
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
 *  Exported for the inbound-email pipeline. `chargeUserId` is who spends the
 *  AI quota and gets the analytics events — for shared team documents that is
 *  the requester, while the rows stay under the document owner (`userId`). */
export async function persistAnalysis(
  db: Db,
  userId: string,
  source: AnalysisSource,
  gen: GeneratedAnalysis,
  chargeUserId: string = userId,
): Promise<AnalysisResult> {
  const analysisId = newId('an');
  let documentId = ''; // set inside the tx; returned so the client can export

  // Encrypt document content BEFORE the transaction (DEK creation is
  // idempotent and must not extend the tx). Owner's key — not the requester's.
  const encSummary = await encText(db, userId, gen.summary);
  const encBlocks = await encJsonForJsonb(db, userId, gen.document);
  const encRedlines = await Promise.all(
    gen.redlines.map(async (r) => ({
      ...r,
      delText: await encText(db, userId, r.delText),
      insText: await encText(db, userId, r.insText),
    })),
  );

  // All of the review's rows (document, versions, analysis, findings, redlines,
  // stats) commit together or not at all — a mid-write failure never leaves a
  // half-saved analysis. Notifications are non-critical and run after commit.
  await db.withTx(async (tx) => {
    // Upsert the document row backing the Documents page.
    const existingDoc = await tx.query<{ id: string }>(
      'SELECT id FROM documents WHERE user_id = $1 AND name = $2 ORDER BY updated_at DESC LIMIT 1',
      [userId, source.fileName],
    );
    if (existingDoc.rows[0]) {
      documentId = existingDoc.rows[0].id;
      await tx.query(
        `UPDATE documents SET status = 'In review', risk = $2, size_bytes = GREATEST(size_bytes, $3),
                jurisdiction = COALESCE($4, jurisdiction), updated_at = now() WHERE id = $1`,
        [documentId, gen.riskLevel, source.sizeBytes, source.jurisdiction ?? null],
      );
    } else {
      documentId = newId('d');
      await tx.query(
        `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, size_bytes)
         VALUES ($1, $2, $3, '—', 'In review', $4, $5, $6)`,
        [documentId, userId, source.fileName, gen.riskLevel, source.jurisdiction ?? '—', source.sizeBytes],
      );
      // Atomic doc-quota reservation inside this tx — a 402 rolls back the new
      // document too, and concurrent creates can't both slip past the limit.
      await reserveDocument(tx, userId);
      await tx.query(
        `INSERT INTO document_versions (id, document_id, label, author, note)
         VALUES ($1, $2, 'v1 — original', 'Upload', 'Initial draft received.')`,
        [newId('v'), documentId],
      );
    }
    await tx.query(
      `INSERT INTO document_versions (id, document_id, label, author, note)
       VALUES ($1, $2, 'AI review', 'LexAI', $3)`,
      [newId('v'), documentId, `Risk score ${gen.riskScore}/100 — ${gen.findings.length} findings.`],
    );

    await tx.query(
      `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        analysisId,
        userId,
        documentId,
        source.fileName,
        source.fileSizeLabel,
        encSummary,
        gen.riskScore,
        gen.riskLevel,
        gen.clausesReviewed,
        encBlocks,
      ],
    );
    for (let i = 0; i < gen.findings.length; i++) {
      const f = gen.findings[i];
      await tx.query(
        'INSERT INTO findings (analysis_id, id, ord, severity, title, citation, unit_id, redline_id, unverified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [analysisId, `f${i + 1}`, i, f.severity, f.title, f.citation, f.unitId ?? null, f.redlineId ?? null, f.unverified ?? false],
      );
    }
    for (let i = 0; i < encRedlines.length; i++) {
      const r = encRedlines[i];
      await tx.query(
        `INSERT INTO redlines (analysis_id, id, ord, del_text, ins_text, severity, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [analysisId, r.id, i, r.delText, r.insText, r.severity],
      );
    }

    // Analytics + usage are attributed to whoever ran the review (the requester
    // for shared team documents) — their allowance was checked, their stats move.
    await tx.query('INSERT INTO review_events (id, user_id, risk_score) VALUES ($1, $2, $3)', [
      newId('re'),
      chargeUserId,
      gen.riskScore,
    ]);
    const bump = { High: 0, Medium: 0, Low: 0 };
    for (const f of gen.findings) bump[f.severity]++;
    await tx.query(
      `UPDATE user_stats SET findings_high = findings_high + $2, findings_medium = findings_medium + $3,
       findings_low = findings_low + $4, hours_saved_minutes = hours_saved_minutes + 90 WHERE user_id = $1`,
      [chargeUserId, bump.High, bump.Medium, bump.Low],
    );
    // AI usage is counted by the caller's reservation (reserveAiRequest), not here.
  });

  // Best-effort AFTER the commit: the analysis is already saved, so a failed
  // notification must not bubble up — the caller would refund the quota and
  // return an error, and the client's retry would then DUPLICATE the analysis.
  void (async () => {
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
  })().catch((err) => console.warn(`[analysis] notify failed (analysis saved): ${(err as Error).message}`));

  // Audit: who ran an analysis (scoped to the document owner's team). NEVER the
  // contract text — only { feature, ok } per the Privacy Policy.
  await audit(db, null, {
    type: 'ai.analysis',
    teamOwnerId: userId,
    actorId: chargeUserId,
    target: { type: 'document', id: documentId, label: source.fileName },
    metadata: { feature: 'analysis', ok: true },
  });

  return {
    id: analysisId,
    documentId,
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
  // POST /analysis/draft — generate a fresh contract from a free-text prompt and
  // persist it as an analysis, so it opens directly in the editable workspace
  // sheet (edit / review / download). Fails loud if the AI is unavailable.
  app.post('/analysis/draft', { preHandler: [app.authenticateReal], config: RATE_LIMIT }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'templates');
    const body = asObject(req.body);
    const prompt = requireString(body, 'prompt', { min: 1, max: 4000 });
    const jurisdiction = optionalString(body, 'jurisdiction')?.slice(0, 120) || null;

    // Atomic AI reservation right before the model call; released on failure.
    const draft = await withAiRequest(db, req.currentUser.id, (plan) => generateContractDraft(prompt, jurisdiction, plan));

    const draftText = draft.document
      .map((b) => (b.type === 'heading' ? (b.text ?? '') : (b.segments ?? []).join('')))
      .join('\n\n');
    const sizeBytes = Buffer.byteLength(draftText, 'utf8');
    const gen: GeneratedAnalysis = {
      summary: draft.summary,
      riskScore: 0,
      riskLevel: 'Low',
      clausesReviewed: draft.document.filter((b) => b.type === 'heading').length,
      findings: [],
      redlines: [],
      document: draft.document,
    };
    const source: AnalysisSource = {
      fileName: draft.title,
      fileSizeLabel: formatSize(sizeBytes),
      sizeBytes,
      text: draftText,
      pdf: null,
      jurisdiction,
    };
    const result = await persistAnalysis(db, req.currentUser.id, source, gen);
    reply.code(201);
    return result;
  });

  app.post('/analysis', { preHandler: [app.authenticateReal], config: RATE_LIMIT }, async (req, reply) => {
    // Plan limits: document allowance when this file would create a NEW
    // document row, then an atomic AI reservation just before the model call.
    const source = await readSource(db, req);

    // RAG: pull the provisions in force for the user's jurisdiction and
    // validate every citation afterwards (unverified findings get demoted).
    const corpus = jurisdictionCode(source.jurisdiction);
    let retrievalFailed = false;
    const legalContext: RetrievedChunk[] = corpus
      ? await retrieveLegalContext(db, {
          query: (source.text ?? source.fileName).slice(0, 2500),
          jurisdiction: corpus,
          topK: 10,
        }).catch((err) => {
          req.log.warn(`legal retrieval failed: ${(err as Error).message}`);
          retrievalFailed = true;
          return [];
        })
      : [];
    const withValidation = async (gen: GeneratedAnalysis): Promise<GeneratedAnalysis> => {
      if (legalContext.length) return { ...gen, findings: await validateFindings(db, gen.findings, undefined, corpus ?? 'UK') };
      // A jurisdiction with a law base whose check couldn't run must NOT look
      // verified — flag every citation as unconfirmed rather than silently
      // presenting model output as grounded.
      if (retrievalFailed) return { ...gen, findings: gen.findings.map((f) => ({ ...f, unverified: true })) };
      return gen;
    };
    const existingDoc = await db.query(
      'SELECT 1 FROM documents WHERE user_id = $1 AND name = $2 LIMIT 1',
      [req.currentUser.id, source.fileName],
    );
    if (!existingDoc.rows[0]) await assertDocumentAllowance(db, req.currentUser.id);

    // Reserve one AI request atomically (402 if over limit); released below if
    // the model fails, and counted post-hoc only for unlimited plans.
    const { plan, reserved } = await reserveAiRequest(db, req.currentUser.id);
    const countOnSuccess = async () => {
      if (!reserved) await bumpUsage(db, req.currentUser.id, { ai: 1 });
    };

    if (wantsSSE(req)) {
      const sse = openSSE(req, reply);
      try {
        sse.send('step', { index: 0, label: ANALYSIS_STEPS[0] });
        sse.send('step', { index: 1, label: ANALYSIS_STEPS[1] });
        const gen = await withValidation(
          await generateAnalysis({ fileName: source.fileName, text: source.text, pdf: source.pdf, jurisdiction: source.jurisdiction, plan, legalContext }),
        );
        sse.send('step', { index: 2, label: ANALYSIS_STEPS[2] });
        const result = await persistAnalysis(db, source.ownerUserId ?? req.currentUser.id, source, gen, req.currentUser.id);
        await countOnSuccess();
        sse.send('result', result);
      } catch (err) {
        if (reserved) await releaseAiRequest(db, req.currentUser.id); // model failed — give the unit back
        req.log.error(err, 'analysis failed');
        // Forward our own user-safe message (e.g. AI-unavailable); hide internals otherwise.
        const message = err instanceof HttpError ? err.message : 'Analysis failed. Please try again.';
        sse.send('error', { message });
      } finally {
        sse.close();
      }
      return reply;
    }

    try {
      const gen = await withValidation(
        await generateAnalysis({ fileName: source.fileName, text: source.text, pdf: source.pdf, jurisdiction: source.jurisdiction, plan, legalContext }),
      );
      const result = await persistAnalysis(db, source.ownerUserId ?? req.currentUser.id, source, gen, req.currentUser.id);
      await countOnSuccess();
      reply.code(201);
      return result;
    } catch (err) {
      if (reserved) await releaseAiRequest(db, req.currentUser.id);
      throw err;
    }
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
    const VALID_TYPES = new Set(['heading', 'paragraph', 'bullet', 'numbered']);
    const VALID_MARKS = new Set(['b', 'i', 'u', 's']);
    // Same safe-scheme policy as the client: no javascript:/data: links can be
    // stored (they would become clickable script for any viewer).
    const safeHref = (h: string) => /^(https?:\/\/|\/|#|\.|mailto:|tel:)/i.test(h.trim());
    const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
    for (const b of blocks as unknown[]) {
      if (!isObject(b)) throw badRequest('Each block must be an object');
      if (typeof b.type !== 'string' || !VALID_TYPES.has(b.type)) {
        throw badRequest('Each block type must be heading, paragraph, bullet or numbered');
      }
      if (b.align !== undefined && !['left', 'center', 'right'].includes(b.align as string)) {
        throw badRequest('Invalid block align');
      }
      if (b.level !== undefined && b.level !== 1 && b.level !== 2) {
        throw badRequest('Invalid heading level');
      }
      if (b.segments !== undefined && !Array.isArray(b.segments)) {
        throw badRequest('Block segments must be an array');
      }
      for (const seg of (b.segments as unknown[]) ?? []) {
        if (typeof seg === 'string') continue;
        if (!isObject(seg)) throw badRequest('Invalid segment');
        if ('redlineId' in seg) {
          if (typeof seg.redlineId !== 'string') throw badRequest('Invalid redline slot');
          continue;
        }
        // A formatted text run.
        if (typeof seg.text !== 'string') throw badRequest('Invalid text run');
        if (seg.marks !== undefined && (!Array.isArray(seg.marks) || seg.marks.some((m) => !VALID_MARKS.has(m as string)))) {
          throw badRequest('Invalid run marks');
        }
        if (seg.href !== undefined) {
          if (typeof seg.href !== 'string') throw badRequest('Invalid link');
          if (seg.href && !safeHref(seg.href)) throw badRequest('Unsafe link scheme');
        }
      }
    }
    const patchAccess = await resolveAnalysisAccess(db, req.currentUser.id, id, true);
    // Validation above ran on the plaintext structure; only the stored value is
    // encrypted — with the analysis OWNER's key (teammates share the owner key).
    await db.query('UPDATE analyses SET document_blocks = $2 WHERE id = $1', [
      id,
      await encJsonForJsonb(db, patchAccess.analysisUserId, blocks),
    ]);
    // A manual edit can flatten a paragraph and drop its {redlineId} slots —
    // retire the pending suggestions that no longer appear anywhere, so the
    // "N suggestions" counters keep matching the visible document.
    const referenced: string[] = [];
    for (const b of blocks as DocBlock[]) {
      for (const seg of b.segments ?? []) {
        if (typeof seg !== 'string' && 'redlineId' in seg) referenced.push(seg.redlineId);
      }
    }
    await db.query(
      `DELETE FROM redlines WHERE analysis_id = $1 AND status = 'pending' AND NOT (id = ANY($2::text[]))`,
      [id, referenced],
    );
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
    const pdf = await buildSimplePdf(`LexAI — Contract Review Report`, sections);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', attachmentDisposition(`LexAI_Report_${a.fileName}`, 'pdf'));
    return reply.send(pdf);
  });

  app.patch('/analysis/:id/redlines/:rid', { preHandler: [app.authenticate] }, async (req): Promise<Redline> => {
    const { id, rid } = req.params as { id: string; rid: string };
    const body = asObject(req.body);
    // 'pending' is allowed so a decision can be reverted (undo). The DB CHECK
    // already permits it; access control (edit rights) is unchanged below.
    const status = requireOneOf(body, 'status', ['accepted', 'rejected', 'pending'] as const);

    // Owner or team member with edit rights.
    const rlAccess = await resolveAnalysisAccess(db, req.currentUser.id, id, true);

    const res = await db.query<{ id: string; del_text: string; ins_text: string; severity: 'High' | 'Medium' | 'Low'; status: 'pending' | 'accepted' | 'rejected' }>(
      `UPDATE redlines SET status = $3 WHERE analysis_id = $1 AND id = $2
       RETURNING id, del_text, ins_text, severity, status`,
      [id, rid, status],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Redline not found');
    const delText = await decText(db, rlAccess.analysisUserId, row.del_text);
    const insText = await decText(db, rlAccess.analysisUserId, row.ins_text);
    if (delText === null || insText === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
    return { id: row.id, delText, insText, severity: row.severity, status: row.status };
  });
}
