import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { legacyHttpObserveMiddleware } from '../../src/middleware/legacy-http-observe.js';
import {
  isLegacyHttpObserveEnabled,
  LEGACY_HTTP_ENDPOINT_CATALOG,
  matchLegacyHttpEndpoint,
  summarizeLegacyHttpObservations,
} from '../../src/shared/legacy-http-observe.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const org = '11111111-1111-1111-1111-111111111111';
const client = '22222222-2222-2222-2222-222222222222';
const contact = '33333333-3333-3333-3333-333333333333';
const note = '44444444-4444-4444-4444-444444444444';
const documentId = '55555555-5555-5555-5555-555555555555';
const member = '66666666-6666-6666-6666-666666666666';

test('matches the seven legacy PATCH/PUT templates and ignores commands, query strings, and GET', () => {
  assert.equal(LEGACY_HTTP_ENDPOINT_CATALOG.length, 7);
  assert.equal(
    matchLegacyHttpEndpoint('PATCH', `/api/v1/organizations/${org}/clients/${client}`)?.key,
    'PATCH /organizations/:orgId/clients/:clientId',
  );
  assert.equal(
    matchLegacyHttpEndpoint('patch', `/api/v1/organizations/${org}/clients/${client}/contacts/${contact}?x=1`)?.key,
    'PATCH /organizations/:orgId/clients/:clientId/contacts/:contactId',
  );
  assert.equal(
    matchLegacyHttpEndpoint('PUT', `/api/v1/organizations/${org}/clients/${client}/contacts/${contact}/primary`)?.key,
    'PUT /organizations/:orgId/clients/:clientId/contacts/:contactId/primary',
  );
  assert.equal(
    matchLegacyHttpEndpoint('PATCH', `/api/v1/organizations/${org}/clients/${client}/notes/${note}`)?.key,
    'PATCH /organizations/:orgId/clients/:clientId/notes/:noteId',
  );
  assert.equal(
    matchLegacyHttpEndpoint('PATCH', `/api/v1/organizations/${org}/documents/${documentId}`)?.key,
    'PATCH /organizations/:orgId/documents/:documentId',
  );
  assert.equal(
    matchLegacyHttpEndpoint('PATCH', `/api/v1/organizations/${org}/members/${member}/role`)?.key,
    'PATCH /organizations/:orgId/members/:memberId/role',
  );
  assert.equal(
    matchLegacyHttpEndpoint('PATCH', `/api/v1/organizations/${org}/settings`)?.key,
    'PATCH /organizations/:orgId/settings',
  );
  assert.equal(
    matchLegacyHttpEndpoint('POST', `/api/v1/organizations/${org}/clients/${client}/commands/update_client`),
    null,
  );
  assert.equal(
    matchLegacyHttpEndpoint('PATCH', `/api/v1/organizations/${org}/clients/${client}/commands/update_client`),
    null,
  );
  assert.equal(matchLegacyHttpEndpoint('GET', `/api/v1/organizations/${org}/clients/${client}`), null);
  assert.equal(matchLegacyHttpEndpoint('PATCH', `/api/v1/organizations/${org}/clients`), null);
});

test('observation flag defaults on and disables only on exact false', () => {
  assert.equal(isLegacyHttpObserveEnabled(undefined), true);
  assert.equal(isLegacyHttpObserveEnabled('true'), true);
  assert.equal(isLegacyHttpObserveEnabled('false'), false);
  assert.equal(isLegacyHttpObserveEnabled('FALSE'), false);
});

test('summary counts facts without inventing internal or external labels', () => {
  const aggregate = summarizeLegacyHttpObservations(
    [
      {
        endpoint_key: 'PATCH /organizations/:orgId/clients/:clientId',
        http_method: 'PATCH',
        http_status: 200,
        observed_at: '2026-11-13T00:00:00.000Z',
        has_authorization: true,
        origin_pull_verified: true,
      },
      {
        endpoint_key: 'PATCH /organizations/:orgId/settings',
        http_method: 'PATCH',
        http_status: 403,
        observed_at: '2026-11-13T00:01:00.000Z',
        has_authorization: false,
        origin_pull_verified: false,
      },
    ],
    '2026-11-13T00:02:00.000Z',
  );
  assert.equal(aggregate.aggregate_key, 'legacy_http_observations_aggregate');
  assert.equal(aggregate.retention_days, 90);
  assert.equal(aggregate.totals.count, 2);
  assert.equal(aggregate.totals.with_authorization, 1);
  assert.equal(aggregate.totals.origin_pull_verified, 1);
  assert.equal(aggregate.totals.by_http_status['403'], 1);
  assert.equal('internal' in aggregate.totals, false);
  assert.equal('external' in aggregate.totals, false);
  assert.equal('source' in aggregate.recent[0]!, false);
});

test('middleware records matched PATCH on finish and does not change the handler status', async () => {
  const recorded: Array<{ endpoint_key: string; http_status: number; has_authorization: boolean }> = [];
  const mw = legacyHttpObserveMiddleware({
    enabled: true,
    record: (row) => {
      recorded.push(row);
    },
    originPullVerified: () => true,
    now: () => new Date('2026-11-13T12:00:00.000Z'),
  });
  const req = {
    method: 'PATCH',
    originalUrl: `/api/v1/organizations/${org}/clients/${client}?secret=1`,
    url: `/api/v1/organizations/${org}/clients/${client}?secret=1`,
    headers: { authorization: 'Bearer should-not-be-stored' },
    body: { tax_id: 'should-not-be-read' },
    query: { secret: '1' },
    ip: '203.0.113.9',
  } as unknown as Request;
  let finish: (() => void) | undefined;
  const res = {
    statusCode: 200,
    once(event: string, listener: () => void) {
      if (event === 'finish') finish = listener;
      return res;
    },
    on(event: string, listener: () => void) {
      if (event === 'finish') finish = listener;
      return res;
    },
  } as unknown as Response;
  let nextCalled = false;
  mw(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);
  assert.equal(nextCalled, true);
  assert.equal(recorded.length, 0);
  assert.ok(finish);
  finish();
  await Promise.resolve();
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.endpoint_key, 'PATCH /organizations/:orgId/clients/:clientId');
  assert.equal(recorded[0]?.http_status, 200);
  assert.equal(recorded[0]?.has_authorization, true);
  assert.equal(JSON.stringify(recorded[0]).includes('should-not-be-stored'), false);
  assert.equal(JSON.stringify(recorded[0]).includes('should-not-be-read'), false);
  assert.equal(JSON.stringify(recorded[0]).includes('203.0.113.9'), false);
  assert.equal(JSON.stringify(recorded[0]).includes('secret=1'), false);
});

