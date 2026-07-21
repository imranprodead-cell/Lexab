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
import { assertDocumentAllowance, assertFeature, assertStorageAllowance, bumpUsage, planHasFeature, releaseAiRequest, reserveAiRequest, reserveDocument, withStorageReservation, withAiRequest } from '../lib/limits.ts';
import { notify } from '../lib/notify.ts';
import { assertCanEdit, resolveAnalysisAccess, resolveDocumentAccess } from '../lib/teamAccess.ts';
import { attachmentDisposition, formatSize, looksRussian, looksUzbekLatin } from '../lib/format.ts';
import { buildSimplePdf } from '../lib/pdf.ts';
import { newId } from '../lib/ids.ts';
import { recalibrateRisk } from '../lib/riskScore.ts';
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

  const findings = await db.query<{ id: string; severity: 'High' | 'Medium' | 'Low'; title: string; citation: string; unit_id: string | null; redline_id: string | null; unverified: boolean; playbook_deviation: boolean }>(
    'SELECT id, severity, title, citation, unit_id, redline_id, unverified, playbook_deviation FROM findings WHERE analysis_id = $1 ORDER BY ord',
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
      playbookDeviation: f.playbook_deviation,
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
  /** The exact upload this analysis is built from (uploads.id). Persisted on the
   *  analysis so re-analysis / chat grounding / export read the RIGHT file even
   *  when two uploads share a name. Null for re-analysis of legacy rows. */
  uploadId?: string | null;
}

/** Render document blocks to plain text with the CURRENT redline states applied
 *  (accepted → new wording, otherwise the original) — the visible draft. */
