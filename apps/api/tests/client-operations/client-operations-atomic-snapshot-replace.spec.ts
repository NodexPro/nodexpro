/**
 * CO-175 — atomic current/open period snapshot replacement contracts.
 * Migration 175 is unapplied; live RPC integration tests require applied DB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeOperationalPeriodApplicability,
  isCurrentOpenOperationalPeriodKey,
  resolveDefaultOperationalPeriodKey,
  type OperationalPeriodSnapshotInputs,
} from '../../src/domains/client-operations/client-operations-operational-period.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const mig175 = readFileSync(
  join(dir, '../../../../supabase/migrations/175_client_operations_atomic_snapshot_replace.sql'),
  'utf8',
);
const periodSvc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-operational-period.service.ts'),
  'utf8',
);
const taxSettings = readFileSync(
  join(dir, '../../src/domains/client-operations/client-tax-settings.service.ts'),
  'utf8',
);
const mig171 = readFileSync(
  join(dir, '../../../../supabase/migrations/171_client_operations_operational_period_foundation.sql'),
  'utf8',
);

const baseInputs = (
  overrides: Partial<OperationalPeriodSnapshotInputs> = {},
): OperationalPeriodSnapshotInputs => ({
  vat_type: 'no',
  vat_frequency: 'not_relevant',
  payroll_flag: false,
  income_tax_advance_enabled: false,
  income_tax_advance_frequency: null,
  income_tax_deductions_enabled: true,
  income_tax_deductions_file_number: null,
  income_tax_deductions_frequency: null,
  national_insurance_type: null,
  national_insurance_monthly_amount: null,
  national_insurance_deductions_file_number: null,
  ...overrides,
});

test('175 — function is persistence-only atomic DELETE+INSERT', () => {
  assert.match(mig175, /create or replace function public\.replace_client_operations_period_applicability_snapshot/);
  assert.match(mig175, /delete from public\.client_operations_period_applicability_snapshots/);
  assert.match(mig175, /insert into public\.client_operations_period_applicability_snapshots/);
  assert.doesNotMatch(mig175, /update public\.client_operations_period_applicability_snapshots/);
  assert.doesNotMatch(mig175, /trg_co_period_appl_snap_freeze|disable trigger/i);
  // No applicability business logic in SQL
  assert.doesNotMatch(mig175, /bi_monthly|semi_annual|month\s*%\s*2|isVatBiMonthly/);
});

test('175 — security: DEFINER + search_path + service_role only', () => {
  assert.match(mig175, /security definer/i);
  assert.match(mig175, /set search_path = public/);
  assert.match(mig175, /revoke all on function public\.replace_client_operations_period_applicability_snapshot/);
  assert.match(mig175, /from public/);
  assert.match(mig175, /from anon, authenticated/);
  assert.match(mig175, /grant execute on function public\.replace_client_operations_period_applicability_snapshot[\s\S]*to service_role/);
});

test('175 — tenant validation against clients(id, organization_id)', () => {
  assert.match(mig175, /from public\.clients c/);
  assert.match(mig175, /c\.organization_id = p_organization_id/);
  assert.match(mig175, /CLIENT_OPERATIONS_SNAPSHOT_REPLACE_TENANT_MISMATCH/);
  assert.match(mig175, /for update/);
});

test('175 — concurrency lock + stale tax settings guard (no new versioning schema)', () => {
  assert.match(mig175, /client_tax_settings/);
  assert.match(mig175, /for update/);
  assert.match(mig175, /p_expected_tax_settings_updated_at/);
  assert.match(mig175, /CLIENT_OPERATIONS_SNAPSHOT_REPLACE_STALE_TAX_SETTINGS/);
  assert.match(mig175, /pg_advisory_xact_lock|for update/);
});

test('175 — freeze trigger from 171 remains the immutability mechanism', () => {
  assert.match(mig171, /trg_co_period_appl_snap_freeze/);
  assert.match(mig171, /CLIENT_OPERATIONS_PERIOD_SNAPSHOT_IMMUTABLE/);
  assert.doesNotMatch(mig175, /drop trigger.*trg_co_period_appl_snap_freeze/i);
});

test('backend reconcile uses ONE rpc persistence call; no independent delete/insert', () => {
  assert.match(periodSvc, /replace_client_operations_period_applicability_snapshot/);
  assert.match(periodSvc, /supabaseAdmin\.rpc\(/);
  assert.match(periodSvc, /isCurrentOpenOperationalPeriodKey/);
  assert.match(periodSvc, /CLIENT_OPERATIONS_SNAPSHOT_REPLACE_STALE_TAX_SETTINGS/);
  assert.match(periodSvc, /maxAttempts/);
  // Must not use two-step client delete+insert anymore inside reconcile
  const reconcileStart = periodSvc.indexOf('reconcileCurrentOpenPeriodApplicabilitySnapshotForClient');
  const reconcileEnd = periodSvc.indexOf('export async function upsertPeriodMaterialFact');
  const body = periodSvc.slice(reconcileStart, reconcileEnd);
  assert.doesNotMatch(body, /\.delete\(\)/);
  assert.doesNotMatch(body, /\.insert\(/);
  assert.equal((body.match(/\.rpc\(/g) ?? []).length, 1);
});

test('tax-settings save still awaits reconcile and does not swallow errors', () => {
  assert.match(taxSettings, /await reconcileCurrentOpenPeriodApplicabilitySnapshotForClient/);
  assert.doesNotMatch(taxSettings, /reconcileCurrentOpenPeriodApplicabilitySnapshotForClient\([^)]*\)\.catch/);
});

test('unique grain remains organization_id+client_id+operational_period_key', () => {
  assert.match(mig171, /unique \(organization_id, client_id, operational_period_key\)/);
});

test('successful replacement semantics: false → monthly file# → applicable true (pure)', () => {
  const before = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({ income_tax_deductions_file_number: null, income_tax_deductions_frequency: 'monthly' }),
  );
  assert.equal(before.income_tax_deductions_applicable, false);
  const after = computeOperationalPeriodApplicability(
    '2026-09',
    baseInputs({
      income_tax_deductions_file_number: '935123456',
      income_tax_deductions_frequency: 'monthly',
    }),
  );
  assert.equal(after.income_tax_deductions_applicable, true);
});

test('historical period is not current/open — must not be reconciled', () => {
  const now = new Date('2026-10-15T12:00:00+03:00');
  assert.equal(resolveDefaultOperationalPeriodKey(now), '2026-09');
  assert.equal(isCurrentOpenOperationalPeriodKey('2026-08', now), false);
  assert.equal(isCurrentOpenOperationalPeriodKey('2026-09', now), true);
});

test('atomic failure contract (SQL): INSERT after DELETE in same function = single transaction', () => {
  // Live DB proof requires applied migration 175 (same pattern as accounting_base payment RPC tests).
  // Contract: both statements live in one plpgsql body; RAISE before INSERT rolls back DELETE.
  const deleteIdx = mig175.indexOf('delete from public.client_operations_period_applicability_snapshots');
  const insertIdx = mig175.indexOf('insert into public.client_operations_period_applicability_snapshots');
  assert.ok(deleteIdx > 0 && insertIdx > deleteIdx);
  assert.match(mig175, /language plpgsql/);
});

test('RPC parameters include complete snapshot fields from migration 171 (no id/created_at caller supply)', () => {
  for (const col of [
    'p_vat_type',
    'p_vat_frequency',
    'p_payroll_flag',
    'p_income_tax_advance_enabled',
    'p_income_tax_advance_frequency',
    'p_income_tax_deductions_enabled',
    'p_income_tax_deductions_frequency',
    'p_national_insurance_type',
    'p_national_insurance_monthly_amount',
    'p_national_insurance_deductions_file_number',
    'p_vat_applicable',
    'p_payroll_applicable',
    'p_income_tax_advance_applicable',
    'p_income_tax_deductions_applicable',
    'p_national_insurance_applicable',
    'p_national_insurance_deductions_applicable',
    'p_row_visible',
    'p_client_created_at',
  ]) {
    assert.match(mig175, new RegExp(col));
  }
  assert.doesNotMatch(mig175, /p_id\b/);
  assert.doesNotMatch(mig175, /p_created_at\b/);
  assert.doesNotMatch(mig175, /p_updated_at\b/);
  assert.match(mig175, /captured_at/);
  assert.match(mig175, /now\(\)/);
});
