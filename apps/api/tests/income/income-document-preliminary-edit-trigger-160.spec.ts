/**
 * P0 — migration 160 trigger contract for preliminary-edit Save.
 * 159 required identity/accounting/cancel equality as a GATE; Save 409ed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allowedConversionTargetsForSource,
  isPreliminaryEditableType,
  isTaxDocumentDirectCancelForbidden,
} from '../../src/domains/income/income-document-conversion.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const migration159 = readFileSync(
  join(dir, '../../../../supabase/migrations/159_income_preliminary_document_edit_in_place.sql'),
  'utf8',
);
const migration160 = readFileSync(
  join(dir, '../../../../supabase/migrations/160_income_preliminary_document_edit_trigger_contract.sql'),
  'utf8',
);
const migration158 = readFileSync(
  join(
    dir,
    '../../../../supabase/migrations/158_income_document_conversion_and_preliminary_cancel.sql',
  ),
  'utf8',
);
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const wizardModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineIncomeDocumentWizardModal.tsx'),
  'utf8',
);

const RAISE = 'income_documents business fields are immutable after issue';

type Doc = {
  id: string;
  organization_id: string;
  represented_client_id: string | null;
  issuer_business_id: string;
  actor_user_id: string;
  acting_mode: string;
  income_customer_id: string | null;
  customer_snapshot_json: unknown;
  document_type: string;
  document_number: string;
  document_status: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  language: string;
  lines_snapshot_json: unknown;
  totals_snapshot_json: unknown;
  legal_snapshot_json: unknown;
  issuer_snapshot_json: unknown;
  notes: string | null;
  source_draft_id: string | null;
  customer_po_reference: string | null;
  tax_allocation_number: string | null;
  accounting_posting_status: string;
  accounting_entry_id: string | null;
  accounting_entry_link_id: string | null;
  accounting_posted_at: string | null;
  accounting_posting_error: string | null;
  accounting_posting_signature: string | null;
  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
  cancel_reason: string | null;
};

function distinct(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return !(b === null || b === undefined);
  if (b === null || b === undefined) return true;
  return JSON.stringify(a) !== JSON.stringify(b);
}

function quoteOld(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'doc-1',
    organization_id: 'org-1',
    represented_client_id: 'client-1',
    issuer_business_id: 'issuer-1',
    actor_user_id: 'actor-1',
    acting_mode: 'self',
    income_customer_id: 'cust-1',
    customer_snapshot_json: { name: 'Old' },
    document_type: 'quote',
    document_number: '1001',
    document_status: 'issued',
    issue_date: '2026-08-08',
    due_date: '2026-08-31',
    currency: 'ILS',
    language: 'he',
    lines_snapshot_json: [{ description: 'Bra', qty: 10 }],
    totals_snapshot_json: { grand_total_reference: 1652 },
    legal_snapshot_json: {},
    issuer_snapshot_json: {},
    notes: null,
    source_draft_id: 'draft-src',
    customer_po_reference: null,
    tax_allocation_number: null,
    accounting_posting_status: 'not_required',
    accounting_entry_id: null,
    accounting_entry_link_id: null,
    accounting_posted_at: null,
    accounting_posting_error: null,
    accounting_posting_signature: null,
    cancelled_at: null,
    cancelled_by_user_id: null,
    cancel_reason: null,
    ...overrides,
  };
}

function saveNew(old: Doc, extra: Partial<Doc> = {}): Doc {
  return {
    ...old,
    income_customer_id: 'cust-1',
    customer_snapshot_json: { name: 'Old', phone: '1' },
    issue_date: '2026-08-08',
    due_date: '2026-08-31',
    currency: 'ILS',
    language: 'he',
    lines_snapshot_json: [
      { description: 'Bra', qty: 10 },
      { description: 'Тест 3', qty: 1 },
    ],
    totals_snapshot_json: {
      grand_total_reference: 1681.5,
      preview: true,
      not_financial_truth: true,
    },
    notes: 'edited',
    customer_po_reference: 'PO-9',
    tax_allocation_number: null,
    ...extra,
  };
}

/** 159: identity/accounting/cancel equality is a GATE. */
function eval159(old: Doc, neu: Doc): 'allow' | 'raise' {
  if (
    old.document_status === 'issued' &&
    neu.document_status === 'issued' &&
    (old.document_type === 'quote' || old.document_type === 'deal_invoice') &&
    neu.document_type === old.document_type &&
    !distinct(neu.document_number, old.document_number) &&
    !distinct(neu.organization_id, old.organization_id) &&
    !distinct(neu.represented_client_id, old.represented_client_id) &&
    !distinct(neu.issuer_business_id, old.issuer_business_id) &&
    !distinct(neu.actor_user_id, old.actor_user_id) &&
    !distinct(neu.acting_mode, old.acting_mode) &&
    !distinct(neu.source_draft_id, old.source_draft_id) &&
    !distinct(neu.accounting_posting_status, old.accounting_posting_status) &&
    !distinct(neu.accounting_entry_id, old.accounting_entry_id) &&
    !distinct(neu.accounting_entry_link_id, old.accounting_entry_link_id) &&
    !distinct(neu.accounting_posted_at, old.accounting_posted_at) &&
    !distinct(neu.accounting_posting_error, old.accounting_posting_error) &&
    !distinct(neu.accounting_posting_signature, old.accounting_posting_signature) &&
    !distinct(neu.cancelled_at, old.cancelled_at) &&
    !distinct(neu.cancelled_by_user_id, old.cancelled_by_user_id) &&
    !distinct(neu.cancel_reason, old.cancel_reason)
  ) {
    return 'allow';
  }
  if (evalCancel159(old, neu)) return 'allow';
  if (evalRaise158(old, neu) || evalRaiseAccounting159(old, neu)) return 'raise';
  return 'allow';
}

