/**
 * Настройки исходящих вебхуков Slack/Teams:
 *   GET    /me/webhooks                 — список (URL замаскирован)
 *   PUT    /me/webhooks                 — { provider, url } сохранить
 *   DELETE /me/webhooks/:provider       — отключить
 *   POST   /me/webhooks/:provider/test  — отправить тестовое сообщение
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { decText, encText } from '../lib/docCrypto.ts';
import { isAllowedWebhookUrl, postWebhook, type WebhookProvider } from '../lib/webhooks.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { audit } from '../lib/audit.ts';

const RATE = { rateLimit: { max: 15, timeWindow: '1 minute' } };

function parseProvider(raw: unknown): WebhookProvider {
  if (raw !== 'slack' && raw !== 'teams') throw badRequest('Поле "provider" — slack или teams');
  return raw;
}

/** hooks.slack.com/services/T…/B…/xxx → hooks.slack.com/…xxxx (хвост для узнавания). */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}/…${url.slice(-4)}`;
  } catch {
    return '…';
  }
}

export function webhookSettingsRoutes(app: FastifyInstance, db: Db): void {
  app.get('/me/webhooks', { preHandler: [app.authenticate] }, async (req) => {
    const rows = await db.query<{ provider: WebhookProvider; url_enc: string; created_at: Date | string }>(
      'SELECT provider, url_enc, created_at FROM user_webhooks WHERE user_id = $1 ORDER BY provider',
      [req.currentUser.id],
    );
    const out = [];
    for (const r of rows.rows) {
      const url = await decText(db, req.currentUser.id, r.url_enc);
      out.push({ provider: r.provider, maskedUrl: url ? maskUrl(url) : '…', createdAt: new Date(r.created_at as string).toISOString() });
    }
    return out;
  });

  app.put('/me/webhooks', { preHandler: [app.authenticateReal], config: RATE }, async (req) => {
    const body = asObject(req.body);
    const provider = parseProvider(body.provider);
    const url = requireString(body, 'url', { min: 20, max: 1000 }).trim();
    if (!isAllowedWebhookUrl(provider, url)) {
      throw badRequest(
        provider === 'slack'
          ? 'Нужен входящий вебхук Slack: https://hooks.slack.com/… / Expected a Slack incoming webhook: https://hooks.slack.com/…'
          : 'Нужен вебхук Teams: https://…webhook.office.com/… или https://…logic.azure.com/… / Expected a Teams webhook URL',
      );
    }
    const enc = await encText(db, req.currentUser.id, url);
    await db.query(
      `INSERT INTO user_webhooks (user_id, provider, url_enc) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, provider) DO UPDATE SET url_enc = EXCLUDED.url_enc, created_at = now()`,
      [req.currentUser.id, provider, enc],
    );
    await audit(db, req, { type: 'settings.webhook_set', teamOwnerId: req.currentUser.id, metadata: { provider } });
    return { provider, maskedUrl: maskUrl(url) };
  });

  app.delete('/me/webhooks/:provider', { preHandler: [app.authenticate], config: RATE }, async (req, reply) => {
    const provider = parseProvider((req.params as { provider: string }).provider);
    await db.query('DELETE FROM user_webhooks WHERE user_id = $1 AND provider = $2', [req.currentUser.id, provider]);
    await audit(db, req, { type: 'settings.webhook_removed', teamOwnerId: req.currentUser.id, metadata: { provider } });
    reply.code(204);
  });

  app.post('/me/webhooks/:provider/test', { preHandler: [app.authenticateReal], config: RATE }, async (req) => {
    const provider = parseProvider((req.params as { provider: string }).provider);
    const row = await db.query<{ url_enc: string }>(
      'SELECT url_enc FROM user_webhooks WHERE user_id = $1 AND provider = $2',
      [req.currentUser.id, provider],
    );
    if (!row.rows[0]) throw notFound('Вебхук не настроен / Webhook is not configured');
    const url = await decText(db, req.currentUser.id, row.rows[0].url_enc);
    if (!url) throw notFound('Вебхук не настроен / Webhook is not configured');
    const ok = await postWebhook(provider, url, 'Lexab: тестовое уведомление', 'Канал подключён — сюда будут приходить события (анализ готов, согласование ждёт, подпись задерживается).');
    return { ok };
  });
}
