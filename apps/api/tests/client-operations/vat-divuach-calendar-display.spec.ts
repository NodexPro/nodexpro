/**
 * Tax-tab VAT due display must use Reporting Calendar, not invented 19/23.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vatDivuachFieldsFromAuthoritativeDue } from '../../src/domains/client-operations/vat-divuach.js';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/client-operations');

test('tax-tab VAT fields use calendar 2026-11-16 / 2026-11-23, never invented 19/23', () => {
  const regular = vatDivuachFieldsFromAuthoritativeDue({
    vat_due_type: 'regular',
    vat_frequency: 'monthly',
    filing_due_date: '2026-11-16',
  });
  assert.equal(regular.vat_divuach_next_due_at, '2026-11-16');
  assert.equal(regular.vat_divuach_next_due_display_he, '16.11.2026');
  assert.equal(regular.vat_due_registry_display_he, '16.11.2026');

  const pcn = vatDivuachFieldsFromAuthoritativeDue({
    vat_due_type: 'pcn',
    vat_frequency: 'bi_monthly',
    filing_due_date: '2026-11-23',
  });
  assert.equal(pcn.vat_divuach_next_due_at, '2026-11-23');
  assert.equal(pcn.vat_divuach_next_due_display_he, '23.11.2026');
  assert.equal(pcn.vat_due_registry_display_he, 'PCN');

  const unknown = vatDivuachFieldsFromAuthoritativeDue({
    vat_due_type: 'regular',
    vat_frequency: 'monthly',
    filing_due_date: null,
  });
  assert.equal(unknown.vat_divuach_next_due_at, null);
  assert.equal(unknown.vat_divuach_next_due_display_he, null);
  assert.equal(unknown.vat_due_registry_display_he, null);
});

test('tax settings and registry recompute do not call computeNextVatDivuachDueDate', () => {
  const taxSettings = readFileSync(join(srcDir, 'client-tax-settings.service.ts'), 'utf8');
  const registry = readFileSync(join(srcDir, 'client-operations.service.ts'), 'utf8');
  const dashboard = readFileSync(join(srcDir, 'client-operations-reporting-dashboard.service.ts'), 'utf8');
  assert.match(taxSettings, /vatDivuachFieldsFromAuthoritativeDue/);
  assert.match(taxSettings, /resolveReportingDueDatesBatch/);
  assert.doesNotMatch(taxSettings, /computeNextVatDivuachDueDate/);
  assert.doesNotMatch(registry, /computeNextVatDivuachDueDate/);
  assert.doesNotMatch(dashboard, /computeNextVatDivuachDueDate/);
});

function sliceRecomputeForOrg(source: string): string {
  const start = source.indexOf('async function recomputeClientObligationsAndTasksForOrg');
  assert.notEqual(start, -1, 'missing recomputeClientObligationsAndTasksForOrg');
  const next = source.indexOf('\nfunction taskTypeByState', start + 1);
  assert.notEqual(next, -1, 'missing taskTypeByState after recompute');
  return source.slice(start, next);
}

test('recompute upserts current VAT by unique period key and preserves historical identities', () => {
  const source = readFileSync(join(srcDir, 'client-obligations-tasks-core.service.ts'), 'utf8');
  const recompute = sliceRecomputeForOrg(source);
  assert.match(source, /vatFilingPeriodIdentityForOperationalPeriod/);
  assert.match(source, /resolveVatCalendarLookupPeriodKey/);
  assert.match(source, /resolveOfficialFilingDueDateIso/);
  assert.match(source, /operationalPeriodKey = businessPreviousMonthKey\(now\)/);
  assert.match(source, /operational_period_key: operationalPeriodKey/);
  assert.match(recompute, /onConflict: 'organization_id,client_id,obligation_type,period_key'/);
  assert.match(recompute, /HISTORICAL_OBLIGATION_PRESERVATION/);
  assert.doesNotMatch(recompute, /is_active:\s*false/);
  assert.doesNotMatch(recompute, /\.update\(\s*\{\s*is_active:\s*false/);
  assert.match(recompute, /status === 'missing_data' && existingStatus !== 'missing_data'/);
  assert.match(source, /export async function recomputeClientObligationsAndTasks/);
  assert.match(source, /recompute_obligations/);
});