function evalCancel159(old: Doc, neu: Doc): boolean {
  return (
    old.document_status === 'issued' &&
    neu.document_status === 'cancelled_future' &&
    (old.document_type === 'quote' || old.document_type === 'deal_invoice') &&
    !distinct(old.organization_id, neu.organization_id) &&
    !distinct(old.represented_client_id, neu.represented_client_id) &&
    !distinct(old.issuer_business_id, neu.issuer_business_id) &&
    !distinct(old.actor_user_id, neu.actor_user_id) &&
    !distinct(old.acting_mode, neu.acting_mode) &&
    !distinct(old.income_customer_id, neu.income_customer_id) &&
    !distinct(old.customer_snapshot_json, neu.customer_snapshot_json) &&
    !distinct(old.document_type, neu.document_type) &&
    !distinct(old.document_number, neu.document_number) &&
    !distinct(old.issue_date, neu.issue_date) &&
    !distinct(old.currency, neu.currency) &&
    !distinct(old.language, neu.language) &&
    !distinct(old.lines_snapshot_json, neu.lines_snapshot_json) &&
    !distinct(old.totals_snapshot_json, neu.totals_snapshot_json) &&
    !distinct(old.legal_snapshot_json, neu.legal_snapshot_json) &&
    !distinct(old.issuer_snapshot_json, neu.issuer_snapshot_json) &&
    !distinct(old.source_draft_id, neu.source_draft_id) &&
    !distinct(old.accounting_posting_status, neu.accounting_posting_status) &&
    !distinct(old.accounting_entry_id, neu.accounting_entry_id) &&
    !distinct(old.accounting_entry_link_id, neu.accounting_entry_link_id) &&
    !distinct(old.accounting_posted_at, neu.accounting_posted_at) &&
    !distinct(old.accounting_posting_error, neu.accounting_posting_error) &&
    !distinct(old.accounting_posting_signature, neu.accounting_posting_signature)
  );
}

