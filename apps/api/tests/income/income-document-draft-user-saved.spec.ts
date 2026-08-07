import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  clientSuppliedUserSavedAt,
  isUserSavedDraftForList,
} from '../../src/domains/income/income-document-draft-user-saved.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readApi(relativePath: string): string {
  return readFileSync(join(dir, '../../src', relativePath), 'utf8');
}

function readMigration(): string {
  return readFileSync(
    join(dir, '../../../../supabase/migrations/151_income_document_drafts_user_saved_at.sql'),
    'utf8',
  );
}

function readWeb(relativePath: string): string {
  return readFileSync(join(dir, '../../../web/src', relativePath), 'utf8');
}

test('isUserSavedDraftForList requires status=draft and non-null user_saved_at', () => {
  assert.equal(isUserSavedDraftForList({ status: 'draft', user_saved_at: null }), false);
  assert.equal(isUserSavedDraftForList({ status: 'draft', user_saved_at: undefined }), false);
  assert.equal(isUserSavedDraftForList({ status: 'draft', user_saved_at: '2026-08-01T12:00:00.000Z' }), true);
  assert.equal(isUserSavedDraftForList({ status: 'issued', user_saved_at: '2026-08-01T12:00:00.000Z' }), false);
  assert.equal(isUserSavedDraftForList({ status: 'cancelled', user_saved_at: '2026-08-01T12:00:00.000Z' }), false);
});

test('clientSuppliedUserSavedAt detects untrusted payload key', () => {
  assert.equal(clientSuppliedUserSavedAt({}), false);
  assert.equal(clientSuppliedUserSavedAt({ draft_id: 'x' }), false);
  assert.equal(clientSuppliedUserSavedAt({ user_saved_at: '2026-01-01T00:00:00.000Z' }), true);
  assert.equal(clientSuppliedUserSavedAt({ user_saved_at: null }), true);
});

test('migration 151 adds user_saved_at and conservative backfill excludes cycle-generated and payment receipt drafts', () => {
  const sql = readMigration();
  assert.match(sql, /ADD COLUMN IF NOT EXISTS user_saved_at timestamptz NULL/);
  assert.match(sql, /income_recurring_document_cycles/);
  assert.match(sql, /generated_draft_id/);
  assert.match(sql, /income_document_payment_operations/);
  assert.match(sql, /receipt_draft_id/);
  assert.doesNotMatch(sql, /retainer_template/);
});

test('scheduler insert does not set user_saved_at', () => {
  const draftService = readApi('domains/work-engine/work-engine-invoice-retainer-draft.service.ts');
  const start = draftService.indexOf('export async function createRecurringCycleDraftFromSnapshot');
  const insertBlock = draftService.slice(start, start + 4500);
  assert.ok(insertBlock.includes("status: 'draft'"));
  assert.ok(!insertBlock.includes('user_saved_at'));
});

test('save_income_document_draft stamps user_saved_at only when null and rejects client supply', () => {
  const editor = readApi('domains/income/income-document-draft-editor.service.ts');
  const start = editor.indexOf('export async function saveIncomeDocumentDraft');
  const block = editor.slice(start, start + 1800);
  assert.ok(block.includes('clientSuppliedUserSavedAt(body)'));
  assert.ok(block.includes("user_saved_at cannot be set by client"));
  assert.ok(block.includes('savePatch.user_saved_at = new Date().toISOString()'));
  assert.ok(block.includes('existingUserSavedAt'));
});

test('create_income_document_draft sets user_saved_at; begin wizard leaves null; payment receipt leaves null', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  const createStart = commands.indexOf('async function executeCreateDraft');
  const createBlock = commands.slice(createStart, createStart + 2200);
  assert.ok(createBlock.includes('user_saved_at: new Date().toISOString()'));
  assert.ok(createBlock.includes('clientSuppliedUserSavedAt(body)'));

  const beginStart = commands.indexOf('if (command === INCOME_COMMAND_BEGIN_WIZARD_DRAFT)');
  const beginBlock = commands.slice(beginStart, beginStart + 500);
  assert.ok(beginBlock.includes('clientSuppliedUserSavedAt(body)'));

  const payment = readApi('domains/income/income-document-payment.service.ts');
  const receiptInsertStart = payment.indexOf("throwIfSupabaseError(error, 'Failed to create receipt draft')");
  assert.ok(receiptInsertStart > 0);
  const receiptBlock = payment.slice(Math.max(0, receiptInsertStart - 900), receiptInsertStart);
  assert.ok(receiptBlock.includes("document_type: 'receipt'"));
  assert.ok(receiptBlock.includes("status: 'draft'"));
  assert.ok(!receiptBlock.includes('user_saved_at'));
});

