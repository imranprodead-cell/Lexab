/**
 * GET /billing/subscription | POST /billing/checkout
 * Checkout returns a hosted-checkout URL. Wire a real PSP (Stripe/Paddle) by
 * replacing `checkoutUrl` with the provider's session URL.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { asObject, requireString } from '../lib/validate.ts';

const KNOWN_PLANS = ['Free', 'Standard', 'Pro', 'Business'];

/**
 * Plan limits (null = unlimited), mirroring the Plans page:
 * Free — 10 AI-запросов/мес, 3 документа/мес;
 * Standard — 100 / 20, 2 GB; Pro — безлимит AI, 80 док./мес, 50 GB;
 * Business — безлимит AI, 700 док./мес, 1 TB.
 */
const PLAN_LIMITS: Record<string, { ai: number | null; docs: number | null; storageMb: number | null }> = {
  Free: { ai: 10, docs: 3, storageMb: 100 },
  Standard: { ai: 100, docs: 20, storageMb: 2 * 1024 },
  Pro: { ai: null, docs: 80, storageMb: 50 * 1024 },
  Business: { ai: null, docs: 700, storageMb: 1024 * 1024 },
  Enterprise: { ai: null, docs: null, storageMb: null },
};

export function billingRoutes(app: FastifyInstance, db: Db): void {
  app.get('/billing/subscription', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{ plan: string; status: string; renews_at: Date | string | null }>(
      'SELECT plan, status, renews_at FROM subscriptions WHERE user_id = $1',
      [req.currentUser.id],
    );
    const row = res.rows[0] ?? { plan: 'Free', status: 'active', renews_at: null };
    return { plan: row.plan, status: row.status, renewsAt: row.renews_at ? toIso(row.renews_at) : null };
  });

  // Current usage vs the plan's monthly limits (drives the Settings widget).
  app.get('/billing/limits', { preHandler: [app.authenticate] }, async (req) => {
    const userId = req.currentUser.id;
    const sub = await db.query<{ plan: string }>('SELECT plan FROM subscriptions WHERE user_id = $1', [userId]);
    const plan = sub.rows[0]?.plan ?? 'Free';
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free;

    const count = async (sql: string): Promise<number> =>
      Number((await db.query<{ count: string | number }>(sql, [userId])).rows[0]?.count ?? 0);

    // "AI requests" = analyses run + assistant replies, this calendar month.
    const analyses = await count(
      `SELECT count(*) AS count FROM analyses WHERE user_id = $1 AND created_at >= date_trunc('month', now())`,
    );
    const replies = await count(
      `SELECT count(*) AS count FROM chat_messages m
       JOIN chat_sessions s ON s.id = m.session_id
       WHERE s.user_id = $1 AND m.role = 'assistant' AND m.created_at >= date_trunc('month', now())`,
    );
    const documents = await count(
      `SELECT count(*) AS count FROM documents WHERE user_id = $1 AND created_at >= date_trunc('month', now())`,
    );
    const storageBytes = Number(
      (await db.query<{ sum: string | number | null }>(
        'SELECT coalesce(sum(size_bytes), 0) AS sum FROM uploads WHERE user_id = $1',
        [userId],
      )).rows[0]?.sum ?? 0,
    );

    return {
      plan,
      aiRequests: { used: analyses + replies, limit: limits.ai },
      documents: { used: documents, limit: limits.docs },
      storageMb: { used: Math.round((storageBytes / (1024 * 1024)) * 10) / 10, limit: limits.storageMb },
    };
  });

  app.post('/billing/checkout', { preHandler: [app.authenticate] }, async (req) => {
    const body = asObject(req.body);
    const plan = requireString(body, 'plan', { min: 1, max: 50 });
    const normalized = KNOWN_PLANS.find((p) => p.toLowerCase() === plan.toLowerCase()) ?? plan;
    const sessionId = newId('cs');
    return {
      checkoutUrl: `https://checkout.lexai.example/session/${sessionId}?plan=${encodeURIComponent(normalized)}`,
    };
  });
}
