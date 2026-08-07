/**
 * INV-2B — lifecycle ribbon presentation tests (pure; no storage / no UI).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { composeInvoiceLifecycleRibbon } from '../../src/domains/income/invoice-lifecycle-ribbon.pure.js';
import type { InvoiceLifecycleAggregate } from '../../src/domains/income/invoice-lifecycle.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const ribbonSource = readFileSync(
  join(dir, '../../src/domains/income/invoice-lifecycle-ribbon.pure.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/income/invoice-lifecycle.read-model.service.ts'),
  'utf8',
);
const migration122 = readFileSync(
  join(dir, '../../../../supabase/migrations/122_income_documents_inc4.sql'),
  'utf8',
);

function baseDims(
  overrides: Partial<{
    delivery: InvoiceLifecycleAggregate['delivery'];
    payment: InvoiceLifecycleAggregate['payment'];
    due: InvoiceLifecycleAggregate['due'];
    document: InvoiceLifecycleAggregate['document'];
  }> = {},
): Pick<InvoiceLifecycleAggregate, 'document' | 'delivery' | 'payment' | 'due' | 'finalization'> {
  return {
    document: {
      document_type: 'tax_invoice',
      document_number: '100',
      document_state_key: 'issued',
      issue_date: '2026-07-01',
      due_date: '2026-08-20',
      source_draft_id: '11111111-1111-4111-8111-111111111111',
      ...overrides.document,
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
    payment: {
      original_amount: 1000,
      paid_amount: 0,
      remaining_balance: 1000,
      state_key: 'unpaid',
      last_payment_at: null,
      financial_source: 'accounting_base',
      ...overrides.payment,
    },
    due: {
      state_key: 'not_due',
      overdue: false,
      overdue_since: null,
      days_overdue: null,
      ...overrides.due,
    },
    finalization: { state_key: 'open' },
  };
}

function byKey(rows: ReturnType<typeof composeInvoiceLifecycleRibbon>, key: string) {
  return rows.find((r) => r.key === key);
}

test('INV-2B issued + not_sent + unpaid + not_due → current=payment or sent; delivered not_tracked', () => {
  const ribbon = composeInvoiceLifecycleRibbon(baseDims());
  assert.equal(byKey(ribbon, 'draft')?.completed, true);
  assert.equal(byKey(ribbon, 'issued')?.completed, true);
  assert.equal(byKey(ribbon, 'sent')?.state, 'pending');
  assert.equal(byKey(ribbon, 'delivered')?.state, 'not_tracked');
  assert.equal(byKey(ribbon, 'payment')?.label, 'לא שולם');
  assert.equal(byKey(ribbon, 'payment')?.current, true);
  assert.equal(byKey(ribbon, 'overdue'), undefined);
  assert.equal(byKey(ribbon, 'credited')?.state, 'unavailable');
  assert.equal(byKey(ribbon, 'voided')?.state, 'unavailable');
  assert.equal(byKey(ribbon, 'closed')?.state, 'unavailable');
  assert.equal(ribbon.filter((r) => r.current).length, 1);
});

test('INV-2B sent + unpaid + overdue → overdue is current; overdue stage included', () => {
  const ribbon = composeInvoiceLifecycleRibbon(
    baseDims({
      delivery: {
        state_key: 'sent',
        attempt_count: 1,
        last_attempt_at: '2026-07-02T00:00:00.000Z',
        last_success_at: '2026-07-02T00:00:00.000Z',
        last_failure_at: null,
        channels: {
          email: {
            attempt_count: 1,
            last_attempt_at: '2026-07-02T00:00:00.000Z',
            last_success_at: '2026-07-02T00:00:00.000Z',
            last_failure_at: null,
          },
          docflow: { attempt_count: 0, last_attempt_at: null, last_success_at: null, last_failure_at: null },
        },
      },
      due: {
        state_key: 'overdue',
        overdue: true,
        overdue_since: '2026-07-01',
        days_overdue: 37,
      },
    }),
  );
  assert.equal(byKey(ribbon, 'sent')?.completed, true);
  assert.equal(byKey(ribbon, 'overdue')?.current, true);
  assert.equal(byKey(ribbon, 'payment')?.current, false);
  assert.equal(ribbon.filter((r) => r.current).length, 1);
});

test('INV-2B partial payment label + paid completed', () => {
  const partial = composeInvoiceLifecycleRibbon(
    baseDims({
      payment: {
        original_amount: 1000,
        paid_amount: 400,
        remaining_balance: 600,
        state_key: 'partial',
        last_payment_at: '2026-07-15',
        financial_source: 'accounting_base',
      },
      delivery: {
        state_key: 'sent',
        attempt_count: 1,
        last_attempt_at: '2026-07-02T00:00:00.000Z',
        last_success_at: '2026-07-02T00:00:00.000Z',
        last_failure_at: null,
        channels: {
          email: {
            attempt_count: 1,
            last_attempt_at: '2026-07-02T00:00:00.000Z',
            last_success_at: '2026-07-02T00:00:00.000Z',
            last_failure_at: null,
          },
          docflow: { attempt_count: 0, last_attempt_at: null, last_success_at: null, last_failure_at: null },
        },
      },
    }),
  );
  assert.equal(byKey(partial, 'payment')?.label, 'שולם חלקית');
  assert.equal(byKey(partial, 'payment')?.current, true);

  const paid = composeInvoiceLifecycleRibbon(
    baseDims({
      payment: {
        original_amount: 1000,
        paid_amount: 1000,
        remaining_balance: 0,
        state_key: 'paid',
        last_payment_at: '2026-07-20',
        financial_source: 'accounting_base',
      },
      delivery: {
        state_key: 'sent',
        attempt_count: 1,
        last_attempt_at: '2026-07-02T00:00:00.000Z',
        last_success_at: '2026-07-02T00:00:00.000Z',
        last_failure_at: null,
        channels: {
          email: {
            attempt_count: 1,
            last_attempt_at: '2026-07-02T00:00:00.000Z',
            last_success_at: '2026-07-02T00:00:00.000Z',
            last_failure_at: null,
          },
          docflow: { attempt_count: 0, last_attempt_at: null, last_success_at: null, last_failure_at: null },
        },
      },
    }),
  );
  assert.equal(byKey(paid, 'payment')?.completed, true);
  assert.equal(byKey(paid, 'payment')?.label, 'שולם');
  assert.equal(byKey(paid, 'payment')?.current, false);
});

test('INV-2B send failed → sent state=failed and current', () => {
  const ribbon = composeInvoiceLifecycleRibbon(
    baseDims({
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
  assert.equal(byKey(ribbon, 'sent')?.state, 'failed');
  assert.equal(byKey(ribbon, 'sent')?.current, true);
});

test('INV-2B ribbon is presentation-only; wired into aggregate; no new columns', () => {
  assert.match(ribbonSource, /Presentation-only|presentation-only/i);
  assert.match(serviceSource, /lifecycle_ribbon: composeInvoiceLifecycleRibbon/);
  assert.doesNotMatch(migration122, /\blifecycle_ribbon\b/);
  assert.doesNotMatch(migration122, /\bpayment_status\b/);
  assert.doesNotMatch(ribbonSource, /supabaseAdmin|from\('income_documents'\)/);
});
