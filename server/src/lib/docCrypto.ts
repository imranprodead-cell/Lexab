/**
 * At-rest encryption of user document data (envelope scheme).
 *
 * Why: a leaked database dump, backup or SQL-injection read must yield only
 * ciphertext — while the AI keeps receiving byte-identical plaintext, so
 * answers cannot change (decryption happens BEFORE any prompt building).
 *
 * ЧТО ОСТАЁТСЯ ОТКРЫТЫМ (честная граница, аудит 2026-08-03): имя документа,
 * контрагент и заголовки/цитаты находок (findings.title, findings.citation).
 * По ним идут поиск, сортировка и фильтры в SQL, чего шифротекст не позволяет.
 * Зашифрованы: текст договора, резюме анализа, блоки документа и правки.
 * Формулировка в SECURITY.md приведена в соответствие — не пишите «дамп отдаёт
 * ТОЛЬКО шифротекст», это неправда для перечисленных полей.
 *
 * Scheme:
 *  - per-user data key (DEK, 32 random bytes) stored in `data_keys`, wrapped
 *    by the master key (KEK) from DATA_ENCRYPTION_KEY — AES-256-GCM everywhere;
 *  - text values: "dv1:<iv>:<tag>:<ct>" (base64url) stored in the SAME columns;
 *  - wrapped DEK: "k1:<kekId>:<iv>:<tag>:<ct>" — kekId (8 hex chars of the
 *    KEK fingerprint) picks current vs previous KEK during rotation;
 *  - file bytes: self-contained envelope with its own wrapped per-file DEK
 *    (saveFile has no user context): magic "LEXAIENC1" + header + ct.
 *
 * Lazy migration: values without the "dv1:" prefix are legacy plaintext and
 * are returned unchanged; writes always encrypt (when a key is configured).
 * Deliberately DECOUPLED from JWT_SECRET (lib/secrets.ts) — rotating the JWT
 * secret must never brick document data.
 */
import crypto from 'node:crypto';
import { config } from '../config.ts';
import type { Queryable } from '../db.ts';

const TEXT_PREFIX = 'dv1:';
const WRAP_PREFIX = 'k1:';
const FILE_MAGIC = Buffer.from('LEXAIENC1', 'ascii');

const b64 = (b: Buffer) => b.toString('base64url');

/** True when a master key is configured — otherwise every call passes through. */
export function encryptionEnabled(): boolean {
  return config.dataEncryptionKey.length >= 32;
}

/** 32-byte KEK derived from a raw key string (HKDF, cached). */
const kekCache = new Map<string, Buffer>();
function kekFor(raw: string): Buffer {
  let k = kekCache.get(raw);
  if (!k) {
    k = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(raw), Buffer.alloc(0), Buffer.from('lexai-doc-kek'), 32));
    kekCache.set(raw, k);
  }
  return k;
}

/** Short fingerprint of a raw key — routes decryption to current vs previous KEK. */
function kekIdFor(raw: string): string {
  return crypto.createHash('sha256').update('lexai-kek-id:').update(raw).digest('hex').slice(0, 8);
}

/** All KEKs allowed for UNWRAP (current first, then previous during rotation). */
function unwrapKeks(): { id: string; key: Buffer }[] {
  const out: { id: string; key: Buffer }[] = [];
  if (config.dataEncryptionKey.length >= 32) {
    out.push({ id: kekIdFor(config.dataEncryptionKey), key: kekFor(config.dataEncryptionKey) });
  }
  if (config.dataEncryptionKeyPrevious.length >= 32) {
    out.push({ id: kekIdFor(config.dataEncryptionKeyPrevious), key: kekFor(config.dataEncryptionKeyPrevious) });
  }
  return out;
}

function gcmEncrypt(key: Buffer, plain: Buffer): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): Buffer | null {
  // Reject anything but a full 16-byte GCM tag: Node otherwise accepts
  // truncated tags (4/8/12 bytes, DEP0182), which would let a DB-write
  // attacker weaken the integrity guarantee from 2^128 to 2^32.
  if (tag.length !== 16 || iv.length !== 12) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    return null;
  }
}

/** Wrap a DEK with the CURRENT KEK → "k1:<kekId>:<iv>:<tag>:<ct>". */
function wrapDek(dek: Buffer): string {
  const { iv, tag, ct } = gcmEncrypt(kekFor(config.dataEncryptionKey), dek);
  return `${WRAP_PREFIX}${kekIdFor(config.dataEncryptionKey)}:${b64(iv)}:${b64(tag)}:${b64(ct)}`;
}

/** Rotation: unwrap a stored key with any configured KEK (current or previous)
 *  and re-wrap it under the CURRENT KEK. Returns the new wrapped string, or
 *  null when no configured KEK opens it. Used by scripts/rotate-kek.ts. */
