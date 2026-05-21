import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveEventMapping } from '../../src/domains/work-engine/work-engine.event-mapping.service.js';
const dir = dirname(fileURLToPath(import.meta.url));
const readModelsSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.read-models.service.ts'),
  'utf8',
);
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const bridgeSource = readFileSync(
  join(dir, '../../src/domains/income/income-work-engine-bridge.ts'),
  'utf8',
);
const invoicesTabSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-tab.read-model.service.ts'),
  'utf8',
);
const invoicesWizardSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-document-creation.builders.ts'),
  'utf8',
);
const schedulerSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.scheduler.service.ts'),
  'utf8',
);

test('income.invoice_overdue maps to invoice_collection_followup', () => {
  const mapped = resolveEventMapping({
    event_type: 'income.invoice_overdue',
    period_key: '2026-05',
  });
  assert.equal(mapped.resolved, true);
  if (!mapped.resolved) return;
  assert.equal(mapped.module_key, 'income');
  assert.equal(mapped.work_type, 'invoice_collection_followup');
  assert.equal(mapped.initial_state, 'waiting_client');
});

test('income.document_issued is not in allowlist (audit/context only)', () => {
  const mapped = resolveEventMapping({
    event_type: 'income.document_issued',
    period_key: '2026-05',
  });
  assert.equal(mapped.resolved, false);
});

test('work type label for collection follow-up is Hebrew', () => {
  assert.match(readModelsSource, /invoice_collection_followup[\s\S]*גבייה עבור חשבונית באיחור/);
});

test('invoices tab aggregate columns are Hebrew and include money_reference', () => {
  assert.match(invoicesTabSource, /label:\s*'לקוח'/);
  assert.match(invoicesTabSource, /label:\s*'סכום לתשלום'/);
  assert.match(invoicesTabSource, /type:\s*'money_reference'/);
  assert.match(invoicesTabSource, /label:\s*'סטטוס'/);
});

test('invoices tab summary is computed in read-model service', () => {
  assert.match(invoicesTabSource, /sum_paid_reference/);
  assert.match(invoicesTabSource, /avg_paid_reference/);
  assert.doesNotMatch(invoicesTabSource, /from\s+['"].*docflow/i);
});

test('issue service emits work events via bridge only (no direct work_items)', () => {
  assert.match(issueSource, /emitIncomeWorkEventsAfterDocumentIssued/);
  assert.doesNotMatch(issueSource, /\.from\(['"]work_items['"]\)/);
  assert.doesNotMatch(bridgeSource, /\.from\(['"]work_items['"]\)/);
  assert.match(bridgeSource, /intakeWorkEvent/);
});

test('scheduler scans income overdue without DocFlow or reminders', () => {
  assert.match(schedulerSource, /scanAndEmitIncomeInvoiceOverdueForOrg/);
  assert.doesNotMatch(schedulerSource, /sendEmail|docflow.*send|generate_reminder/i);
});

test('invoices tab aggregate includes document creation wizard entrypoint', () => {
  assert.match(invoicesTabSource, /document_creation_entrypoint/);
  assert.match(invoicesTabSource, /buildWorkEngineInvoicesDocumentCreationEntrypoint/);
  assert.match(invoicesTabSource, /open_income_document_wizard/);
  assert.match(invoicesWizardSource, /loadClientOperationsCoreClientsForOrg/);
  assert.match(invoicesWizardSource, /clientOperationsBusinessTypeDisplayHe/);
  assert.match(invoicesWizardSource, /office_client_issuer_options/);
  assert.match(invoicesWizardSource, /המשרד —/);
  assert.match(invoicesWizardSource, /לקוח מהמשרד/);
});