function evalRaise158(old: Doc, neu: Doc): boolean {
  return (
    distinct(old.organization_id, neu.organization_id) ||
    distinct(old.represented_client_id, neu.represented_client_id) ||
    distinct(old.issuer_business_id, neu.issuer_business_id) ||
    distinct(old.actor_user_id, neu.actor_user_id) ||
    distinct(old.acting_mode, neu.acting_mode) ||
    distinct(old.income_customer_id, neu.income_customer_id) ||
    distinct(old.customer_snapshot_json, neu.customer_snapshot_json) ||
    distinct(old.document_type, neu.document_type) ||
    distinct(old.document_number, neu.document_number) ||
    distinct(old.document_status, neu.document_status) ||
    distinct(old.issue_date, neu.issue_date) ||
    distinct(old.currency, neu.currency) ||
    distinct(old.language, neu.language) ||
    distinct(old.lines_snapshot_json, neu.lines_snapshot_json) ||
    distinct(old.totals_snapshot_json, neu.totals_snapshot_json) ||
    distinct(old.legal_snapshot_json, neu.legal_snapshot_json) ||
    distinct(old.issuer_snapshot_json, neu.issuer_snapshot_json) ||
    distinct(old.source_draft_id, neu.source_draft_id) ||
    distinct(old.customer_po_reference, neu.customer_po_reference)
  );
}

function evalRaiseAccounting159(old: Doc, neu: Doc): boolean {
  return (
    distinct(old.accounting_posting_status, neu.accounting_posting_status) ||
    distinct(old.accounting_entry_id, neu.accounting_entry_id) ||
    distinct(old.accounting_entry_link_id, neu.accounting_entry_link_id) ||
    distinct(old.accounting_posted_at, neu.accounting_posted_at) ||
    distinct(old.accounting_posting_error, neu.accounting_posting_error) ||
    distinct(old.accounting_posting_signature, neu.accounting_posting_signature)
  );
}

/** 160: identity number/org/issuer/client is the GATE; accounting pinned from OLD. */
function eval160(old: Doc, neu: Doc): { result: 'allow' | 'raise'; applied: Doc } {
  if (
    old.document_status === 'issued' &&
    neu.document_status === 'issued' &&
    (old.document_type === 'quote' || old.document_type === 'deal_invoice') &&
    !distinct(neu.document_type, old.document_type) &&
    !distinct(neu.document_number, old.document_number) &&
    !distinct(neu.organization_id, old.organization_id) &&
    !distinct(neu.represented_client_id, old.represented_client_id) &&
    !distinct(neu.issuer_business_id, old.issuer_business_id)
  ) {
    return {
      result: 'allow',
      applied: {
        ...neu,
        actor_user_id: old.actor_user_id,
        acting_mode: old.acting_mode,
        source_draft_id: old.source_draft_id,
        accounting_posting_status: old.accounting_posting_status,
        accounting_entry_id: old.accounting_entry_id,
        accounting_entry_link_id: old.accounting_entry_link_id,
        accounting_posted_at: old.accounting_posted_at,
        accounting_posting_error: old.accounting_posting_error,
        accounting_posting_signature: old.accounting_posting_signature,
        cancelled_at: old.cancelled_at,
        cancelled_by_user_id: old.cancelled_by_user_id,
        cancel_reason: old.cancel_reason,
      },
    };
  }
  if (evalCancel159(old, neu)) return { result: 'allow', applied: neu };
  if (evalRaise158(old, neu)) return { result: 'raise', applied: neu };
  return { result: 'allow', applied: neu };
}

function saveInPlaceFn(): string {
  const start = draftEditorSource.indexOf('async function savePreliminaryDocumentEditIfNeeded');
  return draftEditorSource.slice(start, start + 12000);
}

