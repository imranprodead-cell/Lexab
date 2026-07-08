/** Tiny request-body validators. Reject malformed bodies with 400 { message }. */
import { badRequest } from './errors.ts';

export function asObject(body: unknown, what = 'body'): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw badRequest(`Malformed ${what}: expected a JSON object`);
  }
  return body as Record<string, unknown>;
}

export function requireString(obj: Record<string, unknown>, field: string, opts?: { min?: number; max?: number }): string {
  const v = obj[field];
  if (typeof v !== 'string') throw badRequest(`Field "${field}" is required and must be a string`);
  const trimmed = v.trim();
  if (opts?.min !== undefined && trimmed.length < opts.min) {
    throw badRequest(`Field "${field}" must be at least ${opts.min} characters`);
  }
  if (opts?.max !== undefined && trimmed.length > opts.max) {
    throw badRequest(`Field "${field}" must be at most ${opts.max} characters`);
  }
  return trimmed;
}

export function optionalString(obj: Record<string, unknown>, field: string): string | undefined {
  const v = obj[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw badRequest(`Field "${field}" must be a string`);
  return v;
}

export function requireEmail(obj: Record<string, unknown>, field = 'email'): string {
  const v = requireString(obj, field, { max: 320 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw badRequest('Invalid email address');
  return v.toLowerCase();
}

export function requireOneOf<T extends string>(obj: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const v = obj[field];
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw badRequest(`Field "${field}" must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}
