import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCycleDraftReviewIssueAndSendAction,
  buildTaxInvoiceIssueAndSendConfirmationMessage,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review-actions.pure.js';
import { resolveDraftDeliveryContactEmail } from '../../src/domains/income/income-document-issue-and-send.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

function readWebSource(relativePath: string): string {
  return readFileSync(join(dir, '../../../web/src', relativePath), 'utf8');
}

test('issue_and_send action enables when backend orchestration prerequisites are met', () => {
  const action = buildCycleDraftReviewIssueAndSendAction({
    document_type: 'tax_invoice',
    issue_action_visible: true,
    can_issue_and_send: true,
    issue_and_send_blocked_reason: null,
    document_date: '2026-07-08',
    already_issued: false,
    issued_document_number_display: null,
    recipient_email: 'client@example.com',
  });
  assert.equal(action.enabled, true);
  assert.equal(action.command_name, 'issue_and_send_income_document');
  assert.equal(action.confirmation_required, true);
});

test('issue_and_send disabled without delivery email on draft', () => {
  const action = buildCycleDraftReviewIssueAndSendAction({
    document_type: 'deal_invoice',
    issue_action_visible: true,
    can_issue_and_send: false,
    issue_and_send_blocked_reason: 'נדרש אימייל למשלוח במסמך',
    document_date: '2026-07-08',
    already_issued: false,
    issued_document_number_display: null,
    recipient_email: null,
  });
  assert.equal(action.enabled, false);
  assert.equal(action.disabled_reason, 'נדרש אימייל למשלוח במסמך');
});

test('tax invoice issue and send confirmation includes month and email from backend', () => {
  const message = buildTaxInvoiceIssueAndSendConfirmationMessage('יולי 2026', 'client@example.com');
  assert.match(message, /חשבונית מס זו תופק ותירשם כהכנסה לחודש יולי 2026/);
  assert.match(message, /client@example.com/);
});

test('resolveDraftDeliveryContactEmail normalizes draft snapshot email', () => {
  assert.equal(
    resolveDraftDeliveryContactEmail({ email: 'Client@Example.com' }),
    'client@example.com',
  );
});

test('issue_and_send command orchestrates issue then send without frontend chaining', () => {
  const orchestratorSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-issue-and-send.service.ts'),
    'utf8',
  );
  const commandsSource = readFileSync(
    join(dir, '../../src/domains/income/income-commands.service.ts'),
    'utf8',
  );
  assert.ok(orchestratorSource.includes('executeIssueIncomeDocument'));
  assert.ok(orchestratorSource.includes('executeSendIncomeDocumentByEmail'));
  assert.ok(orchestratorSource.includes('beginIncomeIssueAndSendIdempotency'));
  assert.ok(orchestratorSource.includes('AUDIT_ACTIONS.INCOME_DOCUMENT_ISSUE_AND_SEND'));
  assert.ok(commandsSource.includes('INCOME_COMMAND_ISSUE_AND_SEND_DOCUMENT'));
  assert.ok(commandsSource.includes('refreshRecurringCycleDraftReviewCase'));
});

test('frontend issue and send uses single named command only', () => {
  const setupModalSource = readWebSource('components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx');
  const handlerStart = setupModalSource.indexOf('const runCycleDraftIssueAndSend');
  const handlerEnd = setupModalSource.indexOf('const applyRetainerAggregate', handlerStart);
  const handlerBlock = setupModalSource.slice(handlerStart, handlerEnd);
  assert.ok(handlerBlock.includes('issue_and_send_document'));
  assert.ok(handlerBlock.includes('idempotency_key: crypto.randomUUID()'));
  assert.ok(!handlerBlock.includes('issue_document'));
  assert.ok(!handlerBlock.includes('fetchWorkEngineInvoiceRetainerSetupAggregate'));
});
