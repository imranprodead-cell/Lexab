/**
 * POST /onboarding/sample — мгновенный «вау-момент» для новичка: готовый
 * разбор образца NDA открывается в воркспейсе за секунду, без загрузки файла,
 * без вызова ИИ и БЕЗ списания лимитов (ни документ-квота, ни ИИ-квота,
 * ни хранилище не трогаются — поэтому вставка своя, а не persistAnalysis).
 *
 * Идемпотентно: повторный вызов возвращает уже созданный образец. Цитаты
 * демо-находок сверяются с корпусом на месте: пропавшая статья честно
 * получает «не подтверждено» вместо липового бейджа.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { SAMPLE_FILE_NAME, SAMPLE_FILE_SIZE, SAMPLE_GEN, SAMPLE_JURISDICTION } from '../data/sampleAnalysis.ts';
import { encJsonForJsonb, encText } from '../lib/docCrypto.ts';
import { newId } from '../lib/ids.ts';
import { audit } from '../lib/audit.ts';
import { loadAnalysis } from './analysis.routes.ts';
import type { AnalysisResult } from '../types.ts';

export function onboardingRoutes(app: FastifyInstance, db: Db): void {
  app.post(
    '/onboarding/sample',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply): Promise<AnalysisResult> => {
      const userId = req.currentUser.id;

      const existing = await db.query<{ id: string }>(
        'SELECT id FROM analyses WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1',
        [userId, SAMPLE_FILE_NAME],
      );
      if (existing.rows[0]) return loadAnalysis(db, userId, existing.rows[0].id);

      // Честная сверка демо-цитат с корпусом (та же валидность «на сегодня»,
      // что у валидатора цитат) — исключённая статья не носит бейдж «Проверено».
      const findings = [] as typeof SAMPLE_GEN.findings;
      for (const f of SAMPLE_GEN.findings) {
        if (!f.unitId) {
          findings.push({ ...f });
          continue;
        }
        const unit = await db.query(
          `SELECT 1 FROM legal_units WHERE id = $1
             AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
             AND (valid_to   IS NULL OR valid_to   >= CURRENT_DATE)`,
          [f.unitId],
        );
        findings.push(unit.rows.length ? { ...f } : { ...f, unitId: null, unverified: true });
      }

      // Шифрование ДО транзакции (ключ идемпотентен; см. persistAnalysis).
      const encSummary = await encText(db, userId, SAMPLE_GEN.summary);
      const encBlocks = await encJsonForJsonb(db, userId, SAMPLE_GEN.document);
      const encRedlines = await Promise.all(
        SAMPLE_GEN.redlines.map(async (r) => ({
          ...r,
          delText: await encText(db, userId, r.delText),
          insText: await encText(db, userId, r.insText),
        })),
      );

      const analysisId = newId('an');
      const documentId = newId('d');
      await db.withTx(async (tx) => {
        // Документ без reserveDocument: демо не занимает слот тарифа.
        await tx.query(
          `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, size_bytes)
           VALUES ($1, $2, $3, $4, 'Reviewed', $5, $6, 0)`,
          [documentId, userId, SAMPLE_FILE_NAME, SAMPLE_GEN.counterparty ?? '—', SAMPLE_GEN.riskLevel, SAMPLE_JURISDICTION],
        );
        await tx.query(
          `INSERT INTO document_versions (id, document_id, label, author, note)
           VALUES ($1, $2, 'Демо-образец', 'Lexab', 'Учебный пример анализа — лимиты не расходуются.')`,
          [newId('v'), documentId],
        );
        await tx.query(
          `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [analysisId, userId, documentId, SAMPLE_FILE_NAME, SAMPLE_FILE_SIZE, encSummary, SAMPLE_GEN.riskScore, SAMPLE_GEN.riskLevel, SAMPLE_GEN.clausesReviewed, encBlocks],
        );
        for (let i = 0; i < findings.length; i++) {
          const f = findings[i];
          await tx.query(
            'INSERT INTO findings (analysis_id, id, ord, severity, title, citation, unit_id, redline_id, unverified, playbook_deviation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
            [analysisId, `f${i + 1}`, i, f.severity, f.title, f.citation, f.unitId ?? null, f.redlineId || null, f.unverified ?? false, false],
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
      });
      await audit(db, req, { type: 'analysis.sample_created', teamOwnerId: userId, target: { type: 'document', label: SAMPLE_FILE_NAME } });

      reply.code(201);
      return loadAnalysis(db, userId, analysisId);
    },
  );
}
