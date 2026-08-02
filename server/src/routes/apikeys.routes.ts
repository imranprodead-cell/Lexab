/**
 * Кабинетные роуты раздела «API» (JWT-сессия, фичегейт apiAccess = Business+):
 * управление ключами + статистика использования публичного API.
 *
 * Секрет ключа возвращается РОВНО один раз — в ответе POST. Дальше в списках
 * живёт только key_prefix («lxb_a1b2c3d4…»). Отзыв мгновенный: authenticateApiKey
 * ищет только строки с revoked_at IS NULL.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { generateApiKey, MAX_LIVE_KEYS } from '../lib/apiKeys.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { apiMonthlyUsage, assertFeature } from '../lib/limits.ts';
import { asObject, requireString } from '../lib/validate.ts';

interface KeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
}

const keyToWire = (r: KeyRow) => ({
  id: r.id,
  label: r.label,
  keyPrefix: `${r.key_prefix}…`,
  createdAt: new Date(r.created_at as string).toISOString(),
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string).toISOString() : null,
});

export function apiKeyRoutes(app: FastifyInstance, db: Db): void {
  // Список живых ключей (без секретов).
  app.get('/api-keys', { preHandler: [app.authenticate] }, async (req) => {
    await assertFeature(db, req.currentUser.id, 'apiAccess');
    const res = await db.query<KeyRow>(
      `SELECT id, label, key_prefix, created_at, last_used_at
       FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [req.currentUser.id],
    );
    return res.rows.map(keyToWire);
  });

  // Создать ключ — секрет в ответе показывается один раз.
  app.post('/api-keys', { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'apiAccess');
    const body = asObject(req.body);
    const label = requireString(body, 'label', { min: 1, max: 100 });

    const key = generateApiKey();
    // Счёт живых ключей и вставка — в ОДНОЙ транзакции под per-user блокировкой
    // (FOR UPDATE), иначе параллельные создания проскочили бы потолок (11+ ключей
    // из-за TOCTOU между count и INSERT).
    await db.withTx(async (tx) => {
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [req.currentUser.id]);
      const live = await tx.query<{ n: string | number }>(
        'SELECT count(*) AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL',
        [req.currentUser.id],
      );
      if (Number(live.rows[0]?.n ?? 0) >= MAX_LIVE_KEYS) {
        throw badRequest(`Не больше ${MAX_LIVE_KEYS} активных ключей — отзовите неиспользуемый. / At most ${MAX_LIVE_KEYS} active keys.`);
      }
      await tx.query(
        'INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)',
        [key.id, req.currentUser.id, label, key.hash, key.prefix],
      );
    });
    await audit(db, req, { type: 'apikey.created', target: { type: 'api_key', id: key.id, label } });
    reply.code(201);
    return {
      id: key.id,
      label,
      keyPrefix: `${key.prefix}…`,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      /** Полный секрет — ТОЛЬКО здесь; больше не показывается никогда. */
      key: key.raw,
    };
  });

  // Отозвать ключ (мгновенно перестаёт работать).
  app.delete('/api-keys/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    await assertFeature(db, req.currentUser.id, 'apiAccess');
    const { id } = req.params as { id: string };
    const res = await db.query<{ id: string; label: string }>(
      'UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id, label',
      [id, req.currentUser.id],
    );
    if (!res.rows[0]) throw notFound('Ключ не найден или уже отозван');
    await audit(db, req, { type: 'apikey.revoked', target: { type: 'api_key', id, label: res.rows[0].label } });
    reply.code(204);
  });

  // Статистика для раздела: месяц/остаток, дневная серия 30 дней, последние
  // вызовы, число активных ключей.
  app.get('/api-keys/usage', { preHandler: [app.authenticate] }, async (req) => {
    await assertFeature(db, req.currentUser.id, 'apiAccess');
    const userId = req.currentUser.id;
    const { used, limit } = await apiMonthlyUsage(db, userId);
    const days = await db.query<{ day: string; count: string | number }>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*) AS count
       FROM api_requests WHERE user_id = $1 AND created_at > now() - interval '30 days'
       GROUP BY 1 ORDER BY 1`,
      [userId],
    );
    const recent = await db.query<{ id: string; file_name: string; status: string; created_at: Date | string; key_label: string | null }>(
      `SELECT r.id, r.file_name, r.status, r.created_at, k.label AS key_label
       FROM api_requests r LEFT JOIN api_keys k ON k.id = r.key_id
       WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
      [userId],
    );
    const keys = await db.query<{ n: string | number }>(
      'SELECT count(*) AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    return {
      month: { used, limit, remaining: limit === null ? null : Math.max(limit - used, 0) },
      days: days.rows.map((d) => ({ day: d.day, count: Number(d.count) })),
      recent: recent.rows.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        status: r.status === 'queued' ? 'processing' : r.status,
        keyLabel: r.key_label,
        createdAt: new Date(r.created_at as string).toISOString(),
      })),
      activeKeys: Number(keys.rows[0]?.n ?? 0),
    };
  });
}
