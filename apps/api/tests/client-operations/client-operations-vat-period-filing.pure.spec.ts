/**
 * VAT period filing: independent tabs, atomic create+file, inactive history, compensation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMissingVatPeriodFileRpc,
  vatFilingCompensationPlan,
  vatHistoricalObligationMustBePreserved,
  vatInactiveUnfiledMayBeFiled,
  vatPeriodFileRpcBusinessError,
  vatReportedStatusForDueDate,
} from '../../src/domains/client-operations/client-operations-filing-command.pure.js';
import { vatSelectedPeriodCanReport } from '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.js';

test('missing obligation and inactive unfiled VAT can report; submitted/paid/N/A cannot', () => {
  assert.equal(
    vatSelectedPeriodCanReport({
      applicable: true,
      submitted: false,
      obligation_id: null,
    }),
    true,
  );
  assert.equal(
    vatSelectedPeriodCanReport({
      applicable: true,
      submitted: false,
      obligation_id: 'ob-inactive',
      status: 'ready_to_report',
    }),
    true,
  );
  assert.equal(
    vatSelectedPeriodCanReport({
      applicable: true,
      submitted: true,
      obligation_id: 'ob-filed',
      status: 'reported',
    }),
    false,
  );
  assert.equal(
    vatSelectedPeriodCanReport({
      applicable: true,
      submitted: false,
      obligation_id: 'ob-na',
      status: 'not_relevant',
    }),
    false,
  );
  assert.equal(
    vatInactiveUnfiledMayBeFiled({ is_active: false, status: 'missing_data', submitted: false }),
    true,
  );
  assert.equal(
    vatInactiveUnfiledMayBeFiled({ is_active: false, status: 'reported', submitted: true }),
    false,
  );
  assert.equal(vatHistoricalObligationMustBePreserved({ is_active: false, status: 'reported' }), true);
  assert.equal(vatHistoricalObligationMustBePreserved({ is_active: false, status: 'reported_and_paid' }), true);
  assert.equal(vatHistoricalObligationMustBePreserved({ is_active: false, status: 'not_relevant' }), true);
  assert.equal(vatHistoricalObligationMustBePreserved({ is_active: false, status: 'ready_to_report' }), false);
  assert.equal(vatHistoricalObligationMustBePreserved({ is_active: true, status: 'reported' }), false);
});

test('null due date is not late and is not an invented statutory date', () => {
  assert.equal(vatReportedStatusForDueDate(null, '2026-11-15'), 'reported');
  assert.equal(vatReportedStatusForDueDate('', '2026-11-15'), 'reported');
  assert.equal(vatReportedStatusForDueDate('2026-11-16', '2026-11-15'), 'reported');
  assert.equal(vatReportedStatusForDueDate('2026-11-14', '2026-11-15'), 'reported_late');
});

test('transaction failure compensation deletes a created row and reverts an updated historical row', () => {
  assert.deepEqual(
    vatFilingCompensationPlan({
      created: true,
      filed: true,
      obligation_id: 'ob-new',
      previous_status: null,
      previous_is_active: null,
    }),
    { kind: 'delete_created', obligation_id: 'ob-new' },
  );
  assert.deepEqual(
    vatFilingCompensationPlan({
      created: false,
      filed: true,
      obligation_id: 'ob-hist',
      previous_status: 'ready_to_report',
      previous_is_active: false,
      previous_last_reported_at: null,
    }),
    {
      kind: 'revert_status',
      obligation_id: 'ob-hist',
      previous_status: 'ready_to_report',
      previous_is_active: false,
      previous_last_reported_at: null,
    },
  );
  assert.deepEqual(
    vatFilingCompensationPlan({
      created: false,
      filed: false,
      obligation_id: 'ob-already',
      previous_status: 'reported',
      previous_is_active: false,
    }),
    { kind: 'none' },
  );
  assert.deepEqual(
    vatFilingCompensationPlan({
      created: true,
      filed: false,
      obligation_id: 'ob-new',
      previous_status: null,
      previous_is_active: null,
    }),
    { kind: 'none' },
  );
});

test('VAT file RPC missing and business errors map without inventing dates', () => {
  assert.equal(isMissingVatPeriodFileRpc({ code: 'PGRST202', message: 'Could not find the function' }), true);
  assert.equal(isMissingVatPeriodFileRpc({ code: '42883', message: 'function does not exist' }), true);
  assert.equal(isMissingVatPeriodFileRpc({ code: 'P0001', message: 'VAT_FILE_NOT_READY' }), false);
  assert.equal(
    vatPeriodFileRpcBusinessError('VAT_FILE_PAYMENT_ALREADY_CONFIRMED')?.httpMessage,
    'payment already confirmed',
  );
  assert.equal(
    vatPeriodFileRpcBusinessError('VAT_FILE_PERIOD_MISMATCH')?.httpMessage,
    'obligation does not match the selected reporting period',
  );
  assert.equal(vatPeriodFileRpcBusinessError('other') , null);
});
