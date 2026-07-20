/**
 * Small utilities shared by the API layer.
 */

/** Simulate network latency in the mock layer. */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Deep clone so callers can't mutate the in-memory mock database. */
export const clone = <T>(value: T): T =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

/** A typed error carrying an HTTP-like status, thrown by both mock and real API.
 *  `code` mirrors the server's machine-readable `{ code }` (e.g. `totp_required`)
 *  when present — callers branch on it without parsing the message. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
