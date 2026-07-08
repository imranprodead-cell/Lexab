/** GET /notifications | POST /notifications/read { id? } (omit id = mark all) */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { relativeTimeRu } from '../lib/format.ts';
import { asObject, optionalString } from '../lib/validate.ts';
import type { AppNotification } from '../types.ts';

export function notificationRoutes(app: FastifyInstance, db: Db): void {
  app.get('/notifications', { preHandler: [app.authenticate] }, async (req): Promise<AppNotification[]> => {
    const res = await db.query<{
      id: string;
      icon: AppNotification['icon'];
      title: string;
      read: boolean;
      created_at: Date | string;
    }>(
      'SELECT id, icon, title, read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.currentUser.id],
    );
    return res.rows.map((r) => ({
      id: r.id,
      icon: r.icon,
      title: r.title,
      time: relativeTimeRu(new Date(r.created_at as string)),
      read: Boolean(r.read),
    }));
  });

  app.post('/notifications/read', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = req.body === undefined || req.body === null ? {} : asObject(req.body);
    const id = optionalString(body, 'id');
    if (id) {
      await db.query('UPDATE notifications SET read = true WHERE user_id = $1 AND id = $2', [req.currentUser.id, id]);
    } else {
      await db.query('UPDATE notifications SET read = true WHERE user_id = $1', [req.currentUser.id]);
    }
    reply.code(204);
  });
}
