export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    /** Merged into JSON error responses (e.g. domain validation details). */
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(message: string, code = 'BAD_REQUEST') {
  return new AppError(400, message, code);
}

export function unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
  return new AppError(401, message, code);
}

export function forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
  return new AppError(403, message, code);
}

export function notFound(message = 'Not found', code = 'NOT_FOUND') {
  return new AppError(404, message, code);
}

export function conflict(message: string, code = 'CONFLICT') {
  return new AppError(409, message, code);
}
