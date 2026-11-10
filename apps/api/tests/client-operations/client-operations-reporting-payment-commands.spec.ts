/**
 * Client Operations filing/payment commands — distinct named commands, no financial overload of filing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const commandSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const dashboardSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-reporting-dashboard.pure.ts'),
  'utf8',
);
const bridgeSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-obligations-work-engine-bridge.ts'),
  'utf8',
);

test('payment confirmation is a distinct command and does not overload mark_obligation_reported', () => {
  assert.match(commandSource, /confirm_client_operations_obligation_filed_with_payment/);
  assert.match(commandSource, /confirm_client_operations_obligation_tax_payment/);
  assert.match(commandSource, /attestTaxObligationPaymentFact/);
  assert.match(commandSource, /cannot update payment on an unfiled obligation/);
  assert.doesNotMatch(
    commandSource.slice(commandSource.indexOf('confirm_client_operations_obligation_filed_with_payment')),
    /mark_obligation_reported_and_paid/,
  );
});

test('payment-only reopen does not refile', () => {
  assert.match(commandSource, /cannot update payment on an unfiled obligation/);
  assert.match(
    commandSource,
    /command === 'confirm_client_operations_obligation_filed_with_payment' && !alreadySubmitted/,
  );
});

test('Work Engine intake events are emitted for filing and payment without writing work_items', () => {
  assert.match(bridgeSource, /emitObligationFiledWorkEvent/);
  assert.match(bridgeSource, /emitObligationPaymentWorkEvent/);
  assert.match(bridgeSource, /intakeWorkEvent/);
  assert.doesNotMatch(bridgeSource, /from\('work_items'\)/);
});

test('payment due dates stay unknown when Country Pack has no payment_due', () => {
  assert.match(dashboardSource, /TEMPORARY_COUNTRY_PACK_PENDING/);
  assert.match(dashboardSource, /payment_overdue: false/);
});
