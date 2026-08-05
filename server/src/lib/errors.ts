/** HTTP error with a user-facing message ({ message } is the API error shape). */
export class HttpError extends Error {
  readonly status: number;
  /** Optional machine-readable code the client can branch on (e.g. 'totp_required'). */
  readonly code?: string;
  /**
   * Данные для локализации на клиенте (какая фича, какой план, лимит, расход).
   * Сообщение с сервера остаётся русско-английским фолбэком, но интерфейс на
   * немецком/казахском/узбекском/арабском собирает свой текст из этих полей —
   * раньше все отказы по тарифу приходили жёстко по-русски (аудит 2026-08-03).
   */
  readonly details?: Record<string, string | number | null>;

  constructor(status: number, message: string, code?: string, details?: Record<string, string | number | null>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Not authenticated') => new HttpError(401, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const serviceUnavailable = (message = 'Service temporarily unavailable') => new HttpError(503, message);
