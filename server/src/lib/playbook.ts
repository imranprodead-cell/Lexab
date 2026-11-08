/**
 * Плейбук команды — стандартные позиции фирмы по пунктам договора. Общий для
 * разбора договора (analyzeSource) и агента чата (инструмент get_playbook),
 * поэтому живёт здесь, а не в маршруте разбора.
 */
import type { Db } from '../db.ts';
import { decText } from './docCrypto.ts';
import { activeTeamOwnerFor } from './teamAccess.ts';

/** The account whose playbook applies when `userId` runs a review: their team's
 *  owner when they are an active member, otherwise themselves. */
export async function resolvePlaybookOwner(db: Db, userId: string): Promise<string> {
  // Единый резолвер команды (lib/teamAccess.ts) с ORDER BY created_at. Локальная
  // копия здесь брала LIMIT 1 БЕЗ порядка: у человека, состоящего в двух
  // командах, база возвращала произвольного владельца — и в анализ договора
  // фирмы А могли попасть конфиденциальные позиции фирмы Б (аудит 2026-08-03).
  return (await activeTeamOwnerFor(db, userId)) ?? userId;
}

/** Load the active playbook's rules as one prompt-ready text block for the given
 *  team owner + corpus (jurisdiction code), or null when none applies. Prefers a
 *  jurisdiction-specific playbook, falling back to a global (jurisdiction NULL)
 *  one. Rule text is decrypted with the OWNER's data key. */
export async function loadActivePlaybook(db: Db, ownerUserId: string, corpus: string | null): Promise<string | null> {
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

