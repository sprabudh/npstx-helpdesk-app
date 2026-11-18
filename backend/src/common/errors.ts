import { HttpException, HttpStatus } from '@nestjs/common';

/** Error with a stable machine code, returned as { statusCode, code, message }. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, public readonly code: string, message: string, public readonly details?: Record<string, unknown>) {
    super({ statusCode: status, code, message, ...(details ? { details } : {}) }, status);
  }
}
export const notFound = (what: string) => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found.`);
export const forbidden = (message = 'You do not have access to this.', code = 'FORBIDDEN') => new AppError(HttpStatus.FORBIDDEN, code, message);
export const badRequest = (message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>) => new AppError(HttpStatus.BAD_REQUEST, code, message, details);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(HttpStatus.CONFLICT, code, message);
