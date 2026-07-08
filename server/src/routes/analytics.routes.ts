/**
 * GET /analytics/summary — aggregated live from review_events + user_stats,
 * so the numbers move as analyses run (seed reproduces the mock's figures).
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import type { AnalyticsSummary } from '../types.ts';

const WEEKS = 6;
const WEEK_MS = 7 * 86_400_000;

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
    };
  });
}
