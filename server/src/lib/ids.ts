import crypto from 'node:crypto';

/** Short unique id with a readable prefix, e.g. `d_k3j9x0q2ab`. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')}`;
}
