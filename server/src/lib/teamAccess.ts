/**
 * Team-shared document access.
 *
 * A document with team_shared=true is visible to every ACTIVE member of the
 * owner's team. Roles: admin & editor may edit (redlines, blocks, re-analysis),
 * viewer is read-only. The owner can always do everything.
 */
import type { Db } from '../db.ts';
import { HttpError, notFound } from './errors.ts';

export type TeamRole = 'admin' | 'editor' | 'viewer';

export interface DocumentRowFull {
  id: string;
  user_id: string;
  name: string;
  counterparty: string;
  status: string;
  risk: string;
  jurisdiction: string;
  size_bytes: number;
  updated_at: Date | string;
  team_shared: boolean;
}

export interface DocumentAccess {
  doc: DocumentRowFull;
  /** 'owner' or the viewer's team role. */
  access: 'owner' | TeamRole;
  /** Owner display name (set when the viewer is not the owner). */
  ownerName?: string;
}

/** Владелец команды, в которой пользователь состоит АКТИВНЫМ участником,
 *  или null (сам себе команда). Единая точка для «чьи плейбуки/фичи применяются». */
export async function activeTeamOwnerFor(db: Db, userId: string): Promise<string | null> {
  const res = await db.query<{ owner_user_id: string }>(
    "SELECT owner_user_id FROM team_members WHERE member_user_id = $1 AND status = 'active' AND owner_user_id <> $1 LIMIT 1",
    [userId],
  );
  return res.rows[0]?.owner_user_id ?? null;
}

/** The viewer's active role in the owner's team, or null. */
export async function teamRoleFor(db: Db, viewerId: string, ownerId: string): Promise<TeamRole | null> {
  if (viewerId === ownerId) return null;
  const res = await db.query<{ role: string }>(
    `SELECT role FROM team_members WHERE owner_user_id = $1 AND member_user_id = $2 AND status = 'active'`,
    [ownerId, viewerId],
  );
  const role = res.rows[0]?.role;
  return role === 'admin' || role === 'editor' || role === 'viewer' ? role : null;
}

/** Owner or team member (for shared docs) — otherwise 404. */
export async function resolveDocumentAccess(db: Db, userId: string, docId: string): Promise<DocumentAccess> {
  const res = await db.query<DocumentRowFull>(
    `SELECT id, user_id, name, counterparty, status, risk, jurisdiction, size_bytes, updated_at, team_shared
     FROM documents WHERE id = $1 AND deleted_at IS NULL`,
    [docId],
  );
  const doc = res.rows[0];
  if (!doc) throw notFound('Document not found');
  if (doc.user_id === userId) return { doc, access: 'owner' };

  if (doc.team_shared) {
    const role = await teamRoleFor(db, userId, doc.user_id);
    if (role) {
      const owner = await db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [doc.user_id]);
      return { doc, access: role, ownerName: owner.rows[0]?.name };
    }
  }
  throw notFound('Document not found');
}

export function canEdit(access: DocumentAccess['access']): boolean {
  return access === 'owner' || access === 'admin' || access === 'editor';
}

/** Throw 403 unless the access level allows editing. */
export function assertCanEdit(access: DocumentAccess['access']): void {
  if (!canEdit(access)) {
    throw new HttpError(403, 'У вас право «только чтение» в этой команде / Your team role is view-only');
  }
}

/** Analysis-level access: owner of the analysis, or team access via its document. */
export async function resolveAnalysisAccess(
  db: Db,
  userId: string,
  analysisId: string,
  write = false,
): Promise<{ analysisUserId: string; documentId: string | null; access: 'owner' | TeamRole }> {
  const res = await db.query<{ user_id: string; document_id: string | null }>(
    'SELECT user_id, document_id FROM analyses WHERE id = $1',
    [analysisId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('Analysis not found');
  if (row.user_id === userId) return { analysisUserId: row.user_id, documentId: row.document_id, access: 'owner' };

  if (row.document_id) {
    const docAccess = await resolveDocumentAccess(db, userId, row.document_id); // throws if no access
    if (write) assertCanEdit(docAccess.access);
    return { analysisUserId: row.user_id, documentId: row.document_id, access: docAccess.access as TeamRole };
  }
  throw notFound('Analysis not found');
}
