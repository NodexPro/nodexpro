import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  filingEvidenceFolderSystemKey,
  incomeTaxDeductionsEvidenceCanonicalId,
  isFilingEvidenceObligationKind,
  niDeductionsEvidenceCanonicalId,
} from '../../src/domains/client-operations/client-operations-filing-evidence.pure.js';
import { CLIENT_OPERATIONS_REGISTRY_COLUMNS } from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';
import { selfEmployedNiOfficeReminderActive } from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('ITD evidence reuses the NI deductions folder and keeps a distinct canonical id', () => {
  assert.equal(isFilingEvidenceObligationKind('income_tax_deductions'), true);
  assert.equal(filingEvidenceFolderSystemKey('income_tax_deductions'), 'ni_deductions_filings');
  assert.equal(filingEvidenceFolderSystemKey('national_insurance_deductions'), 'ni_deductions_filings');
  assert.equal(incomeTaxDeductionsEvidenceCanonicalId('2026-10'), 'income_tax_deductions::2026-10');
  assert.notEqual(incomeTaxDeductionsEvidenceCanonicalId('2026-10'), niDeductionsEvidenceCanonicalId('2026-10'));
  const evidenceSrc = read('../../src/domains/client-operations/client-operations-filing-evidence.service.ts');
  assert.match(evidenceSrc, /filingTarget === 'income_tax_deductions'/);
  assert.match(evidenceSrc, /proves_filing: false/);
  assert.match(evidenceSrc, /proves_payment: false/);
  assert.doesNotMatch(evidenceSrc, /status:\s*'paid'/);
});

test('payroll column default width is halved from the previous 110px fallback', () => {
  const payroll = CLIENT_OPERATIONS_REGISTRY_COLUMNS.find((col) => col.key === 'payroll');
  assert.equal(payroll?.default_width_px, 56);
});

test('self-employed NI office reminder is internal after the 15th when method is unresolved', () => {
  assert.equal(
    selfEmployedNiOfficeReminderActive({
      applicable: true,
      periodKey: '2026-10',
      today: '2026-10-16',
      obligationStatus: 'not_paid',
      monthSettings: [],
    }),
    true,
  );
  assert.equal(
    selfEmployedNiOfficeReminderActive({
      applicable: true,
      periodKey: '2026-10',
      today: '2026-10-16',
      obligationStatus: 'not_paid',
      monthSettings: [{ period_key: '2026-10', handling_method: 'standing_order' }],
    }),
    false,
  );
});

test('tax summary hides יעד דיווח מע״מ and רישום יעד מע״מ without deleting stored data', () => {
  const taxSrc = read('../../src/domains/client-operations/client-tax-tab-read-model.service.ts');
  assert.match(taxSrc, /row_key: 'vat_divuach_next'[\s\S]*visible: false/);
  assert.match(taxSrc, /row_key: 'vat_registry'[\s\S]*visible: false/);
  assert.match(taxSrc, /vat_due_type/);
  const webTaxes = readFileSync(
    join(dir, '../../../../apps/web/src/components/ClientTaxesTab.tsx'),
    'utf8',
  );
  assert.match(webTaxes, /row\.visible !== false/);
});

test('capital case GET skips duplicate client checks and profile seeding', () => {
  const caseSrc = read('../../src/domains/client-operations/client-operations.service.ts');
  const annualSrc = read('../../src/domains/client-operations/client-annual-report-tab.service.ts');
  assert.match(caseSrc, /skipClientCheck: true/);
  assert.match(annualSrc, /skipClientCheck/);
  assert.match(annualSrc, /if \(!options\?\.readOnly\) \{/);
  assert.match(annualSrc, /working_tax_year/);
});
