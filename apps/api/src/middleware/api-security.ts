import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { classifyApiRequest, quotaForSecurityClass, requestExceedsClassSize } from '../shared/api-security.pure.js';
import { originPullSecretMatches, resolveEdgeTrustedIp, shouldRejectUnprotectedOrigin } from '../shared/trusted-proxy.pure.js';
import { classifyRateLimitStoreError } from './rate-limit.js';

function classBucketKey(securityClass: string, raw: string): string {
  return createHash('sha256').update(`api-sec:${securityClass}:${raw}`).digest('hex');
}

function contentLengthOf(req: Request): number | null {
  const raw = req.headers['content-length'];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function requestPath(req: Request): string {
  return String(req.originalUrl ?? req.path ?? '').split('?')[0];
}

export function attachTrustedClientIp(req: Request): string | null {
  const originSecret = typeof req.headers['x-nodexpro-origin-secret'] === 'string' ? req.headers['x-nodexpro-origin-secret'] : '';
  const verified = originPullSecretMatches(originSecret, config.cloudflareOriginPullSecret);
  const forwarded = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : null;
  const resolved = resolveEdgeTrustedIp({
    reqIp: typeof req.ip === 'string' ? req.ip : null,
    cfConnectingIp: typeof req.headers['cf-connecting-ip'] === 'string' ? req.headers['cf-connecting-ip'] : null,
    peerIp: req.socket?.remoteAddress ?? null,
    forwardedFor: forwarded,
    originPullVerified: verified,
  });
  req.trustedClientIp = resolved.ip;
  req.trustedClientIpDisplay = resolved.ip ? resolved.ip : 'Unknown';
  return resolved.ip;
}

export function apiSecurityMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const path = requestPath(req);
    const securityClass = classifyApiRequest(req.method, path);
    const quota = quotaForSecurityClass(securityClass);
    attachTrustedClientIp(req);

    if (
      shouldRejectUnprotectedOrigin({
        enabled: config.cloudflareOriginProtection,
        path,
        originPullConfigured: Boolean(config.cloudflareOriginPullSecret),
        originPullVerified: originPullSecretMatches(
          typeof req.headers['x-nodexpro-origin-secret'] === 'string' ? req.headers['x-nodexpro-origin-secret'] : '',
          config.cloudflareOriginPullSecret,
        ),
      })
    ) {
      return res.status(403).json({ code: 'ORIGIN_PROTECTED', message: 'Direct origin access is not allowed' });
    }

    if (requestExceedsClassSize(contentLengthOf(req), quota.maxBytes)) {
      return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large' });
    }

    if (securityClass === 'health') return next();

    const raw = `${req.trustedClientIp ?? req.ip ?? 'unknown'}:${req.context?.user?.id ?? 'anon'}`;
    try {
      const { supabaseAdmin } = await import('../db/client.js');
      const rpc = await supabaseAdmin.rpc('consume_security_rate_bucket', {
        p_key: classBucketKey(securityClass, raw),
        p_window_seconds: Math.max(1, Math.ceil(quota.windowMs / 1000)),
        p_max: quota.max,
      });
      if (!rpc.error) {
        const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as { allowed?: boolean } | null;
        if (row?.allowed === false) {
          return res.status(429).json({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please wait and try again later.' });
        }
        return next();
      }
      if (classifyRateLimitStoreError(String(rpc.error.message ?? ''), rpc.error.code) === 'unavailable' && quota.failClosed) {
        return res.status(503).json({ code: 'RATE_LIMIT_UNAVAILABLE', message: 'This action is temporarily unavailable' });
      }
    } catch {
      if (quota.failClosed) {
        return res.status(503).json({ code: 'RATE_LIMIT_UNAVAILABLE', message: 'This action is temporarily unavailable' });
      }
    }
    return next();
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    trustedClientIp?: string | null;
    trustedClientIpDisplay?: string;
  }
}
