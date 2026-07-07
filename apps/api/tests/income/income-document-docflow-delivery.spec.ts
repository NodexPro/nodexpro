import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assertIncomeDocumentReadyForDocflowSend,
  assertIncomeRepresentedClientScopeForDocflowSend,
  buildIncomeDocumentDocflowDeliveryIdempotencyKey,
  buildIncomeDocumentDocflowMessageSnapshot,
  incomeDocflowDeliveryAttemptCountLabel,
  parseIncomeDocumentDocflowIdempotencyKey,
  resolveIncomeDocumentDocflowSendEligibility,
} from '../../src/domains/income/income-document-docflow-delivery.pure.js';
import {
  buildIncomeDocumentDocflowDeliveryBlock,
} from '../../src/domains/income/income-document-docflow-delivery.read-model.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-docflow-delivery.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const routesSource = readFileSync(join(dir, '../../src/domains/income/income.routes.ts'), 'utf8');
const workspaceSource = readFileSync(
  join(dir, '../../src/domains/income/income-workspace-aggregate.service.ts'),
  'utf8',
);
const weDocsSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
  ),
  'utf8',
);
const deliveryDir = join(dir, '../../src/domains/delivery');
const bridgeSource = readFileSync(
  join(dir, '../../src/domains/income/income-work-engine-bridge.ts'),
  'utf8',
);

const officePerms = {
  view: true,
  edit: true,
  issue: true,
  issue_on_behalf: true,
};

test('docflow delivery pure validates readiness and idempotency', () => {
  const docId = randomUUID();
  assert.throws(() => parseIncomeDocumentDocflowIdempotencyKey({}));
  assert.throws(() =>
    assertIncomeDocumentReadyForDocflowSend({
      document_status: 'draft',
      pdf_render_status: 'rendered',
      pdf_asset_id: randomUUID(),
    } as never),
  );
  assert.throws(() => assertIncomeRepresentedClientScopeForDocflowSend(null));
  assert.equal(
    buildIncomeDocumentDocflowDeliveryIdempotencyKey(docId, 'click-1'),
    `income:docflow:${docId}:click-1`,
  );
});

test('docflow send eligibility requires entitlement and active portal', () => {
  const enabled = resolveIncomeDocumentDocflowSendEligibility({
    permissions: officePerms,
    representedClientId: randomUUID(),
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: randomUUID(),
    docflowEntitled: true,
    portalActive: true,
  });
  assert.equal(enabled.enabled, true);

  const noPortal = resolveIncomeDocumentDocflowSendEligibility({
    permissions: officePerms,
    representedClientId: randomUUID(),
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: randomUUID(),
    docflowEntitled: true,
    portalActive: false,
  });
  assert.equal(noPortal.enabled, false);
  assert.match(String(noPortal.disabled_reason), /פורטל/);
});

test('docflow delivery block exposes status and docflow action', () => {
  const block = buildIncomeDocumentDocflowDeliveryBlock({
    incomeDocumentId: randomUUID(),
    attemptCount: 1,
    permissions: officePerms,
    representedClientId: randomUUID(),
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: randomUUID(),
    docflowEntitled: true,
    portalActive: true,
  });
  assert.equal(block.status_label, incomeDocflowDeliveryAttemptCountLabel(1));
  assert.equal(block.action.icon_key, 'docflow');
  assert.equal(block.action.key, 'open_docflow_send');
  assert.equal(block.send_enabled, true);
});

test('docflow message snapshot includes body preview fields', () => {
  const snapshot = buildIncomeDocumentDocflowMessageSnapshot({
    documentTypeLabel: 'חשבונית מס',
    documentNumber: '2026-0001',
    clientDisplayName: 'לקוח',
    businessName: 'עסק',
  });
  assert.match(String(snapshot.body), /חשבונית מס/);
  assert.equal(snapshot.channel, 'docflow');
});

test('income commands delegate send_income_document_by_docflow', () => {
  assert.match(commandsSource, /INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW/);
  assert.match(commandsSource, /executeSendIncomeDocumentByDocflow/);
});

test('income routes expose document-docflow-send aggregate', () => {
  assert.match(routesSource, /document-docflow-send/);
  assert.match(routesSource, /buildIncomeDocumentDocflowSendAggregate/);
});

test('workspace and work engine issued rows include docflow_delivery block', () => {
  assert.match(workspaceSource, /docflow_delivery/);
  assert.match(workspaceSource, /loadDocflowAttemptCountsByDocumentIds/);
  assert.match(weDocsSource, /docflow_delivery/);
  assert.match(weDocsSource, /buildIncomeDocumentDocflowDeliveryBlock/);
});

test('docflow delivery service uses delivery ledger without delivery importing income', () => {
  assert.match(serviceSource, /from '\.\.\/delivery\/index\.js'/);
  assert.match(serviceSource, /channel: 'docflow'/);
  assert.match(serviceSource, /docflowThreadId/);
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

test('work engine bridge emits income.document_sent_by_docflow fact only', () => {
  assert.match(bridgeSource, /INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW/);
  assert.match(bridgeSource, /emitIncomeWorkEventAfterDocumentSentByDocflow/);
  assert.match(bridgeSource, /intakeWorkEvent/);
});
