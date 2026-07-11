import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertRowMatchesIssuerScope } from '../../src/domains/income/income.guards.js';
import {
  requiresPdfRender,
  resolveIncomePdfTemplate,
} from '../../src/domains/income/income-pdf-template.resolver.js';
import { buildUnifiedIncomeDocumentRenderAuditSnapshot } from '../../src/domains/income/income-document-unified-render.pure.js';
function incomeDocumentDownloadPath(incomeDocumentId: string): string {
  return `/api/v1/income/documents/${incomeDocumentId}/download`;
}

const dir = dirname(fileURLToPath(import.meta.url));
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const pdfServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf.service.ts'),
  'utf8',
);
const routesSource = readFileSync(join(dir, '../../src/domains/income/income.routes.ts'), 'utf8');

test('unified render audit snapshot records renderer version', () => {
  const snapshot = buildUnifiedIncomeDocumentRenderAuditSnapshot({
    branding: {} as never,
    docTypeLabel: 'חשבונית מס',
    numberPreview: '2026-0001',
    issuer: { display_name: 'Acme', tax_id: '1', address: null, phone: null, email: null },
    recipient: { display_name: 'Client', tax_id: '2', address: null, phone: null, email: null },
    document_date: '2026-05-15',
    due_date: null,
    currency: 'ILS',
    lineRows: [],
    totals: {
      subtotal_before_discount: '₪100.00',
      discount: null,
      subtotal_after_discount: '₪100.00',
      vat_label: 'מע״מ',
      vat: '₪18.00',
      grand_total: '₪118.00',
    },
    notes: 'תודה',
    company_subtitle: null,
  });
  assert.equal(snapshot.renderer, 'unified_income_document_v1');
  assert.equal(snapshot.doc_type_label, 'חשבונית מס');
  assert.equal(snapshot.not_financial_truth, true);
});

test('template resolver returns rtl for Hebrew', () => {
  const t = resolveIncomePdfTemplate({
    document_type: 'receipt',
    language: 'he',
    country_code: 'IL',
  });
  assert.equal(t.rtl, true);
  assert.equal(t.language, 'he');
  assert.match(t.template_key, /fallback_il_receipt/);
});

test('all issued document types require PDF render', () => {
  assert.equal(requiresPdfRender('quote'), true);
  assert.equal(requiresPdfRender('deal_invoice'), true);
  assert.equal(requiresPdfRender('tax_invoice'), true);
});

test('failed PDF render does not rollback issue (render after draft issued, no throw)', () => {
  const draftIssuedIdx = issueSource.indexOf("status: 'issued'");
  const renderIdx = issueSource.indexOf('await renderIncomeDocumentPdf');
  assert.ok(draftIssuedIdx >= 0);
  assert.ok(renderIdx > draftIssuedIdx, 'PDF render runs after draft marked issued');
  assert.doesNotMatch(issueSource.slice(renderIdx), /throw postingErr/);
});

test('retry render command and idempotent rendered check', () => {
  assert.match(pdfServiceSource, /pdf_render_status === 'rendered' && doc.pdf_asset_id/);
  assert.match(pdfServiceSource, /INCOME_PDF_RENDER_STARTED/);
});

test('download path and route validate scope', () => {
  assert.equal(
    incomeDocumentDownloadPath('11111111-1111-4111-8111-111111111111'),
    '/api/v1/income/documents/11111111-1111-4111-8111-111111111111/download',
  );
  assert.match(routesSource, /\/documents\/:id\/download/);
  assert.match(pdfServiceSource, /assertIncomeDocumentDownloadScope/);
});

test('download rejects wrong issuer scope', () => {
  const scope = {
    org_id: 'a1111111-1111-4111-8111-111111111111',
    actor_user_id: 'b2222222-2222-4222-8222-222222222222',
    acting_mode: 'self' as const,
    issuer_business_id: 'c3333333-3333-4333-8333-333333333333',
    represented_client_id: null,
    issuer_label: 'Office',
    represented_client_label: null,
    permissions: { view: true, edit: true, issue: true, issue_on_behalf: true },
  };
  assert.throws(() =>
    assertRowMatchesIssuerScope(scope, {
      organization_id: scope.org_id,
      issuer_business_id: 'd4444444-4444-4444-8444-444444444444',
      represented_client_id: null,
    }),
  );
});

test('pdf service uses file_assets storage not parallel bucket', () => {
  assert.match(pdfServiceSource, /file_assets/);
  assert.match(pdfServiceSource, /income-documents/);
});

test('no Work Engine or DocFlow in pdf pipeline', () => {
  assert.doesNotMatch(pdfServiceSource, /from\s+['"].*work-engine/i);
  assert.doesNotMatch(pdfServiceSource, /from\s+['"].*docflow/i);
});
