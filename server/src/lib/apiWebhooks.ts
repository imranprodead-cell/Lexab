/**
 * Callback-вебхуки публичного API: когда задание (analysis/draft/compare/
 * template) завершается, POST'им подписанное МИНИМАЛЬНОЕ уведомление на URL
 * клиента, чтобы он не поллил вручную.
 *
 * Безопасность:
 *  - URL клиента ПРОИЗВОЛЬНЫЙ (в отличие от Slack/Teams allowlist), поэтому
 *    жёсткая SSRF-защита: только https, без userinfo, хост резолвится ТОЛЬКО в
 *    публичные IP. При доставке соединение ПИНится к заранее провалидированному
 *    IP (undici lookup), что закрывает DNS-rebinding; редиректы не следуются.
 *  - Тело подписывается HMAC-SHA256 (X-Lexab-Signature) секретом эндпоинта —
 *    клиент проверяет тем же кодом. Секрет и URL хранятся зашифрованными.
 *  - Payload МИНИМАЛЬНЫЙ: { event, id, kind, status[, error] } — НИ текста
 *    договора, ни находок; клиент забирает детали своим ключом.
 */
import crypto from 'node:crypto';
import { promises as dnsp } from 'node:dns';
import net from 'node:net';
import { Agent } from 'undici';
import type { Db } from '../db.ts';
import { HttpError } from './errors.ts';
import { decText, encText } from './docCrypto.ts';
import { newId } from './ids.ts';

/** Развернуть IPv6-адрес в 16 байт (учёт ::-сжатия, зоны, встроенного точечного
 *  IPv4-хвоста). null — если не разбирается. */
