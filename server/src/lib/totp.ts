/**
 * TOTP (RFC 6238) with node:crypto only — no external dependency.
 * SHA-1, 6 digits, 30-second step (the defaults every authenticator app uses:
 * Google Authenticator, Authy, 1Password, …).
 */
import crypto from 'node:crypto';

const DIGITS = 6;
const STEP_SECONDS = 30;
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (no padding) — the secret encoding authenticator apps expect. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/,'').toUpperCase().replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // ignore stray chars
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh random base32 secret (20 bytes → 160 bits, the RFC-recommended size). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The 6-digit code for a given base32 secret at a given time (default: now). */
export function totpCode(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/**
 * Match a user-entered code against the secret, tolerating ±1 step (±30s) of
 * clock drift. Returns the matched STEP COUNTER (for anti-replay bookkeeping:
 * RFC 6238 §5.2 — a verified code must not be accepted twice) or null.
 * Constant-time compare per candidate to avoid a timing oracle.
 */
export function matchTotpStep(secretBase32: string, code: string, atMs: number = Date.now()): number | null {
  const cleaned = (code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return null;
  for (const drift of [-1, 0, 1]) {
    const at = atMs + drift * STEP_SECONDS * 1000;
    const candidate = totpCode(secretBase32, at);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cleaned))) {
      return Math.floor(at / 1000 / STEP_SECONDS);
    }
  }
  return null;
}

/** Verify a code (see matchTotpStep) without replay bookkeeping. */
export function verifyTotp(secretBase32: string, code: string, atMs: number = Date.now()): boolean {
  return matchTotpStep(secretBase32, code, atMs) !== null;
}

/** otpauth:// URI for the QR code / manual entry in an authenticator app. */
export function otpauthUri(secretBase32: string, account: string, issuer = 'LexAI'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Ten single-use recovery codes (shown once), e.g. "a1b2-c3d4". */
export function generateBackupCodes(n = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(4).toString('hex'); // 8 hex chars
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

/** SHA-256 of a normalized backup code — stored instead of the plaintext code. */
export function hashBackupCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toLowerCase().replace(/\s+/g, '')).digest('hex');
}