test('all active draft list/counter aggregates filter user_saved_at IS NOT NULL', () => {
  const byType = readApi(
    'domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
  );
  const panel = readApi('domains/income/income-client-document-management-panel.service.ts');
  const tab = readApi('domains/work-engine/work-engine-invoices-tab.read-model.service.ts');
  const workspace = readApi('domains/income/income-workspace-aggregate.service.ts');

  for (const src of [byType, panel, tab, workspace]) {
    assert.ok(src.includes(".not('user_saved_at', 'is', null)"));
  }
  assert.ok(workspace.includes('countUserSavedDrafts'));
  assert.ok(!workspace.includes("countScoped('income_document_drafts', scope, { column: 'status', value: 'draft' })"));
});

test('cycle draft review still loads draft by id without user_saved_at filter', () => {
  const review = readApi(
    'domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts',
  );
  assert.ok(review.includes(".from('income_document_drafts')"));
  assert.ok(!review.includes(".not('user_saved_at', 'is', null)"));
});

test('save with recurring_cycle_review returns full refreshed case including drafts list aggregates', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  const start = commands.indexOf('if (command === INCOME_COMMAND_SAVE_DRAFT)');
  const end = commands.indexOf('if (command === INCOME_COMMAND_GENERATE_PREVIEW)', start);
  const block = commands.slice(start, end);
  assert.ok(block.includes('work_engine_recurring_cycle_draft_review_aggregate'));
  assert.ok(block.includes('work_engine_invoice_retainer_setup_aggregate'));
  assert.ok(block.includes('work_engine_invoices_tab_aggregate'));
  assert.ok(block.includes('work_engine_invoices_client_documents_by_type_aggregate'));
  assert.ok(block.includes('includeDraftListAggregates: true'));
});

test('normal review Save (generate_preview + review) does not stamp user_saved_at path', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  const start = commands.indexOf('if (command === INCOME_COMMAND_GENERATE_PREVIEW)');
  assert.ok(start >= 0, 'GENERATE_PREVIEW handler missing');
  const end = commands.indexOf('if (command === INCOME_COMMAND_UPDATE_DISCOUNT)', start);
  assert.ok(end > start);
  const block = commands.slice(start, end);
  assert.ok(block.includes('generateIncomeDocumentPreview'));
  assert.ok(block.includes('includeDraftListAggregates: false'));
  assert.ok(!block.includes('saveIncomeDocumentDraft'));
  assert.ok(!block.includes('savePatch.user_saved_at'));

  const editor = readApi('domains/income/income-document-draft-editor.service.ts');
  const previewStart = editor.indexOf('export async function generateIncomeDocumentPreview');
  const previewBlock = editor.slice(previewStart, previewStart + 1200);
  assert.ok(!previewBlock.includes('user_saved_at'));
});

test('wizard draft mutations resolve trusted office/recurring issuer before active scope assert', () => {
  const commands = readApi('domains/income/income-commands.service.ts');
  assert.ok(commands.includes('resolveIncomeWizardMutationIssuerScope'));
  assert.ok(commands.includes('resolveAndApplyRecurringCycleIssueIssuerScope'));
  assert.ok(commands.includes('resolveAndApplyIssuerScopeFromTrustedOfficeDraftIfNeeded'));
  const wizardCmdStart = commands.indexOf('const wizardDraftCmd = async');
  const wizardCmdBlock = commands.slice(wizardCmdStart, wizardCmdStart + 500);
  assert.ok(wizardCmdBlock.includes('resolveIncomeWizardMutationIssuerScope'));
  assert.ok(!wizardCmdBlock.includes('loadActiveIncomeIssuerScope(ctx)'));
});

test('request-loop fix: by-type modal stable deps, abort, close not blocked by busy', () => {
  const modal = readWeb('components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx');
  const tabHost = readWeb('components/work-engine/WorkEngineTabHost.tsx');
  const api = readWeb('api/work-engine.ts');

  assert.ok(modal.includes('onBusyChangeRef'));
  assert.ok(modal.includes('onErrorRef'));
  assert.ok(modal.includes('cancelWorkEngineInvoicesClientDocumentsByTypeAggregateFetch'));
  assert.ok(!modal.includes('[onBusyChange, onError, params]'));
  assert.ok(!modal.includes('[loadAggregate, open, params]'));
  assert.match(
    modal,
    /\[\s*open,\s*representedClientId,\s*documentTypeKey,\s*selectedYearForFetch,\s*refreshNonce,\s*\]/,
  );
  assert.ok(modal.includes('<button type="button" className="nx-btn nx-btn-taxes-compact" onClick={onClose}>'));
  assert.ok(!modal.includes('disabled={busy || loading} onClick={onClose}'));

  assert.ok(tabHost.includes('onError={handlePanelError}'));
  assert.ok(api.includes('inFlightInvoicesClientDocumentsByTypeFetches'));
});
