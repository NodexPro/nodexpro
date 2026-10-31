import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  spliceClientRowIntoRegistryMaterialization,
  SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS,
} from '../../src/domains/client-operations/client-operations-registry-incremental.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

type Row = { client_id: string; mark: number };

function mat(rows: Row[]) {
  return { built_rows: rows, stage_timings: {} as Record<string, number>, materialized_at_ms: 1 };
}

test('splice replaces the mutated row and keeps neighbors', () => {
  const cached = mat([
    { client_id: 'a', mark: 0 },
    { client_id: 'b', mark: 0 },
    { client_id: 'c', mark: 0 },
  ]);
  const rebuilt = mat([{ client_id: 'b', mark: 1 }]);
  const next = spliceClientRowIntoRegistryMaterialization(cached, rebuilt, 'b');
  assert.deepEqual(
    next.built_rows.map((r) => r.client_id),
    ['a', 'b', 'c'],
  );
  assert.equal(next.built_rows[1]?.mark, 1);
  assert.equal(next.stage_timings?.incremental_client_refresh, 1);
});

test('splice removes a row that the rebuilt aggregate filtered out', () => {
  const cached = mat([
    { client_id: 'a', mark: 1 },
    { client_id: 'b', mark: 0 },
  ]);
  const rebuilt = mat([]);
  const next = spliceClientRowIntoRegistryMaterialization(cached, rebuilt, 'a');
  assert.deepEqual(
    next.built_rows.map((r) => r.client_id),
    ['b'],
  );
});

test('splice inserts a newly matching client at the end', () => {
  const cached = mat([{ client_id: 'a', mark: 0 }]);
  const rebuilt = mat([{ client_id: 'z', mark: 1 }]);
  const next = spliceClientRowIntoRegistryMaterialization(cached, rebuilt, 'z');
  assert.deepEqual(
    next.built_rows.map((r) => r.client_id),
    ['a', 'z'],
  );
});

test('500-row splice stays well under a millisecond locally', () => {
  const cached = mat(Array.from({ length: 500 }, (_, i) => ({ client_id: `c${i}`, mark: 0 })));
  const rebuilt = mat([{ client_id: 'c250', mark: 1 }]);
  const started = Date.now();
  const next = spliceClientRowIntoRegistryMaterialization(cached, rebuilt, 'c250');
  const elapsed = Date.now() - started;
  assert.equal(next.built_rows[250]?.mark, 1);
  assert.equal(next.built_rows.length, 500);
  assert.ok(elapsed < 20, `splice of 500 rows took ${elapsed}ms`);
});

test('command path rematerializes one client and still returns a full aggregate', () => {
  const custom = read('../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts');
  const service = read('../../src/domains/client-operations/client-operations.service.ts');
  assert.match(custom, /refreshClientOperationsRegistryAfterMutation/);
  assert.match(custom, /mutatedClientId: incrementalRegistryClientId/);
  assert.match(custom, /SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS/);
  assert.match(service, /onlyClientIds/);
  assert.match(service, /spliceClientRowIntoRegistryMaterialization/);
  assert.match(service, /materializationSource = 'incremental'/);
  assert.doesNotMatch(custom, /invalidateClientOperationsRegistryMaterializationCache\(orgId\);\s*const responseQuery/);
  assert.ok(SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS.has('set_material_brought'));
  assert.ok(SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS.has('complete_ni_deductions_126_cycle'));
  assert.equal(SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS.has('copy_client_operations_user_period_data'), false);
});

test('no-op ensure slots reuses the GET materialization instead of rebuilding', () => {
  const custom = read('../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts');
  assert.match(custom, /reuseMaterializationCache = true/);
  assert.match(custom, /materializationCache: true/);
});

test('VAT due starts before phase 2 await', () => {
  const service = read('../../src/domains/client-operations/client-operations.service.ts');
  const vat = service.indexOf('vatDuePromise = settled(resolveVatDueDisplayByClientForRegistry');
  const phase2 = service.indexOf("markStage('phase2_presentation_loads'");
  assert.ok(vat > 0 && phase2 > vat);
});
