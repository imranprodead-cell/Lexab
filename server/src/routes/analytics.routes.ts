/**
 * GET /analytics/summary — aggregated live from review_events + user_stats,
 * so the numbers move as analyses run (seed reproduces the mock's figures).
 * Extended sections: 12-month activity, risk centre (top contracts / by
 * jurisdiction / by counterparty), compliance (citation validation + statute
 * corpus freshness) and per-member team workload (owner only).
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { decText } from '../lib/docCrypto.ts';
import { planFor, planHasFeature } from '../lib/limits.ts';
import type { AnalyticsSummary, RiskLevel } from '../types.ts';

const WEEKS = 6;
const WEEK_MS = 7 * 86_400_000;
const MONTHS = 12;

/** "YYYY-MM" for a date, in UTC (a stable bucket key on server and client). */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The last N calendar-month keys, oldest first, ending at the current month. */
function lastMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return keys;
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Вкладка «Analytics» по образцу Harvey (ui-test 2026-11-15): не «оценки»
 * (сэкономленные часы, средний риск), а то, как фирма пользуется продуктом,
 * и что требует работы юриста. Только данные владельца (как остальная сводка).
 */
async function analyticsExtras(
  db: Db,
  userId: string,
): Promise<Pick<AnalyticsSummary, 'pulse' | 'weekly' | 'decisions' | 'topics' | 'renewals'>> {
  const counts = await db.query<{ r30: string | number; rprev: string | number; q30: string | number; qprev: string | number }>(
    `SELECT
       (SELECT count(*) FROM review_events WHERE user_id = $1 AND created_at > now() - interval '30 days') AS r30,
       (SELECT count(*) FROM review_events WHERE user_id = $1
          AND created_at <= now() - interval '30 days' AND created_at > now() - interval '60 days') AS rprev,
       (SELECT count(*) FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.role = 'user' AND m.kind = 'text' AND m.created_at > now() - interval '30 days') AS q30,
       (SELECT count(*) FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.user_id = $1 AND m.role = 'user' AND m.kind = 'text'
           AND m.created_at <= now() - interval '30 days' AND m.created_at > now() - interval '60 days') AS qprev`,
    [userId],
  );
  const c = counts.rows[0];

  // 12 скользящих недель (как reviewsByWeek): индекс 0 — последние 7 дней.
  const WEEKS12 = 12;
  const now = Date.now();
  const weekly = Array.from({ length: WEEKS12 }, (_, i) => {
    const endMs = now - (WEEKS12 - 1 - i) * WEEK_MS;
    return { start: isoDay(endMs - WEEK_MS + DAY_MS), end: isoDay(endMs), reviews: 0, questions: 0 };
  });
  const bucket = (at: Date | string): number => {
    const idx = Math.floor((now - new Date(at as string).getTime()) / WEEK_MS);
    return idx >= 0 && idx < WEEKS12 ? WEEKS12 - 1 - idx : -1;
  };
  const rev = await db.query<{ created_at: Date | string }>(
    `SELECT created_at FROM review_events WHERE user_id = $1 AND created_at > now() - interval '84 days'`,
    [userId],
  );
  for (const r of rev.rows) {
    const b = bucket(r.created_at);
    if (b >= 0) weekly[b].reviews += 1;
  }
  const qs = await db.query<{ created_at: Date | string }>(
    `SELECT m.created_at FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id
      WHERE s.user_id = $1 AND m.role = 'user' AND m.kind = 'text' AND m.created_at > now() - interval '84 days'`,
    [userId],
  );
  for (const q of qs.rows) {
    const b = bucket(q.created_at);
    if (b >= 0) weekly[b].questions += 1;
  }

  // Ждут решения: последний разбор каждого договора, сделанный за 30 дней.
  const waitingRows = await db.query<{ document_id: string; analysis_id: string; name: string; waiting: string | number; total: string | number }>(
    `SELECT d.id AS document_id, a.id AS analysis_id, d.name,
            count(f.id) FILTER (WHERE fd.kind IS NULL OR fd.kind = 'assigned') AS waiting,
            count(f.id) AS total
       FROM documents d
       JOIN LATERAL (
         SELECT id, created_at FROM analyses a WHERE a.document_id = d.id ORDER BY a.created_at DESC LIMIT 1
       ) a ON true
       JOIN findings f ON f.analysis_id = a.id
       LEFT JOIN finding_decisions fd ON fd.analysis_id = f.analysis_id AND fd.finding_id = f.id
      WHERE d.user_id = $1 AND d.deleted_at IS NULL AND a.created_at > now() - interval '30 days'
      GROUP BY d.id, a.id, d.name, d.updated_at
     HAVING count(f.id) FILTER (WHERE fd.kind IS NULL OR fd.kind = 'assigned') > 0
      ORDER BY waiting DESC, d.updated_at DESC`,
    [userId],
  );
  const decided = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM finding_decisions fd JOIN analyses a ON a.id = fd.analysis_id
      WHERE a.user_id = $1 AND fd.kind IN ('fixed', 'ok') AND fd.decided_at > now() - interval '30 days'`,
    [userId],
  );

  // Темы: по последнему разбору каждого договора (весь портфель).
  const topicRows = await db.query<{ topic: string | null; total: string | number; high: string | number }>(
    `SELECT f.topic, count(*) AS total, count(*) FILTER (WHERE f.severity = 'High' AND NOT f.unverified) AS high
       FROM documents d
       JOIN LATERAL (SELECT id FROM analyses a WHERE a.document_id = d.id ORDER BY a.created_at DESC LIMIT 1) a ON true
       JOIN findings f ON f.analysis_id = a.id
      WHERE d.user_id = $1 AND d.deleted_at IS NULL
      GROUP BY f.topic`,
    [userId],
  );

  // Сроки отказа от продления (только тариф с «Контрактами»): окончание − срок
  // уведомления попадает в ближайшие 30 дней и нет отметки по этой дате.
  let renewals: AnalyticsSummary['renewals'] = null;
  if (planHasFeature(await planFor(db, userId), 'clm')) {
    const rows = await db.query<{ document_id: string; name: string; counterparty: string; last: string; mark_last: string | null }>(
      `SELECT d.id AS document_id, d.name, d.counterparty,
              to_char(ct.expiry_date - ct.renewal_notice_days, 'YYYY-MM-DD') AS last,
              to_char(rm.last_day, 'YYYY-MM-DD') AS mark_last
         FROM contract_terms ct
         JOIN documents d ON d.id = ct.document_id AND d.deleted_at IS NULL
         LEFT JOIN renewal_marks rm ON rm.document_id = d.id
        WHERE d.user_id = $1 AND ct.auto_renew = true AND ct.renewal_notice_days IS NOT NULL AND ct.expiry_date IS NOT NULL
          AND ct.expiry_date - ct.renewal_notice_days BETWEEN current_date AND current_date + 30
        ORDER BY ct.expiry_date - ct.renewal_notice_days`,
      [userId],
    );
    const open = rows.rows.filter((r) => r.mark_last !== r.last);
    renewals = {
      count: open.length,
      top: open.slice(0, 5).map((r) => ({ documentId: r.document_id, name: r.name, counterparty: r.counterparty, last: r.last })),
    };
  }

  return {
    pulse: {
      reviews30d: Number(c?.r30 ?? 0),
      reviewsPrev30d: Number(c?.rprev ?? 0),
      questions30d: Number(c?.q30 ?? 0),
      questionsPrev30d: Number(c?.qprev ?? 0),
    },
    weekly,
    decisions: {
      waiting: waitingRows.rows.reduce((n, r) => n + Number(r.waiting), 0),
      decided30d: Number(decided.rows[0]?.n ?? 0),
      top: waitingRows.rows.slice(0, 5).map((r) => ({
        documentId: r.document_id,
        analysisId: r.analysis_id,
        name: r.name,
        waiting: Number(r.waiting),
        total: Number(r.total),
      })),
    },
    topics: {
      items: topicRows.rows
        .filter((r) => r.topic)
        .map((r) => ({ topic: r.topic as string, total: Number(r.total), high: Number(r.high) }))
        .sort((a, b) => b.total - a.total),
      unlabeled: topicRows.rows.filter((r) => !r.topic).reduce((n, r) => n + Number(r.total), 0),
    },
    renewals,
  };
}

export function analyticsRoutes(app: FastifyInstance, db: Db): void {
  app.get('/analytics/summary', { preHandler: [app.authenticate] }, async (req): Promise<AnalyticsSummary> => {
    const userId = req.currentUser.id;

    const totals = await db.query<{ count: string | number; avg: string | number | null }>(
      'SELECT count(*) AS count, avg(risk_score) AS avg FROM review_events WHERE user_id = $1',
      [userId],
    );
    const contractsReviewed = Number(totals.rows[0]?.count ?? 0);
    const avgRiskScore = Math.round(Number(totals.rows[0]?.avg ?? 0));

    const recent = await db.query<{ created_at: Date | string }>(
      `SELECT created_at FROM review_events WHERE user_id = $1 AND created_at > now() - interval '42 days'`,
      [userId],
    );
    const now = Date.now();
    const buckets = new Array<number>(WEEKS).fill(0);
    for (const row of recent.rows) {
      const age = now - new Date(row.created_at as string).getTime();
      const idx = Math.floor(age / WEEK_MS); // 0 = most recent week
      if (idx >= 0 && idx < WEEKS) buckets[WEEKS - 1 - idx]++;
    }

    const stats = await db.query<{
      findings_high: number;
      findings_medium: number;
      findings_low: number;
      hours_saved_minutes: number;
    }>('SELECT findings_high, findings_medium, findings_low, hours_saved_minutes FROM user_stats WHERE user_id = $1', [
      userId,
    ]);
    const s = stats.rows[0] ?? { findings_high: 0, findings_medium: 0, findings_low: 0, hours_saved_minutes: 0 };

    // ── 12-month activity: reviews + findings, bucketed by calendar month ──
    const monthKeys = lastMonthKeys(MONTHS);
    const monthIdx = new Map(monthKeys.map((k, i) => [k, i]));
    const monthly = monthKeys.map((month) => ({ month, reviews: 0, findings: 0 }));

    const yearReviews = await db.query<{ created_at: Date | string }>(
      `SELECT created_at FROM review_events WHERE user_id = $1 AND created_at > now() - interval '366 days'`,
      [userId],
    );
    for (const row of yearReviews.rows) {
      const i = monthIdx.get(monthKey(new Date(row.created_at as string)));
      if (i !== undefined) monthly[i].reviews++;
    }
    // Findings are attributed to WHOEVER RAN the review (chargeUserId) — the same
    // basis as monthly.reviews and the top metrics — NOT to the document owner
    // (`analyses.user_id`), which for a shared team document is someone else.
    // review_events.analysis_id links each event to ITS analysis exactly (the
    // old created_at+risk_score heuristic double-counted on collisions); legacy
    // rows with NULL analysis_id keep the heuristic as a fallback.
    const yearFindings = await db.query<{ created_at: Date | string; n: string | number }>(
      `SELECT re.created_at, count(f.id) AS n
         FROM review_events re
         JOIN analyses a ON (re.analysis_id IS NOT NULL AND a.id = re.analysis_id)
                         OR (re.analysis_id IS NULL AND a.user_id = re.user_id
                             AND a.created_at = re.created_at AND a.risk_score = re.risk_score)
         JOIN findings f ON f.analysis_id = a.id
        WHERE re.user_id = $1 AND re.created_at > now() - interval '366 days'
        GROUP BY re.id, re.created_at`,
      [userId],
    );
    for (const row of yearFindings.rows) {
      const i = monthIdx.get(monthKey(new Date(row.created_at as string)));
      if (i !== undefined) monthly[i].findings += Number(row.n);
    }

    // ── Risk centre ──
    const topContracts = await db.query<{
      id: string;
      name: string;
      counterparty: string;
      risk_score: number;
      risk_level: RiskLevel;
    }>(
      `SELECT d.id, d.name, d.counterparty, a.risk_score, a.risk_level
         FROM documents d
         JOIN LATERAL (
           SELECT risk_score, risk_level FROM analyses a
            WHERE a.document_id = d.id ORDER BY a.created_at DESC LIMIT 1
         ) a ON true
        WHERE d.user_id = $1 AND d.deleted_at IS NULL
        ORDER BY a.risk_score DESC, d.updated_at DESC
        LIMIT 5`,
      [userId],
    );
    const byJurisdiction = await db.query<{ jurisdiction: string; total: string | number; high: string | number }>(
      `SELECT jurisdiction, count(*) AS total, count(*) FILTER (WHERE risk = 'High') AS high
         FROM documents WHERE user_id = $1 AND deleted_at IS NULL
        GROUP BY jurisdiction ORDER BY count(*) DESC LIMIT 8`,
      [userId],
    );
    const byCounterparty = await db.query<{ counterparty: string; total: string | number; high: string | number }>(
      `SELECT counterparty, count(*) AS total, count(*) FILTER (WHERE risk = 'High') AS high
         FROM documents WHERE user_id = $1 AND counterparty <> '—' AND deleted_at IS NULL
        GROUP BY counterparty ORDER BY count(*) DESC LIMIT 8`,
      [userId],
    );

    // ── Compliance: citation validation + statute-corpus freshness ──
    const citations = await db.query<{ verified: string | number; unverified: string | number }>(
      `SELECT count(*) FILTER (WHERE NOT f.unverified) AS verified,
              count(*) FILTER (WHERE f.unverified)     AS unverified
         FROM findings f JOIN analyses a ON f.analysis_id = a.id
         LEFT JOIN documents d ON d.id = a.document_id
        WHERE a.user_id = $1 AND (d.id IS NULL OR d.deleted_at IS NULL)`,
      [userId],
    );
    // The statute corpus is shared, not per-user: freshness per jurisdiction.
    const corpus = await db.query<{ jurisdiction: string; documents: string | number; updated_at: Date | string | null }>(
      `SELECT jurisdiction, count(*) AS documents, max(retrieved_at) AS updated_at
         FROM legal_documents GROUP BY jurisdiction ORDER BY jurisdiction`,
    );

    // ── Team workload (only when the viewer OWNS an active team) ──
    // Counted from audit_events SCOPED TO THIS TEAM (team_owner_id = owner):
    // a member's work on their own documents or for other teams is their own
    // business and must never surface here. review_events is deliberately NOT
    // used — it is platform-wide per user and would leak outside activity.
    const members = await db.query<{ member_user_id: string; name: string; role: string }>(
      `SELECT member_user_id, name, role FROM team_members
        WHERE owner_user_id = $1 AND status = 'active'
          AND member_user_id IS NOT NULL AND member_user_id <> $1`,
      [userId],
    );
    // «Деньги под риском»: суммы договоров (CLM) по уровням риска документа.
    // Стоимость зашифрована ключом владельца — расшифровываем построчно;
    // валюты не смешиваем (по группе на валюту). Число вытаскиваем из строки
    // («420 000», «USD 1,200,000» → 420000 / 1200000).
    const varRows = await db.query<{ value_enc: string; currency: string | null; risk: string; expiry_date: string | null }>(
      `SELECT ct.contract_value_enc AS value_enc, ct.currency, d.risk,
              to_char(ct.expiry_date, 'YYYY-MM-DD') AS expiry_date
       FROM contract_terms ct
       JOIN documents d ON d.id = ct.document_id AND d.deleted_at IS NULL
       WHERE d.user_id = $1 AND ct.contract_value_enc IS NOT NULL`,
      [userId],
    );
    const byCurrency = new Map<string, { high: number; elevated: number; low: number; total: number }>();
    let highRiskExpiringSoon = 0;
    const soon = Date.now() + 92 * 86_400_000;
    for (const r of varRows.rows) {
      const raw = await decText(db, userId, r.value_enc);
      if (!raw) continue;
      const num = Number(raw.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
      if (!Number.isFinite(num) || num <= 0) continue;
      const cur = (r.currency ?? '').trim().toUpperCase() || '—';
      const slot = byCurrency.get(cur) ?? { high: 0, elevated: 0, low: 0, total: 0 };
      if (r.risk === 'High') slot.high += num;
      else if (r.risk === 'Elevated') slot.elevated += num;
      else slot.low += num;
      slot.total += num;
      byCurrency.set(cur, slot);
      if (r.risk === 'High' && r.expiry_date && new Date(r.expiry_date).getTime() <= soon && new Date(r.expiry_date).getTime() >= Date.now() - 86_400_000) {
        highRiskExpiringSoon += 1;
      }
    }
    const valueAtRisk: AnalyticsSummary['valueAtRisk'] = {
      currencies: [...byCurrency.entries()]
        .map(([currency, v]) => ({ currency, ...v }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 4),
      highRiskExpiringSoon,
    };

    let team: AnalyticsSummary['team'] = null;
    if (members.rows.length > 0) {
      const ids = [userId, ...members.rows.map((m) => m.member_user_id)];
      const work = await db.query<{
        actor_id: string;
        total: string | number;
        recent: string | number;
        last: Date | string | null;
      }>(
        `SELECT actor_id, count(*) AS total,
                count(*) FILTER (WHERE created_at > now() - interval '30 days') AS recent,
                max(created_at) AS last
           FROM audit_events
          WHERE team_owner_id = $1 AND event_type = 'ai.analysis' AND actor_id = ANY($2)
          GROUP BY actor_id`,
        [userId, ids],
      );
      const byId = new Map(work.rows.map((w) => [w.actor_id, w]));
      const rowFor = (id: string, name: string, role: string) => {
        const w = byId.get(id);
        return {
          id,
          name,
          role,
          reviews30d: Number(w?.recent ?? 0),
          reviewsTotal: Number(w?.total ?? 0),
          lastActive: w?.last ? new Date(w.last as string).toISOString() : null,
        };
      };
      team = [
        rowFor(userId, req.currentUser.name, 'owner'),
        ...members.rows.map((m) => rowFor(m.member_user_id, m.name, m.role)),
      ];
    }

    // ── Новая вкладка: пульс 30 дней, 12 недель, решения, темы, сроки отказа ──
    const extra = await analyticsExtras(db, userId);

    return {
      ...extra,
      contractsReviewed,
      avgRiskScore,
      highRiskFindings: Number(s.findings_high),
      hoursSaved: Math.floor(Number(s.hours_saved_minutes) / 60),
      reviewsByWeek: buckets.map((count, i) => ({ week: `W${i + 1}`, count })),
      findingsBySeverity: [
        { severity: 'High', count: Number(s.findings_high) },
        { severity: 'Medium', count: Number(s.findings_medium) },
        { severity: 'Low', count: Number(s.findings_low) },
      ],
      monthly,
      riskCenter: {
        topContracts: topContracts.rows.map((r) => ({
          id: r.id,
          name: r.name,
          counterparty: r.counterparty,
          riskScore: Number(r.risk_score),
          riskLevel: r.risk_level,
        })),
        byJurisdiction: byJurisdiction.rows.map((r) => ({
          jurisdiction: r.jurisdiction,
          total: Number(r.total),
          high: Number(r.high),
        })),
        byCounterparty: byCounterparty.rows.map((r) => ({
          counterparty: r.counterparty,
          total: Number(r.total),
          high: Number(r.high),
        })),
      },
      compliance: {
        verified: Number(citations.rows[0]?.verified ?? 0),
        unverified: Number(citations.rows[0]?.unverified ?? 0),
        corpus: corpus.rows.map((r) => ({
          jurisdiction: r.jurisdiction,
          documents: Number(r.documents),
          updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : null,
        })),
      },
      valueAtRisk,
      team,
    };
  });
}
