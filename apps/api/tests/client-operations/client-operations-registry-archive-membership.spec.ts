/**
 * Client Operations — archived clients must not appear in the active registry
 * for the current period, the default (previous) period, or any earlier month.
 *
 * Frozen snapshots / material facts stay in the database; they do not keep the
 * client in the live list. Restore flips `clients.is_archived` and invalidates
 * the materialization cache so the next GET rebuilds from live truth.
 *
 * Truth is the backend aggregate. The UI must not hide archived rows locally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clientExistsInOperationalPeriod,
  resolveDefaultOperationalPeriodKey,
  shouldEmitOperationalPeriodRegistryRow,
  shouldIncludeArchivedClientInOperationalPeriodRegistry,
} from '../../src/domains/client-operations/client-operations-operational-period.pure.js';
import {
  buildClientOperationsRegistryMaterializationCacheKey,
  clearClientOperationsRegistryMaterializationCacheForTests,
  clientOperationsRegistryMaterializationCache,
  invalidateClientOperationsRegistryMaterializationCache,
} from '../../src/domains/client-operations/client-operations-registry-materialization-cache.js';
import { normalizeClientOperationsRegistryBusinessFilterQuery } from '../../src/domains/client-operations/client-operations-registry-filters.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

type ClientSeed = {
  id: string;
  display_name: string;
  is_archived: boolean;
  created_at: string;
};

type PeriodFacts = {
  snapshotIds: Set<string>;
  materialFactIds: Set<string>;
  frozenMembershipIds: Set<string>;
};

/** Mirrors the live registry membership gates in listClientOperationsRegistry. */
function activeRegistryClientIds(
  clients: ClientSeed[],
  selectedPeriodKey: string,
  defaultPeriodKey: string,
  facts: PeriodFacts,
): string[] {
  const live = clients.filter((c) =>
    shouldIncludeArchivedClientInOperationalPeriodRegistry({
      is_current_or_default_period: selectedPeriodKey === defaultPeriodKey,
      is_archived: c.is_archived,
      has_frozen_period_membership: facts.frozenMembershipIds.has(c.id),
    }),
  );
  return live
    .filter((c) =>
      clientExistsInOperationalPeriod({
        client_created_at: c.created_at,
        operational_period_key: selectedPeriodKey,
      }),
    )
    .filter((c) =>
      shouldEmitOperationalPeriodRegistryRow({
        is_archived: c.is_archived,
        has_applicability_snapshot: facts.snapshotIds.has(c.id),
        has_material_fact: facts.materialFactIds.has(c.id),
      }),
    )
    .map((c) => c.id);
}

