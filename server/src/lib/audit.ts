/**
 * Audit Log helper — append-only event trail (migration 030). Called explicitly
 * at route level. NEVER throws: an audit-write failure must never break the
 * business action (caught + logged as a warning).
 *
 * The AuditEventType union IS the taxonomy. It also reserves names for features
 * that don't exist yet (document.renamed, folders, comments, sso.*, user.blocked,
 * ownership transfer, virus scan) so those can start logging with no schema
 * change when they ship.
 *
 * PRIVACY: AI events store only { feature, ok, errorCode } — NEVER the prompt or
 * the model's output (Privacy-Policy promise; also keeps the never-store-law-text
 * rule intact — audit never persists model output at all).
 */
import type { FastifyRequest } from 'fastify';
import type { Db, Queryable } from '../db.ts';

export type AuditEventType =
  // auth
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.refresh'
  | 'auth.password_changed'
  | 'auth.password_reset'
  | 'auth.account_deleted'
  | 'auth.google_login'
  | 'auth.totp_enabled'
  | 'auth.totp_disabled'
  | 'auth.sessions_revoked'
  | 'user.data_exported'
  | 'document.retention_purged'
  | 'security.bruteforce_alert'
  // team / users (some reserved for features not built yet)
  | 'team.invited'
  | 'team.invite_accepted'
  | 'team.role_changed'
  | 'team.member_removed'
  | 'team.ownership_transferred' // reserved
  | 'user.blocked' // reserved
  | 'user.unblocked' // reserved
  // documents (some reserved)
  | 'document.created'
  | 'document.viewed'
  | 'document.shared'
  | 'document.unshared'
  | 'document.deleted'
  | 'document.exported'
  | 'document.renamed' // reserved
  | 'document.version_restored' // reserved
  | 'document.moved_to_folder' // reserved
  | 'document.archived' // reserved
  | 'document.template_created'
  // ai
  | 'ai.analysis'
  | 'ai.chat'
  | 'ai.draft'
  | 'ai.compare'
  // публичные ссылки на отчёт, вебхуки
  | 'analysis.share_created'
  | 'analysis.share_revoked'
  | 'settings.webhook_set'
  | 'settings.webhook_removed'
  // redlines (метаданные — только id правки, НИКОГДА не текст изменений)
  | 'redline.accepted'
  | 'redline.rejected'
  // files
  | 'file.uploaded'
  | 'file.deleted'
  | 'file.downloaded'
  | 'file.scan_passed' // reserved
  | 'file.scan_failed' // reserved
  // collaboration (some reserved)
  | 'comment.created' // reserved
  | 'comment.replied' // reserved
  | 'comment.resolved' // reserved
  | 'access.permissions_changed'
  // signatures / approvals
  | 'signature.requested'
  | 'signature.completed'
  | 'approval.started'
  | 'approval.decided'
  | 'approval.cancelled'
  // agentic workflows (Этап 4) — метаданные шагов, без текста договора
  | 'workflow.started'
  | 'workflow.step'
  | 'workflow.completed'
  | 'workflow.failed'
  // публичный API (тариф Business): жизненный цикл ключей. Сами вызовы
  // анализа журналируются как ai.analysis с actorLabel «api:<keyId>».
  | 'apikey.created'
  | 'apikey.revoked'
  // billing
  | 'billing.checkout'
  | 'billing.canceled'
  // sso (reserved for the SSO feature)
  | 'sso.config_changed'
  | 'sso.login'
  | 'sso.enforcement_denied';

export interface AuditInput {
  type: AuditEventType;
  /** Tenant scope. Defaults to the actor's own id when omitted; pass the
   *  document/team owner's id for actions on shared resources. */
  teamOwnerId?: string;
  actorId?: string | null;
  actorLabel?: string;
  target?: { type?: string; id?: string; label?: string };
  status?: 'ok' | 'error' | 'denied';
  metadata?: Record<string, unknown>;
}

const trunc = (s: string | undefined, n: number) => (s ? s.slice(0, n) : undefined);

/**
 * Append one audit event. Never throws. `req` supplies actor + ip + user-agent
 * when present; pass actorId/actorLabel explicitly for anonymous flows (e.g.
 * failed logins where there is no session).
 */
export async function audit(db: Queryable, req: FastifyRequest | null, e: AuditInput): Promise<void> {
  try {
    const actorId = e.actorId !== undefined ? e.actorId : (req?.currentUser?.id ?? null);
    const actorLabel = e.actorLabel ?? req?.currentUser?.email ?? null;
    const teamOwnerId = e.teamOwnerId ?? actorId ?? null;
    const ip = req?.ip ?? null;
    const ua = trunc(req?.headers['user-agent'] as string | undefined, 300) ?? null;
    // Hard-cap metadata size so a caller can't accidentally spill a big blob
    // (or sensitive body) into the log.
    const meta = JSON.stringify(e.metadata ?? {}).slice(0, 2000);
    await db.query(
      `INSERT INTO audit_events
        (team_owner_id, actor_id, actor_label, event_type, target_type, target_id, target_label, status, ip, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        teamOwnerId,
        actorId,
        trunc(actorLabel ?? undefined, 200) ?? null,
        e.type,
        e.target?.type ?? null,
        e.target?.id ?? null,
        trunc(e.target?.label, 300) ?? null,
        e.status ?? 'ok',
        ip,
        ua,
        meta,
      ],
    );
  } catch (err) {
    // An audit failure must never break the business action.
    if (req) req.log.warn(err, 'audit write failed');
    else console.warn('[audit] write failed:', (err as Error).message);
  }
}

/** Count recent audit events matching an event type, per ip OR per email in
 *  metadata — powers brute-force detection without any extra infra. */
export async function countRecent(
  db: Db,
  type: AuditEventType,
  windowMinutes: number,
  ip: string | null,
  email: string | null,
): Promise<number> {
  const res = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM audit_events
     WHERE event_type = $1 AND created_at > now() - ($2 || ' minutes')::interval
       AND (($3::text IS NOT NULL AND ip = $3) OR ($4::text IS NOT NULL AND metadata->>'email' = $4))`,
    [type, String(windowMinutes), ip, email],
  );
  return Number(res.rows[0]?.n ?? 0);
}
