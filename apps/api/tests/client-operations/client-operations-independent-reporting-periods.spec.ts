/**
 * Client Operations — each reporting tab is independent.
 * Missing obligation for an applicable period is created only by a named command
 * with an explicit operational_period_key. GET does not write. Recompute stays
 * wall-clock previous month and does not deactivate historical identities.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { businessPreviousMonthKey } from '../../src/shared/business-time.js';
import {
  historicalObligationIdentitiesToPreserve,
  vatFilingPeriodIdentityForOperationalPeriod,
} from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';
import { SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS } from '../../src/domains/client-operations/client-operations-registry-incremental.pure.js';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/client-operations');
const webView = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx',
);

function sliceExportAsync(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = source.indexOf('\nexport async function ', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test('GET registry and reporting dashboard do not persist VAT obligations', () => {
  const routes = readFileSync(join(srcDir, 'client-operations.routes.ts'), 'utf8');
  const getRegistry = routes.slice(
    routes.indexOf("router.get('/registry'"),
    routes.indexOf("router.post('/registry/commands'"),
  );
  assert.match(getRegistry, /listClientOperationsRegistry/);
  assert.doesNotMatch(getRegistry, /ensureClientOperationsPeriodVatObligation/);
  assert.doesNotMatch(getRegistry, /recomputeClientObligationsAndTasks/);
  const dashboard = readFileSync(join(srcDir, 'client-operations-reporting-dashboard.service.ts'), 'utf8');
  assert.match(dashboard, /from\('client_obligations'\)/);
  assert.doesNotMatch(dashboard, /\.insert\(/);
  assert.doesNotMatch(dashboard, /\.upsert\(/);
  assert.doesNotMatch(dashboard, /ensureClientOperationsPeriodVatObligation/);
});

test('recompute_obligations only materializes wall-clock previous month VAT identity', () => {
  const core = readFileSync(join(srcDir, 'client-obligations-tasks-core.service.ts'), 'utf8');
  const start = core.indexOf('async function buildRelevantObligations');
  const next = core.indexOf('\nasync function loadNiSelfEmployedRelevantObligation', start + 1);
  const relevant = core.slice(start, next);
  assert.match(relevant, /operationalPeriodKey = businessPreviousMonthKey\(now\)/);
  assert.match(relevant, /vatFilingPeriodIdentityForOperationalPeriod/);
  const previous = businessPreviousMonthKey(new Date('2026-11-15T10:00:00+02:00'));
  assert.equal(previous, '2026-10');
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({
      vat_frequency: 'monthly',
      operational_period_key: previous,
    }),
    { period_key: '2026-10' },
  );
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({
      vat_frequency: 'bi_monthly',
      operational_period_key: previous,
    }),
    { period_key: '2026-09-10' },
  );
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({
      vat_frequency: 'monthly',
      operational_period_key: '2026-08',
    }),
    { period_key: '2026-08' },
  );
  assert.deepEqual(
    vatFilingPeriodIdentityForOperationalPeriod({
      vat_frequency: 'bi_monthly',
      operational_period_key: '2026-08',
    }),
    { period_key: '2026-07-08' },
  );
});

test('recompute does not deactivate historical identities when a newer period becomes current', () => {
  const core = readFileSync(join(srcDir, 'client-obligations-tasks-core.service.ts'), 'utf8');
  const start = core.indexOf('async function recomputeClientObligationsAndTasksForOrg');
  const next = core.indexOf('\nexport async function ensureClientOperationsPeriodVatObligation', start + 1);
  const recompute = core.slice(start, next);
  assert.match(recompute, /HISTORICAL_OBLIGATION_PRESERVATION/);
  assert.doesNotMatch(recompute, /is_active:\s*false/);
  assert.deepEqual(
    historicalObligationIdentitiesToPreserve({
      existingKeys: ['vat_report::2026-08', 'vat_report::2026-07-08', 'vat_report::2026-10'],
      currentRelevantKeys: new Set(['vat_report::2026-10']),
    }),
    ['vat_report::2026-08', 'vat_report::2026-07-08'],
  );
});

test('ensure_client_operations_period_vat_obligation is a named command with explicit period', () => {
  const core = readFileSync(join(srcDir, 'client-obligations-tasks-core.service.ts'), 'utf8');
  const ensure = sliceExportAsync(core, 'ensureClientOperationsPeriodVatObligation');
  assert.match(ensure, /operational_period_key: input\.operationalPeriodKey/);
  assert.match(ensure, /vatFilingPeriodIdentityForOperationalPeriod/);
  assert.match(ensure, /resolveOfficialFilingDueDateIso/);
  assert.match(ensure, /PERIOD_VAT_ENSURE_NULL_DUE_ALLOWED/);
  assert.match(ensure, /INACTIVE_OBLIGATION_PRESERVED/);
  assert.doesNotMatch(ensure, /vatDueDateFromPeriod/);
  assert.doesNotMatch(ensure, /businessPreviousMonthKey/);
  assert.doesNotMatch(ensure, /recomputeClientObligationsAndTasks/);
  assert.doesNotMatch(ensure, /is_active:\s*false/);
  assert.doesNotMatch(ensure, /\.update\(\s*\{\s*is_active:\s*true/);
  assert.doesNotMatch(ensure, /if \(!due\) return/);
  assert.match(ensure, /due_date: due/);
  assert.match(ensure, /obligation_type: 'vat_report'/);
  assert.match(ensure, /period_key: identity\.period_key/);
  assert.match(ensure, /CLIENT_OPERATIONS_PERIOD_VAT_OBLIGATION_ENSURED/);

  const registry = readFileSync(join(srcDir, 'client-operations-registry-custom-columns.service.ts'), 'utf8');
  assert.match(registry, /command === 'ensure_client_operations_period_vat_obligation'/);
  assert.match(registry, /requiredOperationalPeriodKeyFrom/);
  assert.match(registry, /ensureClientOperationsPeriodVatObligation/);
  const registryEnsure = registry.slice(
    registry.indexOf("command === 'ensure_client_operations_period_vat_obligation'"),
    registry.indexOf("command === 'archive_client_operations_custom_column'"),
  );
  assert.doesNotMatch(registryEnsure, /executeClientObligationsCommand/);
  assert.equal(SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS.has('ensure_client_operations_period_vat_obligation'), true);
});

test('existing VAT report buttons create-then-file atomically; UI has no prepare-filing', () => {
  const view = readFileSync(webView, 'utf8');
  assert.doesNotMatch(view, /runPreparePeriodVatObligation/);
  assert.doesNotMatch(view, /can_prepare_filing/);
  assert.doesNotMatch(view, /prepare_key/);
  assert.doesNotMatch(view, /client-operations-filing-prepare/);
  assert.doesNotMatch(view, /command: 'ensure_client_operations_period_vat_obligation'/);
  assert.match(view, /disabled=\{!reportEnabled\}/);
  assert.match(view, /disabled=\{!reportAndPayEnabled\}/);
  assert.match(view, /buildFilingActionCommandBody/);
  assert.match(view, /runFilingAction\('report'\)/);
  assert.match(view, /runFilingAction\('report_and_pay'\)/);
  assert.doesNotMatch(view, /can_report\s*=\s*true/);
  assert.doesNotMatch(view, /disabled=\{false\}/);
  assert.doesNotMatch(
    view,
    /const openFilingDetailModal[\s\S]{0,900}ensure_client_operations_period_vat_obligation/,
  );

  const registry = readFileSync(join(srcDir, 'client-operations-registry-custom-columns.service.ts'), 'utf8');
  assert.match(registry, /fileClientOperationsPeriodVatObligation/);
  assert.doesNotMatch(registry, /compensateClientOperationsPeriodVatFiling/);
  const markStart = registry.indexOf("command === 'mark_client_operations_obligation_reported' && vatFilingCreateAllowed");
  assert.notEqual(markStart, -1);
  const markBlock = registry.slice(markStart, registry.indexOf('} else {', markStart));
  assert.match(markBlock, /fileClientOperationsPeriodVatObligation/);
  assert.doesNotMatch(markBlock, /type: 'mark_obligation_reported'/);

  const payStart = registry.indexOf(
    "command === 'confirm_client_operations_obligation_filed_with_payment' && vatFilingCreateAllowed",
  );
  assert.notEqual(payStart, -1);
  const payBlock = registry.slice(payStart, registry.indexOf('} else {', payStart));
  assert.match(payBlock, /fileClientOperationsPeriodVatObligation/);
  assert.match(payBlock, /pay:\s*\{/);
  assert.match(payBlock, /canonicalId/);
  assert.doesNotMatch(payBlock, /attestTaxObligationPaymentFact/);
  assert.doesNotMatch(payBlock, /compensateClientOperationsPeriodVatFiling/);

  const core = readFileSync(join(srcDir, 'client-obligations-tasks-core.service.ts'), 'utf8');
  const fileFn = sliceExportAsync(core, 'fileClientOperationsPeriodVatObligation');
  assert.match(fileFn, /file_client_operations_period_vat_obligation/);
  assert.match(fileFn, /p_pay/);
  assert.match(fileFn, /p_due_date: due/);
  assert.match(fileFn, /PERIOD_VAT_FILE_NULL_DUE_ALLOWED/);
  assert.doesNotMatch(fileFn, /recomputeClientObligationsAndTasks/);
  assert.doesNotMatch(fileFn, /vatDueDateFromPeriod/);
  assert.doesNotMatch(fileFn, /\.insert\(/);
  assert.doesNotMatch(fileFn, /\.update\(/);
});

test('due_date nullable migration is prepared and does not invent statutory dates', () => {
  const migration = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations/213_client_obligations_due_date_nullable.sql'),
    'utf8',
  );
  assert.match(migration, /alter column due_date drop not null/i);
  assert.match(migration, /is_nullable = 'NO'/);
  assert.doesNotMatch(migration, /vatDueDateFromPeriod/);
  assert.doesNotMatch(migration, /due_date\s*=\s*'/);
});

test('VAT file+pay RPC is one database transaction and does not invent due dates', () => {
  const migration = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../supabase/migrations/214_file_client_operations_period_vat_obligation.sql',
    ),
    'utf8',
  );
  assert.match(migration, /create or replace function public\.file_client_operations_period_vat_obligation/i);
  assert.match(migration, /insert into public\.client_obligations/);
  assert.match(migration, /insert into public\.accounting_tax_obligation_payment_facts/);
  assert.match(migration, /p_pay boolean/);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.match(migration, /p_due_date date/);
  assert.doesNotMatch(migration, /vatDueDateFromPeriod/);
  assert.doesNotMatch(migration, /make_date\(/);
  assert.doesNotMatch(migration, /due_date\s*=\s*'20/);
  assert.match(migration, /never invented/i);
});
