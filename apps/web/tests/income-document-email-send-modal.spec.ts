import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const modal = readFileSync(
  join(dir, '../src/components/income/IncomeDocumentEmailHistoryModal.tsx'),
  'utf8',
);
const types = readFileSync(join(dir, '../src/income/income-workspace-types.ts'), 'utf8');

test('email send modal renders backend send_view and one שליחה button', () => {
  assert.match(modal, /send_view/);
  assert.match(modal, /sender_display_name/);
  assert.match(modal, /recipient_display_name/);
  assert.match(modal, /document_display/);
  assert.match(modal, /attachment_filename/);
  assert.match(modal, /attachment_ready/);
  assert.match(modal, /send_disabled_user_message/);
  assert.match(modal, /send_form\.command/);
  assert.match(modal, /income_document_email_history_aggregate/);
  assert.match(types, /IncomeDocumentEmailSendView/);
  assert.match(types, /income_document_email_history_aggregate\?: IncomeDocumentEmailHistoryAggregate/);
});

test('email send modal does not expose PDF internals or extra GET after send', () => {
  assert.doesNotMatch(modal, /נסה שוב להפיק PDF/);
  assert.doesNotMatch(modal, /pdf_send_readiness/);
  assert.doesNotMatch(modal, /retry_income_document_pdf_render/);
  assert.doesNotMatch(modal, /handleRetryPdf/);
  assert.doesNotMatch(modal, /await loadAggregate/);
  assert.match(modal, /isIncomeCommandResponse/);
  assert.match(modal, /onClose\(\)/);
});
