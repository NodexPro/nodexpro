/**
 * P11.5-A — Attach one correlation_id per HTTP request.
 */
import { CORRELATION_HEADER, resolveCorrelationId } from '../shared/observability.js';
export function correlationMiddleware(req, res, next) {
    const incoming = req.header(CORRELATION_HEADER) ?? req.header('x-request-id');
    const correlationId = resolveCorrelationId(incoming);
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    next();
}
export function getRequestCorrelationId(req) {
    return req.correlationId ?? resolveCorrelationId(null);
}
