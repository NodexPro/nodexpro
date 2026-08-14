import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildLedgerInvoiceGroups,
  flattenLedgerInvoiceGroups,
  sumLedgerRemainingBalance,
} from '../../src/domains/income/income-client-income-ledger-card.pure.js';
import type { IncomeIssuedDocumentViewAction } from '../../src/domains/income/income.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const modalSource = readFileSync(
  join(dir, '../../../web/src/components/income/IncomeClientIncomeLedgerCardModal.tsx'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-income-ledger-card.service.ts'),
  'utf8',
);

function viewAction(documentId: string): IncomeIssuedDocumentViewAction {
  return {
    action_key: 'open_document',
    label: 'צפייה במסמך',
    enabled: true,
    view_mode: 'issued_html',
    income_document_id: documentId,
    view_aggregate_key: 'income_issued_document_view_aggregate',
    view_aggregate_params: { income_document_id: documentId },
    disabled_reason: null,
  };
}

describe('income client ledger card grouping', () => {
  it('keeps unpaid invoice as a parent with no payment children and full remaining', () => {
    const documents = buildLedgerInvoiceGroups([
      {
        income_document_id: 'inv-1',
        document_type_label: 'חשבונית מס',
        document_number: '4006',
        issue_date: '2026-08-01',
        original_amount: 1298,
        remaining_balance: 1298,
        currency: 'ILS',
        view_action: viewAction('inv-1'),
        payments: [],
      },
    ]);
    assert.equal(documents.length, 1);
    assert.equal(documents[0]?.original_amount_display, '₪1,298.00');
    assert.equal(documents[0]?.remaining_balance_display, '₪1,298.00');
    assert.equal(documents[0]?.remaining_balance_tone, 'open');
    assert.equal(documents[0]?.payments.length, 0);
  });

  it('places payment children directly under the invoice and keeps remaining on the parent', () => {
    const documents = buildLedgerInvoiceGroups([
      {
        income_document_id: 'inv-1',
        document_type_label: 'חשבונית מס',
        document_number: '4007',
        issue_date: '2026-08-23',
        original_amount: 1298,
        remaining_balance: 298,
        currency: 'ILS',
        view_action: viewAction('inv-1'),
        payments: [
          {
            payment_id: 'pay-1',
            allocation_id: 'alloc-1',
            cashbox_display: 'העברה בנקאית',
            payment_date: '2026-08-14',
            amount: 1000,
            currency: 'ILS',
          },
        ],
      },
    ]);
    assert.equal(documents[0]?.original_amount_display, '₪1,298.00');
    assert.equal(documents[0]?.remaining_balance_display, '₪298.00');
    assert.equal(documents[0]?.payments.length, 1);
    assert.equal(documents[0]?.payments[0]?.cashbox_display, 'העברה בנקאית');
    assert.equal(documents[0]?.payments[0]?.payment_date_display, '14/08/2026');
    assert.equal(documents[0]?.payments[0]?.amount_display, '₪1,000.00');

    const rows = flattenLedgerInvoiceGroups(documents);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.row_kind, 'invoice');
    assert.equal(rows[0]?.visual_role, 'parent');
    assert.equal(rows[0]?.view_action?.enabled, true);
    assert.equal(rows[1]?.row_kind, 'payment');
    assert.equal(rows[1]?.visual_role, 'child');
    assert.equal(rows[1]?.document_type_label, 'העברה בנקאית');
    assert.equal(rows[1]?.original_amount_display, '₪1,000.00');
    assert.equal(rows[1]?.amount_tone, 'payment');
    assert.equal(rows[1]?.view_action, null);
    assert.equal(rows[1]?.remaining_balance_display, '');
  });

  it('keeps fully paid invoices visible with remaining zero and payment history', () => {
    const documents = buildLedgerInvoiceGroups([
      {
        income_document_id: 'inv-2',
        document_type_label: 'חשבונית מס',
        document_number: '4008',
        issue_date: '2026-09-19',
        original_amount: 1203.6,
        remaining_balance: 0,
        currency: 'ILS',
        view_action: viewAction('inv-2'),
        payments: [
          {
            payment_id: 'pay-2',
            allocation_id: 'alloc-2',
            cashbox_display: 'העברה בנקאית',
            payment_date: '2026-09-20',
            amount: 1203.6,
            currency: 'ILS',
          },
        ],
      },
    ]);
    assert.equal(documents[0]?.remaining_balance_display, '₪0.00');
    assert.equal(documents[0]?.remaining_balance_tone, 'zero');
    assert.equal(documents[0]?.payments.length, 1);
  });

  it('keeps multiple payments under the same invoice in backend order by date', () => {
    const documents = buildLedgerInvoiceGroups([
      {
        income_document_id: 'inv-3',
        document_type_label: 'חשבונית מס',
        document_number: '4009',
        issue_date: '2026-08-01',
        original_amount: 2000,
        remaining_balance: 500,
        currency: 'ILS',
        view_action: viewAction('inv-3'),
        payments: [
          {
            payment_id: 'pay-b',
            allocation_id: 'alloc-b',
            cashbox_display: "צ'ק",
            payment_date: '2026-08-20',
            amount: 500,
            currency: 'ILS',
          },
          {
            payment_id: 'pay-a',
            allocation_id: 'alloc-a',
            cashbox_display: 'העברה בנקאית',
            payment_date: '2026-08-10',
            amount: 1000,
            currency: 'ILS',
          },
        ],
      },
    ]);
    assert.equal(documents[0]?.payments.length, 2);
    assert.equal(documents[0]?.payments[0]?.cashbox_display, 'העברה בנקאית');
    assert.equal(documents[0]?.payments[1]?.cashbox_display, "צ'ק");
    const rows = flattenLedgerInvoiceGroups(documents);
    assert.equal(rows.map((r) => r.row_kind).join(','), 'invoice,payment,payment');
  });

  it('sums remaining balances already computed by Accounting Base', () => {
    const total = sumLedgerRemainingBalance([
      {
        income_document_id: 'a',
        document_type_label: 'חשבונית מס',
        document_number: '1',
        issue_date: '2026-01-01',
        original_amount: 2000,
        remaining_balance: 1500,
        currency: 'ILS',
        view_action: null,
        payments: [],
      },
      {
        income_document_id: 'b',
        document_type_label: 'חשבונית מס',
        document_number: '2',
        issue_date: '2026-01-02',
        original_amount: 500,
        remaining_balance: 0,
        currency: 'ILS',
        view_action: null,
        payments: [],
      },
    ]);
    assert.equal(total, 1500);
  });
});

