/**
 * Symmetric sealing for at-rest secrets (the per-team SSO client secret).
 * AES-256-GCM with a key derived from JWT_SECRET via HKDF — no new key to
 * manage. Format: "v1:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>".
 *
 * The sealed value is never shown back to the user (the UI displays only
 * "secret set"); on a JWT_SECRET rotation old secrets stop decrypting and the
 * admin simply re-enters the client secret.
 */
import crypto from 'node:crypto';
import { config } from '../config.ts';

const KEY = crypto.hkdfSync('sha256', Buffer.from(config.jwtSecret), Buffer.alloc(0), Buffer.from('lexai-sso-seal'), 32);
const b64 = (b: Buffer) => b.toString('base64url');

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(KEY), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${b64(iv)}:${b64(tag)}:${b64(ct)}`;
}

/** Returns null on any tamper / wrong-key / malformed input (never throws). */
export function openSecret(sealed: string): string | null {
  try {
    const [v, ivB, tagB, ctB] = sealed.split(':');
    if (v !== 'v1' || !ivB || !tagB || !ctB) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(KEY), Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
