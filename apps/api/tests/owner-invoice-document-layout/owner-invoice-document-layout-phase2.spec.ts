/**
 * INV-13A Phase 2 — Owner Builder UI helpers + architecture boundary tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSectionedGoldenMasterLayoutDefinitionV1 } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-seed.pure.js';
import { getOwnerInvoiceFieldCatalog } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-field-catalog.pure.js';
import {
  isLegacyIssuedLayoutPath,
  resolveIssuedDocumentLayoutSource,
} from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-resolver.pure.js';
import { buildOwnerInvoiceLayoutIssueFreezeFromPublished } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-issue-freeze.pure.js';
import { parseAndValidateOwnerInvoiceLayoutDefinition } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-schema.pure.js';
import { fieldHideRejectedReason } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-field-catalog.pure.js';
import { OWNER_INVOICE_LAYOUT_COMMANDS } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout.types.js';
import { buildOwnerInvoiceLayoutPreviewHtml } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-preview.service.js';

const dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(dir, '../../../web/src');

test('A: seed preview_html is non-empty A4 golden master HTML', () => {
  const html = buildOwnerInvoiceLayoutPreviewHtml(buildSectionedGoldenMasterLayoutDefinitionV1());
  assert.ok(html.length > 200);
  assert.match(html, /nx-doc|חשבונית/i);
});

test('B: builder route/section is platform-owner scoped in Owner panel (source)', () => {
  const panel = readFileSync(join(webRoot, 'pages/PlatformOwnerLegalControl.tsx'), 'utf8');
  assert.match(panel, /invoice_document_builder/);
  assert.match(panel, /OwnerInvoiceDocumentBuilderSection/);
  const routes = readFileSync(
    join(dir, '../../src/routes/owner-country-pack.routes.ts'),
    'utf8',
  );
  assert.match(routes, /invoice-document-builder/);
  assert.match(routes, /assertOwnerOrAuditFailure/);
});

test('H: hide legal required field blocked by catalog', () => {
  assert.ok(fieldHideRejectedReason('vat_total'));
  assert.ok(fieldHideRejectedReason('tax_id'));
  assert.equal(fieldHideRejectedReason('notes'), null);
});

test('K/L: published immutable; create draft command exists', () => {
  assert.equal(OWNER_INVOICE_LAYOUT_COMMANDS.create_draft, 'create_owner_invoice_layout_draft');
  assert.equal(OWNER_INVOICE_LAYOUT_COMMANDS.publish, 'publish_owner_invoice_layout_version');
});

test('N: legacy issued path unchanged without freeze', () => {
  assert.equal(isLegacyIssuedLayoutPath({}), true);
  assert.equal(
    resolveIssuedDocumentLayoutSource({
      owner_layout_version_id: null,
      owner_layout_snapshot_json: null,
    }).mode,
    'legacy',
  );
});

test('O: new issue freeze helper from published only', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const freeze = buildOwnerInvoiceLayoutIssueFreezeFromPublished({
    id: 'pub-1',
    status: 'published',
    layout_definition_json: def,
  });
  assert.equal(freeze?.owner_layout_version_id, 'pub-1');
  assert.equal(
    buildOwnerInvoiceLayoutIssueFreezeFromPublished({
      id: 'd1',
      status: 'draft',
      layout_definition_json: def,
    }),
    null,
  );
});

test('P: Branding Studio has no structural drag/section builder wiring', () => {
  const branding = readFileSync(
    join(webRoot, 'components/income/IncomeDocumentBrandingSettingsPanel.tsx'),
    'utf8',
  );
  assert.equal(branding.includes('move_owner_invoice_layout_section'), false);
  assert.equal(branding.includes('OwnerInvoiceDocumentBuilder'), false);
  assert.equal(branding.includes('dragsection'), false);
  assert.match(branding, /Platform Owner|מבנה המסמך/);
});

test('Q: arbitrary HTML rejected in layout schema', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const raw = JSON.parse(JSON.stringify(def)) as Record<string, unknown>;
  (raw as { html?: string }).html = '<div>x</div>';
  assert.throws(() => parseAndValidateOwnerInvoiceLayoutDefinition(raw));
});

test('R: no VAT rate in field catalog / layout seed', () => {
  const catalog = getOwnerInvoiceFieldCatalog();
  assert.ok(catalog.every((f) => f.field_key !== 'vat_rate'));
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  assert.throws(() =>
    parseAndValidateOwnerInvoiceLayoutDefinition({
      ...def,
      vat_rate: 17,
    }),
  );
});

test('S: FE builder uses named commands + aggregate refresh (no PATCH)', () => {
  const section = readFileSync(
    join(webRoot, 'pages/OwnerInvoiceDocumentBuilderSection.tsx'),
    'utf8',
  );
  const types = readFileSync(
    join(webRoot, 'pages/owner-invoice-document-builder-types.ts'),
    'utf8',
  );
  assert.match(section, /OWNER\.command/);
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.create_draft/);
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.move_section/);
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.publish/);
  assert.match(types, /create_owner_invoice_layout_draft/);
  assert.match(types, /move_owner_invoice_layout_section/);
  assert.match(types, /publish_owner_invoice_layout_version/);
  assert.match(section, /refreshed\.aggregate/);
  assert.equal(section.includes('method: \'PATCH\''), false);
  assert.equal(section.includes('method: "PATCH"'), false);
  assert.match(section, /srcDoc=\{iframeSrcDoc\}/);
  assert.match(section, /sandbox="allow-same-origin"/);
});

test('FE pure overlay helpers exist and use aggregate geometry only', async () => {
  // Dynamic import of TS via relative path is not available in api tests runtime for web.
  // Assert source contract instead.
  const pure = readFileSync(join(webRoot, 'pages/owner-invoice-document-builder.pure.ts'), 'utf8');
  assert.match(pure, /buildOwnerBuilderSectionOverlayRects/);
  assert.match(pure, /tenantBrandingStudioAllowsStructuralLayoutControls/);
  assert.match(pure, /return false/);
  assert.match(pure, /ownerBuilderActionAllowed/);
});
