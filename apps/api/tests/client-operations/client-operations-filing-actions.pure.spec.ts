import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReportingCellPresentation,
  buildSelfEmployedNiOperations,
  nextSelfEmployedNiStandingOrderUntil,
  reportingKindAffectsFilingKpi,
  selfEmployedNiOfficeReminderActive,
  type ClientOperationsReportingCellInput,
} from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';

const TODAY = '2026-11-15';

function cell(
  overrides: Partial<ClientOperationsReportingCellInput> & Pick<ClientOperationsReportingCellInput, 'kind'>,
): ClientOperationsReportingCellInput {
  return {
    applicable: true,
    submitted: false,
    not_applicable_terminal: false,
    due_date: '2026-11-20',
    canonical_id: `${overrides.kind}::2026-11`,
    obligation_id: 'ob-1',
    can_mark_submitted: true,
    can_mark_not_submitted: false,
    last_reported_at: null,
    operational_period_key: '2026-11',
    ...overrides,
  };
}

test('שולם stays disabled until an authoritative filing exists', () => {
  const pending = buildReportingCellPresentation(cell({ kind: 'vat' }), TODAY);
  assert.equal(pending.filing_detail?.chrome, 'pending');
  assert.equal(pending.filing_detail?.can_report, true);
  assert.equal(pending.filing_detail?.can_report_and_pay, true);
  assert.equal(pending.filing_detail?.can_mark_paid, false);
  const overdue = buildReportingCellPresentation(
    cell({ kind: 'income_tax_advance', due_date: '2026-11-01' }),
    TODAY,
  );
  assert.equal(overdue.filing_detail?.chrome, 'action_required');
  assert.equal(overdue.filing_detail?.can_mark_paid, false);
  const filedUnpaid = buildReportingCellPresentation(
    cell({ kind: 'vat', submitted: true, can_mark_submitted: false, payment_classification: null }),
    TODAY,
  );
  assert.equal(filedUnpaid.filing_detail?.chrome, 'filed_unpaid');
  assert.equal(filedUnpaid.filing_detail?.can_report, false);
  assert.equal(filedUnpaid.filing_detail?.can_report_and_pay, false);
  assert.equal(filedUnpaid.filing_detail?.can_mark_paid, true);
  const filedPaid = buildReportingCellPresentation(
    cell({
      kind: 'vat',
      submitted: true,
      can_mark_submitted: false,
      payment_classification: 'paid_in_full',
    }),
    TODAY,
  );
  assert.equal(filedPaid.filing_detail?.chrome, 'filed_paid');
  assert.equal(filedPaid.filing_detail?.can_report, false);
  assert.equal(filedPaid.filing_detail?.can_mark_paid, false);
  assert.equal(reportingKindAffectsFilingKpi('national_insurance'), false);
});

test('self-employed NI standing order covers the selected year and the 15th reminder', () => {
  assert.equal(
    nextSelfEmployedNiStandingOrderUntil({ active: true, periodKey: '2026-04', existingUntil: null }),
    '2026-12-31',
  );
  assert.equal(
    nextSelfEmployedNiStandingOrderUntil({
      active: false,
      periodKey: '2026-06',
      existingUntil: '2026-12-31',
    }),
    null,
  );
  assert.equal(
    nextSelfEmployedNiStandingOrderUntil({
      active: true,
      periodKey: '2027-01',
      existingUntil: '2026-12-31',
    }),
    '2027-12-31',
  );
  const before = buildSelfEmployedNiOperations({
    applicable: true,
    standingOrderUntil: null,
    periodKey: '2026-11',
    today: '2026-11-14',
    obligationStatus: 'not_paid',
  });
  assert.equal(before.office_reminder, false);
  assert.equal(before.standing_order_active, false);
  const after = selfEmployedNiOfficeReminderActive({
    applicable: true,
    standingOrderUntil: null,
    periodKey: '2026-11',
    today: '2026-11-15',
    obligationStatus: 'not_paid',
  });
  assert.equal(after, true);
  const covered = buildSelfEmployedNiOperations({
    applicable: true,
    standingOrderUntil: '2026-12-31',
    periodKey: '2026-11',
    today: '2026-11-20',
    obligationStatus: 'not_paid',
  });
  assert.equal(covered.standing_order_active, true);
  assert.equal(covered.office_reminder, false);
});

test('payment-only confirmation is rejected before filing in the command', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
    'utf8',
  );
  assert.match(source, /cannot update payment on an unfiled obligation/);
  assert.match(source, /existingClassification !== classificationRaw/);
  assert.match(source, /save_client_operations_self_employed_ni/);
  assert.doesNotMatch(source, /set_ni_standing_order/);
});
