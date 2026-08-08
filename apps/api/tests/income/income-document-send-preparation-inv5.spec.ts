/**
 * INV-5 — Original Send Preparation: recipient prefill + PDF eligibility contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildIncomeDocumentEmailSendForm,
  normalizeRepresentedClientRecipientEmailPrefill,
  resolveIncomeDocumentEmailSendEligibility,
} from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';
import { resolveIncomeDocumentDocflowSendEligibility } from '../../src/domains/income/income-document-docflow-delivery.pure.js';
import { resolveIncomeDocumentPdfSendReadiness } from '../../src/domains/income/income-document-pdf-send-readiness.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const historyServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-email-history.service.ts'),
  'utf8',
);
const issueServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const emailModalSource = readFileSync(
  join(dir, '../../../web/src/components/income/IncomeDocumentEmailHistoryModal.tsx'),
  'utf8',
);

const officePerms = {
  view: true,
  edit: true,
  issue: true,
  issue_on_behalf: true,
};

const baseEmailInput = {
  permissions: officePerms,
  representedClientId: randomUUID(),
  documentStatus: 'issued' as const,
};

test('invoice customer email becomes send form default_value', () => {
  const form = buildIncomeDocumentEmailSendForm({
    incomeDocumentId: randomUUID(),
    sendEligibility: {
      enabled: true,
      disabled_reason: null,
      disabled_reason_key: null,
    },
    recipientEmailDefault: '  marinator02@walla.com ',
  });
  assert.equal(form.fields[0]?.key, 'recipient_email');
  assert.equal(form.fields[0]?.default_value, 'marinator02@walla.com');
});

test('no invoice customer email leaves recipient default empty', () => {
  assert.equal(normalizeRepresentedClientRecipientEmailPrefill(null), null);
  assert.equal(normalizeRepresentedClientRecipientEmailPrefill('   '), null);
  const form = buildIncomeDocumentEmailSendForm({
    incomeDocumentId: randomUUID(),
    sendEligibility: {
      enabled: true,
      disabled_reason: null,
      disabled_reason_key: null,
    },
    recipientEmailDefault: null,
  });
  assert.equal(form.fields[0]?.default_value, null);
});

test('send history prefills from invoice customer / delivery contact (not Core issuer)', () => {
  assert.match(historyServiceSource, /resolveIssuedDocumentEmailRecipientPrefill/);
  assert.match(historyServiceSource, /loadIncomeRecipientById/);
  assert.match(historyServiceSource, /customer_snapshot_json/);
  assert.match(historyServiceSource, /delivery_contact_json/);
  assert.doesNotMatch(
    historyServiceSource,
    /recipientEmailDefault[\s\S]{0,200}loadRepresentedClient/,
  );
});

test('pending PDF disables send with pdf_pending', () => {
  const pdf = resolveIncomeDocumentPdfSendReadiness({
    pdfRenderStatus: 'pending',
    pdfAssetId: null,
  });
  assert.equal(pdf.ready, false);
  assert.equal(pdf.status_key, 'pdf_pending');
  assert.equal(pdf.retry_eligible, false);

  const email = resolveIncomeDocumentEmailSendEligibility({
    ...baseEmailInput,
    pdfRenderStatus: 'pending',
    pdfAssetId: null,
  });
  assert.equal(email.enabled, false);
  assert.equal(email.disabled_reason_key, 'pdf_pending');
  assert.match(String(email.disabled_reason), /בהכנה/);
  assert.equal(email.retry_pdf_render_allowed, false);
});

test('failed PDF disables send with pdf_failed and retry when issue permitted', () => {
  const email = resolveIncomeDocumentEmailSendEligibility({
    ...baseEmailInput,
    pdfRenderStatus: 'failed',
    pdfAssetId: null,
  });
  assert.equal(email.enabled, false);
  assert.equal(email.disabled_reason_key, 'pdf_failed');
  assert.equal(email.retry_pdf_render_allowed, true);
  assert.match(String(email.disabled_reason), /נכשלה/);
  assert.doesNotMatch(String(email.disabled_reason), /Error|stack|supabase/i);
});

test('rendered + asset enables send when other gates pass', () => {
  const assetId = randomUUID();
  const email = resolveIncomeDocumentEmailSendEligibility({
    ...baseEmailInput,
    pdfRenderStatus: 'rendered',
    pdfAssetId: assetId,
  });
  assert.equal(email.enabled, true);
  assert.equal(email.disabled_reason_key, null);
  assert.equal(email.pdf_readiness.status_key, 'pdf_ready');
  assert.equal(email.retry_pdf_render_allowed, false);
});

test('rendered without asset is unavailable and not sendable', () => {
  const email = resolveIncomeDocumentEmailSendEligibility({
    ...baseEmailInput,
    pdfRenderStatus: 'rendered',
    pdfAssetId: null,
  });
  assert.equal(email.enabled, false);
  assert.equal(email.disabled_reason_key, 'pdf_unavailable');
  assert.equal(email.pdf_readiness.status_key, 'pdf_unavailable');
  // Missing asset is regenerable — same path as failed PDF retry.
  assert.equal(email.retry_pdf_render_allowed, true);
});

test('Email and DocFlow share identical PDF readiness mapping', () => {
  const cases: Array<{ status: string; asset: string | null }> = [
    { status: 'pending', asset: null },
    { status: 'failed', asset: null },
    { status: 'rendered', asset: randomUUID() },
    { status: 'rendered', asset: null },
  ];
  for (const c of cases) {
    const email = resolveIncomeDocumentEmailSendEligibility({
      ...baseEmailInput,
      pdfRenderStatus: c.status,
      pdfAssetId: c.asset,
    });
    const docflow = resolveIncomeDocumentDocflowSendEligibility({
      permissions: officePerms,
      representedClientId: baseEmailInput.representedClientId,
      documentStatus: 'issued',
      pdfRenderStatus: c.status,
      pdfAssetId: c.asset,
      docflowEntitled: true,
      portalActive: true,
    });
    assert.equal(email.pdf_readiness.status_key, docflow.pdf_readiness.status_key);
    assert.equal(email.pdf_readiness.ready, docflow.pdf_readiness.ready);
    assert.equal(email.pdf_readiness.disabled_reason, docflow.pdf_readiness.disabled_reason);
    assert.equal(email.retry_pdf_render_allowed, docflow.retry_pdf_render_allowed);
  }
});

test('web email modal initializes from default_value and has no /clients lookup', () => {
  assert.match(emailModalSource, /default_value/);
  assert.match(emailModalSource, /formValuesFromAggregate/);
  assert.match(emailModalSource, /allowed_actions\.includes\('retry_income_document_pdf_render'\)/);
  assert.doesNotMatch(emailModalSource, /\/clients/);
  assert.doesNotMatch(emailModalSource, /fetchClient|loadClient/);
  assert.doesNotMatch(emailModalSource, /pdf_render_status\s*===/);
});

test('issue flow still schedules async PDF and does not await renderIncomeDocumentPdf', () => {
  assert.match(issueServiceSource, /scheduleIncomeDocumentPdfRender/);
  assert.doesNotMatch(
    issueServiceSource,
    /await\s+renderIncomeDocumentPdf\s*\(/,
  );
});

test('history aggregate exposes retry_income_document_pdf_render when allowed', () => {
  assert.match(historyServiceSource, /INCOME_COMMAND_RETRY_PDF_RENDER/);
  assert.match(historyServiceSource, /retry_pdf_render_allowed/);
  assert.match(historyServiceSource, /pdf_send_readiness/);
});
