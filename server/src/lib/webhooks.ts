/**
 * Исходящие вебхуки Slack / Microsoft Teams: каждое уведомление колокольчика
 * дублируется в настроенные пользователем каналы.
 *
 * Безопасность: URL принимаются ТОЛЬКО по https и только на официальных
 * хостах провайдеров (allowlist) — иначе поле «ваш вебхук» превращалось бы в
 * SSRF-прокси во внутреннюю сеть. URL содержит секрет — храним зашифрованным
 * ключом пользователя (user_webhooks.url_enc).
 */
import { getDb, type Db } from '../db.ts';
import { decText } from './docCrypto.ts';

export type WebhookProvider = 'slack' | 'teams';

/** Разрешённые хосты входящих вебхуков провайдеров. */
export function isAllowedWebhookUrl(provider: WebhookProvider, raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (provider === 'slack') return host === 'hooks.slack.com';
  // Teams: классические incoming webhooks (*.webhook.office.com) и новые
  // Workflows (*.logic.azure.com).
  return host.endsWith('.webhook.office.com') || host.endsWith('.logic.azure.com');
}

function payloadFor(provider: WebhookProvider, title: string, body: string | undefined): unknown {
  if (provider === 'slack') return { text: body ? `*${title}*\n${body}` : `*${title}*` };
  return { text: body ? `**${title}**<br>${body}` : `**${title}**` };
}

/** POST в один вебхук с коротким таймаутом; никогда не бросает. */
export async function postWebhook(provider: WebhookProvider, url: string, title: string, body?: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadFor(provider, title, body)),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Продублировать уведомление во все вебхуки пользователя. Fire-and-forget:
 * берёт ГЛОБАЛЬНЫЙ db (не Queryable вызывающего — notify нередко живёт внутри
 * транзакции, и лишние запросы/сетевые походы там недопустимы).
 */
export function fireUserWebhooks(userId: string, title: string, body?: string): void {
  void (async () => {
    try {
      const db: Db = await getDb();
      const rows = await db.query<{ provider: WebhookProvider; url_enc: string }>(
        'SELECT provider, url_enc FROM user_webhooks WHERE user_id = $1',
        [userId],
      );
      for (const r of rows.rows) {
        const url = await decText(db, userId, r.url_enc);
        if (url) void postWebhook(r.provider, url, title, body);
      }
    } catch {
      /* дублирование в мессенджер не должно ломать основной поток */
    }
  })();
}
