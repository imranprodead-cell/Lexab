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
export const USE_MOCK = import.meta.env.VITE_USE_MOCK_API === 'true';

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

export async function http<T>(path: string, options: HttpOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers = {}, retries = method === 'GET' ? 2 : 0 } = options;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(tStandalone('net.offline'), 0);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        signal,
        // Content-Type only when a body is sent: Fastify rejects bodyless
        // requests (e.g. DELETE /chats/:id) that declare application/json.
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...authHeader(),
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
        let message = `Request failed (${response.status})`;
        try {
          const data = (await response.json()) as { message?: string };
          if (data?.message) message = data.message;
        } catch {
          /* non-JSON error body — keep default message */
        }
        throw new ApiError(message, response.status);
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
  throw lastError instanceof Error ? lastError : new ApiError('Network error', 0);
}

/** Authenticated multipart upload (files go as FormData, not JSON). */
export async function httpForm<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { ...authHeader() }, // no Content-Type: the browser sets the multipart boundary
    body: form,
  });
  if (!response.ok) {
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
export async function httpBlob(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<Blob> {
  const { method = 'GET', body } = options;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...authHeader(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
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
