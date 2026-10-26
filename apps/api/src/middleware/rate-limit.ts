import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

type KeyGenerator = (req: Request) => string;

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  /**
   * Determines the bucket key for this request.
   * Example: `${ip}:${orgId}:${route}`
   */
  keyGenerator?: KeyGenerator;
  /**
   * Response payload for 429.
   */
  message?: string;
  code?: string;
};

type Bucket = { resetAt: number; count: number };

// In-memory fixed window rate limiter.
// NOTE: This is sufficient as a baseline; for multi-instance deployments, use a shared store (e.g. Redis).
const buckets = new Map<string, Bucket>();

/** Test-only: clear in-memory buckets between cases. */
export function resetRateLimitBucketsForTests(): void {
  buckets.clear();
}

export function classifyRateLimitStoreError(message: string, code: string | undefined): 'missing' | 'unavailable' {
  const text = message.toLowerCase();
  const missingFunction = code === 'PGRST202' || text.includes('could not find the function') || text.includes('schema cache');
  return missingFunction ? 'missing' : 'unavailable';
}

function loginBucketKey(raw: string): string {
  return createHash('sha256').update(`login:${raw}`).digest('hex');
}

/** Shared login limiter. Missing storage degrades to this process. Any other store error fails closed. */
export function sharedLoginRateLimit(opts: RateLimitOptions) {
  const local = rateLimit(opts);
  return async (req: Request, res: Response, next: NextFunction) => {
    const raw = opts.keyGenerator ? opts.keyGenerator(req) : req.ip || 'unknown';
    try {
      const { supabaseAdmin } = await import('../db/client.js');
      const rpc = await supabaseAdmin.rpc('consume_security_rate_bucket', {
        p_key: loginBucketKey(raw),
        p_window_seconds: Math.max(1, Math.ceil(opts.windowMs / 1000)),
        p_max: opts.max,
      });
      if (!rpc.error) {
        const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as { allowed?: boolean; request_count?: number } | null;
        const count = Number(row?.request_count ?? 0);
        res.locals.rateLimitCount = count;
        if (row?.allowed === false) {
          res.setHeader('Retry-After', '180');
          return res.status(429).json({
            code: opts.code ?? 'TOO_MANY_REQUESTS',
            retry_after: 180,
            offer_recovery: true,
          });
        }
        return next();
      }
      if (classifyRateLimitStoreError(String(rpc.error.message ?? ''), rpc.error.code) === 'unavailable') {
        return res.status(503).json({ code: 'RATE_LIMIT_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' });
      }
    } catch {
      return res.status(503).json({ code: 'RATE_LIMIT_UNAVAILABLE', message: 'Sign-in is temporarily unavailable' });
    }
    return local(req, res, next);
  };
}

export function rateLimit(opts: RateLimitOptions) {
  const windowMs = opts.windowMs;
  const max = opts.max;
  const message = opts.message ?? 'Too many requests. Please try again later.';
  const code = opts.code ?? 'TOO_MANY_REQUESTS';

  return (req: Request, res: Response, next: NextFunction) => {
    const keyBase = opts.keyGenerator ? opts.keyGenerator(req) : req.ip || 'unknown';
    // Use Express matched route path (normalized) if possible,
    // so `/.../invites/:inviteId/resend` shares the same bucket.
    const routePath = req.route?.path ?? req.path;
    const key = `${req.method}:${req.baseUrl}:${routePath}:${keyBase}`;
    const now = Date.now();

    const bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { resetAt: now + windowMs, count: 1 });
      res.locals.rateLimitCount = 1;
      return next();
    }

    const nextCount = bucket.count + 1;
    buckets.set(key, { ...bucket, count: nextCount });
    res.locals.rateLimitCount = nextCount;

    if (nextCount > max) {
      const retryAfterSec = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ code, message });
    }

    return next();
  };
}

