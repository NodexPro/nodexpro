import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIncomeDocumentEmailDeliveryBlock,
  incomeEmailDeliveryAttemptCountLabel,
  resolveIncomeDocumentEmailSendEligibility,
} from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(join(dir, '../../src/domains/income/income.routes.ts'), 'utf8');
const workspaceSource = readFileSync(
  join(dir, '../../src/domains/income/income-workspace-aggregate.service.ts'),
  'utf8',
);
const panelSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);
const weDocsSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
  ),
  'utf8',
);
const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');

const officePerms = {
  view: true,
  edit: true,
  issue: true,
  issue_on_behalf: true,
};

test('email delivery block exposes attempt count, labels, and @ action', () => {
  const block = buildIncomeDocumentEmailDeliveryBlock({
    incomeDocumentId: 'a1111111-1111-4111-8111-111111111111',
    attemptCount: 2,
    permissions: officePerms,
    representedClientId: 'b2222222-2222-4222-8222-222222222222',
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: 'c3333333-3333-4333-8333-333333333333',
  });
  assert.equal(block.attempt_count, 2);
  assert.equal(block.status_label, incomeEmailDeliveryAttemptCountLabel(2));
  assert.equal(block.action.icon_key, 'at');
  assert.equal(block.action.enabled, true);
  assert.equal(block.send_enabled, true);
});

test('email send eligibility disabled in self mode', () => {
  const result = resolveIncomeDocumentEmailSendEligibility({
    permissions: officePerms,
    representedClientId: null,
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: 'c3333333-3333-4333-8333-333333333333',
  });
  assert.equal(result.enabled, false);
  assert.match(String(result.disabled_reason), /ניהול לקוח/);
});

test('income routes expose email history aggregates', () => {
  assert.match(routesSource, /document-email-history/);
  assert.match(routesSource, /represented-client-email-history/);
  assert.match(routesSource, /buildIncomeDocumentEmailHistoryAggregate/);
  assert.match(routesSource, /buildIncomeRepresentedClientEmailHistoryAggregate/);
});

test('workspace issued rows include email_delivery block', () => {
  assert.match(workspaceSource, /email_delivery/);
  assert.match(workspaceSource, /loadEmailAttemptCountsByDocumentIds/);
  assert.match(workspaceSource, /buildIncomeDocumentEmailDeliveryBlock/);
});

test('client management panel includes @ email history action', () => {
  assert.match(panelSource, /open_email_history/);
  assert.match(panelSource, /icon_key: 'at'/);
  assert.match(panelSource, /INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY/);
});

test('work engine documents-by-type rows include email_delivery for issued docs', () => {
  assert.match(weDocsSource, /email_delivery/);
  assert.match(weDocsSource, /buildIncomeDocumentEmailDeliveryBlock/);
  assert.match(weDocsSource, /loadEmailAttemptCountsByDocumentIds/);
});

test('types define email history aggregates and delivery block', () => {
  assert.match(typesSource, /income_document_email_history_aggregate/);
  assert.match(typesSource, /income_represented_client_email_history_aggregate/);
  assert.match(typesSource, /IncomeDocumentEmailDeliveryBlock/);
  assert.match(typesSource, /email_delivery: IncomeDocumentEmailDeliveryBlock/);
});
