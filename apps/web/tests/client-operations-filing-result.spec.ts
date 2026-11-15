/**
 * Filing modal clicks: דווח / דווח ושולם without obligation_id stay backend-gated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFilingActionCommandBody,
  filingActionDisabledReasonKey,
  filingModalActionEnabled,
} from '../src/lib/client-operations-filing-result.pure.ts';

const query = { operational_period_key: '2026-08' };

test('דווח click without obligation_id sends mark_reported for the selected VAT period', () => {
  const body = buildFilingActionCommandBody({
    action: 'report',
    clientId: 'client-1',
    columnKey: 'vat',
    obligationId: null,
    canonicalId: 'vat_report::2026-08',
    operationalPeriodKey: '2026-08',
    query,
  });
  assert.equal(body.command, 'mark_client_operations_obligation_reported');
  assert.equal(body.obligation_id, null);
  assert.equal(body.kind, 'vat');
  assert.equal(body.operational_period_key, '2026-08');
  assert.equal(body.canonical_id, 'vat_report::2026-08');
});

test('דווח ושולם click without obligation_id sends filed_with_payment for the selected VAT period', () => {
  const body = buildFilingActionCommandBody({
    action: 'report_and_pay',
    clientId: 'client-1',
    columnKey: 'vat',
    obligationId: null,
    canonicalId: 'vat_report::2026-07-08',
    operationalPeriodKey: '2026-08',
    query,
  });
  assert.equal(body.command, 'confirm_client_operations_obligation_filed_with_payment');
  assert.equal(body.obligation_id, null);
  assert.equal(body.kind, 'vat');
  assert.equal(body.payment_classification, 'paid_in_full');
});

test('frontend does not enable דווח unless the aggregate can_report is true', () => {
  assert.equal(
    filingModalActionEnabled({
      canMutate: true,
      action: 'report',
      can_report: true,
      can_report_and_pay: true,
      can_mark_paid: false,
      hasObligation: false,
    }),
    true,
  );
  assert.equal(
    filingModalActionEnabled({
      canMutate: true,
      action: 'report_and_pay',
      can_report: true,
      can_report_and_pay: true,
      can_mark_paid: false,
      hasObligation: false,
    }),
    true,
  );
  assert.equal(
    filingModalActionEnabled({
      canMutate: true,
      action: 'report',
      can_report: false,
      can_report_and_pay: false,
      can_mark_paid: false,
      hasObligation: false,
    }),
    false,
  );
  assert.equal(
    filingModalActionEnabled({
      canMutate: true,
      action: 'paid',
      can_report: true,
      can_report_and_pay: true,
      can_mark_paid: true,
      hasObligation: false,
    }),
    false,
  );
});

test('after דווח only שולם stays enabled; after דווח ושולם every button is locked', () => {
  assert.equal(
    filingModalActionEnabled({
      canMutate: true,
      action: 'report',
      can_report: false,
      can_report_and_pay: false,
      can_mark_paid: true,
      hasObligation: true,
    }),
    false,
  );
  assert.equal(
    filingModalActionEnabled({
      canMutate: true,
      action: 'report_and_pay',
      can_report: false,
      can_report_and_pay: false,
      can_mark_paid: true,
      hasObligation: true,
    }),
    false,
  );
  assert.equal(
    filingModalActionEnabled({
      canMutate: true,
      action: 'paid',
      can_report: false,
      can_report_and_pay: false,
      can_mark_paid: true,
      hasObligation: true,
    }),
    true,
  );
  assert.equal(
    filingModalActionEnabled({
      canMutate: true,
      action: 'paid',
      can_report: false,
      can_report_and_pay: false,
      can_mark_paid: false,
      hasObligation: true,
    }),
    false,
  );
});

test('דווח without obligation_id is also the income-tax advance command path', () => {
  const body = buildFilingActionCommandBody({
    action: 'report',
    clientId: 'client-2',
    columnKey: 'income_tax_advance',
    obligationId: null,
    canonicalId: 'income_tax_advance::2026-08',
    operationalPeriodKey: '2026-08',
    query,
  });
  assert.equal(body.command, 'mark_client_operations_obligation_reported');
  assert.equal(body.obligation_id, null);
  assert.equal(body.kind, 'income_tax_advance');
  assert.equal(body.canonical_id, 'income_tax_advance::2026-08');
});

test('disabled filing buttons expose aggregate or permission reason keys', () => {
  assert.equal(
    filingActionDisabledReasonKey({
      enabled: true,
      canMutate: true,
      aggregateReasonKey: 'clientOperations.registry.reporting.filing.alreadyFiled',
      noPermissionKey: 'clientOperations.registry.reporting.filing.noPermission',
    }),
    null,
  );
  assert.equal(
    filingActionDisabledReasonKey({
      enabled: false,
      canMutate: false,
      aggregateReasonKey: 'clientOperations.registry.reporting.filing.alreadyFiled',
      noPermissionKey: 'clientOperations.registry.reporting.filing.noPermission',
    }),
    'clientOperations.registry.reporting.filing.noPermission',
  );
  assert.equal(
    filingActionDisabledReasonKey({
      enabled: false,
      canMutate: true,
      aggregateReasonKey: 'clientOperations.registry.reporting.filing.payRequiresFiling',
      noPermissionKey: 'clientOperations.registry.reporting.filing.noPermission',
    }),
    'clientOperations.registry.reporting.filing.payRequiresFiling',
  );
});