export function blocksToDraftText(blocks: DocBlock[], redlines: Redline[]): string {
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
export async function sourceFromAnalysis(db: Db, userId: string, analysisId: string): Promise<AnalysisSource> {
  const access = await resolveAnalysisAccess(db, userId, analysisId, true);
  const a = await loadAnalysis(db, userId, analysisId);
  const ownerId = access.analysisUserId;
  // Re-analysis must review the WHOLE contract. For an uploaded document,
  // blocksToDraftText holds only the clauses that carried redlines (the model is
  // told to reproduce just those), so re-analysing it would review 2–3 clauses
  // and could even declare the contract "clean". Prefer the full original text
  // from the exact upload this analysis was built from; fall back to the draft
  // blocks for prompt-drafts (no upload) and legacy rows without a link.
  const linked = await db.query<{ upload_id: string | null }>('SELECT upload_id FROM analyses WHERE id = $1', [analysisId]);
  const uploadId = linked.rows[0]?.upload_id ?? null;
  let fullText: string | null = null;
  if (uploadId) {
    const up = await db.query<{ extracted_text: string | null }>(
      'SELECT extracted_text FROM uploads WHERE id = $1 AND user_id = $2',
      [uploadId, ownerId],
    );
    const raw = up.rows[0]?.extracted_text ?? null;
    fullText = raw === null ? null : await decTextStrict(db, ownerId, raw);
  }
  return {
    fileName: a.fileName,
    fileSizeLabel: a.fileSize,
    sizeBytes: 0,
    text: fullText ?? blocksToDraftText(a.document, a.redlines),
    pdf: null,
    ownerUserId: ownerId,
    uploadId,
  };
}

/** Resolve the contract content for JSON-mode requests from the uploads table. */
async function resolveUploadedContent(db: Db, userId: string, fileName: string): Promise<{ text: string | null; pdf: Buffer | null; sizeBytes: number; uploadId: string | null }> {
  const res = await db.query<{ id: string; storage: 's3' | 'local' | 'supabase'; storage_key: string; extracted_text: string | null; size_bytes: number }>(
    `SELECT id, storage, storage_key, extracted_text, size_bytes FROM uploads
     WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1`,
    [userId, fileName],
  );
  const row = res.rows[0];
  if (!row) return { text: null, pdf: null, sizeBytes: 0, uploadId: null };
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
  return { text, pdf, sizeBytes: Number(row.size_bytes), uploadId: row.id };
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
    // extractText can reject (e.g. a decompression-bomb docx) AFTER the bytes are
    // already stored but BEFORE the uploads row exists — the storage-reservation
    // compensation only fires on an INSERT failure, so clean up here or the file
    // orphans.
    let text: string | null;
    try {
      text = await extractText(buffer, fileName);
    } catch (err) {
      await deleteFile(stored.storage, stored.key).catch(() => undefined);
      throw err;
    }
    // Only the DB param is encrypted — the local `text` stays plaintext and is
    // what the LLM receives below (answers unchanged by encryption).
    const storedText = text === null ? null : await encText(db, req.currentUser.id, text);
    const uploadId = newId('up');
    await withStorageReservation(
      db,
      req.currentUser.id,
      buffer.length,
      (tx) =>
        tx
          .query(
            `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
            [uploadId, req.currentUser.id, fileName, buffer.length, part.mimetype || null, stored.storage, stored.key, storedText],
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
      uploadId,
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
  return { fileName, fileSizeLabel, sizeBytes: uploaded.sizeBytes, text: uploaded.text, pdf: uploaded.pdf, jurisdiction, uploadId: uploaded.uploadId };
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
  // Для журнала: req даёт ip/user-agent/email актора; inbound-email передаёт
  // null + actorLabel (email отправителя).
  req: FastifyRequest | null = null,
  actorLabel?: string,
): Promise<AnalysisResult> {
  // Пост-калибровка: после валидации цитат (демоция непроверенных в Low) балл
  // риска не может превышать потолок фактической максимальной severity.
  gen = { ...gen, ...recalibrateRisk(gen.findings, gen.riskScore) };
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

  // CLM (Этап 2): условия договора. Шифрование и чтение прежних обязательств —
  // ДО транзакции (encText/decText ходят в БД за ключом; вложенный запрос
  // внутри withTx на односоединённой PGlite зависает).
  const terms = gen.terms ?? null;
  const encContractValue = terms?.contractValue ? await encText(db, userId, terms.contractValue) : null;
  const encObligations: { textEnc: string; dueDate: string | null; responsible: string | null; done: boolean; reminded: boolean }[] = [];
  // Документ, из которого перенесены отметки done/reminded (для TOCTOU-проверки
  // ниже: если внутри транзакции мы всё же создаём НОВЫЙ документ — например,
  // прежний удалили в зазоре, — перенос не применяется).
  let carriedFromDocId: string | null = null;
  if (terms) {
    // Переанализ того же ЖИВОГО документа: сохраняем пользовательские отметки
    // «выполнено» и не шлём повторные напоминания по тем же обязательствам.
    // Ключ переноса — текст + срок: обязательство с НОВОЙ датой — это новый
    // дедлайн (напоминание должно прийти заново), а мягко удалённый документ
    // в переносе не участвует (его отметки не должны перетекать на свежий).
    const prior = new Map<string, { done: boolean; reminded: boolean }>();
    const carryKey = (text: string, dueDate: string | null) => `${text}\u0000${dueDate ?? ''}`;
    const priorDoc = await db.query<{ id: string }>(
      'SELECT id FROM documents WHERE user_id = $1 AND name = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1',
      [userId, source.fileName],
    );
    carriedFromDocId = priorDoc.rows[0]?.id ?? null;
    if (priorDoc.rows[0]) {
      const old = await db.query<{ text_enc: string; due_date: string | null; done: boolean; reminded: boolean }>(
        "SELECT text_enc, to_char(due_date, 'YYYY-MM-DD') AS due_date, done, reminded FROM contract_obligations WHERE document_id = $1",
        [priorDoc.rows[0].id],
      );
      for (const o of old.rows) {
        const t = await decText(db, userId, o.text_enc);
        if (t !== null) prior.set(carryKey(t, o.due_date), { done: o.done, reminded: o.reminded });
      }
    }
    for (const o of terms.obligations) {
      const kept = prior.get(carryKey(o.text, o.dueDate));
      encObligations.push({
        textEnc: await encText(db, userId, o.text),
        dueDate: o.dueDate,
        responsible: o.responsible,
        done: kept?.done ?? false,
        reminded: kept?.reminded ?? false,
      });
    }
  }

  // All of the review's rows (document, versions, analysis, findings, redlines,
  // stats) commit together or not at all — a mid-write failure never leaves a
  // half-saved analysis. Notifications are non-critical and run after commit.
  await db.withTx(async (tx) => {
    // Upsert the document row backing the Documents page. A soft-deleted doc of
    // the same name is skipped, so re-analysing a file whose old copy is in the
    // retention trash creates a fresh document instead of reviving the deleted one.
    const existingDoc = await tx.query<{ id: string }>(
      'SELECT id FROM documents WHERE user_id = $1 AND name = $2 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1',
      [userId, source.fileName],
    );
    if (existingDoc.rows[0]) {
      documentId = existingDoc.rows[0].id;
      await tx.query(
        `UPDATE documents SET status = 'In review', risk = $2, size_bytes = GREATEST(size_bytes, $3),
                jurisdiction = COALESCE($4, jurisdiction), counterparty = COALESCE($5, counterparty),
                updated_at = now() WHERE id = $1`,
        [documentId, gen.riskLevel, source.sizeBytes, source.jurisdiction ?? null, gen.counterparty ?? null],
      );
    } else {
      documentId = newId('d');
      await tx.query(
        `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, size_bytes)
         VALUES ($1, $2, $3, $4, 'In review', $5, $6, $7)`,
        [documentId, userId, source.fileName, gen.counterparty ?? '—', gen.riskLevel, source.jurisdiction ?? '—', source.sizeBytes],
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
      `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks, upload_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
        source.uploadId ?? null,
      ],
    );
    for (let i = 0; i < gen.findings.length; i++) {
      const f = gen.findings[i];
      await tx.query(
        'INSERT INTO findings (analysis_id, id, ord, severity, title, citation, unit_id, redline_id, unverified, playbook_deviation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [analysisId, `f${i + 1}`, i, f.severity, f.title, f.citation, f.unitId ?? null, f.redlineId ?? null, f.unverified ?? false, f.playbookDeviation ?? false],
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

    // CLM: upsert условий договора. Флаги напоминаний сбрасываются только
    // когда соответствующая дата реально изменилась — иначе повторный анализ
    // с теми же сроками прислал бы дубль напоминания.
    if (terms) {
      await tx.query(
        `INSERT INTO contract_terms (document_id, effective_date, expiry_date, auto_renew, renewal_notice_days, contract_value_enc, currency, governing_law)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (document_id) DO UPDATE SET
           effective_date = EXCLUDED.effective_date,
           expiry_date = EXCLUDED.expiry_date,
           auto_renew = EXCLUDED.auto_renew,
           renewal_notice_days = EXCLUDED.renewal_notice_days,
           contract_value_enc = EXCLUDED.contract_value_enc,
           currency = EXCLUDED.currency,
           governing_law = EXCLUDED.governing_law,
           -- Сброс «напомнено» — только при СУЩЕСТВЕННОМ изменении даты: дрейф
           -- извлечения на ≤3 дня не присылает то же напоминание заново. НО если
           -- прежняя дата была В ПРОШЛОМ, реального напоминания не было (проход
           -- «просрочено» ставит флаг молча) — исправление даты на будущее должно
           -- разбудить напоминание.
           expiry_reminded = CASE
             WHEN contract_terms.expiry_date IS NOT DISTINCT FROM EXCLUDED.expiry_date THEN contract_terms.expiry_reminded
             WHEN contract_terms.expiry_date IS NULL OR EXCLUDED.expiry_date IS NULL THEN false
             WHEN contract_terms.expiry_date < CURRENT_DATE THEN false
             WHEN ABS(EXCLUDED.expiry_date - contract_terms.expiry_date) > 3 THEN false
             ELSE contract_terms.expiry_reminded END,
           -- Демпфер и для продления: сброс только если ДЕДЛАЙН уведомления
           -- (expiry − notice_days) сдвинулся более чем на 3 дня (или прежний
           -- дедлайн был в прошлом = реального напоминания не было).
           renewal_reminded = CASE
             WHEN contract_terms.expiry_date IS NULL OR EXCLUDED.expiry_date IS NULL
                  OR contract_terms.renewal_notice_days IS NULL OR EXCLUDED.renewal_notice_days IS NULL
               THEN CASE WHEN contract_terms.renewal_notice_days IS DISTINCT FROM EXCLUDED.renewal_notice_days
                           OR contract_terms.expiry_date IS DISTINCT FROM EXCLUDED.expiry_date THEN false
                         ELSE contract_terms.renewal_reminded END
             WHEN (contract_terms.expiry_date - contract_terms.renewal_notice_days) < CURRENT_DATE THEN false
             WHEN ABS((EXCLUDED.expiry_date - EXCLUDED.renewal_notice_days)
                      - (contract_terms.expiry_date - contract_terms.renewal_notice_days)) > 3 THEN false
             ELSE contract_terms.renewal_reminded END,
           extracted_at = now()`,
        [documentId, terms.effectiveDate, terms.expiryDate, terms.autoRenew, terms.renewalNoticeDays, encContractValue, terms.currency, terms.governingLaw],
      );
      await tx.query('DELETE FROM contract_obligations WHERE document_id = $1', [documentId]);
      // Перенос флагов действителен только если пишем в ТОТ ЖЕ документ, из
      // которого читали (иначе прежний удалили в зазоре и это уже новый).
      const carryValid = documentId === carriedFromDocId;
      for (let i = 0; i < encObligations.length; i++) {
        const o = encObligations[i];
        await tx.query(
          'INSERT INTO contract_obligations (id, document_id, ord, text_enc, due_date, responsible, reminded, done) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [newId('ob'), documentId, i, o.textEnc, o.dueDate, o.responsible, carryValid && o.reminded, carryValid && o.done],
        );
      }
    }

    // Analytics + usage are attributed to whoever ran the review (the requester
    // for shared team documents) — their allowance was checked, their stats move.
    await tx.query('INSERT INTO review_events (id, user_id, risk_score, analysis_id) VALUES ($1, $2, $3, $4)', [
      newId('re'),
      chargeUserId,
      gen.riskScore,
      analysisId,
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
  await audit(db, req, {
    type: 'ai.analysis',
    teamOwnerId: userId,
    actorId: chargeUserId,
    ...(actorLabel ? { actorLabel } : {}),
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
    findings: gen.findings.map((f, i) => ({ id: `f${i + 1}`, ...f, playbookDeviation: f.playbookDeviation ?? false })),
    redlines: gen.redlines.map((r) => ({ ...r, status: 'pending' as const })),
    document: gen.document,
  };
}

/** The account whose playbook applies when `userId` runs a review: their team's
 *  owner when they are an active member, otherwise themselves. */
async function resolvePlaybookOwner(db: Db, userId: string): Promise<string> {
  const res = await db.query<{ owner_user_id: string }>(
    "SELECT owner_user_id FROM team_members WHERE member_user_id = $1 AND status = 'active' AND owner_user_id <> $1 LIMIT 1",
    [userId],
  );
  return res.rows[0]?.owner_user_id ?? userId;
}

/** Load the active playbook's rules as one prompt-ready text block for the given
 *  team owner + corpus (jurisdiction code), or null when none applies. Prefers a
 *  jurisdiction-specific playbook, falling back to a global (jurisdiction NULL)
 *  one. Rule text is decrypted with the OWNER's data key. */
async function loadActivePlaybook(db: Db, ownerUserId: string, corpus: string | null): Promise<string | null> {
  const pb = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM playbooks
     WHERE owner_user_id = $1 AND active = true AND (jurisdiction = $2 OR jurisdiction IS NULL)
     ORDER BY (jurisdiction = $2) DESC NULLS LAST, created_at DESC LIMIT 1`,
    [ownerUserId, corpus],
  );
  const row = pb.rows[0];
  if (!row) return null;
  const rules = await db.query<{ text_enc: string }>(
    'SELECT text_enc FROM playbook_rules WHERE playbook_id = $1 ORDER BY ord',
    [row.id],
  );
  const lines: string[] = [];
  for (const r of rules.rows) {
    const text = await decText(db, ownerUserId, r.text_enc);
    if (text && text.trim()) lines.push(`- ${text.trim()}`);
  }
  return lines.length ? `«${row.name}»:\n${lines.join('\n')}` : null;
}

/** Демоция непроверенных цитат: находка без подтверждённой ссылки из корпуса
 *  помечается unverified и (при связанной правке) синхронизирует её тяжесть. */
async function validateGen(
  db: Db,
  gen: GeneratedAnalysis,
  legalContext: RetrievedChunk[],
  corpus: string | null,
  retrievalFailed: boolean,
): Promise<GeneratedAnalysis> {
  if (legalContext.length) {
    const findings = await validateFindings(db, gen.findings, undefined, corpus ?? 'UK');
    const sevByRedline = new Map(findings.filter((f) => f.redlineId).map((f) => [f.redlineId as string, f.severity]));
    const redlines = gen.redlines.map((r) => (sevByRedline.has(r.id) ? { ...r, severity: sevByRedline.get(r.id) as typeof r.severity } : r));
    return { ...gen, findings, redlines };
  }
  // Юрисдикция с базой законов, чью проверку не удалось выполнить, не должна
  // выглядеть «проверенной» — каждую цитату помечаем неподтверждённой.
  if (retrievalFailed) return { ...gen, findings: gen.findings.map((f) => ({ ...f, unverified: true })) };
  return gen;
}

/** Полный конвейер «источник → проверенный анализ»: RAG-контекст по юрисдикции,
 *  активный плейбук команды (Pro+), генерация моделью и валидация цитат.
 *  Общий для одиночного POST /analysis и массового разбора (batch) — оба дают
 *  одинаковое качество. Резервирование ИИ-квоты остаётся на вызывающем. */
export async function analyzeSource(
  db: Db,
  requesterId: string,
  source: AnalysisSource,
  plan: string,
  logWarn: (msg: string) => void = () => undefined,
): Promise<GeneratedAnalysis> {
  const corpus = jurisdictionCode(source.jurisdiction);
  let retrievalFailed = false;
  const legalContext: RetrievedChunk[] = corpus
    ? await retrieveLegalContext(db, {
        query: (source.text ?? source.fileName).slice(0, 2500),
        jurisdiction: corpus,
        topK: 10,
      }).catch((err) => {
        logWarn(`legal retrieval failed: ${(err as Error).message}`);
        retrievalFailed = true;
        return [];
      })
    : [];
  const playbook = planHasFeature(plan, 'playbooks')
    ? await loadActivePlaybook(db, await resolvePlaybookOwner(db, requesterId), corpus).catch(() => null)
    : null;
  const gen = await generateAnalysis({
    fileName: source.fileName,
    text: source.text,
    pdf: source.pdf,
    jurisdiction: source.jurisdiction,
    plan,
    legalContext,
    playbook,
  });
  return validateGen(db, gen, legalContext, corpus, retrievalFailed);
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
    await audit(db, req, { type: 'ai.draft', target: { type: 'document', label: draft.title }, metadata: { feature: 'draft', ok: true } });

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
    const result = await persistAnalysis(db, req.currentUser.id, source, gen, req.currentUser.id, req);
    reply.code(201);
    return result;
  });

  app.post('/analysis', { preHandler: [app.authenticateReal], config: RATE_LIMIT }, async (req, reply) => {
    // Plan limits: document allowance when this file would create a NEW
    // document row, then an atomic AI reservation just before the model call.
    const source = await readSource(db, req);

    // The document is upserted under its OWNER (source.ownerUserId for a shared
    // re-analysis), so check existence under the owner too — otherwise re-analysing
    // a teammate's shared document is falsely blocked by the REQUESTER's personal
    // document limit even though no new document row is created.
    const docOwnerId = source.ownerUserId ?? req.currentUser.id;
    const existingDoc = await db.query(
      'SELECT 1 FROM documents WHERE user_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1',
      [docOwnerId, source.fileName],
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
        const gen = await analyzeSource(db, req.currentUser.id, source, plan, (m) => req.log.warn(m));
        sse.send('step', { index: 2, label: ANALYSIS_STEPS[2] });
        const result = await persistAnalysis(db, source.ownerUserId ?? req.currentUser.id, source, gen, req.currentUser.id, req);
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
      const gen = await analyzeSource(db, req.currentUser.id, source, plan, (m) => req.log.warn(m));
      const result = await persistAnalysis(db, source.ownerUserId ?? req.currentUser.id, source, gen, req.currentUser.id, req);
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
    // Undo/redo can re-introduce a {redlineId} slot whose redline row was deleted
    // by an earlier edit. The client sends its current redline snapshot; re-create
    // any that the (restored) document references but that no longer exist — so the
    // clause text a slot carries is never silently lost after a reload. DO NOTHING
    // on conflict: an existing redline keeps its real server status (a stale client
    // snapshot must not clobber an accepted/rejected state).
    const refSet = new Set(referenced);
    const SEV = new Set(['High', 'Medium', 'Low']);
    const STAT = new Set(['pending', 'accepted', 'rejected']);
    const incoming = Array.isArray(body.redlines) ? (body.redlines as unknown[]) : [];
    for (const [i, r] of incoming.slice(0, 200).entries()) {
      if (!isObject(r) || typeof r.id !== 'string' || !refSet.has(r.id)) continue;
      if (typeof r.delText !== 'string' || typeof r.insText !== 'string') continue;
      const severity = SEV.has(r.severity as string) ? (r.severity as string) : 'Medium';
      const status = STAT.has(r.status as string) ? (r.status as string) : 'pending';
      await db.query(
        `INSERT INTO redlines (analysis_id, id, ord, del_text, ins_text, severity, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (analysis_id, id) DO NOTHING`,
        [
          id,
          r.id,
          i,
          await encText(db, patchAccess.analysisUserId, r.delText),
          await encText(db, patchAccess.analysisUserId, r.insText),
          severity,
          status,
        ],
      );
    }
    await db.query(
      `DELETE FROM redlines WHERE analysis_id = $1 AND status = 'pending' AND NOT (id = ANY($2::text[]))`,
      [id, referenced],
    );
    // Clear finding→redline links that now dangle (the redline was retired just
    // above), so a finding card doesn't keep advertising a "jump to the change"
    // that leads nowhere after reload.
    await db.query(
      `UPDATE findings SET redline_id = NULL
       WHERE analysis_id = $1 AND redline_id IS NOT NULL
         AND redline_id NOT IN (SELECT id FROM redlines WHERE analysis_id = $1)`,
      [id],
    );
    return loadAnalysis(db, req.currentUser.id, id);
  });

  // Branded PDF report: summary, findings, redlines — ready to send to a client.
  app.get('/analysis/:id/report.pdf', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = await loadAnalysis(db, req.currentUser.id, id);

    // Рамка отчёта — на языке КОНТЕНТА анализа (русский разбор → русские
    // подписи), не UI: файл живёт дольше сессии и уходит третьим лицам.
    const contentSample = `${a.summary} ${a.findings.map((f) => f.title).join(' ')}`;
    // Русская рамка — для кириллического И узбекского контента (решение
    // продукта: рынок СНГ, узбекской рамки пока нет).
    const ru = looksRussian(contentSample) || looksUzbekLatin(contentSample);
    const SEV_RU: Record<string, string> = { High: 'Высокий', Medium: 'Средний', Low: 'Низкий' };
    const SEV_RU_LEVEL: Record<string, string> = { High: 'Высокий', Elevated: 'Повышенный', Low: 'Низкий' };
    const STATUS_RU: Record<string, string> = { pending: 'на рассмотрении', accepted: 'принята', rejected: 'отклонена' };
    const sev = (s: string) => (ru ? (SEV_RU[s] ?? s) : s);
    const sections: { heading?: string; text?: string }[] = [
      {
        text: ru
          ? `Файл: ${a.fileName} (${a.fileSize}) · Оценка риска: ${a.riskScore}/100 (${SEV_RU_LEVEL[a.riskLevel] ?? a.riskLevel}) · Проверено пунктов: ${a.clausesReviewed}`
          : `File: ${a.fileName} (${a.fileSize}) · Risk score: ${a.riskScore}/100 (${a.riskLevel}) · Clauses reviewed: ${a.clausesReviewed}`,
      },
      { heading: ru ? 'Сводка' : 'Summary' },
      { text: a.summary },
      { heading: ru ? `Находки (${a.findings.length})` : `Findings (${a.findings.length})` },
      ...a.findings.map((f, i) => ({ text: `${i + 1}. [${sev(f.severity)}] ${f.title} — ${f.citation}` })),
      { heading: ru ? `Предлагаемые правки (${a.redlines.length})` : `Suggested redlines (${a.redlines.length})` },
      ...a.redlines.map((r, i) => ({
        text: ru
          ? `${i + 1}. [${sev(r.severity)}] Заменить «${r.delText}» на «${r.insText}» — статус: ${STATUS_RU[r.status] ?? r.status}.`
          : `${i + 1}. [${r.severity}] Replace "${r.delText}" with "${r.insText}" — status: ${r.status}.`,
      })),
      { heading: ru ? 'Об этом отчёте' : 'About this report' },
      {
        text: ru
          ? 'Сформировано LexAI. Отчёт подготовлен с помощью ИИ и не является юридической консультацией.'
          : 'Generated by LexAI contract intelligence. This report is an AI-assisted review and does not constitute legal advice.',
      },
    ];
    const pdf = await buildSimplePdf(ru ? 'LexAI — Отчёт о проверке договора' : 'LexAI — Contract Review Report', sections);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', attachmentDisposition(`LexAI_Report_${a.fileName}`, 'pdf'));
    reply.header('Cache-Control', 'no-store');
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

    const redline = await setRedlineStatus(db, id, rlAccess.analysisUserId, rid, status);
    if (!redline) throw notFound('Redline not found');
    // Метаданные — только id правки и статус, НИКОГДА не текст изменений
    // (содержимое договора конфиденциально и зашифровано at-rest).
    if (status !== 'pending') {
      await audit(db, req, {
        type: status === 'accepted' ? 'redline.accepted' : 'redline.rejected',
        teamOwnerId: rlAccess.analysisUserId,
        target: { type: 'document', id, label: rid },
        metadata: { redlineId: rid },
      });
    }
    return redline;
  });
}

/**
 * Set one redline's status and return the decrypted redline (null when the id
 * doesn't belong to the analysis). Access control + audit stay with the caller.
 * Reused by PATCH /redlines and the agentic-workflow orchestrator (Этап 4).
 */
export async function setRedlineStatus(
  db: Db,
  analysisId: string,
  ownerUserId: string,
  rid: string,
  status: 'accepted' | 'rejected' | 'pending',
): Promise<Redline | null> {
  const res = await db.query<{ id: string; del_text: string; ins_text: string; severity: 'High' | 'Medium' | 'Low'; status: 'pending' | 'accepted' | 'rejected' }>(
    `UPDATE redlines SET status = $3 WHERE analysis_id = $1 AND id = $2
     RETURNING id, del_text, ins_text, severity, status`,
    [analysisId, rid, status],
  );
  const row = res.rows[0];
  if (!row) return null;
  const delText = await decText(db, ownerUserId, row.del_text);
  const insText = await decText(db, ownerUserId, row.ins_text);
  if (delText === null || insText === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
  return { id: row.id, delText, insText, severity: row.severity, status: row.status };
}
