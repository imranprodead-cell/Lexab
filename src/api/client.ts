/**
 * HTTP client for the real backend.
 *
 * The API modules (`chats.api.ts`, `documents.api.ts`, …) call `http<T>()` when
 * `VITE_USE_MOCK_API` is not "true". Until the backend exists they route to the
 * mock implementation instead, so no UI code changes when the switch is flipped.
 */
import { tStandalone } from '@/i18n/messages';
import { ApiError } from './util';

export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

// Mock mode is OPT-IN: without the env var the app talks to the real backend.
// (A fresh deploy that forgets the var must never silently show demo data.)
// Mocks accept ANY credentials, so they are FORCED OFF in a production build
// unless a second explicit flag is set — a stray VITE_USE_MOCK_API must never
// ship open login.
const mockRequested = import.meta.env.VITE_USE_MOCK_API === 'true';
export const USE_MOCK =
  mockRequested && (!import.meta.env.PROD || import.meta.env.VITE_ALLOW_MOCK_IN_PROD === 'true');
if (mockRequested && !USE_MOCK) {
  console.error(
    '[client] VITE_USE_MOCK_API=true was ignored in this production build (it would expose open login). ' +
      'Set VITE_ALLOW_MOCK_IN_PROD=true only if a mock demo build is truly intended.',
  );
}

interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Retry attempts for idempotent GETs on network/5xx failures. Default 2. */
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bearer token from the persisted auth session (see useAuthStore). */
function authHeader(): Record<string, string> {
  try {
    const raw = localStorage.getItem('lexai.auth');
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Fired once per 401 so the auth store can drop the dead session and route
 *  the user to the login screen ("session expired") instead of leaving pages
 *  stuck on a generic error card. */
export const SESSION_EXPIRED_EVENT = 'lexai:session-expired';

// Endpoints where a 401 means "bad credentials", not "session expired":
// login, register, password reset/verify flows, Google/SSO exchanges and the
// change-password form (wrong current password is also a 401). /auth/refresh
// is the exception — a 401 there IS an expired session.
// `sentAuth` is the Authorization header the FAILED request carried: the
// listener ignores the event when the store already holds a different (newer)
// token — e.g. an in-flight poll losing the race against a password change.
function noteUnauthorized(path: string, status: number, sentAuth?: string): void {
  if (status !== 401) return;
  if (path.startsWith('/auth/') && path !== '/auth/refresh') return;
  if (typeof window === 'undefined') return;
  const token = sentAuth?.startsWith('Bearer ') ? sentAuth.slice(7) : undefined;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { token } }));
}

export async function http<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers = {}, retries = method === 'GET' ? 2 : 0 } = options;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(tStandalone('net.offline'), 0);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const authH = authHeader();
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        signal,
        // Content-Type only when a body is sent: Fastify rejects bodyless
        // requests (e.g. DELETE /chats/:id) that declare application/json.
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...authH,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!response.ok) {
        // Retry transient server errors; surface client errors immediately.
        if (response.status >= 500 && attempt < retries) {
          lastError = new ApiError(`Request failed (${response.status})`, response.status);
          await sleep(300 * (attempt + 1));
          continue;
        }
        noteUnauthorized(path, response.status, authH.Authorization);
        let message = `Request failed (${response.status})`;
        let code: string | undefined;
        try {
          const data = (await response.json()) as { message?: string; code?: string };
          if (data?.message) message = data.message;
          if (data?.code) code = data.code;
        } catch {
          /* non-JSON error body — keep default message */
        }
        throw new ApiError(message, response.status, code);
      }

      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (err) {
      // Abort is intentional — never retry or swallow it.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
      lastError = err;
      if (attempt < retries) {
        await sleep(300 * (attempt + 1));
        continue;
      }
    }
  }
  // A real HTTP failure (ApiError with a status, e.g. a retried 5xx) surfaces
  // as-is. Anything else here is a connection-level rejection — fetch rejects
  // with a raw TypeError ("Failed to fetch") on connection refused/DNS/TLS/CORS,
  // which navigator.onLine cannot detect. Normalise it to the same friendly,
  // localised offline error we already show when onLine === false, so callers
  // never surface an untranslated TypeError.
  if (lastError instanceof ApiError) throw lastError;
  throw new ApiError(tStandalone('net.offline'), 0);
}