function generatePreviewFn(): string {
  const start = draftEditorSource.indexOf('export async function generateIncomeDocumentPreview');
  const end = draftEditorSource.indexOf(
    'export async function buildReadOnlyIncomeDocumentPreviewOverlay',
  );
  return draftEditorSource.slice(start, end > start ? end : start + 2200);
}

const editBranch160 = migration160.slice(
  migration160.indexOf('Active preliminary edit'),
  migration160.indexOf('Preliminary cancel exception'),
);

test('A — issued quote business-field UPDATE succeeds under 160', () => {
  const old = quoteOld();
  const neu = saveNew(old);
  assert.equal(eval159(old, neu), 'allow');
  const out = eval160(old, neu);
  assert.equal(out.result, 'allow');
  assert.deepEqual(out.applied.lines_snapshot_json, neu.lines_snapshot_json);
  assert.equal(out.applied.id, old.id);
  assert.match(editBranch160, /OLD\.document_type in \('quote', 'deal_invoice'\)/);
  assert.match(editBranch160, /return NEW;/);
});

test('B — issued deal_invoice business-field UPDATE succeeds under 160', () => {
  const old = quoteOld({ document_type: 'deal_invoice', document_number: '2001' });
  const neu = saveNew(old);
  const out = eval160(old, neu);
  assert.equal(out.result, 'allow');
  assert.equal(out.applied.document_type, 'deal_invoice');
  assert.equal(isPreliminaryEditableType('deal_invoice'), true);
});

