/**
 * Audit Log viewer (Business feature). The team owner sees every event in their
 * team scope (team_owner_id = their id): their own actions plus teammates'
 * actions on shared documents. Read is gated by the auditLog plan feature; the
 * append side (lib/audit.ts) is NOT gated so history exists the moment a user
 * upgrades.
 *
 *   GET /audit/events      — filtered, paginated (X-Total-Count header)
 *   GET /audit/events.csv  — same filters, CSV download
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { assertFeature } from '../lib/limits.ts';

interface EventRow {
  id: string | number;
  actor_label: string | null;
  event_type: string;
  target_type: string | null;
  target_label: string | null;
  status: string;
  ip: string | null;
  created_at: Date | string;
}

const AUDIT_RETENTION_DAYS = 365;

/** Build the WHERE clause + params shared by the JSON list and the CSV export. */
function buildFilter(ownerId: string, q: Record<string, string | undefined>): { where: string; params: unknown[] } {
  const params: unknown[] = [ownerId];
  const where: string[] = ['team_owner_id = $1'];
  // Event group prefix, e.g. "auth" or "document".
  if (q.group?.trim()) {
    params.push(`${q.group.trim()}.%`);
    where.push(`event_type LIKE $${params.length}`);
  }
  if (q.actorId?.trim()) {
    params.push(q.actorId.trim());
    where.push(`actor_id = $${params.length}`);
  }
  if (q.from?.trim()) {
    params.push(q.from.trim());
    where.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (q.to?.trim()) {
    params.push(q.to.trim());
    where.push(`created_at <= $${params.length}::timestamptz`);
  }
  // Free-text search across who / what / target ("ivan", "document.deleted", "NDA.pdf").
  if (q.q?.trim()) {
    // Escape LIKE wildcards so a user typing "%" doesn't match everything.
    const term = q.q.trim().slice(0, 200).replace(/([\\%_])/g, '\\$1');
    params.push(`%${term}%`);
    const n = params.length;
    where.push(`(actor_label ILIKE $${n} OR event_type ILIKE $${n} OR coalesce(target_label, '') ILIKE $${n})`);
  }
  return { where: where.join(' AND '), params };
}

export function auditRoutes(app: FastifyInstance, db: Db): void {
  app.get('/audit/events', { preHandler: [app.authenticate] }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'auditLog');
    const q = req.query as Record<string, string | undefined>;
    const { where, params } = buildFilter(req.currentUser.id, q);

    const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 200);
    const page = Math.max(Number(q.page) || 1, 1);

    const total = await db.query<{ count: string | number }>(`SELECT count(*) AS count FROM audit_events WHERE ${where}`, params);
    const rows = await db.query<EventRow>(
      `SELECT id, actor_label, event_type, target_type, target_label, status, ip, created_at
       FROM audit_events WHERE ${where}
       ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );
    reply.header('X-Total-Count', String(total.rows[0]?.count ?? 0));
    return rows.rows.map((r) => ({
      id: String(r.id),
      actor: r.actor_label,
      type: r.event_type,
      targetType: r.target_type,
      target: r.target_label,
      status: r.status,
      ip: r.ip,
      at: new Date(r.created_at).toISOString(),
    }));
  });

  app.get('/audit/events.csv', { preHandler: [app.authenticate] }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'auditLog');
    const q = req.query as Record<string, string | undefined>;
    const { where, params } = buildFilter(req.currentUser.id, q);
    const rows = await db.query<EventRow>(
      `SELECT actor_label, event_type, target_label, status, ip, created_at
       FROM audit_events WHERE ${where} ORDER BY created_at DESC LIMIT 10000`,
      params,
    );
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'time,actor,event,target,status,ip\n';
    const body = rows.rows
      .map((r) => [new Date(r.created_at).toISOString(), r.actor_label, r.event_type, r.target_label, r.status, r.ip].map(esc).join(','))
      .join('\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="audit-log.csv"');
    return header + body;
  });
}

/** Daily retention purge: drop events older than the retention window. The
 *  append-only trigger permits deleting rows past the same window. */
export async function checkAuditRetention(db: Db): Promise<void> {
  await db.query(`DELETE FROM audit_events WHERE created_at < now() - ($1 || ' days')::interval`, [String(AUDIT_RETENTION_DAYS)]);
}