/** Thrown before any network send when the browser can't read a streaming
 *  response body — lets the caller fall back to a plain POST. */
export class StreamingUnsupportedError extends Error {
  constructor() {
    super('streaming unsupported');
    this.name = 'StreamingUnsupportedError';
  }
}

/**
 * Authenticated Server-Sent-Events POST. Streams the server's `token`/`done`/
 * `error` protocol: each `token` delta is handed to `onToken`, the final `done`
 * payload resolves the promise, an `error` event rejects with an ApiError that
 * carries the server's status (so 402 limit-reached behaves like a normal HTTP
 * 402). fetch + ReadableStream (NOT EventSource — it can't POST, can't send the
 * Bearer header, and a token in the URL would leak into logs).
 *
 * Throws StreamingUnsupportedError up front (before sending) when the runtime
 * can't read response bodies, so the caller can fall back to a plain POST. A
 * mid-stream failure rejects with a real error and MUST NOT be retried by
 * re-POSTing (the server may have already persisted the turn + reply).
 */
export async function httpSSE<T>(path: string, body: unknown, onToken: (delta: string) => void): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(tStandalone('net.offline'), 0);
  }
  // Feature-detect before sending anything, so the fallback re-POST is safe.
  if (typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined') {
    throw new StreamingUnsupportedError();
  }

  // A stalled connection must never leave the caller's bubble stuck streaming:
  // abort if no event arrives for 90s (reset on every event).
  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), 90_000);
  };
  armIdle();

  const authH = authHeader();
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authH,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (idle) clearTimeout(idle);
    throw err instanceof Error ? err : new ApiError('Network error', 0);
  }

  if (!response.ok) {
    if (idle) clearTimeout(idle);
    noteUnauthorized(path, response.status, authH.Authorization);
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      /* non-JSON error body — keep default message */
    }
    throw new ApiError(message, response.status);
  }

  // The server may answer non-SSE (e.g. a proxy stripped Accept) — honour it.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    if (idle) clearTimeout(idle);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
  if (!response.body) {
    if (idle) clearTimeout(idle);
    throw new StreamingUnsupportedError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: T | undefined;
  let doneSeen = false;

  // Parse one SSE record ("event: <name>\ndata: <json>") into a dispatch.
  const handleRecord = (record: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of record.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (!dataLines.length) return;
    const payload = JSON.parse(dataLines.join('\n')) as { text?: string; message?: string; status?: number };
    if (event === 'token') onToken(payload.text ?? '');
    else if (event === 'done') {
      done = payload as unknown as T;
      doneSeen = true;
    } else if (event === 'error') {
      throw new ApiError(payload.message ?? 'Stream failed', payload.status ?? 500);
    }
  };

  try {
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      // Records are separated by a blank line; keep the trailing partial.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const record = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (record.trim()) handleRecord(record);
      }
    }
    // Flush any final record without a trailing blank line.
    if (buffer.trim()) handleRecord(buffer);
  } finally {
    if (idle) clearTimeout(idle);
    reader.cancel().catch(() => undefined);
  }

  if (!doneSeen) throw new ApiError('Stream ended unexpectedly', 0);
  return done as T;
}

/** Authenticated multipart upload (files go as FormData, not JSON). */
export async function httpForm<T>(path: string, form: FormData): Promise<T> {
  const authH = authHeader();
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { ...authH }, // no Content-Type: the browser sets the multipart boundary
    body: form,
  });
  if (!response.ok) {
    noteUnauthorized(path, response.status, authH.Authorization);
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

/** Authenticated binary download (e.g. the PDF analysis report). */
export async function httpBlob(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
): Promise<Blob> {
  const { method = 'GET', body, signal } = options;
  const authH = authHeader();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...authH,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    noteUnauthorized(path, response.status, authH.Authorization);
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      /* binary/non-JSON error body */
    }
    throw new ApiError(message, response.status);
  }
  return response.blob();
}