test('C — same id', () => {
  const old = quoteOld();
  const neu = saveNew(old);
  const out = eval160(old, neu);
  assert.equal(out.applied.id, old.id);
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /\.eq\('id', source\.id\)/);
  assert.doesNotMatch(saveBody, /\.from\('income_documents'\)[\s\S]*\.insert\(\{/);
});

test('D — same document_number', () => {
  const old = quoteOld();
  const neu = saveNew(old);
  const out = eval160(old, neu);
  assert.equal(out.applied.document_number, old.document_number);
  assert.match(editBranch160, /NEW\.document_number is not distinct from OLD\.document_number/);
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
  assert.doesNotMatch(saveBody, /allocateIncomeDocumentNumber/);
});

test('E — changing document_number is rejected', () => {
  const old = quoteOld();
  const neu = saveNew(old, { document_number: '9999' });
  assert.equal(eval160(old, neu).result, 'raise');
  assert.match(migration160, new RegExp(RAISE));
});

test('F — changing document_type is rejected', () => {
  const old = quoteOld();
  const neu = saveNew(old, { document_type: 'tax_invoice' });
  assert.equal(eval160(old, neu).result, 'raise');
});

test('G — changing org/issuer/accounting identity is rejected', () => {
  const old = quoteOld();
  assert.equal(eval160(old, saveNew(old, { organization_id: 'org-other' })).result, 'raise');
  assert.equal(eval160(old, saveNew(old, { issuer_business_id: 'issuer-other' })).result, 'raise');
  const accountingAttack = eval160(old, saveNew(old, { accounting_entry_id: 'entry-hack' }));
  assert.equal(accountingAttack.result, 'allow');
  assert.equal(accountingAttack.applied.accounting_entry_id, old.accounting_entry_id);
  assert.match(editBranch160, /NEW\.accounting_entry_id := OLD\.accounting_entry_id;/);
  assert.match(editBranch160, /NEW\.actor_user_id := OLD\.actor_user_id;/);
});

test('H — issued tax_invoice business-field UPDATE is rejected', () => {
  const old = quoteOld({ document_type: 'tax_invoice', document_number: '3001' });
  const neu = saveNew(old);
  assert.equal(eval160(old, neu).result, 'raise');
  assert.equal(isPreliminaryEditableType('tax_invoice'), false);
  assert.equal(isTaxDocumentDirectCancelForbidden('tax_invoice'), true);
});

test('I — receipt UPDATE is rejected', () => {
  const old = quoteOld({ document_type: 'receipt', document_number: '4001' });
  const neu = saveNew(old);
  assert.equal(eval160(old, neu).result, 'raise');
  assert.equal(isPreliminaryEditableType('receipt'), false);
});

test('J — cancellation rules remain unchanged', () => {
  const old = quoteOld();
  const cancelNew: Doc = { ...old, document_status: 'cancelled_future', cancelled_at: '2026-08-14T00:00:00Z' };
  assert.equal(eval159(old, cancelNew), 'allow');
  assert.equal(eval160(old, cancelNew).result, 'allow');
  const taxCancel = quoteOld({ document_type: 'tax_invoice' });
  assert.equal(
    eval160(taxCancel, { ...taxCancel, document_status: 'cancelled_future' }).result,
    'raise',
  );
  const cancelIf = (sql: string) => {
    const start = sql.indexOf("NEW.document_status = 'cancelled_future'");
    const marker =
      'OLD.accounting_posting_signature is not distinct from NEW.accounting_posting_signature';
    const end = sql.indexOf(marker, start);
    return sql.slice(start, end + marker.length).replace(/\s+/g, ' ').trim();
  };
  assert.equal(cancelIf(migration160), cancelIf(migration159));
});

test('159 first branch misses when accounting/actor write-back is distinct — that is the Save 409', () => {
  const old = quoteOld({ accounting_posted_at: '2026-08-08T07:00:00.000+00' });
  const pinned = saveNew(old, {
    actor_user_id: old.actor_user_id,
    acting_mode: old.acting_mode,
    source_draft_id: old.source_draft_id,
    accounting_posting_status: old.accounting_posting_status,
    accounting_posted_at: '2026-08-08T07:00:00.000Z',
  });
  assert.equal(eval159(old, pinned), 'raise');
  const out = eval160(old, pinned);
  assert.equal(out.result, 'allow');
  assert.equal(out.applied.accounting_posted_at, old.accounting_posted_at);
  assert.deepEqual(out.applied.lines_snapshot_json, pinned.lines_snapshot_json);
  assert.match(migration159, /NEW\.accounting_posted_at is not distinct from OLD\.accounting_posted_at/);
  assert.match(editBranch160, /NEW\.accounting_posted_at := OLD\.accounting_posted_at;/);
  assert.doesNotMatch(editBranch160, /NEW\.accounting_posted_at is not distinct from OLD\.accounting_posted_at/);
});

test('158 has no preliminary-edit exception — omit-identity Save still raises', () => {
  assert.doesNotMatch(migration158, /Active preliminary edit/);
  const old = quoteOld();
  const neu = saveNew(old);
  assert.equal(evalRaise158(old, neu), true);
});

test('160 does not put accounting_* on the global raise list (tax posting stays possible)', () => {
  const raise160 = migration160.slice(migration160.indexOf('Default immutability'));
  assert.doesNotMatch(raise160, /OLD\.accounting_posting_status is distinct from NEW\.accounting_posting_status/);
  assert.match(migration159, /OLD\.accounting_posting_status is distinct from NEW\.accounting_posting_status/);
});

test('application Save still updates the same row; Preview still does not UPDATE income_documents', () => {
  const saveBody = saveInPlaceFn();
  assert.match(saveBody, /lines_snapshot_json:\s*validation\.draft_lines_json/);
  assert.match(saveBody, /totals_snapshot_json:\s*totalsSnapshot/);
  assert.match(saveBody, /\.eq\('id', source\.id\)/);
  assert.match(saveBody, /\.eq\('document_number', source\.document_number\)/);
  const genBody = generatePreviewFn();
  assert.doesNotMatch(genBody, /from\('income_documents'\)/);
  assert.match(wizardModalSource, /WorkEngineInvoiceRetainerPreviewModal/);
  assert.deepEqual(allowedConversionTargetsForSource('deal_invoice'), [
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
});
