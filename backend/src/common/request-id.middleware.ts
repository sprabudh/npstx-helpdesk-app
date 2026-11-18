import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Adds a request id and logs method, path, status and duration (no bodies, no personal data). */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly log = new Logger('Access');
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    req.requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.setHeader('x-request-id', req.requestId);
    const t0 = Date.now();
    res.on('finish', () => this.log.log({ id: req.requestId, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Date.now() - t0 } as unknown as string));
    next();
  }
}
