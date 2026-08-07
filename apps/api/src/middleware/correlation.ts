/**
 * P11.5-A — Attach one correlation_id per HTTP request.
 */

import type { NextFunction, Request, Response } from 'express';
import { CORRELATION_HEADER, resolveCorrelationId } from '../shared/observability.js';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(CORRELATION_HEADER) ?? req.header('x-request-id');
  const correlationId = resolveCorrelationId(incoming);
  req.correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);
  next();
}

export function getRequestCorrelationId(req: Request): string {
  return req.correlationId ?? resolveCorrelationId(null);
}
