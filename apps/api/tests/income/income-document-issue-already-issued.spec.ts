import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildAlreadyIssuedIssueResult,
  buildFreshIssuedIssueResult,
  formatIssuedDateDisplayHe,
} from '../../src/domains/income/income-document-issue-result.pure.js';
import { buildCycleDraftReviewIssueAction } from '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review-actions.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const issueServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const cyclesSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycles.service.ts'),
  'utf8',
);
const reviewServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts'),
  'utf8',
);
const migration128 = readFileSync(
  join(dir, '../../../../supabase/migrations/128_income_issue_idempotency_hardening.sql'),
  'utf8',
);

test('already_issued Hebrew message and view_action are backend-prepared', () => {
  const result = buildAlreadyIssuedIssueResult({
    document_id: 'doc-1',
    document_number: '4000',
    document_type_key: 'tax_invoice',
    issued_date: '2026-06-23',
  });
  assert.equal(result.result_key, 'already_issued');
  assert.equal(result.document_type_label, 'חשבונית מס');
  assert.equal(formatIssuedDateDisplayHe('2026-06-23'), '23/06/2026');
  assert.match(result.message, /החשבונית כבר הופקה בתאריך 23\/06\/2026/);
  assert.match(result.message, /מספר החשבונית: 4000/);
  assert.match(result.message, /ניתן לצפות בה ברשימת החשבוניות/);
  assert.equal(result.view_action.action_key, 'view_document');
  assert.equal(result.view_action.enabled, true);
  assert.equal(result.view_action.label, 'צפייה בחשבונית');
  assert.equal(result.view_action.document_id, 'doc-1');
});

test('fresh issued result uses issued key and preserves number', () => {
  const result = buildFreshIssuedIssueResult({
    document_id: 'doc-2',
    document_number: '4001',
    document_type_key: 'tax_invoice',
    issued_date: '2026-07-01',
  });
  assert.equal(result.result_key, 'issued');
  assert.equal(result.document_number, '4001');
  assert.match(result.message, /4001/);
});

test('already issued disables issue action and enables view_document in aggregate wiring', () => {
  const issueAction = buildCycleDraftReviewIssueAction({
    document_type: 'tax_invoice',
    can_issue: true,
    issue_blocked_reason: null,
    document_date: '2026-07-01',
    already_issued: true,
    issued_document_number_display: '4000',
  });
  assert.equal(issueAction.enabled, false);
  assert.match(reviewServiceSource, /view_document_action/);
  assert.match(reviewServiceSource, /צפייה בחשבונית/);
  assert.match(reviewServiceSource, /\.\.\.\(issueAction\.enabled \? \['issue_income_document'\] : \[\]\)/);
  assert.match(reviewServiceSource, /\.\.\.\(viewDocumentAction\?\.enabled \? \['view_document'\] : \[\]\)/);
});

test('issue service detects existing document before numbering and recovers cycle link', () => {
  assert.match(issueServiceSource, /findIssuedDocumentBySourceDraft/);
  assert.match(issueServiceSource, /findRecurringCycleIssuedDocumentId/);
  assert.match(issueServiceSource, /buildAlreadyIssuedIssueResult/);
  assert.match(issueServiceSource, /ensureRecurringCycleLinked/);
  assert.match(issueServiceSource, /finishIdempotentIssue/);
  const executeStart = issueServiceSource.indexOf('export async function executeIssueIncomeDocument');
  const executeBody = issueServiceSource.slice(executeStart);
  const earlyExistingIdx = executeBody.indexOf('findIssuedDocumentBySourceDraft');
  const allocateInExecute = executeBody.indexOf('issueNewDocumentFromDraft');
  assert.ok(earlyExistingIdx > 0);
  assert.ok(allocateInExecute > earlyExistingIdx);
  assert.doesNotMatch(
    issueServiceSource.slice(
      issueServiceSource.indexOf('async function finishIdempotentIssue'),
      issueServiceSource.indexOf('export async function executeIssueIncomeDocument'),
    ),
    /\.catch\(\(\)\s*=>\s*undefined\)/,
  );
});

test('cycle link recovery uses draft and cycle id and does not swallow profile errors', () => {
  assert.match(cyclesSource, /findRecurringCycleIssuedDocumentId/);
  assert.match(cyclesSource, /cycleId\?:/);
  assert.match(cyclesSource, /throwIfSupabaseError\(profileErr/);
  assert.match(cyclesSource, /linked: boolean/);
});

test('issue command returns already_issued contract and full refreshed retainer case', () => {
  assert.match(commandsSource, /issue_result: issueResult\.issue_result/);
  assert.match(commandsSource, /work_engine_invoice_retainer_setup_aggregate/);
  assert.match(commandsSource, /work_engine_invoices_tab_aggregate/);
  assert.match(commandsSource, /work_engine_invoices_client_documents_by_type_aggregate/);
  assert.match(commandsSource, /buildWorkEngineInvoiceRetainerSetupAggregate/);
  assert.match(commandsSource, /idempotent_replay: issueResult\.idempotentReplay/);
});

test('unique source_draft constraint remains the DB idempotency guarantee', () => {
  assert.match(migration128, /uq_income_documents_org_source_draft/);
  assert.match(migration128, /organization_id,\s*source_draft_id/);
});

test('diagnostic issue_command_received logs before issuer scope load', () => {
  const receivedIdx = issueServiceSource.indexOf(
    "logIncomeIssueStage(diag, 'issue_command_received'",
  );
  const scopeIdx = issueServiceSource.indexOf('loadActiveIncomeIssuerScope(ctx)');
  assert.ok(receivedIdx > 0);
  assert.ok(scopeIdx > receivedIdx);
});

test('race unique violation returns already_issued path not a second posting', () => {
  assert.ok(issueServiceSource.includes('created: false'));
  assert.ok(issueServiceSource.includes('if (!issued.created)'));
  assert.ok(issueServiceSource.includes('if (!issuedInsert.created)'));
  assert.ok(issueServiceSource.includes('return finishIdempotentIssue'));
  const fnStart = issueServiceSource.indexOf('async function issueNewDocumentFromDraft');
  const fnBody = issueServiceSource.slice(fnStart);
  const createdFalseBlock = fnBody.indexOf('if (!issuedInsert.created)');
  const postingIdx = fnBody.indexOf('await applyAccountingPostingForIssuedDocument');
  assert.ok(createdFalseBlock > 0);
  assert.ok(postingIdx > createdFalseBlock);
});
