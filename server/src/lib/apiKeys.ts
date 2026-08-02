/**
 * Публичные API-ключи (тариф Business). Секрет выдаётся ОДИН раз в момент
 * создания; в БД хранится только SHA-256. Ключ высокоэнтропийный (32 случайных
 * байта), поэтому соль не нужна — хеш ищется точным совпадением по индексу.
 */
import crypto from 'node:crypto';
import type { Db } from '../db.ts';
import type { UserRow } from '../plugins/auth.ts';
import { newId } from './ids.ts';

export const API_KEY_PREFIX = 'lxb_';
/** Сколько символов ключа показываем в списках («lxb_a1b2c3d4…»). */
const DISPLAY_PREFIX_LEN = 12;
/** Живых ключей на аккаунт — защита от бесконтрольного размножения секретов. */
export const MAX_LIVE_KEYS = 10;

export function generateApiKey(): { id: string; raw: string; hash: string; prefix: string } {
  const raw = API_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { id: newId('key'), raw, hash: hashApiKey(raw), prefix: raw.slice(0, DISPLAY_PREFIX_LEN) };
}

export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export interface LiveApiKey {
  keyId: string;
  user: UserRow;
}

/** Живой (не отозванный) ключ по присланному секрету + его владелец. */
export async function findLiveKey(db: Db, raw: string): Promise<LiveApiKey | null> {
  if (!raw.startsWith(API_KEY_PREFIX)) return null;
  const res = await db.query<UserRow & { key_id: string }>(
    `SELECT k.id AS key_id, u.id, u.email, u.name, u.initials, u.firm, u.jurisdiction,
            u.avatar_url, u.token_version, u.email_verified
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [hashApiKey(raw)],
  );
  const row = res.rows[0];
  if (!row) return null;
  const { key_id, ...user } = row;
  return { keyId: key_id, user: user as UserRow };
}

/** last_used_at — не чаще раза в минуту, чтобы поллинг статуса не молотил БД. */
export async function touchLastUsed(db: Db, keyId: string): Promise<void> {
  await db
    .query(
      `UPDATE api_keys SET last_used_at = now()
       WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '60 seconds')`,
      [keyId],
    )
    .catch(() => undefined); // best-effort — витринное поле не должно ронять вызов
}
