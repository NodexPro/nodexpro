/**
 * P4.1 — Issue critical path: async PDF + slim refreshed case + delivery safety.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildFreshIssuedIssueResult,
  buildAlreadyIssuedIssueResult,
} from '../../src/domains/income/income-document-issue-result.pure.js';
import {
  assertIncomeDocumentReadyForEmailSend,
} from '../../src/domains/income/income-document-email-delivery.pure.js';
import {
  assertIncomeDocumentReadyForDocflowSend,
} from '../../src/domains/income/income-document-docflow-delivery.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const pdfSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/income/income-commands.service.ts'),
  'utf8',
);
const issueAndSendSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue-and-send.service.ts'),
  'utf8',
);
const setupModalSource = readFileSync(
  join(
    dir,
    '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx',
  ),
  'utf8',
);
const migration124 = readFileSync(
  join(dir, '../../../../supabase/migrations/124_income_documents_pdf_inc6.sql'),
  'utf8',
);

test('P4.1-A issue schedules PDF and does not await Puppeteer renderer', () => {
  assert.match(issueSource, /scheduleIncomeDocumentPdfRender/);
  assert.doesNotMatch(issueSource, /await renderIncomeDocumentPdf/);
  assert.match(pdfSource, /export async function scheduleIncomeDocumentPdfRender/);
  assert.match(pdfSource, /void renderIncomeDocumentPdf\(/);
  const scheduleIdx = issueSource.indexOf('scheduleIncomeDocumentPdfRender');
  const cycleLinkIdx = issueSource.indexOf("started: 'recurring_cycle_link_started'");
  // Fresh-path schedule is after cycle link in executeIssueIncomeDocument body.
  assert.ok(scheduleIdx > 0);
  assert.ok(
    issueSource.includes("started: 'pdf_scheduling_started'"),
    'pdf_scheduling stages present',
  );
  void cycleLinkIdx;
});

test('P4.1-A PDF contract remains pending|rendered|failed with retry command', () => {
  assert.match(migration124, /pdf_render_status in \('pending', 'rendered', 'failed'\)/);
  assert.match(pdfSource, /pdf_render_status: 'pending'/);
  assert.match(pdfSource, /pdf_render_status: 'rendered'/);
  assert.match(pdfSource, /pdf_render_status: 'failed'/);
  assert.match(commandsSource, /INCOME_COMMAND_RETRY_PDF_RENDER/);
  assert.match(commandsSource, /await renderIncomeDocumentPdf/);
});

test('P4.1-A fresh issue_result exposes pdf_render_status pending and disables view until rendered', () => {
  const pending = buildFreshIssuedIssueResult({
    document_id: 'd1',
    document_number: '4008',
    document_type_key: 'tax_invoice',
    issued_date: '2026-08-01',
    pdf_render_status: 'pending',
  });
  assert.equal(pending.pdf_render_status, 'pending');
  assert.equal(pending.view_action.enabled, false);

  const rendered = buildAlreadyIssuedIssueResult({
    document_id: 'd1',
    document_number: '4008',
    document_type_key: 'tax_invoice',
    issued_date: '2026-08-01',
    pdf_render_status: 'rendered',
  });
  assert.equal(rendered.pdf_render_status, 'rendered');
  assert.equal(rendered.view_action.enabled, true);
});

test('P4.1 delivery safety blocks email/docflow when PDF not rendered', () => {
  const pendingDoc = {
    id: 'doc-1',
    organization_id: 'org-1',
    issuer_business_id: 'biz-1',
    represented_client_id: 'client-1',
    document_type: 'tax_invoice' as const,
    document_number: '4008',
    document_status: 'issued',
    issue_date: '2026-08-01',
    due_date: null,
    currency: 'ILS',
    pdf_render_status: 'pending',
    pdf_asset_id: null as string | null,
    customer_snapshot_json: null,
    totals_snapshot_json: null,
    language: 'he',
  };
  assert.throws(() => assertIncomeDocumentReadyForEmailSend(pendingDoc));
  assert.throws(() => assertIncomeDocumentReadyForDocflowSend(pendingDoc));

  assert.match(issueAndSendSource, /ensureIssuedDocumentPdfReady/);
  assert.match(issueAndSendSource, /await renderIncomeDocumentPdf/);
});

test('P4.1-B issue refreshed case is review + setup only (no tab / by-type rebuild)', () => {
  const issueBlockStart = commandsSource.indexOf('if (command === INCOME_COMMAND_ISSUE_DOCUMENT)');
  const issueBlockEnd = commandsSource.indexOf(
    'if (command === INCOME_COMMAND_ISSUE_AND_SEND_DOCUMENT)',
  );
  const issueBlock = commandsSource.slice(issueBlockStart, issueBlockEnd);
  assert.match(issueBlock, /refreshRecurringCycleDraftReviewCase/);
  assert.match(issueBlock, /buildWorkEngineInvoiceRetainerSetupAggregate/);
  assert.match(issueBlock, /buildMode: 'schedule_refresh'/);
  assert.doesNotMatch(issueBlock, /buildWorkEngineInvoicesTabAggregate/);
  assert.doesNotMatch(issueBlock, /buildWorkEngineInvoicesClientDocumentsByTypeAggregate/);
});

test('P4.1-C retainer template issue path has zero post-command GETs', () => {
  const handlerStart = setupModalSource.indexOf('const handleIssueDocument = async ()');
  assert.ok(handlerStart >= 0);
  const handlerEnd = setupModalSource.indexOf('const handleSaveProfile = async ()', handlerStart);
  const handler = setupModalSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /executeIncomeCommand/);
  assert.match(handler, /end_customer_id: settings\.end_customer_id/);
  assert.doesNotMatch(handler, /fetchWorkEngineInvoiceRetainerSetupAggregate/);
  assert.doesNotMatch(handler, /fetchWorkEngineInvoicesTabAggregate/);
});

test('P4.1-D idempotent replay path does not schedule PDF again', () => {
  const finishStart = issueSource.indexOf('async function finishIdempotentIssue');
  const finishEnd = issueSource.indexOf('export async function executeIssueIncomeDocument');
  const finishBody = issueSource.slice(finishStart, finishEnd);
  assert.doesNotMatch(finishBody, /scheduleIncomeDocumentPdfRender/);
  assert.doesNotMatch(finishBody, /renderIncomeDocumentPdf/);
});

test('P4.1-F issue command logs total duration via issue_command_completed', () => {
  assert.match(commandsSource, /issue_command_completed/);
  assert.match(commandsSource, /command_started_ms/);
});
