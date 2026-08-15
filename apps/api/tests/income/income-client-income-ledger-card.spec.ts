import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildLedgerTransactionRows,
  incomeLedgerCashboxTypeLabel,
} from '../../src/domains/income/income-client-income-ledger-card.pure.js';
import { resolveIncomeDocumentSemanticDates } from '../../src/domains/income/income-document-semantic-dates.pure.js';
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

describe('income client ledger card debit/credit composition', () => {
  it('builds chronological חובה / זכות / יתרה from Accounting Base amounts', () => {
    const ledger = buildLedgerTransactionRows({
      currency: 'ILS',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
      events: [
        {
          transaction_id: 'inv-4007',
          row_kind: 'invoice',
          transaction_date: '2026-08-15',
          transaction_type_key: 'tax_invoice',
          transaction_type_label: 'חשבונית מס',
          document_id: 'inv-4007',
          document_number: '4007',
          payment_document_id: null,
          payment_document_number: null,
          debit_amount: 1298,
          credit_amount: null,
          view_action: viewAction('inv-4007'),
        },
        {
          transaction_id: 'alloc-1001',
          row_kind: 'payment',
          transaction_date: '2026-08-15',
          transaction_type_key: 'cashbox',
          transaction_type_label: 'קופת העברות',
          document_id: null,
          document_number: null,
          payment_document_id: 'rcp-1001',
          payment_document_number: '1001',
          debit_amount: null,
          credit_amount: 1000,
          view_action: viewAction('rcp-1001'),
        },
        {
          transaction_id: 'inv-4008',
          row_kind: 'invoice',
          transaction_date: '2026-08-16',
          transaction_type_key: 'tax_invoice',
          transaction_type_label: 'חשבונית מס',
          document_id: 'inv-4008',
          document_number: '4008',
          payment_document_id: null,
          payment_document_number: null,
          debit_amount: 1203.6,
          credit_amount: null,
          view_action: viewAction('inv-4008'),
        },
      ],
    });

    assert.equal(ledger.rows.length, 3);
    assert.equal(ledger.rows[0]?.document_number, '4007');
    assert.equal(ledger.rows[0]?.debit_amount_display, '₪1,298.00');
    assert.equal(ledger.rows[0]?.credit_amount_display, '');
    assert.equal(ledger.rows[0]?.running_balance_display, '₪1,298.00');
    assert.equal(ledger.rows[0]?.credit_amount_tone, 'none');

    assert.equal(ledger.rows[1]?.transaction_type_label, 'קופת העברות');
    assert.equal(ledger.rows[1]?.payment_document_number, '1001');
    assert.equal(ledger.rows[1]?.debit_amount_display, '');
    assert.equal(ledger.rows[1]?.credit_amount_display, '₪1,000.00');
    assert.equal(ledger.rows[1]?.credit_amount_tone, 'emphasis');
    assert.equal(ledger.rows[1]?.running_balance_display, '₪298.00');
    assert.equal(ledger.rows[1]?.view_action?.enabled, true);

    assert.equal(ledger.rows[2]?.document_number, '4008');
    assert.equal(ledger.rows[2]?.debit_amount_display, '₪1,203.60');
    assert.equal(ledger.rows[2]?.running_balance_display, '₪1,501.60');

    assert.equal(ledger.total_debit, 2501.6);
    assert.equal(ledger.total_credit, 1000);
    assert.equal(ledger.current_balance, 1501.6);
  });

  it('keeps running balance from full history when the displayed period is filtered', () => {
    const ledger = buildLedgerTransactionRows({
      currency: 'ILS',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
      events: [
        {
          transaction_id: 'inv-old',
          row_kind: 'invoice',
          transaction_date: '2026-07-01',
          transaction_type_key: 'tax_invoice',
          transaction_type_label: 'חשבונית מס',
          document_id: 'inv-old',
          document_number: '4000',
          payment_document_id: null,
          payment_document_number: null,
          debit_amount: 500,
          credit_amount: null,
          view_action: null,
        },
        {
          transaction_id: 'inv-new',
          row_kind: 'invoice',
          transaction_date: '2026-08-10',
          transaction_type_key: 'tax_invoice',
          transaction_type_label: 'חשבונית מס',
          document_id: 'inv-new',
          document_number: '4001',
          payment_document_id: null,
          payment_document_number: null,
          debit_amount: 200,
          credit_amount: null,
          view_action: null,
        },
      ],
    });
    assert.equal(ledger.rows.length, 1);
    assert.equal(ledger.rows[0]?.document_number, '4001');
    assert.equal(ledger.rows[0]?.running_balance_display, '₪700.00');
    assert.equal(ledger.current_balance, 700);
    assert.equal(ledger.total_debit, 200);
  });

  it('returns backend cashbox labels for payment methods', () => {
    assert.equal(incomeLedgerCashboxTypeLabel('bank_transfer'), 'קופת העברות');
    assert.equal(incomeLedgerCashboxTypeLabel('check'), 'קופת צ׳קים');
    assert.equal(incomeLedgerCashboxTypeLabel('credit_card'), 'קופת כ. אשראי');
    assert.equal(incomeLedgerCashboxTypeLabel('cash'), 'קופת מזומן');
  });

  it('uses semantic document_date, never due_date, as the ledger תאריך', () => {
    const semantic = resolveIncomeDocumentSemanticDates({
      issue_date: '2026-08-23',
      due_date: '2026-08-15',
    });
    assert.equal(semantic.document_date, '2026-08-15');
    assert.equal(semantic.due_date, '2026-08-23');
  });
});

describe('income client ledger card contracts', () => {
  it('composes Accounting Base allocations and does not invent a local financial source', () => {
    assert.match(serviceSource, /sumPostedAllocationsForIncomeDocuments/);
    assert.match(serviceSource, /accounting_payment_allocations/);
    assert.match(serviceSource, /composeCollectibleAfterCredit/);
    assert.match(serviceSource, /loadOpenCustomerCreditAmountByCustomer/);
    assert.match(serviceSource, /customer_credit:/);
    assert.match(serviceSource, /incomeLedgerCashboxTypeLabel/);
    assert.match(serviceSource, /resolveIncomeDocumentSemanticDates/);
    assert.match(serviceSource, /income_document_payment_operations/);
    assert.match(serviceSource, /ledger_customer/);
    assert.match(serviceSource, /issuer_context/);
    assert.match(serviceSource, /send_by_email/);
    assert.match(serviceSource, /send_by_docflow/);
    assert.match(serviceSource, /financial_source: INCOME_LEDGER_FINANCIAL_SOURCE/);
    assert.doesNotMatch(serviceSource, /TEMPORARY_ACCOUNTING_BASE_PENDING/);
    assert.doesNotMatch(serviceSource, /incomePaymentMethodLabel/);
    assert.doesNotMatch(serviceSource, /void params.endCustomerId/);
  });

  it('renders backend ledger truth without frontend debit/credit or payment-method mapping', () => {
    assert.match(modalSource, /IncomeIssuedDocumentViewModal/);
    assert.match(modalSource, /aggregate.customer_credit\?\.visible/);
    assert.doesNotMatch(modalSource, /קופת העברות/);
    assert.doesNotMatch(modalSource, /previousBalance/);
    assert.doesNotMatch(modalSource, /TEMPORARY_ACCOUNTING_BASE_PENDING/);
  });
});
