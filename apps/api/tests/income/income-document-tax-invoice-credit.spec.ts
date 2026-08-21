/**
 * Tax invoice → credit_tax_invoice workflow: pure truth + wiring contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE,
  CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE,
  INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT,
  INCOME_CREDIT_DOCUMENT_TYPE,
  assertCreditAmountWithinRemaining,
  composeCollectibleAfterCredit,
  creditSourceReferenceDisplay,
  decideAtomicCreditConsume,
  mergeCreditSourceReferenceIntoNotes,
  preserveIncomeTaxInvoiceCreditInDocumentSettings,
  readCreditDraftSettings,
  resolveCanonicalCreditNoteAmount,
  resolveCreditNoteDraftDocumentSettings,
  applySourceDocumentDiscountNetToCreditDraftLines,
  resolveCreditState,
  resolveReceivableAfterCredit,
  sourceLineIdentityFromSnapshot,
  writeCreditDraftSettings,
} from '../../src/domains/income/income-document-tax-invoice-credit.pure.js';
import {
  parseDocumentSettingsJson,
  serializeDocumentSettingsJson,
} from '../../src/domains/income/income-document-draft-totals.pure.js';
import { isTaxDocumentDirectCancelForbidden } from '../../src/domains/income/income-document-conversion.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const documentsByTypeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts'),
  'utf8',
);
const modalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx'),
  'utf8',
);
const creditConfirmSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineTaxInvoiceCreditConfirmModal.tsx'),
  'utf8',
);
const documentsShellSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentManagementShell.tsx'),
  'utf8',
);
const tabHostSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineTabHost.tsx'),
  'utf8',
);
const incomeWizardSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);
const retainerSetupSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);
const creditServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-tax-invoice-credit.service.ts'),
  'utf8',
);
const migration161 = readFileSync(
  join(dir, '../../../../supabase/migrations/161_income_tax_invoice_credit_lineage.sql'),
  'utf8',
);
const numberingSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-numbering.service.ts'),
  'utf8',
);

test('document type key is existing credit_tax_invoice', () => {
  assert.equal(INCOME_CREDIT_DOCUMENT_TYPE, 'credit_tax_invoice');
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice'), true);
});

test('command name is begin_income_tax_invoice_credit', () => {
  assert.equal(INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT, 'begin_income_tax_invoice_credit');
  assert.match(commandsSource, /INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT/);
  assert.match(commandsSource, /executeBeginIncomeTaxInvoiceCredit/);
});

test('credit state none / partial / full', () => {
  assert.deepEqual(resolveCreditState({ originalAmount: 10000, creditedAmount: 0 }), {
    credit_state: 'none',
    remaining_creditable_amount: 10000,
  });
  assert.deepEqual(resolveCreditState({ originalAmount: 10000, creditedAmount: 5000 }), {
    credit_state: 'partial',
    remaining_creditable_amount: 5000,
  });
  assert.deepEqual(resolveCreditState({ originalAmount: 10000, creditedAmount: 10000 }), {
    credit_state: 'full',
    remaining_creditable_amount: 0,
  });
});

test('TEST A/D — multiple credits remaining', () => {
  const afterFirst = resolveCreditState({ originalAmount: 10000, creditedAmount: 3000 });
  assert.equal(afterFirst.remaining_creditable_amount, 7000);
  const afterSecond = resolveCreditState({ originalAmount: 10000, creditedAmount: 5000 });
  assert.equal(afterSecond.credit_state, 'partial');
  assert.equal(afterSecond.remaining_creditable_amount, 5000);
});

test('TEST E — over-credit guard throws stable code', () => {
  assert.throws(
    () => assertCreditAmountWithinRemaining({ requestedAmount: 4000, remainingAmount: 3000 }),
    (err: Error & { code?: string }) => err.code === CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE,
  );
  assert.doesNotThrow(() =>
    assertCreditAmountWithinRemaining({ requestedAmount: 3000, remainingAmount: 3000 }),
  );
});

test('TEST G/H — payment plus credit receivable / customer credit', () => {
  const partialPaid = resolveReceivableAfterCredit({
    originalAmount: 10000,
    creditedAmount: 3000,
    allocatedPayments: 4000,
  });
  assert.equal(partialPaid.net_invoice_amount, 7000);
  assert.equal(partialPaid.remaining_receivable, 3000);
  assert.equal(partialPaid.customer_credit, 0);

  const fullyPaid = resolveReceivableAfterCredit({
    originalAmount: 10000,
    creditedAmount: 3000,
    allocatedPayments: 10000,
  });
  assert.equal(fullyPaid.remaining_receivable, 0);
  assert.equal(fullyPaid.customer_credit, 3000);
});

test('TEST I — VAT components are not frontend-negated; collectible uses net', () => {
  const collectible = composeCollectibleAfterCredit({
    originalAmount: 1180,
    creditedAmount: 1180,
    allocatedPayments: 0,
  });
  assert.equal(collectible.net_invoice_amount, 0);
  assert.equal(collectible.remaining_receivable, 0);
  assert.equal(collectible.payment_state_key, 'paid');
});

test('source line identity is not display text', () => {
  assert.equal(sourceLineIdentityFromSnapshot({ line_id: 'line-a', description: 'Service A' }, 0), 'line-a');
  assert.equal(sourceLineIdentityFromSnapshot({ description: 'Service A' }, 2), 'source_index:2');
});

test('credit reference wording is backend-owned', () => {
  assert.equal(creditSourceReferenceDisplay('4008'), 'זיכוי עבור חשבונית מס מספר 4008');
  const merged = mergeCreditSourceReferenceIntoNotes('הערה', 'זיכוי עבור חשבונית מס מספר 4008');
  assert.match(String(merged), /זיכוי עבור חשבונית מס מספר 4008/);
});

test('locked identity persists in draft settings', () => {
  const written = writeCreditDraftSettings(
    {},
    {
      source_invoice_id: 'inv-1',
      source_invoice_number: '4008',
      credit_mode: 'partial',
      reason_key: 'billing_error',
      reason_note: null,
      locked_income_customer_id: 'cust-1',
      locked_currency: 'USD',
      line_map: {
        'draft-1': { source_line_identity: 'line-a', original_quantity: 1, original_amount: 1000 },
      },
    },
  );
  const read = readCreditDraftSettings(written);
  assert.equal(read?.source_invoice_id, 'inv-1');
  assert.equal(read?.locked_currency, 'USD');
  assert.equal(read?.line_map['draft-1']?.source_line_identity, 'line-a');
});

test('issue consumes credit remaining via atomic Accounting Base RPC', () => {
  assert.match(issueSource, /assertAndConsumeCreditOnIssue/);
  assert.match(issueSource, /reverseCreditConsumeOnIssueFailure/);
  const creditService = readFileSync(
    join(dir, '../../src/domains/income/income-document-tax-invoice-credit.service.ts'),
    'utf8',
  );
  assert.match(creditService, /callConsumeIncomeTaxInvoiceCreditRpc/);
  assert.match(creditService, /callReverseIncomeTaxInvoiceCreditConsumeRpc/);
  assert.match(creditService, /resolveCanonicalCreditNoteAmount/);
  assert.match(issueSource, /resolveCanonicalCreditNoteAmount\(totals_snapshot_json\)/);
  assert.doesNotMatch(
    creditService,
    /requestedAmount = resolveIncomeInvoiceOriginalAmount\(params\.totalsSnapshotJson\)/,
  );
  assert.doesNotMatch(creditService, /sourceTotalsSnapshotJson: source\.totals_snapshot_json/);
});

test('canonical Credit Note amount is Income totals grand_total, not source/discount/subtotal', () => {
  const snapshot = {
    grand_total_reference: 6960.82,
    subtotal_reference: 5899,
    subtotal_before_discount_reference: 5899,
    discount_enabled: false,
    discount_amount_reference: 0,
  };
  assert.equal(resolveCanonicalCreditNoteAmount(snapshot), 6960.82);
  assert.equal(
    resolveCanonicalCreditNoteAmount({
      grand_total_reference: 2000,
      subtotal_reference: 1694.92,
    }),
    2000,
  );
  assert.equal(
    resolveCanonicalCreditNoteAmount({
      subtotal_reference: 5899,
      discount_amount_reference: 1184.85,
      amount_reference: 7922.7,
    }),
    0,
  );
});

test('DISCOUNT IS NOT CREDIT — source invoice discount is not the Credit Note amount', () => {
  const sourceInvoice = {
    grand_total_reference: 7922.7,
    discount_enabled: true,
    discount_amount_reference: 1184.85,
    subtotal_before_discount_reference: 7722.54,
  };
  const creditNote = {
    grand_total_reference: 6960.82,
    subtotal_reference: 5899,
    discount_enabled: false,
    discount_amount_reference: 0,
  };
  const creditAmount = resolveCanonicalCreditNoteAmount(creditNote);
  assert.equal(creditAmount, 6960.82);
  assert.notEqual(creditAmount, sourceInvoice.discount_amount_reference);
  assert.notEqual(creditAmount, sourceInvoice.grand_total_reference);
  const collectible = composeCollectibleAfterCredit({
    originalAmount: 7922.7,
    creditedAmount: creditAmount,
    allocatedPayments: 0,
  });
  assert.equal(collectible.remaining_receivable, 961.88);
  const settings = resolveCreditNoteDraftDocumentSettings();
  assert.equal(settings.discount.enabled, false);
  assert.equal(settings.discount.value, 0);
  const creditService = readFileSync(
    join(dir, '../../src/domains/income/income-document-tax-invoice-credit.service.ts'),
    'utf8',
  );
  assert.match(creditService, /resolveCreditNoteDraftDocumentSettings/);
  assert.match(creditService, /applySourceDocumentDiscountNetToCreditDraftLines/);
  assert.doesNotMatch(creditService, /resolveDocumentSettingsForConversion/);
});

test('Credit Note ₪2,000 stays ₪2,000 — no remaining/original normalization', () => {
  const requested = resolveCanonicalCreditNoteAmount({ grand_total_reference: 2000 });
  assert.equal(requested, 2000);
  const consume = decideAtomicCreditConsume({
    originalAmount: 7922.7,
    creditedAmount: 0,
    requestedAmount: requested,
  });
  assert.equal(consume.ok, true);
  if (!consume.ok) return;
  assert.equal(consume.nextCredited, 2000);
  const collectible = composeCollectibleAfterCredit({
    originalAmount: 7922.7,
    creditedAmount: 2000,
    allocatedPayments: 0,
  });
  assert.equal(collectible.remaining_receivable, 5922.7);
});

test('source discount nets into Credit Note draft lines without re-applying discount settings', () => {
  const lines = applySourceDocumentDiscountNetToCreditDraftLines({
    lines: [
      { amount_reference: 10000, unit_price_reference: 10000 },
      { amount_reference: 0, unit_price_reference: 0 },
    ],
    sourceTotalsSnapshot: {
      discount_enabled: true,
      subtotal_before_discount_reference: 10000,
      subtotal_after_discount_reference: 9000,
      discount_amount_reference: 1000,
      grand_total_reference: 10620,
    },
  });
  assert.equal(lines[0]?.amount_reference, 9000);
  assert.equal(lines[0]?.unit_price_reference, 9000);
  const settings = resolveCreditNoteDraftDocumentSettings();
  assert.equal(settings.discount.enabled, false);
});

test('payment + credit remaining is original − payments − issued credits', () => {
  const collectible = composeCollectibleAfterCredit({
    originalAmount: 7922.7,
    creditedAmount: 2000,
    allocatedPayments: 1000,
  });
  assert.equal(collectible.remaining_receivable, 4922.7);
});

test('two successive partial Credit Notes accumulate (500 + 118)', () => {
  const first = decideAtomicCreditConsume({
    originalAmount: 7922.7,
    creditedAmount: 0,
    requestedAmount: 500,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = decideAtomicCreditConsume({
    originalAmount: 7922.7,
    creditedAmount: first.nextCredited,
    requestedAmount: 118,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.nextCredited, 618);
  const collectible = composeCollectibleAfterCredit({
    originalAmount: 7922.7,
    creditedAmount: second.nextCredited,
    allocatedPayments: 0,
  });
  assert.equal(collectible.remaining_receivable, 7304.7);
});

test('loadIssuedCreditAmountsByInvoice sums all issued links (wiring)', () => {
  const readSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-tax-invoice-credit.read.ts'),
    'utf8',
  );
  assert.match(readSource, /status', 'issued'/);
  assert.match(readSource, /credited_amount_reference/);
  assert.match(readSource, /current \+ Number\(row\.credited_amount_reference/);
});

test('issue cleans up orphan Credit Note when consume fails', () => {
  assert.match(issueSource, /Credit Note lineage is required/);
  assert.match(issueSource, /creditSettingsEarly/);
  assert.match(issueSource, /logIncomeIssueFailed\(diag, 'credit_consume'/);
  assert.match(issueSource, /assertAndConsumeCreditOnIssue/);
});

test('credit issue refreshes invoices-tab panel unpaid surface (no FE unpaid math)', () => {
  assert.match(commandsSource, /document_type_key === 'credit_tax_invoice'/);
  assert.match(commandsSource, /buildWorkEngineInvoicesTabAggregate/);
  assert.match(commandsSource, /client_document_management_panel \(לא שולם\)/);
});

test('over-credit guard uses canonical Credit Note total against remaining creditable', () => {
  assert.doesNotThrow(() =>
    assertCreditAmountWithinRemaining({ requestedAmount: 6960.82, remainingAmount: 7000 }),
  );
  assert.throws(
    () => assertCreditAmountWithinRemaining({ requestedAmount: 7100, remainingAmount: 7000 }),
    (err: Error & { code?: string }) => err.code === CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE,
  );
});

test('tax invoice row owns credit_action; quote/deal cancel untouched', () => {
  assert.match(documentsByTypeSource, /credit_action = buildTaxInvoiceCreditAction/);
  assert.match(documentsByTypeSource, /params\.documentType === 'tax_invoice'/);
  assert.match(documentsByTypeSource, /INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT/);
  assert.match(modalSource, /row\.credit_action/);
  assert.match(modalSource, /onRequestTaxInvoiceCredit/);
  assert.match(documentsShellSource, /begin_income_tax_invoice_credit|creditRequest\.action\.command/);
  assert.match(creditConfirmSource, /זיכוי מלא|creditMode/);
  assert.match(documentsShellSource, /setDocumentsModalOpen\(false\)/);
  assert.doesNotMatch(modalSource, /nx-modal-overlay--nested[\s\S]{0,80}credit/);
  assert.doesNotMatch(modalSource, /cancel_action[\s\S]{0,80}tax_invoice/);
});

test('credit handoff opens canonical Income wizard, not retainer setup', () => {
  const creditHandlerStart = documentsShellSource.indexOf('const handleConfirmTaxInvoiceCredit');
  const creditHandlerEnd = documentsShellSource.indexOf('if (!panel?.visible)');
  assert.ok(creditHandlerStart >= 0 && creditHandlerEnd > creditHandlerStart);
  const creditHandler = documentsShellSource.slice(creditHandlerStart, creditHandlerEnd);
  assert.match(creditHandler, /onOpenConvertedDraft/);
  assert.match(creditHandler, /income_workspace_aggregate/);
  assert.match(creditHandler, /setRetainerSetupOpen\(false\)/);
  assert.doesNotMatch(creditHandler, /setRetainerSetupOpen\(true\)/);
  assert.doesNotMatch(creditHandler, /setRetainerCustomerOpen\(true\)/);
  assert.match(tabHostSource, /WorkEngineIncomeDocumentWizardModal/);
  assert.match(tabHostSource, /onOpenConvertedDraft=\{async \(\{ workspaceAggregate \}\) => \{/);
  assert.match(tabHostSource, /setWizardOpen\(true\)/);
  assert.match(incomeWizardSource, /resolveIncomeWizardStartingStepIndex/);
  assert.match(incomeWizardSource, /<WorkEngineDocumentDetailsStep/);
  assert.doesNotMatch(creditConfirmSource, /WorkEngineInvoiceRetainerSetupModal/);
  assert.doesNotMatch(creditConfirmSource, /ריטיינר/);
  assert.doesNotMatch(retainerSetupSource, /begin_income_tax_invoice_credit/);
  assert.doesNotMatch(retainerSetupSource, /credit_tax_invoice/);
});

test('begin credit returns workspace starting at document_details', () => {
  assert.match(creditServiceSource, /wizard_starting_step_key/);
  assert.match(creditServiceSource, /resumed\.result\.starting_step_key/);
  assert.match(creditServiceSource, /income_workspace_aggregate: workspace/);
  assert.match(creditServiceSource, /converted_draft_id: params\.draftId/);
});

test('lineage migration is forward-only 161', () => {
  assert.match(migration161, /income_document_credit_links/);
  assert.match(migration161, /income_invoice_credit_control/);
  assert.match(migration161, /income_invoice_credit_line_control/);
});

test('numbering path is not reinvented in credit workflow', () => {
  assert.match(numberingSource, /allocateIncomeDocumentNumber/);
  const creditService = readFileSync(
    join(dir, '../../src/domains/income/income-document-tax-invoice-credit.service.ts'),
    'utf8',
  );
  assert.doesNotMatch(creditService, /6000|starting_number|next_number\s*=/);
});

const migration162 = readFileSync(
  join(dir, '../../../../supabase/migrations/162_accounting_base_customer_credit_and_atomic_credit_consume.sql'),
  'utf8',
);
const consumeRpcSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-customer-credit.service.ts'),
  'utf8',
);

test('A — FULL CREDIT remaining receivable and credit_state', () => {
  const state = resolveCreditState({ originalAmount: 10000, creditedAmount: 10000 });
  const money = resolveReceivableAfterCredit({
    originalAmount: 10000,
    creditedAmount: 10000,
    allocatedPayments: 0,
  });
  assert.equal(state.credit_state, 'full');
  assert.equal(state.remaining_creditable_amount, 0);
  assert.equal(money.remaining_receivable, 0);
  assert.equal(money.customer_credit, 0);
});

test('B — PARTIAL CREDIT remaining 7,000', () => {
  const state = resolveCreditState({ originalAmount: 10000, creditedAmount: 3000 });
  assert.equal(state.credit_state, 'partial');
  assert.equal(state.remaining_creditable_amount, 7000);
});

test('C — MULTIPLE CREDIT 3,000 + 2,000', () => {
  const first = decideAtomicCreditConsume({
    originalAmount: 10000,
    creditedAmount: 0,
    requestedAmount: 3000,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = decideAtomicCreditConsume({
    originalAmount: 10000,
    creditedAmount: first.nextCredited,
    requestedAmount: 2000,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const state = resolveCreditState({ originalAmount: 10000, creditedAmount: second.nextCredited });
  assert.equal(state.remaining_creditable_amount, 5000);
  assert.equal(second.nextCredited, 5000);
});

test('D — OVER-CREDIT remaining 3,000 attempt 4,000', () => {
  const result = decideAtomicCreditConsume({
    originalAmount: 10000,
    creditedAmount: 7000,
    requestedAmount: 4000,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE);
});

test('E — CONCURRENT CREDIT remaining 5,000 two 4,000 attempts', () => {
  let credited = 5000;
  const original = 10000;
  const remainingAtOpen = original - credited;
  assert.equal(remainingAtOpen, 5000);
  const outcomes: Array<'ok' | 'reject'> = [];
  for (const requested of [4000, 4000]) {
    const decision = decideAtomicCreditConsume({
      originalAmount: original,
      creditedAmount: credited,
      requestedAmount: requested,
    });
    if (decision.ok) {
      credited = decision.nextCredited;
      outcomes.push('ok');
    } else {
      outcomes.push('reject');
    }
  }
  assert.deepEqual(outcomes, ['ok', 'reject']);
  assert.equal(credited, 9000);
  assert.equal(credited <= original, true);
});

test('F — PARTIAL PAYMENT + CREDIT remaining receivable 3,000', () => {
  const money = resolveReceivableAfterCredit({
    originalAmount: 10000,
    creditedAmount: 3000,
    allocatedPayments: 4000,
  });
  assert.equal(money.net_invoice_amount, 7000);
  assert.equal(money.remaining_receivable, 3000);
  assert.equal(money.customer_credit, 0);
});

test('G — FULL PAYMENT + CREDIT creates AB customer credit amount 3,000', () => {
  const money = resolveReceivableAfterCredit({
    originalAmount: 10000,
    creditedAmount: 3000,
    allocatedPayments: 10000,
  });
  assert.equal(money.remaining_receivable, 0);
  assert.equal(money.customer_credit, 3000);
  assert.match(migration162, /accounting_customer_credits/);
  assert.match(migration162, /status text not null default 'open'/);
  assert.doesNotMatch(migration162, /insert into public\.accounting_payments/);
  assert.doesNotMatch(migration162, /insert into public\.accounting_payment_allocations/);
  assert.match(consumeRpcSource, /accounting_customer_credits/);
  assert.match(consumeRpcSource, /ACCOUNTING_BASE_CONSUME_INCOME_TAX_INVOICE_CREDIT_RPC/);
});

test('atomic consume RPC locks control and line rows', () => {
  assert.match(migration162, /accounting_base_consume_income_tax_invoice_credit/);
  assert.match(migration162, /from public\.income_invoice_credit_control[\s\S]*for update/);
  assert.match(migration162, /from public\.income_invoice_credit_line_control[\s\S]*for update/);
  assert.match(migration162, /from public\.income_document_credit_links[\s\S]*for update/);
  assert.match(migration162, /CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE/);
  assert.match(migration162, /CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE/);
  assert.match(migration162, /accounting_base_reverse_income_tax_invoice_credit_consume/);
  assert.match(migration162, /status = 'reversed'/);
});

test('line guard uses source identity not display text', () => {
  const blocked = decideAtomicCreditConsume({
    originalAmount: 1000,
    creditedAmount: 0,
    requestedAmount: 500,
    lines: [{ remainingQuantity: 2, remainingAmount: 200, requestedQuantity: 5, requestedAmount: 500 }],
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.code, CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE);
});

test('H — ledger reads first-class Accounting Base customer credit', () => {
  const ledger = readFileSync(
    join(dir, '../../src/domains/income/income-client-income-ledger-card.service.ts'),
    'utf8',
  );
  assert.match(ledger, /loadOpenCustomerCreditAmountByCustomer/);
  assert.match(ledger, /financial_source: 'accounting_base'/);
  assert.match(ledger, /יתרת זכות ללקוח/);
});

test('I — A/R remaining is collectible only', () => {
  const ar = readFileSync(
    join(dir, '../../src/domains/accounting-base/accounting-base-accounts-receivable.read-model.service.ts'),
    'utf8',
  );
  assert.match(ar, /composeCollectibleAfterCredit/);
  const money = composeCollectibleAfterCredit({
    originalAmount: 10000,
    creditedAmount: 3000,
    allocatedPayments: 10000,
  });
  assert.equal(money.remaining_receivable, 0);
  assert.equal(money.customer_credit, 3000);
});

test('J — collection reconcile runs only after successful posting', () => {
  assert.match(issueSource, /finalizeIssuedTaxInvoiceCreditSideEffects/);
  assert.match(issueSource, /accounting_posting_completed[\s\S]*finalizeIssuedTaxInvoiceCreditSideEffects/);
  const collection = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine-collection-credit-fact.service.ts'),
    'utf8',
  );
  assert.match(collection, /tax_invoice_credit_issued/);
  assert.match(collection, /collection_followup_auto_closed_credited/);
});

test('K/L/M — PDF / Email / DocFlow reuse canonical systems', () => {
  const render = readFileSync(
    join(dir, '../../src/domains/income/income-document-unified-render.service.ts'),
    'utf8',
  );
  const email = readFileSync(
    join(dir, '../../src/domains/income/income-document-email-history.service.ts'),
    'utf8',
  );
  const docflow = readFileSync(
    join(dir, '../../src/domains/income/income-document-docflow-send.service.ts'),
    'utf8',
  );
  assert.match(render, /loadCreditSourceReferenceForDocument/);
  assert.match(render, /mergeCreditSourceReferenceIntoNotes/);
  assert.match(email, /credit_tax_invoice/);
  assert.match(docflow, /credit_tax_invoice/);
  assert.doesNotMatch(issueSource, /credit-specific PDF|second preview/);
  assert.match(numberingSource, /allocateIncomeDocumentNumber/);
});

test('N — issued credit and original invoice stay immutable', () => {
  assert.match(commandsSource, /Cannot update an issued draft/);
  assert.doesNotMatch(issueSource, /from\('income_documents'\)[\s\S]{0,120}\.update\(/);
  const creditService = readFileSync(
    join(dir, '../../src/domains/income/income-document-tax-invoice-credit.service.ts'),
    'utf8',
  );
  assert.doesNotMatch(creditService, /from\('income_documents'\)[\s\S]{0,80}\.update\(/);
});

test('partial and full credit do not mutate source invoice due_date', () => {
  const creditService = readFileSync(
    join(dir, '../../src/domains/income/income-document-tax-invoice-credit.service.ts'),
    'utf8',
  );
  const loadStart = creditService.indexOf('async function loadSourceInvoice');
  const loadEnd = creditService.indexOf('async function findCreditLinkByDraft');
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const loadSource = creditService.slice(loadStart, loadEnd);
  assert.doesNotMatch(loadSource, /due_date/);
  assert.doesNotMatch(creditService, /from\('income_documents'\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(issueSource, /from\('income_documents'\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(creditService, /due_date:\s*source/);
  assert.doesNotMatch(issueSource, /due_date:\s*source/);
});

test('O — numbering is existing credit_tax_invoice sequence only', () => {
  assert.match(numberingSource, /allocateIncomeDocumentNumber/);
  const creditService = readFileSync(
    join(dir, '../../src/domains/income/income-document-tax-invoice-credit.service.ts'),
    'utf8',
  );
  assert.doesNotMatch(creditService, /6000|starting_number|next_number\s*=/);
  assert.doesNotMatch(migration162, /starting_number|next_number/);
});

test('posting failure reverses consume including customer credit', () => {
  assert.match(issueSource, /reverseCreditConsumeOnIssueFailure/);
  assert.match(issueSource, /issuedDocumentId: issuedId/);
  assert.match(migration162, /status = 'reversed'/);
});

test('begin credit writes income_tax_invoice_credit lineage metadata', () => {
  const sample = writeCreditDraftSettings(
    { vat_mode: 'standard', discount: { enabled: false, type: 'percent', value: 0 } },
    {
      source_invoice_id: '52ab543b-8854-4891-8719-796e8512dced',
      source_invoice_number: '4006',
      credit_mode: 'partial',
      reason_key: 'pricing_correction',
      reason_note: null,
      locked_income_customer_id: '88ef2ff3-605b-4c71-bab6-0bd439d43341',
      locked_currency: 'ILS',
      line_map: {
        'draft-line-1': {
          source_line_identity: '0563fb2c-4821-46ee-bff0-9b55c5499f6a',
          original_quantity: 1,
          original_amount: 7922.7,
        },
      },
    },
  );
  const read = readCreditDraftSettings(sample);
  assert.ok(read);
  assert.equal(read!.source_invoice_id, '52ab543b-8854-4891-8719-796e8512dced');
  assert.equal(read!.source_invoice_number, '4006');
  assert.equal(read!.line_map['draft-line-1']?.source_line_identity, '0563fb2c-4821-46ee-bff0-9b55c5499f6a');
  assert.match(creditServiceSource, /writeCreditDraftSettings/);
  assert.match(creditServiceSource, /document_settings_json: documentSettingsJson/);
});

test('serializeDocumentSettingsJson alone strips credit lineage (regression of wipe)', () => {
  const withCredit = writeCreditDraftSettings(
    {
      vat_mode: 'standard',
      amount_rounding: 'none',
      discount: { enabled: false, type: 'percent', value: 0 },
      due_date_manual_override: false,
    },
    {
      source_invoice_id: '52ab543b-8854-4891-8719-796e8512dced',
      source_invoice_number: '4006',
      credit_mode: 'partial',
      reason_key: 'other',
      reason_note: null,
      locked_income_customer_id: '88ef2ff3-605b-4c71-bab6-0bd439d43341',
      locked_currency: 'ILS',
      line_map: {},
    },
  );
  const wiped = serializeDocumentSettingsJson(parseDocumentSettingsJson(withCredit));
  assert.equal(readCreditDraftSettings(wiped), null);
});

test('preserveIncomeTaxInvoiceCreditInDocumentSettings keeps lineage across discount/VAT/settings rewrite', () => {
  const existing = writeCreditDraftSettings(
    {
      vat_mode: 'standard',
      amount_rounding: 'none',
      discount: { enabled: false, type: 'percent', value: 0 },
    },
    {
      source_invoice_id: '52ab543b-8854-4891-8719-796e8512dced',
      source_invoice_number: '4006',
      credit_mode: 'partial',
      reason_key: 'billing_error',
      reason_note: null,
      locked_income_customer_id: '88ef2ff3-605b-4c71-bab6-0bd439d43341',
      locked_currency: 'ILS',
      line_map: {
        a: { source_line_identity: '0563fb2c-4821-46ee-bff0-9b55c5499f6a', original_quantity: 1, original_amount: 100 },
      },
    },
  );

  // Simulate update_income_document_discount / update_income_document_draft_settings rewrite.
  const nextFromEditor = {
    vat_mode: 'exempt',
    amount_rounding: 'nearest_agora',
    discount: { enabled: true, type: 'percent', value: 10 },
    due_date_manual_override: true,
  };
  const preserved = preserveIncomeTaxInvoiceCreditInDocumentSettings(existing, nextFromEditor);
  const credit = readCreditDraftSettings(preserved);
  assert.ok(credit);
  assert.equal(credit!.source_invoice_id, '52ab543b-8854-4891-8719-796e8512dced');
  assert.equal(credit!.source_invoice_number, '4006');
  assert.equal(preserved.vat_mode, 'exempt');
  assert.equal((preserved.discount as { value: number }).value, 10);
  assert.equal(credit!.line_map.a?.source_line_identity, '0563fb2c-4821-46ee-bff0-9b55c5499f6a');
});

test('client cannot overwrite or delete credit lineage via settings payload', () => {
  const existing = writeCreditDraftSettings(
    { vat_mode: 'standard' },
    {
      source_invoice_id: '52ab543b-8854-4891-8719-796e8512dced',
      source_invoice_number: '4006',
      credit_mode: 'partial',
      reason_key: 'other',
      reason_note: null,
      locked_income_customer_id: 'cust-1',
      locked_currency: 'ILS',
      line_map: {},
    },
  );

  const maliciousOverwrite = preserveIncomeTaxInvoiceCreditInDocumentSettings(existing, {
    vat_mode: 'standard',
    income_tax_invoice_credit: {
      source_invoice_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      source_invoice_number: 'HACKED',
      credit_mode: 'full',
      reason_key: 'other',
      reason_note: null,
      locked_income_customer_id: 'other-cust',
      locked_currency: 'USD',
      line_map: {},
    },
  });
  assert.equal(readCreditDraftSettings(maliciousOverwrite)!.source_invoice_id, '52ab543b-8854-4891-8719-796e8512dced');
  assert.equal(readCreditDraftSettings(maliciousOverwrite)!.source_invoice_number, '4006');

  const maliciousDelete = preserveIncomeTaxInvoiceCreditInDocumentSettings(existing, {
    vat_mode: 'zero',
    // omit income_tax_invoice_credit entirely
  });
  assert.ok(readCreditDraftSettings(maliciousDelete));
  assert.equal(readCreditDraftSettings(maliciousDelete)!.source_invoice_id, '52ab543b-8854-4891-8719-796e8512dced');
});

test('client cannot invent credit lineage on a normal draft', () => {
  const forged = preserveIncomeTaxInvoiceCreditInDocumentSettings(
    { vat_mode: 'standard', discount: { enabled: false, type: 'percent', value: 0 } },
    {
      vat_mode: 'standard',
      income_tax_invoice_credit: {
        source_invoice_id: '52ab543b-8854-4891-8719-796e8512dced',
        source_invoice_number: '4006',
        credit_mode: 'partial',
        reason_key: 'other',
        reason_note: null,
        locked_income_customer_id: null,
        locked_currency: 'ILS',
        line_map: {},
      },
    },
  );
  assert.equal(readCreditDraftSettings(forged), null);
  assert.equal(forged.vat_mode, 'standard');
});

test('draft editor settings/discount paths preserve protected credit metadata', () => {
  const draftEditorSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
    'utf8',
  );
  assert.match(draftEditorSource, /preserveIncomeTaxInvoiceCreditInDocumentSettings/);
  assert.match(
    draftEditorSource,
    /function preservePreliminaryEditMarker[\s\S]*preserveIncomeTaxInvoiceCreditInDocumentSettings/,
  );
  assert.match(draftEditorSource, /updateIncomeDocumentDiscount[\s\S]*preservePreliminaryEditMarker/);
  assert.match(draftEditorSource, /updateIncomeDocumentDraftSettings[\s\S]*preservePreliminaryEditMarker/);
  assert.match(
    draftEditorSource,
    /serializeDocumentSettingsJson\(\{ \.\.\.settings, vat_mode: value \}\)/,
  );
});

test('4006 expected remaining after issued credits 2360 + 118', () => {
  const collectible = composeCollectibleAfterCredit({
    originalAmount: 7922.7,
    creditedAmount: 2360 + 118,
    allocatedPayments: 0,
  });
  assert.equal(collectible.remaining_receivable, 5444.7);
});
