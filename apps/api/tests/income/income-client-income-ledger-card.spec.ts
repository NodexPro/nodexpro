import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLedgerEndCustomerOptions,
  computeLedgerMovementRows,
  formatLedgerCreditDisplay,
  sumLedgerDebitCredit,
} from '../../src/domains/income/income-client-income-ledger-card.pure.js';

describe('income client ledger card pure', () => {
  it('computes running balance for invoice then payment', () => {
    const rows = computeLedgerMovementRows({
      currency: 'ILS',
      movements: [
        {
          row_id: '1:invoice',
          movement_type: 'invoice',
          income_label: 'חשבונית מס',
          debit_reference: 2596,
          credit_reference: null,
          document_number: '2026-0045',
          issue_date: '2026-06-06',
          created_at: '2026-06-06T10:00:00Z',
          document_id: 'doc-1',
          can_view_document: true,
        },
        {
          row_id: '1:payment',
          movement_type: 'payment',
          income_label: 'תשלום',
          debit_reference: null,
          credit_reference: 1000,
          document_number: '2026-0045',
          issue_date: '2026-06-10',
          created_at: '2026-06-10T12:00:00Z',
          document_id: 'doc-1',
          can_view_document: true,
        },
      ],
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.balance_display, '₪2,596.00');
    assert.equal(rows[1]?.balance_display, '₪1,596.00');
    assert.equal(rows[1]?.credit_amount_display, formatLedgerCreditDisplay(1000, 'ILS'));
  });

  it('sums open balance across movements', () => {
    const movements = [
      {
        row_id: '1:invoice',
        movement_type: 'invoice' as const,
        income_label: 'חשבונית מס',
        debit_reference: 2000,
        credit_reference: null,
        document_number: '1',
        issue_date: '2026-01-01',
        created_at: '2026-01-01',
        document_id: 'a',
        can_view_document: false,
      },
      {
        row_id: '2:payment',
        movement_type: 'payment' as const,
        income_label: 'תשלום',
        debit_reference: null,
        credit_reference: 500,
        document_number: '2',
        issue_date: '2026-01-02',
        created_at: '2026-01-02',
        document_id: 'b',
        can_view_document: false,
      },
    ];
    const totals = sumLedgerDebitCredit(movements);
    assert.equal(totals.open_balance_reference, 1500);
  });

  it('includes all income customers even with zero balance', () => {
    const options = buildLedgerEndCustomerOptions({
      customers: [
        {
          id: 'cust-1',
          display_name: 'Alpha',
          tax_id: null,
          email: null,
        },
        {
          id: 'cust-2',
          display_name: 'Beta',
          tax_id: '123',
          email: 'a@b.c',
        },
      ],
      statsByCustomerId: new Map(),
    });

    assert.equal(options.length, 2);
    assert.equal(options[0]?.end_customer_id, 'cust-1');
    assert.equal(options[0]?.open_balance_display, '₪0.00');
    assert.equal(options[1]?.open_balance_display, '₪0.00');
  });
});
