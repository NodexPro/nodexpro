/**
 * INV-13A Phase 1 — Owner Invoice Document Builder foundation tests (A–O).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOwnerInvoiceFieldCatalog,
  layoutJsonContainsForbiddenVatRateKeys,
} from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-field-catalog.pure.js';
import { buildOwnerInvoiceLayoutIssueFreezeFromPublished } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-issue-freeze.pure.js';
import {
  assertOwnerInvoiceLayoutVersionMutable,
  planPublishOwnerInvoiceLayoutVersion,
  resizeOwnerInvoiceLayoutSection,
  setOwnerInvoiceFieldVisibility,
} from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-mutations.pure.js';
import { buildOwnerInvoiceLayoutPreviewHtml } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-preview.service.js';
import {
  adaptOwnerLayoutDefinitionForCanonicalRenderer,
  isLegacyIssuedLayoutPath,
  resolveIssuedDocumentLayoutSource,
} from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-resolver.pure.js';
import { parseAndValidateOwnerInvoiceLayoutDefinition } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-schema.pure.js';
import {
  buildSectionedGoldenMasterLayoutDefinitionV1,
  sectionedGoldenMasterSeedStructuralMarkers,
} from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-seed.pure.js';
import {
  isOwnerInvoiceLayoutCommand,
  OWNER_INVOICE_LAYOUT_COMMANDS,
} from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout.types.js';

function seedClone() {
  return buildSectionedGoldenMasterLayoutDefinitionV1();
}

test('A: seed layout structurally represents current sectioned GM', () => {
  const def = seedClone();
  const markers = sectionedGoldenMasterSeedStructuralMarkers();
  const sectionKeys = new Set(def.sections.map((s) => s.key));
  const fieldKeys = new Set(def.fields.map((f) => f.field_key));
  for (const m of markers) {
    assert.ok(sectionKeys.has(m as never) || fieldKeys.has(m), `missing marker ${m}`);
  }
  assert.equal(def.schema_version, 1);
  assert.equal(def.grid.page.width_px, 794);
  assert.equal(def.grid.page.height_px, 1123);
  assert.ok(def.sections.some((s) => s.key === 'lines'));
  assert.ok(def.table.columns.some((c) => c.key === 'line_vat'));
  assert.ok(def.user_branding_bounds.logo_size_keys_allowed.includes('medium'));
});

test('B: unknown field key rejected', () => {
  const def = seedClone();
  const raw = JSON.parse(JSON.stringify(def)) as Record<string, unknown>;
  const fields = raw.fields as Array<Record<string, unknown>>;
  fields.push({
    field_key: 'not_a_real_field',
    section_key: 'totals',
    order: 99,
    visible: true,
    width_span: 12,
    display_variant: 'default',
    owner_locked: false,
  });
  assert.throws(() => parseAndValidateOwnerInvoiceLayoutDefinition(raw), /unknown/i);
});

test('C: invalid section resize rejected', () => {
  const def = seedClone();
  assert.throws(
    () =>
      resizeOwnerInvoiceLayoutSection(def, {
        section_key: 'customer',
        height_px: 99999,
      }),
    /outside min\/max|constraints/i,
  );
});

test('D: required/legal field hide rejected', () => {
  const def = seedClone();
  assert.throws(
    () => setOwnerInvoiceFieldVisibility(def, { field_key: 'vat_total', visible: false }),
    /legal_required|cannot be hidden/i,
  );
  assert.throws(
    () => setOwnerInvoiceFieldVisibility(def, { field_key: 'tax_id', visible: false }),
    /legal_required|cannot be hidden/i,
  );
});

test('E: draft mutable', () => {
  assert.doesNotThrow(() => assertOwnerInvoiceLayoutVersionMutable('draft'));
});

test('F: published immutable', () => {
  assert.throws(() => assertOwnerInvoiceLayoutVersionMutable('published'), /immutable/i);
  assert.throws(() => assertOwnerInvoiceLayoutVersionMutable('archived'), /immutable/i);
});

test('G/H: publish creates active version and archives previous published', () => {
  const plan = planPublishOwnerInvoiceLayoutVersion({
    target_id: 'draft-2',
    target_status: 'draft',
    currently_published_ids: ['pub-1'],
  });
  assert.equal(plan.publish_id, 'draft-2');
  assert.deepEqual(plan.archive_ids, ['pub-1']);
  assert.throws(
    () =>
      planPublishOwnerInvoiceLayoutVersion({
        target_id: 'pub-x',
        target_status: 'published',
        currently_published_ids: [],
      }),
    /Only draft/i,
  );
});

test('I: preview_html generated from same renderer path', () => {
  const html = buildOwnerInvoiceLayoutPreviewHtml(seedClone());
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 100);
  assert.match(html, /nx-doc|חשבונית|sectioned|invoice/i);
});

test('J: Owner layout commands are named platform-owner commands (not tenant PATCH)', () => {
  // executeOwnerInvoiceLayoutCommand always calls assertPlatformOwner before mutation.
  assert.ok(isOwnerInvoiceLayoutCommand(OWNER_INVOICE_LAYOUT_COMMANDS.create_draft));
  assert.ok(isOwnerInvoiceLayoutCommand(OWNER_INVOICE_LAYOUT_COMMANDS.publish));
  assert.ok(isOwnerInvoiceLayoutCommand(OWNER_INVOICE_LAYOUT_COMMANDS.archive));
  assert.equal(isOwnerInvoiceLayoutCommand('patch_owner_invoice_layout'), false);
  assert.equal(isOwnerInvoiceLayoutCommand('update_income_branding'), false);
});

test('K: VAT rate cannot enter layout JSON', () => {
  assert.equal(
    layoutJsonContainsForbiddenVatRateKeys({
      schema_version: 1,
      vat_rate: 17,
    }),
    true,
  );
  assert.equal(
    layoutJsonContainsForbiddenVatRateKeys({
      nested: { effective_vat_rate: 0.17 },
    }),
    true,
  );
  const def = seedClone();
  const smuggled = JSON.parse(JSON.stringify(def)) as Record<string, unknown>;
  (smuggled as { vat_percentage?: number }).vat_percentage = 17;
  assert.throws(
    () => parseAndValidateOwnerInvoiceLayoutDefinition(smuggled),
    /VAT rate|not allowed/i,
  );
});

test('L: legacy issued document without owner layout fields → legacy path', () => {
  assert.equal(isLegacyIssuedLayoutPath({}), true);
  assert.equal(
    isLegacyIssuedLayoutPath({
      owner_layout_version_id: null,
      owner_layout_snapshot_json: null,
    }),
    true,
  );
  const src = resolveIssuedDocumentLayoutSource({
    owner_layout_version_id: null,
    owner_layout_snapshot_json: null,
  });
  assert.equal(src.mode, 'legacy');
});

test('M: new layout-aware render uses structured layout adapter', () => {
  const def = seedClone();
  const adapted = adaptOwnerLayoutDefinitionForCanonicalRenderer(def);
  assert.equal(adapted.document_style_key, 'sectioned');
  assert.equal(adapted.layout_schema_version, 1);
  assert.equal(adapted.field_visibility.vat_total, true);
  assert.equal(adapted.table_column_visibility.line_description, true);
  const src = resolveIssuedDocumentLayoutSource({
    owner_layout_version_id: '00000000-0000-4000-8000-000000000099',
    owner_layout_snapshot_json: def,
  });
  assert.equal(src.mode, 'owner_layout');
  if (src.mode === 'owner_layout') {
    assert.equal(src.definition.schema_version, 1);
  }
});

test('N: no arbitrary HTML/CSS injection', () => {
  const def = seedClone();
  const raw = JSON.parse(JSON.stringify(def)) as Record<string, unknown>;
  (raw as { html?: string }).html = '<script>alert(1)</script>';
  assert.throws(() => parseAndValidateOwnerInvoiceLayoutDefinition(raw), /unknown key|HTML|not allowed/i);

  const withCss = JSON.parse(JSON.stringify(def)) as Record<string, unknown>;
  const fields = withCss.fields as Array<Record<string, unknown>>;
  fields[0] = { ...fields[0], display_variant: 'color: red; font-size: 99px;' };
  assert.throws(() => parseAndValidateOwnerInvoiceLayoutDefinition(withCss), /CSS|HTML|script/i);
});

test('O: audit action strings defined for mutation/publish', async () => {
  // Read source to avoid importing audit-events (pulls supabaseAdmin/config).
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const dir = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(dir, '../../src/shared/audit-events.ts'),
    'utf8',
  );
  for (const key of [
    'OWNER_INVOICE_LAYOUT_DRAFT_CREATED',
    'OWNER_INVOICE_LAYOUT_SECTION_MOVED',
    'OWNER_INVOICE_LAYOUT_SECTION_RESIZED',
    'OWNER_INVOICE_LAYOUT_FIELD_MOVED',
    'OWNER_INVOICE_LAYOUT_FIELD_VISIBILITY_SET',
    'OWNER_INVOICE_LAYOUT_TABLE_COLUMN_SET',
    'OWNER_INVOICE_LAYOUT_VERSION_PUBLISHED',
    'OWNER_INVOICE_LAYOUT_VERSION_ARCHIVED',
  ]) {
    assert.ok(src.includes(key), `missing audit action ${key}`);
  }
  assert.ok(src.includes('owner_invoice_layout.version_published'));
});

test('field catalog has issuer/document/customer/lines/totals/legal groups and no VAT %', () => {
  const catalog = getOwnerInvoiceFieldCatalog();
  const groups = new Set(catalog.map((c) => c.group));
  for (const g of ['issuer', 'document', 'customer', 'lines', 'totals', 'legal'] as const) {
    assert.ok(groups.has(g), `missing group ${g}`);
  }
  assert.ok(!layoutJsonContainsForbiddenVatRateKeys(catalog));
  assert.ok(catalog.every((c) => !('vat_rate' in c)));
});

test('issue freeze helper only from published; null otherwise', () => {
  const def = seedClone();
  assert.equal(buildOwnerInvoiceLayoutIssueFreezeFromPublished(null), null);
  assert.equal(
    buildOwnerInvoiceLayoutIssueFreezeFromPublished({
      id: 'x',
      status: 'draft',
      layout_definition_json: def,
    }),
    null,
  );
  const freeze = buildOwnerInvoiceLayoutIssueFreezeFromPublished({
    id: 'pub-1',
    status: 'published',
    layout_definition_json: def,
  });
  assert.ok(freeze);
  assert.equal(freeze?.owner_layout_version_id, 'pub-1');
  assert.equal(freeze?.owner_layout_snapshot_json.schema_version, 1);
});

test('version-id without snapshot stays legacy (no Owner DB dependency)', () => {
  const src = resolveIssuedDocumentLayoutSource({
    owner_layout_version_id: '00000000-0000-4000-8000-000000000001',
    owner_layout_snapshot_json: null,
  });
  assert.equal(src.mode, 'legacy');
});
