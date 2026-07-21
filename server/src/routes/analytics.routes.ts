/**
 * GET /analytics/summary — aggregated live from review_events + user_stats,
 * so the numbers move as analyses run (seed reproduces the mock's figures).
 * Extended sections: 12-month activity, risk centre (top contracts / by
 * jurisdiction / by counterparty), compliance (citation validation + statute
 * corpus freshness) and per-member team workload (owner only).
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
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

    return {
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
      team,
    };
  });
}
