/**
 * P0 — Issued invoice email recipient = CURRENT invoice customer contact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  resolveIssuedDocumentEmailRecipientPrefill,
} from '../../src/domains/income/income-document-email-recipient-prefill.pure.js';
import { buildIncomeDocumentEmailSendForm } from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const historyServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-email-history.service.ts'),
  'utf8',
);
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
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
const weDocsSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx'),
  'utf8',
);

const unileverId = randomUUID();

test('H saved customer email changed after issue → CURRENT live email', () => {
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      incomeCustomerId: unileverId,
      draftDeliveryContactJson: { email: 'old-seeded@example.com', snapshot_only: true },
      incomeCustomerEmail: 'marinator02@walla.com',
      customerSnapshotJson: { email: 'old-frozen@example.com', display_name: 'Unilever' },
    }),
    'marinator02@walla.com',
  );
});

test('I stale auto-seeded delivery_contact loses to live customer email', () => {
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      incomeCustomerId: unileverId,
      draftDeliveryContactJson: { email: 'stale-autoseed@old.com', snapshot_only: true },
      incomeCustomerEmail: 'current@unilever.example',
      customerSnapshotJson: { email: 'stale-autoseed@old.com' },
    }),
    'current@unilever.example',
  );
});

test('J no canonical explicit-override flag — delivery_contact cannot beat live email', () => {
  // Both auto-seed create and update_delivery_contact set snapshot_only:true identically.
  assert.match(draftEditorSource, /snapshot_only:\s*true/);
  assert.match(draftEditorSource, /action: 'update_delivery_contact'/);
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      incomeCustomerId: unileverId,
      draftDeliveryContactJson: {
        email: 'manual-looking@example.com',
        snapshot_only: true,
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      incomeCustomerEmail: 'live-card@example.com',
      customerSnapshotJson: { email: 'frozen@example.com' },
    }),
    'live-card@example.com',
  );
});

test('K one-time customer → delivery/snapshot email without live customer row', () => {
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      incomeCustomerId: null,
      draftDeliveryContactJson: { email: 'onetime-delivery@example.com' },
      incomeCustomerEmail: null,
      customerSnapshotJson: {
        source: 'one_time_snapshot',
        email: 'onetime-snap@example.com',
      },
    }),
    'onetime-delivery@example.com',
  );
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      incomeCustomerId: null,
      draftDeliveryContactJson: null,
      incomeCustomerEmail: null,
      customerSnapshotJson: { email: 'onetime-snap@example.com' },
    }),
    'onetime-snap@example.com',
  );
});

test('L issuer/represented-client email never used as Email recipient', () => {
  assert.match(historyServiceSource, /resolveIssuedDocumentEmailRecipientPrefill/);
  assert.doesNotMatch(
    historyServiceSource,
    /recipientEmailDefault = await resolveDocumentRecipientEmailDefault[\s\S]{0,40}loadRepresentedClient/,
  );
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      incomeCustomerId: unileverId,
      draftDeliveryContactJson: null,
      incomeCustomerEmail: 'customer@example.com',
      customerSnapshotJson: { email: 'customer@example.com' },
    }),
    'customer@example.com',
  );
});

test('C live customer email absent → snapshot fallback', () => {
  assert.equal(
    resolveIssuedDocumentEmailRecipientPrefill({
      incomeCustomerId: unileverId,
      draftDeliveryContactJson: { email: 'stale-delivery@example.com' },
      incomeCustomerEmail: null,
      customerSnapshotJson: { email: 'snapshot-fallback@example.com' },
    }),
    'snapshot-fallback@example.com',
  );
});

test('F empty when no email anywhere — editable field remains', () => {
  const recipient = resolveIssuedDocumentEmailRecipientPrefill({
    incomeCustomerId: unileverId,
    draftDeliveryContactJson: null,
    incomeCustomerEmail: null,
    customerSnapshotJson: { display_name: 'Unilever' },
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
  assert.equal(form.enabled, true);
});

test('N no FE /customers or /clients lookup', () => {
  assert.doesNotMatch(emailModalSource, /\/clients/);
  assert.doesNotMatch(emailModalSource, /\/customers/);
  assert.doesNotMatch(emailModalSource, /fetchClient|loadClient|income_customers/);
  assert.match(emailModalSource, /recipient_email_default/);
});

test('H DocFlow policy unchanged', () => {
  assert.match(docflowServiceSource, /assertIncomeRepresentedClientScopeForDocflowSend/);
  assert.match(docflowServiceSource, /recipientEmail:\s*null/);
  assert.match(docflowPureSource, /DocFlow delivery requires an active represented client scope/);
  assert.doesNotMatch(docflowServiceSource, /resolveIssuedDocumentEmailRecipientPrefill/);
});

test('VIEW retry-then-open uses command workspace row — no documents-by-type GET', () => {
  assert.match(weDocsSource, /issued_documents_table_model/);
  assert.match(weDocsSource, /applyIssuedViewFromWorkspaceRow/);
  assert.match(weDocsSource, /openIncomeDocumentPdf/);
  const viewFnStart = weDocsSource.indexOf('const handleViewDocument');
  const viewFnEnd = weDocsSource.indexOf('const handleEditDraft');
  assert.ok(viewFnStart >= 0 && viewFnEnd > viewFnStart);
  const viewFn = weDocsSource.slice(viewFnStart, viewFnEnd);
  assert.match(viewFn, /executeIncomeCommand/);
  assert.doesNotMatch(viewFn, /fetchWorkEngineInvoicesClientDocumentsByTypeAggregate/);
});
