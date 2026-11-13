/**
 * Read-only observation of the seven legacy Core PATCH/PUT routes.
 * Does not authorize, mutate, or change status. Never records bodies, tokens, query strings, or IPs.
 */

import type { NextFunction, Request, Response } from 'express';
import { getRequestCorrelationId } from './correlation.js';
import { originPullSecretMatches } from '../shared/trusted-proxy.pure.js';
import {
  isLegacyHttpObserveEnabled,
  matchLegacyHttpEndpoint,
  type LegacyHttpObservationRow,
} from '../shared/legacy-http-observe.pure.js';

export type LegacyHttpObserveDependencies = {
  enabled?: boolean;
  now?: () => Date;
  originPullVerified?: (req: Request) => boolean;
  record?: (row: LegacyHttpObservationRow) => void | Promise<void>;
};

function headerPresent(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.some((item) => String(item ?? '').trim().length > 0);
  return String(value ?? '').trim().length > 0;
}

function defaultOriginPullVerified(req: Request): boolean {
  const provided = typeof req.headers['x-nodexpro-origin-secret'] === 'string'
    ? req.headers['x-nodexpro-origin-secret']
    : '';
  return originPullSecretMatches(provided, process.env.CLOUDFLARE_ORIGIN_PULL_SECRET?.trim() || null);
}

async function defaultRecord(row: LegacyHttpObservationRow): Promise<void> {
  const { recordLegacyHttpObservation } = await import('../shared/legacy-http-observe.service.js');
  await recordLegacyHttpObservation(row);
}

export function legacyHttpObserveMiddleware(deps: LegacyHttpObserveDependencies = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const enabled = deps.enabled ?? isLegacyHttpObserveEnabled(process.env.LEGACY_HTTP_OBSERVE);
    if (!enabled) {
      next();
      return;
    }
    const matched = matchLegacyHttpEndpoint(req.method, req.originalUrl ?? req.url ?? '');
    if (!matched) {
      next();
      return;
    }
    res.on('finish', () => {
      const row: LegacyHttpObservationRow = {
        endpoint_key: matched.key,
        http_method: matched.method,
        http_status: res.statusCode,
        observed_at: (deps.now ?? (() => new Date()))().toISOString(),
        has_authorization: headerPresent(req.headers.authorization),
        origin_pull_verified: (deps.originPullVerified ?? defaultOriginPullVerified)(req),
        correlation_id: getRequestCorrelationId(req),
      };
      void Promise.resolve((deps.record ?? defaultRecord)(row)).catch(() => {
        /* observation must never affect the response */
      });
    });
    next();
  };
}