describe('income client ledger card contracts', () => {
  it('uses Accounting Base allocations and remaining balance, not document-snapshot running balance', () => {
    assert.match(serviceSource, /sumPostedAllocationsForIncomeDocuments/);
    assert.match(serviceSource, /accounting_payment_allocations/);
    assert.match(serviceSource, /resolveIncomeInvoicePaymentState/);
    assert.match(serviceSource, /incomePaymentMethodLabel/);
    assert.match(serviceSource, /financial_source: INCOME_LEDGER_FINANCIAL_SOURCE/);
    assert.match(serviceSource, /show_customer_picker: false/);
    assert.doesNotMatch(serviceSource, /TEMPORARY_ACCOUNTING_BASE_PENDING/);
    assert.doesNotMatch(serviceSource, /computeLedgerMovementRows/);
  });

  it('does not render the internal accounting marker or a client picker', () => {
    assert.doesNotMatch(modalSource, /TEMPORARY_ACCOUNTING_BASE_PENDING/);
    assert.doesNotMatch(modalSource, /nx-income-ledger-modal__customer-select/);
    assert.doesNotMatch(modalSource, /end_customer_options/);
    assert.match(modalSource, /user_notice/);
    assert.match(modalSource, /view_action\?\.enabled/);
    assert.match(modalSource, /IncomeIssuedDocumentViewModal/);
    assert.match(modalSource, /nx-income-ledger-modal__payment-amount/);
    assert.match(modalSource, /nx-income-ledger-modal__row--child/);
  });
});
