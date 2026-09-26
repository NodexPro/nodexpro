/**
 * CO-176 — historical מ״ה ניכויים applicability repair contracts.
 * Migration file is created but NOT applied in this pass.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot } from '../../src/domains/client-operations/client-operations-operational-period.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const mig176 = readFileSync(
  join(
    dir,
    '../../../../supabase/migrations/176_client_operations_repair_income_tax_deductions_applicability.sql',
  ),
  'utf8',
);
const registryService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const pureSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-operational-period.pure.ts'),
  'utf8',
);

test('1 — enabled + monthly → true', () => {
  assert.equal(
    resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot({
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'monthly',
      operational_period_key: '2026-09',
    }),
    true,
  );
});

test('2 — enabled + bi_monthly + 2026-08 → true', () => {
  assert.equal(
    resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot({
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'bi_monthly',
      operational_period_key: '2026-08',
    }),
    true,
  );
});

test('3 — enabled + bi_monthly + 2026-09 → false', () => {
  assert.equal(
    resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot({
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'bi_monthly',
      operational_period_key: '2026-09',
    }),
    false,
  );
});

test('4 — enabled + semi_annual + January → true', () => {
  assert.equal(
    resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot({
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'semi_annual',
      operational_period_key: '2026-01',
    }),
    true,
  );
});

test('5 — enabled + semi_annual + June → true', () => {
  assert.equal(
    resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot({
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'semi_annual',
      operational_period_key: '2026-06',
    }),
    true,
  );
});

test('6 — enabled + semi_annual + February → false', () => {
  assert.equal(
    resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot({
      income_tax_deductions_enabled: true,
      income_tax_deductions_frequency: 'semi_annual',
      operational_period_key: '2026-02',
    }),
    false,
  );
});

test('7 — enabled=false → false', () => {
  assert.equal(
    resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot({
      income_tax_deductions_enabled: false,
      income_tax_deductions_frequency: 'bi_monthly',
      operational_period_key: '2026-08',
    }),
    false,
  );
  assert.equal(
    resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot({
      income_tax_deductions_enabled: null,
      income_tax_deductions_frequency: 'monthly',
      operational_period_key: '2026-08',
    }),
    false,
  );
});

test('8 — repair does NOT read live client_tax_settings', () => {
  // Comment may name the forbidden table; executable SQL must not touch it.
  assert.doesNotMatch(mig176, /from\s+.*client_tax_settings/i);
  assert.doesNotMatch(mig176, /join\s+.*client_tax_settings/i);
  assert.doesNotMatch(mig176, /update\s+.*client_tax_settings/i);
  assert.match(mig176, /Does NOT read client_tax_settings/);
  assert.match(mig176, /income_tax_deductions_enabled/);
  assert.match(mig176, /income_tax_deductions_frequency/);
  assert.match(mig176, /operational_period_key/);
});

test('9 — ONLY income_tax_deductions_applicable changes', () => {
  assert.match(mig176, /set income_tax_deductions_applicable\s*=/i);
  assert.doesNotMatch(mig176, /set\s+vat_applicable/i);
  assert.doesNotMatch(mig176, /set\s+payroll_applicable/i);
  assert.doesNotMatch(mig176, /set\s+row_visible/i);
  assert.doesNotMatch(mig176, /set\s+income_tax_deductions_enabled\s*=/i);
  assert.doesNotMatch(mig176, /set\s+income_tax_deductions_frequency\s*=/i);
  // Comment may name the progress table; executable SQL must not touch it.
  assert.doesNotMatch(mig176, /from\s+.*client_income_tax_deductions_period/i);
  assert.doesNotMatch(mig176, /update\s+.*client_income_tax_deductions_period/i);
  assert.match(mig176, /Does NOT touch completion\/progress tables/);
});

test('10 — other frozen snapshot fields remain unchanged (freeze restored)', () => {
  // Temporary allow only ITD applicable, then restore full freeze including that column.
  assert.match(mig176, /CO-176 temporary|CO-176 one-shot/i);
  assert.match(mig176, /Restore full freeze protection/);
  assert.equal(
    (mig176.match(/CLIENT_OPERATIONS_PERIOD_SNAPSHOT_IMMUTABLE/g) || []).length >= 2,
    true,
  );
  // Final freeze again rejects income_tax_deductions_applicable rewrites.
  const restoreIdx = mig176.lastIndexOf('Restore full freeze');
  const restored = mig176.slice(restoreIdx);
  assert.match(restored, /NEW\.income_tax_deductions_applicable is distinct from OLD\.income_tax_deductions_applicable/);
});

test('11 — historical runtime still reads frozen snapshot (no live recompute)', () => {
  assert.match(
    registryService,
    /incomeTaxDeductionsDue = isCurrentOpenPeriod[\s\S]*\? resolveIncomeTaxDeductionsApplicability[\s\S]*: Boolean\(snapshot\?\.income_tax_deductions_applicable\)/,
  );
  assert.doesNotMatch(
    registryService,
    /resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot/,
  );
});

test('12 — current/open runtime still uses live file+frequency formula', () => {
  assert.match(registryService, /resolveIncomeTaxDeductionsApplicability/);
  assert.match(registryService, /income_tax_deductions_file_number/);
  assert.match(
    pureSource,
    /NOT used by registry runtime[\s\S]*resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot|resolveIncomeTaxDeductionsApplicableFromFrozenSnapshot[\s\S]*NOT used by registry runtime/,
  );
});

test('migration 176 SQL cadence matches even-month bi_monthly / Jan+Jun semi_annual', () => {
  assert.match(mig176, /bi_monthly[\s\S]*?%\s*2\)\s*=\s*0/);
  assert.match(mig176, /semi_annual[\s\S]*?'01',\s*'06'/);
  assert.match(mig176, /176_client_operations_repair_income_tax_deductions_applicability|CO-176/);
});