export function rewrapKey(wrapped: string): string | null {
  const dek = unwrapDek(wrapped);
  return dek ? wrapDek(dek) : null;
}

/** Unwrap "k1:…" with whichever configured KEK matches its kekId. Null = no key fits. */
export function unwrapDek(wrapped: string): Buffer | null {
  const parts = wrapped.split(':');
  if (parts.length !== 5 || `${parts[0]}:` !== WRAP_PREFIX) return null;
  const [, kekId, ivB, tagB, ctB] = parts;
  for (const { id, key } of unwrapKeks()) {
    if (id !== kekId) continue;
    const dek = gcmDecrypt(key, Buffer.from(ivB, 'base64url'), Buffer.from(tagB, 'base64url'), Buffer.from(ctB, 'base64url'));
    if (dek && dek.length === 32) return dek;
  }
  return null;
}

/* ── Per-user DEK ────────────────────────────────────────────────────────── */

/** Small cache: DEKs are immutable once created, so no invalidation needed. */
const dekCache = new Map<string, Buffer>();
const DEK_CACHE_MAX = 1000;

function cacheDek(userId: string, dek: Buffer): void {
  if (dekCache.size >= DEK_CACHE_MAX) {
    // Drop the oldest entry (Map preserves insertion order).
    const first = dekCache.keys().next().value;
    if (first !== undefined) dekCache.delete(first);
  }
  dekCache.set(userId, dek);
}

/** Test/rotation hook: forget cached DEKs (e.g. after re-wrapping keys). */
export function clearDekCache(): void {
  dekCache.clear();
}

/**
 * Fetch (or create) the user's data key. Race-safe: concurrent creators both
 * INSERT … ON CONFLICT DO NOTHING and re-read, so exactly one wins.
 * Throws when the wrapped key exists but no configured KEK can open it —
 * that is an operations error (wrong/lost master key), never silent data loss.
 */
export async function getOrCreateUserDek(db: Queryable, userId: string): Promise<Buffer> {
  // NEVER mint a DEK without a real master key: wrapping under the empty-string
  // KEK would persist a data_keys row that no future real key could unwrap,
  // permanently bricking the user. Callers must not reach here when disabled.
  if (!encryptionEnabled()) {
    throw new Error('getOrCreateUserDek called with document encryption disabled (no DATA_ENCRYPTION_KEY)');
  }
  const cached = dekCache.get(userId);
  if (cached) return cached;

  const read = async (): Promise<Buffer | null> => {
    const { rows } = await db.query<{ key_wrapped: string }>(
      'SELECT key_wrapped FROM data_keys WHERE user_id = $1',
      [userId],
    );
    if (rows.length === 0) return null;
    const dek = unwrapDek(rows[0].key_wrapped);
    if (!dek) {
      throw new Error(
        `data key for user ${userId} cannot be unwrapped — DATA_ENCRYPTION_KEY mismatch (check DATA_ENCRYPTION_KEY_PREVIOUS during rotation)`,
      );
    }
    return dek;
  };

  let dek = await read();
  if (!dek) {
    const fresh = crypto.randomBytes(32);
    await db.query('INSERT INTO data_keys (user_id, key_wrapped) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [
      userId,
      wrapDek(fresh),
    ]);
    dek = await read(); // re-read: either ours or the concurrent winner's
    if (!dek) throw new Error(`data key for user ${userId} could not be created`);
  }
  cacheDek(userId, dek);
  return dek;
}

/* ── Text values ─────────────────────────────────────────────────────────── */

/** Encrypt a text value with the owner's DEK. Passthrough when disabled. */
export async function encText(db: Queryable, ownerUserId: string, plain: string): Promise<string> {
  if (!encryptionEnabled()) return plain;
  const dek = await getOrCreateUserDek(db, ownerUserId);
  const { iv, tag, ct } = gcmEncrypt(dek, Buffer.from(plain, 'utf8'));
  return `${TEXT_PREFIX}${b64(iv)}:${b64(tag)}:${b64(ct)}`;
}

/**
 * Decrypt a stored text value.
 *  - null/undefined → null;
 *  - no "dv1:" prefix → legacy plaintext, returned unchanged (lazy migration);
 *  - "dv1:" that fails to open → null (callers fail loud; ciphertext is never
 *    served to a client or fed to the model as content).
 */
