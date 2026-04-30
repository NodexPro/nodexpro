// In-memory fixed window rate limiter.
// NOTE: This is sufficient as a baseline; for multi-instance deployments, use a shared store (e.g. Redis).
const buckets = new Map();
export function rateLimit(opts) {
    const windowMs = opts.windowMs;
    const max = opts.max;
    const message = opts.message ?? 'Too many requests. Please try again later.';
    const code = opts.code ?? 'TOO_MANY_REQUESTS';
    return (req, res, next) => {
        const keyBase = opts.keyGenerator ? opts.keyGenerator(req) : req.ip || 'unknown';
        // Use Express matched route path (normalized) if possible,
        // so `/.../invites/:inviteId/resend` shares the same bucket.
        const routePath = req.route?.path ?? req.path;
        const key = `${req.method}:${req.baseUrl}:${routePath}:${keyBase}`;
        const now = Date.now();
        const bucket = buckets.get(key);
        if (!bucket || now > bucket.resetAt) {
            buckets.set(key, { resetAt: now + windowMs, count: 1 });
            return next();
        }
        const nextCount = bucket.count + 1;
        buckets.set(key, { ...bucket, count: nextCount });
        if (nextCount > max) {
            const retryAfterSec = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfterSec));
            return res.status(429).json({ code, message });
        }
        return next();
    };
}
