/**
 * Client Operations case GET is read-only for obligations.
 * Recompute is a named command on the existing obligations engine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { businessPreviousMonthKey } from '../../src/shared/business-time.js';
import { vatFilingPeriodIdentityForOperationalPeriod } from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/client-operations');

function sliceFunction(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = source.indexOf('\nexport async function ', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test('getClientOperationsCase does not persist obligations or emit recompute side effects', () => {
  const caseSource = readFileSync(join(srcDir, 'client-operations.service.ts'), 'utf8');
  const getCase = sliceFunction(caseSource, 'getClientOperationsCase');
  assert.doesNotMatch(getCase, /recomputeClientObligationsAndTasks/);
  const routes = readFileSync(join(srcDir, 'client-operations.routes.ts'), 'utf8');
  const getRoute = routes.slice(
    routes.indexOf("router.get('/clients/:clientId'"),
    routes.indexOf("router.get('/clients/:clientId/quick-profile'"),
  );
  assert.match(getRoute, /getClientOperationsCase/);
  assert.doesNotMatch(getRoute, /recomputeClientObligationsAndTasks/);
  assert.doesNotMatch(getRoute, /executeClientObligationsCommand/);
});

test('recompute_obligations is a named edit command that reuses the existing engine and returns the case', () => {
  const core = readFileSync(join(srcDir, 'client-obligations-tasks-core.service.ts'), 'utf8');
  const routes = readFileSync(join(srcDir, 'client-operations.routes.ts'), 'utf8');
  assert.match(core, /\| 'recompute_obligations'/);
  assert.match(core, /case 'recompute_obligations':/);
  const cmdRoute = routes.slice(
    routes.indexOf("router.post('/clients/:clientId/obligations/commands'"),
    routes.indexOf("router.post('/clients/:clientId/tasks/commands'"),
  );
  assert.match(cmdRoute, /withEdit/);
  assert.match(cmdRoute, /executeClientObligationsCommand/);
  assert.match(cmdRoute, /getClientOperationsCase/);
  const taxSettings = readFileSync(join(srcDir, 'client-operations-commands.service.ts'), 'utf8');
  const taxTab = readFileSync(join(srcDir, 'client-tax-commands.service.ts'), 'utf8');
  assert.match(taxSettings, /await recomputeClientObligationsAndTasks\(ctx, clientId, new Date\(\)\)/);
  assert.match(taxTab, /await recomputeClientObligationsAndTasks\(ctx, clientId, new Date\(\)\)/);
});

test('recompute_obligations preserves historical incomplete periods and stays idempotent', () => {
  const core = readFileSync(join(srcDir, 'client-obligations-tasks-core.service.ts'), 'utf8');
  const start = core.indexOf('async function recomputeClientObligationsAndTasksForOrg');
  assert.notEqual(start, -1);
  const next = core.indexOf('\nfunction taskTypeByState', start + 1);
  assert.notEqual(next, -1);
  const recompute = core.slice(start, next);
  assert.match(recompute, /HISTORICAL_OBLIGATION_PRESERVATION/);
  assert.doesNotMatch(recompute, /is_active:\s*false/);
  assert.match(recompute, /onConflict: 'organization_id,client_id,obligation_type,period_key'/);
  assert.match(recompute, /status === 'missing_data' && existingStatus !== 'missing_data'/);
  assert.match(recompute, /keepCommandOwned && existingStatus \? existingStatus : rel.computed_status/);
});

test('November 2026 recompute identities restore monthly 2026-10 and bimonthly 2026-09-10', () => {
  const previous = businessPreviousMonthKey(new Date('2026-11-11T10:00:00+02:00'));
  assert.equal(previous, '2026-10');
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({ vat_frequency: 'monthly', operational_period_key: previous }),
    { period_key: '2026-10' },
  );
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({ vat_frequency: 'bi_monthly', operational_period_key: previous }),
    { period_key: '2026-09-10' },
  );
});
