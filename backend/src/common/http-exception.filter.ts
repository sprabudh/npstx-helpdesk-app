import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Every error leaves the API as { statusCode, code, message, details?, path, requestId }. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { code: 'INTERNAL', message: 'Something went wrong on our side. Try again in a moment.' };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'object' && r) {
        const o = r as Record<string, unknown>;
        const msg = Array.isArray(o.message) ? (o.message as string[]).join('; ') : (o.message as string);
        body = { code: o.code ?? (status === 400 ? 'VALIDATION' : HttpStatus[status]), message: msg, ...(o.details ? { details: o.details } : {}) };
      } else body = { code: HttpStatus[status], message: String(r) };
    } else {
      this.log.error(JSON.stringify({ msg: 'unhandled', path: req.path, error: exception instanceof Error ? exception.message : String(exception) }));
    }
    res.status(status).json({ statusCode: status, ...body, path: req.path, requestId: req.requestId });
  }
}
