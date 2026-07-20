/**
 * Have I Been Pwned — k-anonymity range check (https://haveibeenpwned.com/API/v3#PwnedPasswords).
 * We send only the FIRST 5 chars of the SHA-1 of the password; the API returns
 * all suffixes with that prefix, and we match locally — the full hash and the
 * password itself never leave this process.
 *
 * Fail-OPEN: a network error / timeout / non-200 must never block a legitimate
 * signup or password change (availability > this advisory control). Disabled
 * entirely when PASSWORD_BREACH_CHECK=0.
 */
import crypto from 'node:crypto';
import { config } from '../config.ts';

/** Number of times the password appears in known breaches, or 0 (incl. on any error). */
export async function pwnedCount(password: string): Promise<number> {
  if (!config.passwordBreachCheck) return 0;
  try {
    const sha1 = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    let text: string;
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'LexAI-password-check' },
        signal: controller.signal,
      });
      if (!res.ok) return 0;
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }
    for (const line of text.split('\n')) {
      const [hashSuffix, count] = line.trim().split(':');
      if (hashSuffix === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return 0; // fail open
  }
}

/** True when the password appears in a known breach (above a small threshold). */
export async function isPasswordBreached(password: string): Promise<boolean> {
  return (await pwnedCount(password)) > 0;
}