function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]; // отбросить zone id (%eth0)
  // Встроенный точечный IPv4-хвост (::ffff:127.0.0.1, ::127.0.0.1) → два хекстета.
  const dot = s.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dot) {
    const q = dot[1].split('.').map(Number);
    if (q.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    const hex = `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
    s = s.slice(0, s.length - dot[1].length) + hex;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

/** Приватный/непубличный IP (SSRF): loopback, private, link-local, CGNAT,
 *  unique-local/mapped/NAT64 IPv6 и т.п. Всё, что НЕ маршрутизируется в интернете.
 *  IPv6 разбирается ПОБАЙТНО (не по строковым префиксам) — иначе mapped-форма
 *  ::ffff:7f00:1 (=127.0.0.1) или ::ffff:a9fe:a9fe (=169.254.169.254 метаданные)
 *  проскакивала бы как публичная (критический SSRF). */
export function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // мусор → блок
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
    if (a === 169 && b === 254) return true; // link-local (169.254.169.254 метаданные)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 192 && b === 0) return true; // 192.0.0/24 IETF, 192.0.2/24 TEST-NET
    if (a >= 224) return true; // multicast + reserved (224+)
    return false;
  }
  if (v === 6) {
    const bytes = expandIpv6(ip);
    if (!bytes || bytes.length !== 16) return true; // не разобрался → блок
    const first10Zero = bytes.slice(0, 10).every((x) => x === 0);
    // IPv4-mapped ::ffff:0:0/96 → проверяем встроенный IPv4.
    if (first10Zero && bytes[10] === 0xff && bytes[11] === 0xff) {
      return isPrivateIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
    }
    // IPv4-compatible ::a.b.c.d (устаревш.) — байты 0..11 нули, IPv4 ненулевой.
    if (bytes.slice(0, 12).every((x) => x === 0) && (bytes[12] || bytes[13] || bytes[14] || bytes[15])) {
      return isPrivateIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
    }
    // NAT64 64:ff9b::/96 — встроенный IPv4.
    if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((x) => x === 0)) {
      return isPrivateIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
    }
    if (bytes.every((x) => x === 0)) return true; // :: unspecified
    if (bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1) return true; // ::1 loopback
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
    if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
    if (bytes[0] === 0xff) return true; // ff00::/8 multicast
    return false;
  }
  return true; // не распознан как IP → блок
}

/** Проверить, что URL безопасен для callback: https, без userinfo, хост
 *  резолвится только в публичные IP. Возвращает {hostname, addresses}. */
export async function assertSafeWebhookUrl(raw: string): Promise<{ url: URL; addresses: { address: string; family: number }[] }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Webhook URL is not a valid URL.', 'invalid_webhook_url');
  }
  if (url.protocol !== 'https:') throw new HttpError(400, 'Webhook URL must use https.', 'invalid_webhook_url');
  if (url.username || url.password) throw new HttpError(400, 'Webhook URL must not contain credentials.', 'invalid_webhook_url');
  // URL.hostname для IPv6 возвращает адрес В СКОБКАХ ([::1]) — снимаем для net.isIP.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Литеральный IP в URL — проверяем сразу, без DNS.
  const litFamily = net.isIP(host);
  if (litFamily) {
    if (isPrivateIp(host)) throw new HttpError(400, 'Webhook URL must not point to a private address.', 'webhook_ssrf');
    return { url, addresses: [{ address: host, family: litFamily }] };
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dnsp.lookup(host, { all: true });
  } catch {
    throw new HttpError(400, 'Webhook host does not resolve.', 'webhook_dns');
  }
  if (!addresses.length) throw new HttpError(400, 'Webhook host does not resolve.', 'webhook_dns');
  for (const a of addresses) {
    if (isPrivateIp(a.address)) throw new HttpError(400, 'Webhook host resolves to a private address.', 'webhook_ssrf');
  }
  return { url, addresses };
}

/** HMAC-SHA256(hex) сырого тела секретом эндпоинта. */
export function signWebhookBody(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** undici-диспетчер, ПИНящий соединение к провалидированным публичным IP —
 *  повторный DNS-резолв (rebinding) не сможет увести на приватный адрес. */
function pinnedDispatcher(addresses: { address: string; family: number }[]): Agent {
  const pinned = addresses[0];
  return new Agent({
    connect: {
      // undici зовёт lookup для host из URL; возвращаем ТОЛЬКО пиннутый IP.
      lookup: (_hostname: string, _opts: unknown, cb: (err: Error | null, address: string, family: number) => void) => {
        // Двойная защита: даже пиннутый адрес перепроверяем.
        if (isPrivateIp(pinned.address)) {
          cb(new Error('blocked private address'), '', 0);
          return;
        }
        cb(null, pinned.address, pinned.family);
      },
    },
  });
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length; // 5

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  user_id: string;
  event: string;
  payload: unknown;
  attempts: number;
}

/** Одна попытка доставки: расшифровать url+секрет, SSRF-проверка+пиннинг,
 *  подписать, POST; обновить статус/бэкофф. Never-throw. */
async function attemptDelivery(db: Db, row: DeliveryRow): Promise<void> {
  // Атомарный клейм: аренда next_attempt_at на 30с ТОЛЬКО у queued И дозревшей
  // строки. 0 строк = её уже забрал другой воркер (немедленная попытка vs свип,
  // или два инстанса) → выходим БЕЗ второго POST. Клейм переносит next_attempt_at
  // в будущее, поэтому свип (SELECT next_attempt_at <= now()) не подхватит её в
  // окне доставки; при падении процесса строка «оживёт» через 30с.
  const claim = await db.query<{ attempts: number }>(
    "UPDATE api_webhook_deliveries SET next_attempt_at = now() + interval '30 seconds', updated_at = now() WHERE id = $1 AND status = 'queued' AND next_attempt_at <= now() RETURNING attempts",
    [row.id],
  );
  if (!claim.rows[0]) return;
  const attempts = Number(claim.rows[0].attempts);
  try {
    const ep = (
      await db.query<{ url_enc: string; signing_secret_enc: string; revoked_at: Date | null }>(
        'SELECT url_enc, signing_secret_enc, revoked_at FROM api_webhook_endpoints WHERE id = $1',
        [row.endpoint_id],
      )
    ).rows[0];
    if (!ep || ep.revoked_at) {
      await failDelivery(db, row.id, attempts, 'endpoint revoked', null, true);
      return;
    }
    const url = await decText(db, row.user_id, ep.url_enc);
    const secret = await decText(db, row.user_id, ep.signing_secret_enc);
    if (!url || !secret) {
      await failDelivery(db, row.id, attempts, 'endpoint secret unreadable', null, true);
      return;
    }

    let safe: { url: URL; addresses: { address: string; family: number }[] };
    try {
      safe = await assertSafeWebhookUrl(url);
    } catch (e) {
      // Небезопасный/неразрешимый URL — постоянный провал, без ретраев.
      await failDelivery(db, row.id, attempts, e instanceof Error ? e.message.slice(0, 200) : 'unsafe url', null, true);
      return;
    }

    const rawBody = JSON.stringify(row.payload);
    const signature = signWebhookBody(secret, rawBody);
    const dispatcher = pinnedDispatcher(safe.addresses);
    let code: number | null = null;
    try {
      // Глобальный fetch (undici): dispatcher пинит IP; в тестах fetch мокается.
      // Каст через unknown: RequestInit.dispatcher (undici-types) ≠ Agent (undici)
      // из-за двух версий типов — на рантайме это один и тот же undici.
      const res = await fetch(safe.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lexab-Signature': signature,
          'User-Agent': 'Lexab-Webhook/1',
        },
        body: rawBody,
        redirect: 'manual', // не следуем редиректам (анти-SSRF)
        signal: AbortSignal.timeout(5000),
        dispatcher,
      } as unknown as RequestInit);
      code = res.status;
      // Тело ответа НЕ читаем (никакой эксфильтрации); дренируем для сокета.
      await res.body?.cancel?.().catch(() => undefined);
    } finally {
      await dispatcher.close().catch(() => undefined);
    }

    if (code >= 200 && code < 300) {
      await db.query(
        "UPDATE api_webhook_deliveries SET status = 'delivered', response_code = $2, attempts = attempts + 1, updated_at = now() WHERE id = $1 AND status = 'queued'",
        [row.id, code],
      );
      return;
    }
    await failDelivery(db, row.id, attempts, `HTTP ${code}`, code, false);
  } catch (err) {
    await failDelivery(db, row.id, attempts, err instanceof Error ? err.message.slice(0, 200) : 'delivery error', null, false).catch(() => undefined);
  }
}

/** Пометить попытку неуспешной: постоянный провал (permanent) или бэкофф. */
async function failDelivery(db: Db, id: string, attempts: number, error: string, code: number | null, permanent: boolean): Promise<void> {
  const nextAttempts = attempts + 1;
  if (permanent || nextAttempts >= MAX_ATTEMPTS) {
    await db.query(
      "UPDATE api_webhook_deliveries SET status = 'failed', attempts = $2, last_error = $3, response_code = $4, updated_at = now() WHERE id = $1 AND status = 'queued'",
      [id, nextAttempts, error, code],
    );
    return;
  }
  // Индексируем по УЖЕ израсходованным попыткам (attempts): первый ретрай = [0]=1мин.
  const delayMs = BACKOFF_MS[attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  await db.query(
    `UPDATE api_webhook_deliveries SET attempts = $2, last_error = $3, response_code = $4,
       next_attempt_at = now() + ($5 || ' milliseconds')::interval, updated_at = now()
     WHERE id = $1 AND status = 'queued'`,
    [id, nextAttempts, error, code, String(delayMs)],
  );
}

/**
 * Поставить в очередь уведомления по завершении задания и попытаться доставить
 * сразу (best-effort). Never-throw — сбой вебхука не влияет на само задание.
 * payload минимальный; на error добавляется error_code.
 */
export async function enqueueJobWebhooks(db: Db, userId: string, apiRequestId: string, kind: string, status: 'done' | 'error'): Promise<void> {
  try {
    const event = `${kind}.${status}`;
    const endpoints = await db.query<{ id: string; events: string[] }>(
      'SELECT id, events FROM api_webhook_endpoints WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
    const matched = endpoints.rows.filter((e) => e.events.includes('*') || e.events.includes(event) || e.events.includes(`${kind}.*`));
    if (!matched.length) return;

    const payload: Record<string, unknown> = { event, id: apiRequestId, kind, status, createdAt: new Date().toISOString() };
    if (status === 'error') {
      const r = (await db.query<{ error_code: string | null }>('SELECT error_code FROM api_requests WHERE id = $1', [apiRequestId])).rows[0];
      payload.error = { code: r?.error_code ?? 'generation_failed' };
    }
    const payloadJson = JSON.stringify(payload);

    const rows: DeliveryRow[] = [];
    for (const ep of matched) {
      const id = newId('whd');
      await db.query(
        "INSERT INTO api_webhook_deliveries (id, endpoint_id, user_id, api_request_id, event, payload, status) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued')",
        [id, ep.id, userId, apiRequestId, event, payloadJson],
      );
      rows.push({ id, endpoint_id: ep.id, user_id: userId, event, payload, attempts: 0 });
    }
    // Немедленная best-effort доставка; ретраи подхватит свип.
    for (const r of rows) void attemptDelivery(db, r).catch(() => undefined);
  } catch {
    /* вебхуки не должны ломать основной поток задания */
  }
}

/** Свип доставки (index.ts, ~раз в минуту под кластер-локом): дозревшие
 *  queued-доставки. Ограничение пачки, чтобы не залипнуть на большом хвосте. */
export async function runWebhookDeliveries(db: Db): Promise<void> {
  const due = await db.query<DeliveryRow>(
    `SELECT id, endpoint_id, user_id, event, payload, attempts
     FROM api_webhook_deliveries WHERE status = 'queued' AND next_attempt_at <= now()
     ORDER BY next_attempt_at LIMIT 100`,
  );
  for (const row of due.rows) {
    await attemptDelivery(db, row);
  }
}

/** Ретеншен журнала доставок: терминальные строки старше 30 дней. */
export async function pruneWebhookDeliveries(db: Db): Promise<void> {
  await db.query("DELETE FROM api_webhook_deliveries WHERE status IN ('delivered', 'failed') AND created_at < now() - interval '30 days'");
}

/* ── Управление эндпоинтами (для роутов кабинета/публичного API) ───────────── */

export interface WebhookEndpointInfo {
  id: string;
  maskedUrl: string;
  events: string[];
  createdAt: string;
  lastError: string | null;
}

/** Маскировать URL для показа: схема+хост, путь скрыт (в нём бывает секрет). */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return '…';
  }
}

export async function listWebhookEndpoints(db: Db, userId: string): Promise<WebhookEndpointInfo[]> {
  const rows = await db.query<{ id: string; url_enc: string; events: string[]; created_at: Date | string }>(
    'SELECT id, url_enc, events, created_at FROM api_webhook_endpoints WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC',
    [userId],
  );
  const out: WebhookEndpointInfo[] = [];
  for (const r of rows.rows) {
    const url = (await decText(db, userId, r.url_enc)) ?? '';
    const lastErr = (
      await db.query<{ last_error: string | null }>(
        "SELECT last_error FROM api_webhook_deliveries WHERE endpoint_id = $1 AND status = 'failed' ORDER BY updated_at DESC LIMIT 1",
        [r.id],
      )
    ).rows[0];
    out.push({ id: r.id, maskedUrl: maskUrl(url), events: r.events, createdAt: new Date(r.created_at as string).toISOString(), lastError: lastErr?.last_error ?? null });
  }
  return out;
}

/** Создать эндпоинт: SSRF-проверка URL, генерация signing-секрета (показать один
 *  раз), шифрование url+секрета. Возвращает id + секрет. */
export async function createWebhookEndpoint(db: Db, userId: string, keyId: string | null, rawUrl: string, events: string[]): Promise<{ id: string; secret: string; events: string[] }> {
  await assertSafeWebhookUrl(rawUrl); // бросит 400, если небезопасен
  const id = newId('whep');
  const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
  const urlEnc = await encText(db, userId, rawUrl);
  const secretEnc = await encText(db, userId, secret);
  const evs = events.length ? events.slice(0, 20) : ['*'];
  await db.query(
    'INSERT INTO api_webhook_endpoints (id, user_id, key_id, url_enc, signing_secret_enc, events) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, userId, keyId, urlEnc, secretEnc, evs],
  );
  return { id, secret, events: evs };
}

export async function revokeWebhookEndpoint(db: Db, userId: string, id: string): Promise<boolean> {
  const res = await db.query<{ id: string }>(
    'UPDATE api_webhook_endpoints SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
    [id, userId],
  );
  return res.rows.length > 0;
}
