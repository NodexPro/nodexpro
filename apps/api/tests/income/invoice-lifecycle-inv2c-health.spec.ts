/**
 * INV-2C — lifecycle health / anomaly pure tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { composeInvoiceLifecycleHealth } from '../../src/domains/income/invoice-lifecycle-health.pure.js';
import { composeInvoiceLifecycleRibbon } from '../../src/domains/income/invoice-lifecycle-ribbon.pure.js';
import type { InvoiceLifecycleAggregate } from '../../src/domains/income/invoice-lifecycle.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const healthSource = readFileSync(
  join(dir, '../../src/domains/income/invoice-lifecycle-health.pure.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/income/invoice-lifecycle.read-model.service.ts'),
  'utf8',
);
const failedOpsSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-failed-operations.pure.ts'),
  'utf8',
);

function dims(
  overrides: Partial<{
    payment: InvoiceLifecycleAggregate['payment'];
    delivery: InvoiceLifecycleAggregate['delivery'];
    due: InvoiceLifecycleAggregate['due'];
    collection: InvoiceLifecycleAggregate['collection'];
  }> = {},
): Pick<
  InvoiceLifecycleAggregate,
  'income_document_id' | 'payment' | 'delivery' | 'due' | 'collection'
> {
  return {
    income_document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    payment: {
      original_amount: 1000,
      paid_amount: 0,
      remaining_balance: 1000,
      state_key: 'unpaid',
      last_payment_at: null,
      financial_source: 'accounting_base',
      ...overrides.payment,
    },
    delivery: {
      state_key: 'not_sent',
      attempt_count: 0,
      last_attempt_at: null,
      last_success_at: null,
      last_failure_at: null,
      channels: {
        email: { attempt_count: 0, last_attempt_at: null, last_success_at: null, last_failure_at: null },
        docflow: { attempt_count: 0, last_attempt_at: null, last_success_at: null, last_failure_at: null },
      },
      ...overrides.delivery,
    },
    due: {
      state_key: 'not_due',
      overdue: false,
      overdue_since: null,
      days_overdue: null,
      ...overrides.due,
    },
    collection: {
      active: false,
      work_item_id: null,
      work_state: null,
      next_actions: [],
      ...overrides.collection,
    },
  };
}

test('INV-2C A: unpaid + not overdue + no collection → health ok', () => {
  const health = composeInvoiceLifecycleHealth(dims());
  assert.equal(health.state_key, 'ok');
  assert.equal(health.warning_count, 0);
});

test('INV-2C B: overdue + active collection → health ok', () => {
  const health = composeInvoiceLifecycleHealth(
    dims({
      due: { state_key: 'overdue', overdue: true, overdue_since: '2026-07-01', days_overdue: 10 },
      collection: {
        active: true,
        work_item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        work_state: 'waiting_client',
        next_actions: [],
      },
    }),
  );
  assert.equal(health.state_key, 'ok');
  assert.equal(health.warnings.length, 0);
});

test('INV-2C C: paid + inactive collection → health ok', () => {
  const health = composeInvoiceLifecycleHealth(
    dims({
      payment: {
        original_amount: 1000,
        paid_amount: 1000,
        remaining_balance: 0,
        state_key: 'paid',
        last_payment_at: '2026-08-01',
        financial_source: 'accounting_base',
      },
    }),
  );
  assert.equal(health.state_key, 'ok');
});

test('INV-2C D: paid + active collection → collection_stale_after_paid / attention_required', () => {
  const health = composeInvoiceLifecycleHealth(
    dims({
      payment: {
        original_amount: 1000,
        paid_amount: 1000,
        remaining_balance: 0,
        state_key: 'paid',
        last_payment_at: '2026-08-01',
        financial_source: 'accounting_base',
      },
      collection: {
        active: true,
        work_item_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        work_state: 'waiting_client',
        next_actions: [],
      },
    }),
  );
  assert.equal(health.state_key, 'attention_required');
  assert.equal(health.warnings[0]?.code, 'collection_stale_after_paid');
  assert.equal(health.warnings[0]?.repair_owner, 'work_engine');
  assert.equal(health.warnings[0]?.action_required, true);
  assert.equal(health.warnings[0]?.repair_action, null);
});

test('INV-2C E: sent + later failure → info warning; delivery state unchanged by health', () => {
  const delivery = {
    state_key: 'sent' as const,
    attempt_count: 2,
    last_attempt_at: '2026-07-03T00:00:00.000Z',
    last_success_at: '2026-07-01T00:00:00.000Z',
    last_failure_at: '2026-07-03T00:00:00.000Z',
    channels: {
      email: {
        attempt_count: 2,
        last_attempt_at: '2026-07-03T00:00:00.000Z',
        last_success_at: '2026-07-01T00:00:00.000Z',
        last_failure_at: '2026-07-03T00:00:00.000Z',
      },
      docflow: { attempt_count: 0, last_attempt_at: null, last_success_at: null, last_failure_at: null },
    },
  };
  const health = composeInvoiceLifecycleHealth(dims({ delivery }));
  assert.equal(health.state_key, 'warning');
  assert.equal(health.warnings[0]?.code, 'delivery_later_attempt_failed');
  assert.equal(health.warnings[0]?.severity, 'info');
  assert.equal(delivery.state_key, 'sent');
});

test('INV-2C F: only failed delivery → not an anomaly', () => {
  const health = composeInvoiceLifecycleHealth(
    dims({
      delivery: {
        state_key: 'failed',
        attempt_count: 1,
        last_attempt_at: '2026-07-03T00:00:00.000Z',
        last_success_at: null,
        last_failure_at: '2026-07-03T00:00:00.000Z',
        channels: {
          email: {
            attempt_count: 1,
            last_attempt_at: '2026-07-03T00:00:00.000Z',
            last_success_at: null,
            last_failure_at: '2026-07-03T00:00:00.000Z',
          },
          docflow: { attempt_count: 0, last_attempt_at: null, last_success_at: null, last_failure_at: null },
        },
      },
    }),
  );
  assert.equal(health.state_key, 'ok');
  assert.equal(health.warnings.length, 0);
});

test('INV-2C G: overdue + no collection → NOT anomaly (INV-4 deferred)', () => {
  const health = composeInvoiceLifecycleHealth(
    dims({
      due: { state_key: 'overdue', overdue: true, overdue_since: '2026-07-01', days_overdue: 5 },
      collection: { active: false, work_item_id: null, work_state: null, next_actions: [] },
    }),
  );
  assert.equal(health.state_key, 'ok');
  assert.equal(
    health.warnings.some((w) => w.code === ('overdue_without_collection_item' as never)),
    false,
  );
  assert.match(healthSource, /NOT implemented \(INV-4/);
  assert.doesNotMatch(healthSource, /code: 'overdue_without_collection_item'/);
});

test('INV-2C H/I: health does not mutate dimensions or ribbon mapping rules', () => {
  const input = dims({
    payment: {
      original_amount: 100,
      paid_amount: 100,
      remaining_balance: 0,
      state_key: 'paid',
      last_payment_at: '2026-08-01',
      financial_source: 'accounting_base',
    },
    collection: {
      active: true,
      work_item_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      work_state: 'waiting_client',
      next_actions: [],
    },
  });
  const beforePayment = input.payment.state_key;
  const beforeActive = input.collection.active;
  composeInvoiceLifecycleHealth(input);
  assert.equal(input.payment.state_key, beforePayment);
  assert.equal(input.collection.active, beforeActive);

  const ribbon = composeInvoiceLifecycleRibbon({
    document: {
      document_type: 'tax_invoice',
      document_number: '1',
      document_state_key: 'issued',
      issue_date: '2026-07-01',
      due_date: '2026-08-20',
      source_draft_id: null,
    },
    delivery: input.delivery,
    payment: input.payment,
    due: input.due,
    finalization: { state_key: 'open' },
  });
  assert.ok(ribbon.some((r) => r.key === 'payment' && r.completed));
  assert.doesNotMatch(healthSource, /composeInvoiceLifecycleRibbon/);
});

test('INV-2C J: wired into aggregate; no Failed Ops storage; no new tables', () => {
  assert.match(serviceSource, /composeInvoiceLifecycleHealth/);
  assert.match(serviceSource, /health: composeInvoiceLifecycleHealth/);
  assert.doesNotMatch(healthSource, /supabaseAdmin|from\(/);
  assert.doesNotMatch(failedOpsSource, /collection_stale_after_paid/);
  assert.doesNotMatch(failedOpsSource, /invoice_lifecycle/);
});
