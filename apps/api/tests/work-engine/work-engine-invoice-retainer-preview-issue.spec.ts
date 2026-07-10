import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCycleDraftReviewIssueAction,
  buildCycleDraftReviewIssueAndSendAction,
  buildTaxInvoiceIssueConfirmationMessage,
  ISSUE_AND_SEND_DISABLED_REASON_HE,
  RETAINER_PREVIEW_ISSUE_DOCUMENT_TYPES,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review-actions.pure.js';
import { resolveCycleDraftPreviewIssueIcon } from '../../../web/src/components/work-engine/work-engine-invoice-retainer-preview-header-actions.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

function readWebSource(relativePath: string): string {
  return readFileSync(join(dir, '../../../web/src', relativePath), 'utf8');
}

test('issue actions are limited to tax_invoice, deal_invoice, quote', () => {
  assert.deepEqual([...RETAINER_PREVIEW_ISSUE_DOCUMENT_TYPES].sort(), [
    'deal_invoice',
    'quote',
    'tax_invoice',
  ]);
  const receipt = buildCycleDraftReviewIssueAction({
    document_type: 'receipt',
    can_issue: true,
    issue_blocked_reason: null,
    document_date: '2026-07-01',
    already_issued: false,
    issued_document_number_display: null,
  });
  assert.equal(receipt.visible, false);
});

test('tax invoice confirmation text comes from backend builder', () => {
  const message = buildTaxInvoiceIssueConfirmationMessage('יולי 2026');
  assert.match(message, /חשבונית מס זו תופק ותירשם כהכנסה לחודש יולי 2026/);
  const action = buildCycleDraftReviewIssueAction({
    document_type: 'tax_invoice',
    can_issue: true,
    issue_blocked_reason: null,
    document_date: '2026-07-08',
    already_issued: false,
    issued_document_number_display: null,
  });
  assert.equal(action.confirmation_required, true);
  assert.equal(action.command_name, 'issue_income_document');
  assert.match(action.confirmation_message ?? '', /להמשיך\?/);
});

test('issue_and_send is disabled until delivery chaining exists', () => {
  const action = buildCycleDraftReviewIssueAndSendAction({
    document_type: 'tax_invoice',
    issue_action_visible: true,
  });
  assert.equal(action.visible, true);
  assert.equal(action.enabled, false);
  assert.equal(action.disabled_reason, ISSUE_AND_SEND_DISABLED_REASON_HE);
  assert.equal(action.command_name, 'send_income_document_by_email');
});

test('frontend issue icon renders from backend descriptor only', () => {
  const model = resolveCycleDraftPreviewIssueIcon({
    issue_action: {
      visible: true,
      enabled: true,
      disabled_reason: null,
      icon: 'issue',
      tooltip: 'הפקת חשבונית מס',
      confirmation_required: true,
      confirmation_title: 'אישור',
      confirmation_message: 'להמשיך?',
      command_name: 'issue_income_document',
    },
    has_on_issue_handler: true,
  });
  assert.equal(model.render, true);
  assert.equal(model.disabled, false);
  assert.equal(model.confirmation_required, true);
  assert.equal(model.command_name, 'issue_income_document');
});

test('cycle draft issue command returns refreshed review aggregate without setup reload', () => {
  const incomeCommandsSource = readFileSync(
    join(dir, '../../src/domains/income/income-commands.service.ts'),
    'utf8',
  );
  assert.ok(incomeCommandsSource.includes('parseRecurringCycleReviewCommandContext'));
  assert.ok(incomeCommandsSource.includes('refreshRecurringCycleDraftReviewCase'));
  assert.ok(incomeCommandsSource.includes('work_engine_recurring_cycle_draft_review_aggregate'));

  const setupModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
  const issueHandlerStart = setupModalSource.indexOf('const runCycleDraftIssue');
  const issueHandlerEnd = setupModalSource.indexOf('const handleCycleDraftIssueRequest', issueHandlerStart);
  const issueHandlerBlock = setupModalSource.slice(issueHandlerStart, issueHandlerEnd);
  assert.ok(issueHandlerBlock.includes('recurring_cycle_review'));
  assert.ok(issueHandlerBlock.includes('work_engine_recurring_cycle_draft_review_aggregate'));
  assert.ok(!issueHandlerBlock.includes('fetchWorkEngineInvoiceRetainerSetupAggregate'));
});

test('preview modal renders issue icons from aggregate descriptors', () => {
  const previewModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerPreviewModal.tsx');
  assert.ok(previewModalSource.includes('resolveCycleDraftPreviewIssueIcon'));
  assert.ok(previewModalSource.includes('resolveCycleDraftPreviewIssueAndSendIcon'));
  assert.ok(previewModalSource.includes('data-testid={issueButton.test_id}'));
  assert.ok(previewModalSource.includes('data-testid={issueAndSendButton.test_id}'));
  assert.ok(previewModalSource.includes('nx-we-retainer-preview-modal__head-icon-rail'));
  assert.ok(!previewModalSource.includes('הפקת מסמך'));
});

test('cycle draft review service exposes issue_action descriptors', () => {
  const cycleReviewServiceSource = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts'),
    'utf8',
  );
  assert.ok(cycleReviewServiceSource.includes('issue_action:'));
  assert.ok(cycleReviewServiceSource.includes('issue_and_send_action:'));
  assert.ok(cycleReviewServiceSource.includes('buildCycleDraftReviewIssueAction'));
});
