/** HTTP error with a user-facing message ({ message } is the API error shape). */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Not authenticated') => new HttpError(401, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const serviceUnavailable = (message = 'Service temporarily unavailable') => new HttpError(503, message);