export async function decText(db: Queryable, ownerUserId: string, stored: string | null | undefined): Promise<string | null> {
  if (stored === null || stored === undefined) return null;
  if (!stored.startsWith(TEXT_PREFIX)) return stored; // legacy plaintext
  // A "dv1:" value with no configured key cannot be decrypted — return null
  // (never serve ciphertext) and, crucially, do NOT mint a DEK (would poison
  // the user's data_keys row under the empty KEK).
  if (!encryptionEnabled()) return null;
  const parts = stored.slice(TEXT_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const dek = await getOrCreateUserDek(db, ownerUserId);
  const plain = gcmDecrypt(dek, Buffer.from(parts[0], 'base64url'), Buffer.from(parts[1], 'base64url'), Buffer.from(parts[2], 'base64url'));
  return plain === null ? null : plain.toString('utf8');
}

/** decText for NOT NULL contexts: decryption failure throws (ops error). */
export async function decTextStrict(db: Queryable, ownerUserId: string, stored: string): Promise<string> {
  const plain = await decText(db, ownerUserId, stored);
  if (plain === null) throw new Error('encrypted value cannot be decrypted — data key mismatch');
  return plain;
}

/* ── JSONB document blocks ───────────────────────────────────────────────── */

/**
 * Encrypt an arbitrary JSON value for storage in a JSONB column: the whole
 * JSON is one ciphertext stored as a JSON *string scalar* (so the text→jsonb
 * cast succeeds). Passthrough returns the plain JSON when disabled.
 */
export async function encJsonForJsonb(db: Queryable, ownerUserId: string, value: unknown): Promise<string> {
  const json = JSON.stringify(value ?? null);
  if (!encryptionEnabled()) return json;
  return JSON.stringify(await encText(db, ownerUserId, json));
}

/**
 * Decode a JSONB `document_blocks`-style value in any of its three shapes:
 *  - object/array (legacy plaintext via node-postgres),
 *  - plain JSON string (legacy via PGlite),
 *  - encrypted "dv1:" string (current format).
 * Returns the parsed plaintext value; null on decrypt failure.
 */
export async function decJsonFromJsonb(db: Queryable, ownerUserId: string, raw: unknown): Promise<unknown> {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return raw; // legacy plaintext object/array
  if (raw.startsWith(TEXT_PREFIX)) {
    const json = await decText(db, ownerUserId, raw);
    if (json === null) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(raw); // legacy PGlite string form
  } catch {
    return null;
  }
}

/* ── File bytes (storage envelope) ───────────────────────────────────────── */

/**
 * Encrypt raw file bytes into a self-contained envelope:
 * magic(9) | ver(1) | wrapLen(2 BE) | wrappedDEK(utf8) | iv(12) | tag(16) | ct.
 * The per-file DEK is random and wrapped with the current KEK, so decryption
 * needs no user context (saveFile/readFileBytes have none).
 */
export function encFileBuffer(buf: Buffer): Buffer {
  if (!encryptionEnabled()) return buf;
  const dek = crypto.randomBytes(32);
  const wrapped = Buffer.from(wrapDek(dek), 'utf8');
  const { iv, tag, ct } = gcmEncrypt(dek, buf);
  const head = Buffer.alloc(FILE_MAGIC.length + 1 + 2);
  FILE_MAGIC.copy(head, 0);
  head.writeUInt8(1, FILE_MAGIC.length);
  head.writeUInt16BE(wrapped.length, FILE_MAGIC.length + 1);
  return Buffer.concat([head, wrapped, iv, tag, ct]);
}

/**
 * Decrypt an envelope produced by encFileBuffer. Non-envelope buffers (legacy
 * plaintext files) pass through unchanged. Throws on an envelope that no
 * configured KEK can open (ops error — wrong/lost master key).
 */
export function decFileBuffer(buf: Buffer): Buffer {
  if (buf.length < FILE_MAGIC.length + 3 || !buf.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) return buf;
  const ver = buf.readUInt8(FILE_MAGIC.length);
  if (ver !== 1) throw new Error(`unknown encrypted-file envelope version ${ver}`);
  const wrapLen = buf.readUInt16BE(FILE_MAGIC.length + 1);
  let off = FILE_MAGIC.length + 3;
  const wrapped = buf.subarray(off, off + wrapLen).toString('utf8');
  off += wrapLen;
  const iv = buf.subarray(off, off + 12);
  const tag = buf.subarray(off + 12, off + 28);
  const ct = buf.subarray(off + 28);
  const dek = unwrapDek(wrapped);
  if (!dek) throw new Error('encrypted file cannot be decrypted — DATA_ENCRYPTION_KEY mismatch');
  const plain = gcmDecrypt(dek, iv, tag, ct);
  if (!plain) throw new Error('encrypted file failed integrity check');
  return plain;
}

/** True when a stored value carries the encrypted-text prefix (for tests/scripts). */
export function isEncryptedText(value: string): boolean {
  return value.startsWith(TEXT_PREFIX);
}
