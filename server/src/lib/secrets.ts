/**
 * Symmetric sealing for at-rest secrets (the per-team SSO client secret).
 * AES-256-GCM. Format: "v1:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>".
 *
 * KEY: derived from a DEDICATED SECRETS_ENCRYPTION_KEY when set (so rotating
 * JWT_SECRET never breaks SSO secrets); otherwise the legacy JWT-derived key.
 * On decrypt we try the primary key first, then the legacy key — so secrets
 * sealed before a SECRETS_ENCRYPTION_KEY was introduced still open (an admin's
 * re-save then upgrades them to the new key). The sealed value is never shown
 * back to the user (the UI displays only "secret set").
 */
import crypto from 'node:crypto';
import { config } from '../config.ts';

const deriveKey = (material: string) => crypto.hkdfSync('sha256', Buffer.from(material), Buffer.alloc(0), Buffer.from('lexai-sso-seal'), 32);

// Primary sealing key: the dedicated secret when configured, else JWT-derived
// (unchanged behaviour for deployments that never set SECRETS_ENCRYPTION_KEY).
const PRIMARY_KEY = deriveKey(config.secretsEncryptionKey || config.jwtSecret);
// Legacy decrypt-only key: the JWT-derived one, tried when the primary fails —
// only meaningfully different once SECRETS_ENCRYPTION_KEY is set.
const LEGACY_KEY = config.secretsEncryptionKey ? deriveKey(config.jwtSecret) : null;

const b64 = (b: Buffer) => b.toString('base64url');

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(PRIMARY_KEY), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${b64(iv)}:${b64(tag)}:${b64(ct)}`;
}

function openWith(key: Buffer, ivB: string, tag: Buffer, ctB: string): string | null {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'), { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Returns null on any tamper / wrong-key / malformed input (never throws). */
export function openSecret(sealed: string): string | null {
  const [v, ivB, tagB, ctB] = sealed.split(':');
  if (v !== 'v1' || !ivB || !tagB || !ctB) return null;
  const tag = Buffer.from(tagB, 'base64url');
  // Reject anything but a full 16-byte GCM tag: Node otherwise accepts
  // truncated tags (4/8/12 bytes, DEP0182), which would weaken forgery
  // resistance from 2^128 to 2^32 — mirrors gcmDecrypt in lib/docCrypto.ts.
  if (tag.length !== 16) return null;
  const primary = openWith(Buffer.from(PRIMARY_KEY), ivB, tag, ctB);
  if (primary !== null) return primary;
  return LEGACY_KEY ? openWith(Buffer.from(LEGACY_KEY), ivB, tag, ctB) : null;
}