test('middleware does not record named commands and still calls next', () => {
  const recorded: unknown[] = [];
  const mw = legacyHttpObserveMiddleware({
    enabled: true,
    record: (row) => {
      recorded.push(row);
    },
  });
  const req = {
    method: 'POST',
    originalUrl: `/api/v1/organizations/${org}/clients/${client}/commands/update_client`,
    headers: {},
  } as unknown as Request;
  const res = {
    statusCode: 200,
    on() {
      throw new Error('command routes must not register an observer');
    },
  } as unknown as Response;
  let nextCalled = false;
  mw(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);
  assert.equal(nextCalled, true);
  assert.equal(recorded.length, 0);
});

test('observation SQL is service-role only and has no PII columns; legacy PATCH/PUT routes remain', () => {
  const sql = readFileSync(join(dir, '../../../../supabase/migrations/210_legacy_http_observations.sql'), 'utf8');
  assert.match(sql, /revoke all on table public\.legacy_http_observations from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, delete on table public\.legacy_http_observations to service_role/);
  assert.match(sql, /force row level security/);
  assert.doesNotMatch(sql, /\bip_address\b/);
  assert.doesNotMatch(sql, /\buser_agent\b/);
  assert.doesNotMatch(sql, /\borganization_id\b/);
  assert.doesNotMatch(sql, /\brequest_body\b/);
  assert.doesNotMatch(sql, /\bquery_string\b/);
  assert.doesNotMatch(sql, /\bcorrelation_id\b/);

  const observeSrc = readFileSync(join(dir, '../../src/middleware/legacy-http-observe.ts'), 'utf8');
  assert.doesNotMatch(observeSrc, /req\.body/);
  assert.doesNotMatch(observeSrc, /req\.query/);
  assert.doesNotMatch(observeSrc, /trustedClientIp/);
  assert.doesNotMatch(observeSrc, /user-agent/);
  assert.doesNotMatch(observeSrc, /getRequestCorrelationId/);
  assert.match(observeSrc, /res\.once/);

  const ownerRoutes = readFileSync(join(dir, '../../src/routes/owner-country-pack.routes.ts'), 'utf8');
  assert.match(ownerRoutes, /assertOwnerOrAuditFailure\(ctx, req\)/);
  assert.match(ownerRoutes, /\/aggregates\/legacy-http-observations/);
  assert.match(ownerRoutes, /\/internal\/legacy-http-observations\/purge/);
  assert.match(ownerRoutes, /requireInternalCronSecret\(req\)/);
  const purgeSlice = ownerRoutes.slice(
    ownerRoutes.indexOf('/internal/legacy-http-observations/purge'),
    ownerRoutes.indexOf('/aggregates/legacy-http-observations'),
  );
  assert.match(purgeSlice, /requireInternalCronSecret\(req\)/);
  const aggregateSlice = ownerRoutes.slice(ownerRoutes.indexOf('/aggregates/legacy-http-observations'));
  assert.match(aggregateSlice, /assertOwnerOrAuditFailure\(ctx, req\)/);

  const serviceSrc = readFileSync(join(dir, '../../src/shared/legacy-http-observe.service.ts'), 'utf8');
  assert.match(serviceSrc, /export async function purgeLegacyHttpObservations/);
  assert.match(serviceSrc, /startLegacyHttpObservationRetentionScheduler/);
  const indexSrc = readFileSync(join(dir, '../../src/index.ts'), 'utf8');
  assert.match(indexSrc, /startLegacyHttpObservationRetentionScheduler\(\)/);

  const clients = readFileSync(join(dir, '../../src/domains/clients/clients.routes.ts'), 'utf8');
  assert.match(clients, /router\.patch\('\/:id\/clients\/:clientId'/);
  assert.match(clients, /router\.patch\('\/:id\/clients\/:clientId\/contacts\/:contactId'/);
  assert.match(clients, /router\.put\('\/:id\/clients\/:clientId\/contacts\/:contactId\/primary'/);
  assert.match(clients, /router\.patch\('\/:id\/clients\/:clientId\/notes\/:noteId'/);
  const documents = readFileSync(join(dir, '../../src/domains/documents/documents.routes.ts'), 'utf8');
  assert.match(documents, /router\.patch\('\/:id\/documents\/:documentId'/);
  const memberships = readFileSync(join(dir, '../../src/domains/memberships/memberships.routes.ts'), 'utf8');
  assert.match(memberships, /router\.patch\('\/:id\/members\/:memberId\/role'/);
  const settings = readFileSync(join(dir, '../../src/domains/organization-settings/organization-settings.routes.ts'), 'utf8');
  assert.match(settings, /router\.patch\('\/:id\/settings'/);
  assert.doesNotMatch(clients, /410/);
  assert.doesNotMatch(observeSrc, /410/);
});
