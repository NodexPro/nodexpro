/**
 * Request timing — measurement only, no business behavior.
 *
 * Every API request does a chain of network calls to Supabase (auth + REST). In production those calls are the
 * dominant cost, so the only trustworthy way to see where a request's time goes is to measure it on the real
 * deployment. This adds ONE response header, `Server-Timing`, visible in the browser DevTools (Network → request →
 * Timing) without any extra tooling:
 *
 *   Server-Timing: total;dur=2310;desc="API time in the process", db;dur=3120;desc="21 data calls, avg 148ms,
 *                  max 402ms (sum of overlapping calls)"
 *
 *   total  wall time the API spent on the request (excludes the browser/Vercel/Render network legs and any Render
 *          cold start, which happen before the request reaches Express).
 *   db     number of data calls (REST + Auth), the average and the slowest single call. `avg` is the real
 *          Render→Supabase round-trip cost per call; `sum` > `total` means calls already overlap.
 *
 * Only aggregates are exposed: no table names, queries, ids or payloads. Calls started outside a request are not
 * counted. The wrapper delegates to `globalThis.fetch` untouched (same arguments, same result, same errors).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

type TimingStore = { startedAt: number; calls: number; sumMs: number; maxMs: number };

const storage = new AsyncLocalStorage<TimingStore>();

const now = (): number => performance.now();

/** `fetch` for the Supabase clients: identical behavior, plus per-request call accounting. */
export const timedFetch: typeof fetch = async (input, init) => {
  const store = storage.getStore();
  if (!store) return globalThis.fetch(input, init);
  const t0 = now();
  try {
    return await globalThis.fetch(input, init);
  } finally {
    const ms = now() - t0;
    store.calls += 1;
    store.sumMs += ms;
    if (ms > store.maxMs) store.maxMs = ms;
  }
};

export function formatServerTiming(store: TimingStore, at: number = now()): string {
  const total = Math.max(0, at - store.startedAt);
  const avg = store.calls > 0 ? store.sumMs / store.calls : 0;
  const db =
    `db;dur=${store.sumMs.toFixed(0)};desc="${store.calls} data calls, avg ${avg.toFixed(0)}ms, ` +
    `max ${store.maxMs.toFixed(0)}ms (sum of overlapping calls)"`;
  return `total;dur=${total.toFixed(0)};desc="API time in the process", ${db}`;
}

export function requestTimingMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const store: TimingStore = { startedAt: now(), calls: 0, sumMs: 0, maxMs: 0 };
  const writeHead = res.writeHead;
  res.writeHead = function patchedWriteHead(this: Response, ...args: unknown[]) {
    try {
      if (!this.headersSent && !this.hasHeader('Server-Timing')) {
        this.setHeader('Server-Timing', formatServerTiming(store));
      }
    } catch {
      // measurement must never affect a response
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  } as typeof res.writeHead;
  storage.run(store, next);
}
