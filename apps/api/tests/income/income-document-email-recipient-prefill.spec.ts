/**
 * P0 — Issued invoice email recipient = invoice customer, not represented issuer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  resolveCustomerSnapshotEmail,
  resolveIssuedDocumentEmailRecipientPrefill,
} from '../../src/domains/income/income-document-email-recipient-prefill.pure.js';
import { buildIncomeDocumentEmailSendForm } from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';
import { randomUUID } from 'node:crypto';

const dir = dirname(fileURLToPath(import.meta.url));
const historyServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-email-history.service.ts'),
  'utf8',
);
const docflowServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-docflow-delivery.service.ts'),
  'utf8',
);
const docflowPureSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-docflow-delivery.pure.ts'),
  'utf8',
);
const emailModalSource = readFileSync(
  join(dir, '../../../web/src/components/income/IncomeDocumentEmailHistoryModal.tsx'),
  'utf8',
);

test('A/B office mode: Unilever customer email wins; Test3 represented email unused', () => {
  const recipient = resolveIssuedDocumentEmailRecipientPrefill({
    draftDeliveryContactJson: null,
    incomeCustomerEmail: 'marinator02@walla.com',
    customerSnapshotJson: {
      source: 'income_customer',
      display_name: 'Unilever',
      email: 'marinator02@walla.com',
    },
  });
  assert.equal(recipient, 'marinator02@walla.com');
  // Document history uses invoice-customer resolver, not Core issuer client email.
  assert.match(
    historyServiceSource,
    /recipientEmailDefault = await resolveDocumentRecipientEmailDefault/,
  );
  assert.doesNotMatch(
    historyServiceSource,
    /doc\.represented_client_id[\s\S]{0,120}loadRepresentedClient/,
  );
});

test('B represented client email differs — never selected as recipient', () => {
  const recipient = resolveIssuedDocumentEmailRecipientPrefill({
    draftDeliveryContactJson: null,
    incomeCustomerEmail: 'customer@unilever.example',
    customerSnapshotJson: { email: 'customer@unilever.example' },
  });
  assert.equal(recipient, 'customer@unilever.example');
  assert.notEqual(recipient, 'test3-office@example.com');
});

test('C normal income customer → customer email', () => {
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      draftDeliveryContactJson: null,
      incomeCustomerEmail: 'saved-customer@example.com',
      customerSnapshotJson: { email: 'stale-snapshot@example.com' },
    }),
    'saved-customer@example.com',
  );
});

test('D one-time customer → delivery/snapshot email without Core client', () => {
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      draftDeliveryContactJson: null,
      incomeCustomerEmail: null,
      customerSnapshotJson: {
        source: 'one_time_snapshot',
        display_name: 'Walk-in',
        email: 'onetime@example.com',
      },
    }),
    'onetime@example.com',
  );
  assert.equal(
    resolveCustomerSnapshotEmail({
      source: 'one_time_snapshot',
      email: 'onetime@example.com',
    }),
    'onetime@example.com',
  );
});

test('explicit draft delivery_contact overrides live customer email', () => {
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      draftDeliveryContactJson: { email: 'override@delivery.example' },
      incomeCustomerEmail: 'canonical@customer.example',
      customerSnapshotJson: { email: 'frozen@snapshot.example' },
    }),
    'override@delivery.example',
  );
});

test('E self mode: invoice customer email (issuer != customer)', () => {
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      draftDeliveryContactJson: null,
      incomeCustomerEmail: 'buyer@selfmode.example',
      customerSnapshotJson: {
        display_name: 'Buyer Ltd',
        email: 'buyer@selfmode.example',
      },
    }),
    'buyer@selfmode.example',
  );
});

test('F customer email absent → empty recipient; form still editable field', () => {
  const recipient = resolveIssuedDocumentEmailRecipientPrefill({
    draftDeliveryContactJson: null,
    incomeCustomerEmail: null,
    customerSnapshotJson: { display_name: 'No Email Co', email: null },
  });
  assert.equal(recipient, null);
  const form = buildIncomeDocumentEmailSendForm({
    incomeDocumentId: randomUUID(),
    sendEligibility: {
      enabled: true,
      disabled_reason: null,
      disabled_reason_key: null,
    },
    recipientEmailDefault: recipient,
  });
  assert.equal(form.fields[0]?.default_value, null);
  assert.equal(form.fields[0]?.key, 'recipient_email');
  assert.equal(form.enabled, true);
});

test('G no FE client/customer lookup for recipient', () => {
  assert.doesNotMatch(emailModalSource, /\/clients/);
  assert.doesNotMatch(emailModalSource, /fetchClient|loadClient|income_customers/);
  assert.match(emailModalSource, /recipient_email_default/);
  assert.match(historyServiceSource, /resolveIssuedDocumentEmailRecipientPrefill/);
  assert.match(historyServiceSource, /income_customer_id/);
  assert.match(historyServiceSource, /customer_snapshot_json/);
  assert.match(historyServiceSource, /delivery_contact_json/);
});

test('H DocFlow policy unchanged — represented-client portal channel', () => {
  assert.match(docflowServiceSource, /assertIncomeRepresentedClientScopeForDocflowSend/);
  assert.match(docflowServiceSource, /recipientEmail:\s*null/);
  assert.match(docflowServiceSource, /loadPortalActive/);
  assert.match(docflowPureSource, /DocFlow delivery requires an active represented client scope/);
  assert.doesNotMatch(docflowServiceSource, /resolveIssuedDocumentEmailRecipientPrefill/);
  assert.doesNotMatch(docflowServiceSource, /income_customers/);
});

test('history aggregate no longer prefill from Core clients.email for document send', () => {
  assert.doesNotMatch(
    historyServiceSource,
    /recipientEmailDefault[\s\S]{0,200}loadRepresentedClient/,
  );
  assert.match(historyServiceSource, /loadIncomeRecipientById/);
  assert.match(historyServiceSource, /resolveIssuedDocumentEmailRecipientPrefill/);
});