const TEST10: ClientSeed = {
  id: 'client-test10',
  display_name: 'Test10',
  is_archived: true,
  created_at: '2025-01-01T00:00:00.000Z',
};
const LIVE: ClientSeed = {
  id: 'client-live',
  display_name: 'LiveCo',
  is_archived: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

const OCT_FACTS: PeriodFacts = {
  snapshotIds: new Set([TEST10.id, LIVE.id]),
  materialFactIds: new Set([TEST10.id]),
  frozenMembershipIds: new Set([TEST10.id, LIVE.id]),
};

const noFilters = () => normalizeClientOperationsRegistryBusinessFilterQuery({});

test('archive → disappear: Test10 leaves Oct 2026 even with frozen membership (production case)', () => {
  const defaultPeriodKey = resolveDefaultOperationalPeriodKey(new Date('2026-10-30T08:00:00.000Z'));
  assert.equal(defaultPeriodKey, '2026-09');
  const ids = activeRegistryClientIds([TEST10, LIVE], '2026-09', defaultPeriodKey, OCT_FACTS);
  const octIds = activeRegistryClientIds([TEST10, LIVE], '2026-10', defaultPeriodKey, OCT_FACTS);
  assert.deepEqual(ids, [LIVE.id]);
  assert.deepEqual(octIds, [LIVE.id]);
  assert.ok(!ids.includes(TEST10.id));
  assert.ok(!octIds.includes(TEST10.id));
});

test('archive → disappear: previous month (default) also excludes archived clients', () => {
  const ids = activeRegistryClientIds([TEST10, LIVE], '2026-09', '2026-09', OCT_FACTS);
  assert.deepEqual(ids, [LIVE.id]);
});

test('restore → reappear: live is_archived=false returns Test10 per created_at / period rules', () => {
  const restored = { ...TEST10, is_archived: false };
  const defaultPeriodKey = '2026-09';
  const sep = activeRegistryClientIds([restored, LIVE], '2026-09', defaultPeriodKey, OCT_FACTS);
  const oct = activeRegistryClientIds([restored, LIVE], '2026-10', defaultPeriodKey, OCT_FACTS);
  assert.deepEqual(sep.sort(), [LIVE.id, restored.id].sort());
  assert.deepEqual(oct.sort(), [LIVE.id, restored.id].sort());
});

test('period change: archived client stays out of every selected month; live client remains', () => {
  const periods = ['2026-08', '2026-09', '2026-10'];
  for (const selected of periods) {
    const ids = activeRegistryClientIds([TEST10, LIVE], selected, '2026-09', OCT_FACTS);
    assert.deepEqual(ids, [LIVE.id], `period ${selected} must hide archived Test10`);
  }
});

test('reopen page: archive invalidates materialization cache so the next GET cannot reuse archived rows', () => {
  clearClientOperationsRegistryMaterializationCacheForTests();
  const orgId = 'org-archive-reopen';
  const key = buildClientOperationsRegistryMaterializationCacheKey({
    organizationId: orgId,
    accessScopeKey: 'OFFICE',
    selectedPeriodKey: '2026-10',
    defaultPeriodKey: '2026-09',
    canEditRegistry: true,
    filters: noFilters(),
  });
  const stale = {
    built_rows: [{ client_id: TEST10.id, client_name: TEST10.display_name }],
  } as never;
  clientOperationsRegistryMaterializationCache.set(key, stale);
  assert.ok(clientOperationsRegistryMaterializationCache.peek(key));

  const dropped = invalidateClientOperationsRegistryMaterializationCache(orgId);
  assert.ok(dropped >= 1);
  assert.equal(clientOperationsRegistryMaterializationCache.peek(key), undefined);

  const rebuiltIds = activeRegistryClientIds([TEST10, LIVE], '2026-10', '2026-09', OCT_FACTS);
  assert.deepEqual(rebuiltIds, [LIVE.id]);
  clearClientOperationsRegistryMaterializationCacheForTests();
});

test('source: Core archive/restore commands own is_archived + audit + cache invalidation', () => {
  const clients = read('../../src/domains/clients/clients.service.ts');
  const archiveFn = clients.slice(
    clients.indexOf('export async function archiveClient'),
    clients.indexOf('export async function restoreClient'),
  );
  const restoreFn = clients.slice(
    clients.indexOf('export async function restoreClient'),
    clients.indexOf('export async function bulkMarkActive'),
  );
  assert.match(archiveFn, /is_archived:\s*true/);
  assert.match(archiveFn, /eq\('organization_id',\s*orgId\)/);
  assert.match(archiveFn, /CLIENT_ARCHIVED/);
  assert.match(archiveFn, /invalidateClientOperationsRegistryMaterializationCache\(orgId\)/);
  assert.match(restoreFn, /is_archived:\s*false/);
  assert.match(restoreFn, /eq\('organization_id',\s*orgId\)/);
  assert.match(restoreFn, /CLIENT_RESTORED/);
  assert.match(restoreFn, /invalidateClientOperationsRegistryMaterializationCache\(orgId\)/);
});

test('source: aggregate query is live non-archived; frozen membership is not re-attached', () => {
  const service = read('../../src/domains/client-operations/client-operations.service.ts');
  const builder = service.slice(
    service.indexOf('const setupMs = Date.now();'),
    service.indexOf('if (safeClients.length === 0)'),
  );
  assert.match(builder, /\.eq\('is_archived',\s*false\)/);
  assert.match(builder, /shouldIncludeArchivedClientInOperationalPeriodRegistry/);
  assert.doesNotMatch(builder, /loadPeriodMembershipClientIds/);
  assert.doesNotMatch(builder, /historicalExtras/);
  assert.match(service, /shouldEmitOperationalPeriodRegistryRow/);
});

test('source: UI renders aggregate rows and does not locally drop archived clients', () => {
  const page = read('../../../web/src/pages/ClientOperationsRegistry.tsx');
  const view = read('../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx');
  assert.doesNotMatch(page, /rows\.filter\s*\(/);
  assert.doesNotMatch(view, /rows\.filter\s*\(/);
  assert.doesNotMatch(page, /is_archived/);
  assert.doesNotMatch(view, /is_archived/);
});
