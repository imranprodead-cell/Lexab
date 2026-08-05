/**
 * Публичная ссылка на отчёт анализа — для клиента/контрагента без аккаунта.
 *
 *   POST   /analysis/:id/share  — создать (или вернуть живую) ссылку
 *   DELETE /analysis/:id/share  — отозвать все ссылки анализа
 *   GET    /share/:token        — ПУБЛИЧНО: краткий отчёт (без текста договора)
 *
 * Паттерн токен-ссылки как у /sign/:token и /approve/:token. Наружу уходит
 * ТОЛЬКО витрина: имя файла, балл риска, резюме и находки с цитатами норм —
 * ни текста документа, ни правок, ни данных владельца, кроме названия фирмы.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { audit } from '../lib/audit.ts';
import { decText } from '../lib/docCrypto.ts';
import { notFound } from '../lib/errors.ts';
import { assertCanEdit, resolveAnalysisAccess } from '../lib/teamAccess.ts';

const RATE = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/** Сколько живёт публичная ссылка-отчёт. Столько же, сколько ссылка на подпись:
 *  бессрочная ссылка на содержание чужого договора — это утечка с отложенным
 *  сроком, а не удобство. */
const SHARE_TTL_DAYS = 90;

/** Переиспользовать живую или создать новую публичную ссылку-отчёт для анализа
 *  ВЛАДЕЛЬЦА (без проверки доступа — вызывающий уже подтвердил владение, напр.
 *  публичный API по api_requests.user_id). Возвращает полный URL /share/:token. */
export async function ensureAnalysisShareUrl(db: Db, userId: string, analysisId: string): Promise<string> {
  const live = await db.query<{ token: string }>(
    'SELECT token FROM analysis_shares WHERE analysis_id = $1 AND revoked_at IS NULL AND expires_at > now() LIMIT 1',
    [analysisId],
  );
  let token = live.rows[0]?.token;
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    await db.query(
      `INSERT INTO analysis_shares (token, analysis_id, user_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
      [token, analysisId, userId, String(SHARE_TTL_DAYS)],
    );
  }
  return `${config.appBaseUrl}/share/${token}`;
}

export function shareRoutes(app: FastifyInstance, db: Db): void {
  app.post('/analysis/:id/share', { preHandler: [app.authenticate], config: RATE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // Публиковать может владелец/админ/редактор — viewer только читает.
    const access = await resolveAnalysisAccess(db, req.currentUser.id, id);
    assertCanEdit(access.access);

    const live = await db.query<{ token: string }>(
      'SELECT token FROM analysis_shares WHERE analysis_id = $1 AND revoked_at IS NULL AND expires_at > now() LIMIT 1',
      [id],
    );
    let token = live.rows[0]?.token;
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url');
      await db.query(
        `INSERT INTO analysis_shares (token, analysis_id, user_id, expires_at)
         VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
        [token, id, req.currentUser.id, String(SHARE_TTL_DAYS)],
      );
      await audit(db, req, { type: 'analysis.share_created', teamOwnerId: access.analysisUserId, target: { type: 'analysis', id } });
    }
    reply.code(201);
    return { token, url: `${config.appBaseUrl}/share/${token}` };
  });

  app.delete('/analysis/:id/share', { preHandler: [app.authenticate], config: RATE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const access = await resolveAnalysisAccess(db, req.currentUser.id, id);
    assertCanEdit(access.access);
    await db.query('UPDATE analysis_shares SET revoked_at = now() WHERE analysis_id = $1 AND revoked_at IS NULL', [id]);
    await audit(db, req, { type: 'analysis.share_revoked', teamOwnerId: access.analysisUserId, target: { type: 'analysis', id } });
    reply.code(204);
  });

  // ПУБЛИЧНЫЙ отчёт по токену. 404 и для отозванных, и для несуществующих —
  // ответ не раскрывает, была ли ссылка когда-то живой.
  app.get('/share/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { token } = req.params as { token: string };
    // Второй контур поверх отзыва: истёкший срок и удалённый документ гасят
    // ссылку, даже если её забыли отозвать явно (аудит 2026-08-03).
    const share = await db.query<{ analysis_id: string; user_id: string }>(
      `SELECT s.analysis_id, s.user_id FROM analysis_shares s
         JOIN analyses a ON a.id = s.analysis_id
         LEFT JOIN documents d ON d.id = a.document_id
        WHERE s.token = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND (d.id IS NULL OR d.deleted_at IS NULL)`,
      [String(token).slice(0, 100)],
    );
    const row = share.rows[0];
    if (!row) throw notFound('Ссылка недействительна или отозвана / Link is invalid or revoked');

    const a = await db.query<{
      user_id: string;
      file_name: string;
      summary: string;
      risk_score: number;
      risk_level: string;
      clauses_reviewed: number;
      created_at: Date | string;
    }>(
      'SELECT user_id, file_name, summary, risk_score, risk_level, clauses_reviewed, created_at FROM analyses WHERE id = $1',
      [row.analysis_id],
    );
    const an = a.rows[0];
    if (!an) throw notFound('Ссылка недействительна или отозвана / Link is invalid or revoked');

    const findings = await db.query<{ severity: string; title: string; citation: string; unit_id: string | null; unverified: boolean; playbook_deviation: boolean }>(
      'SELECT severity, title, citation, unit_id, unverified, playbook_deviation FROM findings WHERE analysis_id = $1 ORDER BY ord',
      [row.analysis_id],
    );
    const firm = await db.query<{ firm: string }>('SELECT firm FROM users WHERE id = $1', [an.user_id]);

    return {
      fileName: an.file_name,
      // Резюме зашифровано ключом владельца; нерасшифровавшееся не валит отчёт.
      summary: (await decText(db, an.user_id, an.summary)) ?? '',
      riskScore: an.risk_score,
      riskLevel: an.risk_level,
      clausesReviewed: an.clauses_reviewed,
      analyzedAt: new Date(an.created_at as string).toISOString(),
      firm: firm.rows[0]?.firm ?? 'Lexab',
      findings: findings.rows.map((f) => ({
        severity: f.severity,
        title: f.title,
        citation: f.citation,
        verified: Boolean(f.unit_id) && !f.unverified,
        playbookDeviation: f.playbook_deviation,
      })),
    };
  });
}
