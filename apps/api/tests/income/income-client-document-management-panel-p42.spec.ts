/**
 * P4.2 — Client Documents / invoices-tab panel counters via SQL aggregation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);
const invoicesTabSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-tab.read-model.service.ts'),
  'utf8',
);
const migration152 = readFileSync(
  join(dir, '../../../../supabase/migrations/152_income_client_document_management_panel_stats.sql'),
  'utf8',
);
const migration157 = readFileSync(
  join(dir, '../../../../supabase/migrations/157_income_client_document_management_panel_unpaid_ab.sql'),
  'utf8',
);
const migration151 = readFileSync(
  join(dir, '../../../../supabase/migrations/151_income_document_drafts_user_saved_at.sql'),
  'utf8',
);
const pureSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.pure.ts'),
  'utf8',
);

test('P4.2 panel uses SQL RPC aggregation and does not hydrate 5000 document rows', () => {
  assert.match(panelSource, /income_client_document_management_panel_stats/);
  assert.match(panelSource, /income_client_document_management_end_customer_stats/);
  assert.match(panelSource, /\.rpc\(/);
  assert.doesNotMatch(panelSource, /\.limit\(5000\)/);
  assert.doesNotMatch(panelSource, /totals_snapshot_json/);
});

test('P4.2 RPC preserves office scoping and excludes self mode', () => {
  assert.match(migration152, /acting_mode = 'office_representative' or d\.acting_mode is null/);
  assert.match(migration152, /acting_mode = 'self' then null/);
  assert.match(migration152, /issuer_business_id = d\.represented_client_id/);
  assert.match(pureSource, /resolveOfficeClientGroupKey/);
});

test('P4.2 draft aggregation keeps migration 151 user_saved_at rule', () => {
  assert.match(migration151, /user_saved_at/);
  assert.match(migration152, /d\.status = 'draft'/);
  assert.match(migration152, /d\.user_saved_at is not null/);
  assert.match(panelSource, /user_saved_at/);
});

test('P4.2 RPC returns per-type issued counters and draft counter', () => {
  assert.match(migration152, /tax_invoice_issued_count/);
  assert.match(migration152, /tax_invoice_receipt_issued_count/);
  assert.match(migration152, /draft_documents_count/);
  assert.match(migration152, /unpaid_reference/);
  // P0 AB: live unpaid_reference definition is migration 157 (remaining, not gross totals).
  assert.match(migration157, /unpaid_reference/);
  assert.match(migration157, /accounting_payment_allocations/);
  assert.match(panelSource, /document_type_counters/);
  assert.match(panelSource, /key: 'draft'/);
});

test('P4.2 Test3/Test4 isolation remains represented_client scoped in SQL', () => {
  assert.match(migration152, /group by client_id/);
  assert.match(migration152, /represented_client_id/);
  assert.doesNotMatch(migration152, /cross join/i);
});

test('P4.2 invoices-tab parallelizes independent reads', () => {
  assert.match(invoicesTabSource, /Promise\.all\(/);
  assert.match(invoicesTabSource, /buildIncomeClientDocumentManagementPanel/);
  assert.match(invoicesTabSource, /loadInvoicesTabBranding/);
  assert.match(invoicesTabSource, /buildWorkEngineInvoicesDocumentCreationEntrypoint/);
  assert.match(invoicesTabSource, /loadInvoiceAttentionCounts/);
});

test('P4.2 panel does not add frontend counting and grants RPC to service_role', () => {
  assert.doesNotMatch(panelSource, /rows\.reduce/);
  assert.match(migration152, /grant execute on function public\.income_client_document_management_panel_stats/);
});

test('P4.2 self-mode empty-state counts use head count queries only', () => {
  assert.match(panelSource, /count: 'exact', head: true/);
  assert.match(panelSource, /acting_mode', 'self'/);
});
