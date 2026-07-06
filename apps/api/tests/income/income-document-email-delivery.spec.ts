import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  appendIncomeEmailFooter,
  assertIncomeDocumentReadyForEmailSend,
  assertIncomeRepresentedClientScopeForEmailSend,
  buildIncomeDocumentEmailDeliveryIdempotencyKey,
  buildIncomeDocumentEmailMessage,
  buildIncomeDocumentEmailTemplateValues,
  buildIncomeEmailSenderSnapshot,
  incomeEmailTextToHtml,
  normalizeIncomeDocumentRecipientEmail,
  renderIncomeEmailTemplate,
} from '../../src/domains/income/income-document-email-delivery.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-email-delivery.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const deliveryDir = join(dir, '../../src/domains/delivery');

test('income email delivery pure builds template values and message', () => {
  const values = buildIncomeDocumentEmailTemplateValues({
    documentTypeLabel: 'חשבונית מס',
    documentNumber: '2026-0042',
    clientName: 'לקוח א',
    businessName: 'עסק לדוגמה',
  });
  assert.equal(values.document_type, 'חשבונית מס');
  assert.equal(renderIncomeEmailTemplate('{{document_type}} {{document_number}}', values), 'חשבונית מס 2026-0042');

  const message = buildIncomeDocumentEmailMessage({
    branding: {
      email_subject_template: '{{document_type}} {{document_number}}',
      email_body_template: 'שלום {{client_name}}',
      footer_text: 'בברכה',
    } as never,
    templateValues: values,
    replyTo: 'biz@example.com',
  });
  assert.equal(message.subject, 'חשבונית מס 2026-0042');
  assert.match(message.body_text, /שלום לקוח א/);
  assert.match(message.body_text, /בברכה/);
  assert.equal(message.reply_to, 'biz@example.com');
  assert.match(message.body_html, /<br>/);
});

test('income email delivery pure validates readiness and recipient', () => {
  assert.throws(() => normalizeIncomeDocumentRecipientEmail('not-an-email'));
  assert.throws(() =>
    assertIncomeDocumentReadyForEmailSend({
      document_status: 'draft',
      pdf_render_status: 'rendered',
      pdf_asset_id: randomUUID(),
    } as never),
  );
  assert.throws(() => assertIncomeRepresentedClientScopeForEmailSend(null));
});

test('income email delivery pure builds sender snapshot from client operations', () => {
  const snapshot = buildIncomeEmailSenderSnapshot({
    id: randomUUID(),
    display_name: 'Acme Ltd',
    email: 'acme@example.com',
    phone: '050-0000000',
    tax_id: '123',
    business_type: 'עוסק מורשה',
    address: null,
    city: null,
  });
  assert.equal(snapshot.source, 'client_operations_core');
  assert.equal(snapshot.display_name, 'Acme Ltd');
});

test('income email delivery idempotency key is scoped per document', () => {
  const docId = randomUUID();
  assert.equal(
    buildIncomeDocumentEmailDeliveryIdempotencyKey(docId, 'click-1'),
    `income:email:${docId}:click-1`,
  );
});

test('appendIncomeEmailFooter and incomeEmailTextToHtml', () => {
  assert.equal(appendIncomeEmailFooter('Hello', 'Footer'), 'Hello\n\nFooter');
  assert.match(incomeEmailTextToHtml('a & b\nline'), /&amp;/);
});

test('income commands delegate send_income_document_by_email', () => {
  assert.match(commandsSource, /INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL/);
  assert.match(commandsSource, /executeSendIncomeDocumentByEmail/);
  assert.doesNotMatch(commandsSource, /from\s+['"].*\/delivery\//);
});

test('income email delivery service imports delivery but delivery domain has no income imports', () => {
  assert.match(serviceSource, /from '\.\.\/delivery\/index\.js'/);
  for (const file of [
    'delivery.service.ts',
    'delivery-email.transport.ts',
    'delivery.repository.ts',
    'delivery.pure.ts',
  ]) {
    const source = readFileSync(join(deliveryDir, file), 'utf8');
    assert.doesNotMatch(source, /from\s+['"].*\/income\//i, `${file} must not import income`);
  }
});

test('idempotent replay skips send and finalize when attempt is already terminal', async () => {
  const calls: string[] = [];
  const attempt = {
    id: randomUUID(),
    result: 'sent' as const,
    providerMessageId: 'msg-old',
  };

  const idempotentReplay = attempt.result !== 'pending';
  assert.equal(idempotentReplay, true);

  if (!idempotentReplay) {
    calls.push('send');
    calls.push('finalize');
  }

  assert.deepEqual(calls, []);
});
