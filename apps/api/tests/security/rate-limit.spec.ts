import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { classifyRateLimitStoreError, rateLimit, resetRateLimitBucketsForTests } from '../../src/middleware/rate-limit.js';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    baseUrl: '/api/v1/auth',
    path: '/register',
    route: { path: '/register' },
    ip: '203.0.113.9',
    body: { email: 'new@example.com' },
    ...overrides,
  } as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown; headers: Record<string, string> } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    locals: {} as Record<string, unknown>,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = String(value);
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string> };
}

test('register limiter allows the first requests and returns 429 after the window max', () => {
  resetRateLimitBucketsForTests();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
      return `${req.ip ?? 'unknown'}:${email || 'no-email'}`;
    },
    message: 'Too many registration attempts. Please wait and try again later.',
  });

  for (let i = 0; i < 5; i += 1) {
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    limiter(req, res, (() => {
      nextCalled = true;
    }) as NextFunction);
    assert.equal(nextCalled, true, `request ${i + 1} should pass`);
    assert.equal(res.statusCode, 200);
  }

  const blockedReq = mockReq();
  const blockedRes = mockRes();
  let blockedNext = false;
  limiter(blockedReq, blockedRes, (() => {
    blockedNext = true;
  }) as NextFunction);
  assert.equal(blockedNext, false);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal((blockedRes.body as { code?: string }).code, 'TOO_MANY_REQUESTS');
  assert.equal(
    (blockedRes.body as { message?: string }).message,
    'Too many registration attempts. Please wait and try again later.',
  );
  assert.ok(blockedRes.headers['retry-after']);
});

test('register limiter isolates buckets by email so a second user is not locked out', () => {
  resetRateLimitBucketsForTests();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1,
    keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? '')}`,
  });

  const first = mockRes();
  let firstNext = false;
  limiter(mockReq({ body: { email: 'a@example.com' } } as Partial<Request>), first, (() => {
    firstNext = true;
  }) as NextFunction);
  assert.equal(firstNext, true);

  const sameUser = mockRes();
  let sameNext = false;
  limiter(mockReq({ body: { email: 'a@example.com' } } as Partial<Request>), sameUser, (() => {
    sameNext = true;
  }) as NextFunction);
  assert.equal(sameNext, false);
  assert.equal(sameUser.statusCode, 429);

  const other = mockRes();
  let otherNext = false;
  limiter(mockReq({ body: { email: 'b@example.com' } } as Partial<Request>), other, (() => {
    otherNext = true;
  }) as NextFunction);
  assert.equal(otherNext, true);
  assert.equal(other.statusCode, 200);
});

test('a missing shared limiter degrades and any other store error fails closed', () => {
  assert.equal(classifyRateLimitStoreError('Could not find the function public.consume_security_rate_bucket', 'PGRST202'), 'missing');
  assert.equal(classifyRateLimitStoreError('consume_security_rate_bucket failed', 'P0001'), 'unavailable');
  assert.equal(classifyRateLimitStoreError('connection refused', '08006'), 'unavailable');
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations/202_security_rate_buckets.sql'), 'utf8');
  assert.match(sql, /returning b\.request_count into v_count/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on function public\.consume_security_rate_bucket/);
});
