import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canManuallyConfirmFiling,
  clientDocumentDeliveryPresentation,
  clientDocumentStorageReadOrder,
  evidenceForCanonical,
  filingEvidenceFolderSystemKey,
  filingMaterialWarning,
  niDeductionsEvidenceCanonicalId,
  paymentAlreadyConfirmedInFull,
  type FilingEvidenceRow,
} from '../../src/domains/client-operations/client-operations-filing-evidence.pure.js';
import { vatFilingPeriodIdentityForOperationalPeriod } from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';

test('manual filing stays available when material is missing and stays closed after filing', () => {
  assert.equal(canManuallyConfirmFiling('missing_data'), true);
  assert.equal(canManuallyConfirmFiling('waiting_for_material'), true);
  assert.equal(canManuallyConfirmFiling('waiting_for_income_data'), true);
  assert.equal(canManuallyConfirmFiling('reported'), false);
  assert.equal(filingMaterialWarning('missing_data'), true);
  assert.equal(filingMaterialWarning('ready_to_report'), false);
});

test('full payment cannot be confirmed twice', () => {
  assert.equal(paymentAlreadyConfirmedInFull('paid_in_full', 'paid_in_full'), true);
  assert.equal(paymentAlreadyConfirmedInFull('outstanding', 'paid_in_full'), false);
  assert.equal(paymentAlreadyConfirmedInFull(null, 'paid_in_full'), false);
});

test('evidence follows the obligation, not the column label, and is not required', () => {
  assert.equal(filingEvidenceFolderSystemKey('vat'), 'vat_filings');
  assert.equal(filingEvidenceFolderSystemKey('income_tax_advance'), 'income_tax_advance_filings');
  assert.equal(filingEvidenceFolderSystemKey('national_insurance_deductions'), 'ni_deductions_filings');
  const rows: FilingEvidenceRow[] = [
    {
      document_id: 'doc-1',
      file_asset_id: 'file-1',
      file_name: 'october.pdf',
      evidence_kind: 'filing',
      obligation_canonical_id: 'vat_report::2026-10',
      reporting_period_key: '2026-10',
      reporting_period_display: '10.26',
      uploaded_at: '2026-11-14T00:00:00.000Z',
    },
  ];
  assert.equal(evidenceForCanonical(rows, 'vat_report::2026-10').length, 1);
  assert.equal(evidenceForCanonical(rows, 'income_tax_advance::2026-10').length, 0);
  assert.equal(evidenceForCanonical([], 'vat_report::2026-10').length, 0);
});

test('payroll NI evidence uses the selected month and stays out of self-employed NI', () => {
  assert.equal(niDeductionsEvidenceCanonicalId('2026-10'), 'national_insurance_deductions::2026-10');
  assert.equal(filingEvidenceFolderSystemKey('national_insurance_deductions'), 'ni_deductions_filings');
  const rows: FilingEvidenceRow[] = [
    {
      document_id: 'doc-ni',
      file_asset_id: 'file-ni',
      file_name: '102.pdf',
      evidence_kind: 'filing',
      obligation_canonical_id: 'national_insurance_deductions::2026-10',
      reporting_period_key: '2026-10',
      reporting_period_display: '10.26',
      uploaded_at: null,
    },
  ];
  assert.equal(evidenceForCanonical(rows, 'national_insurance_deductions::2026-10').length, 1);
  assert.equal(evidenceForCanonical(rows, 'national_insurance::2026-10').length, 0);
});

test('client document reads use the upload bucket before the column default', () => {
  assert.deepEqual(clientDocumentStorageReadOrder('organization-assets'), ['client-files', 'organization-assets']);
  assert.deepEqual(clientDocumentStorageReadOrder(null), ['client-files']);
  assert.deepEqual(clientDocumentStorageReadOrder(''), ['client-files']);
  assert.deepEqual(clientDocumentStorageReadOrder('client-files'), ['client-files']);
});

test('provider acceptance is not confirmed delivery', () => {
  assert.equal(clientDocumentDeliveryPresentation('sent').provider_confirmed, false);
  assert.equal(
    clientDocumentDeliveryPresentation('sent').status_key,
    'clientOperations.documents.deliveryHandedToProvider',
  );
  assert.equal(clientDocumentDeliveryPresentation('failed').provider_confirmed, false);
  assert.equal(clientDocumentDeliveryPresentation(null).status_key, null);
});

test('migration 211 binds bimonthly VAT to the pair and keeps the client tenant', () => {
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations/211_client_filing_evidence.sql'),
    'utf8',
  );
  assert.match(sql, /vat_report::/);
  assert.match(sql, /vat_end_month <> vat_start_month \+ 1/);
  assert.match(sql, /vat_start_month % 2 = 0/);
  assert.match(sql, /filing evidence folder is outside this client/);
  assert.match(sql, /filing evidence file is outside this client/);
  assert.match(sql, /o\.organization_id = new\.organization_id/);
  assert.match(sql, /o\.client_id = new\.client_id/);
  assert.match(sql, /o\.period_key = new\.reporting_period_key/);
  assert.match(sql, /p\.organization_id = new\.organization_id/);
  assert.doesNotMatch(sql, /269_client_filing_evidence/);
});

test('selected tab 10.26 resolves monthly October and bimonthly September–October', () => {
  assert.equal(
    vatFilingPeriodIdentityForOperationalPeriod({
      vat_frequency: 'monthly',
      operational_period_key: '2026-10',
    })?.period_key,
    '2026-10',
  );
  assert.equal(
    vatFilingPeriodIdentityForOperationalPeriod({
      vat_frequency: 'bi_monthly',
      operational_period_key: '2026-10',
    })?.period_key,
    '2026-09-10',
  );
  assert.equal(
    vatFilingPeriodIdentityForOperationalPeriod({
      vat_frequency: 'bi_monthly',
      operational_period_key: '2026-09',
    }),
    null,
  );
});
