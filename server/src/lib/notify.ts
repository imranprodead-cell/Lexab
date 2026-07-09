/** Insert a bilingual in-app notification (RU primary + EN variant). */
import type { Db } from '../db.ts';
import { newId } from './ids.ts';

export type NotificationIcon = 'esign' | 'check' | 'alert' | 'docs';

export interface NotifyOptions {
  /** Second dim line under the title (details: file name, sender, …). */
  bodyRu?: string;
  bodyEn?: string;
  /** Action button in the bell: accept a team invite or open an app page. */
  action?: { kind: 'team_invite'; data: string } | { kind: 'open'; data: string };
}

export async function notify(
  db: Db,
  userId: string,
  icon: NotificationIcon,
  titleRu: string,
  titleEn: string,
  opts: NotifyOptions = {},
): Promise<void> {
  await db.query(
    `INSERT INTO notifications (id, user_id, icon, title, title_en, body, body_en, action_kind, action_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      newId('n'),
      userId,
      icon,
      titleRu,
      titleEn,
      opts.bodyRu ?? null,
      opts.bodyEn ?? null,
      opts.action?.kind ?? null,
      opts.action?.data ?? null,
    ],
  );
}
