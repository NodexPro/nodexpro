/**
 * INV-13C — Universal Document Platform foundation tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOwnerInvoiceBuilderZones } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-builder-zones.pure.js';
import { buildSectionedGoldenMasterLayoutDefinitionV1 } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-seed.pure.js';
import { isLegacyIssuedLayoutPath } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-resolver.pure.js';
import { buildOwnerDocumentPlatformAggregateSlice } from '../../src/domains/owner-document-platform/owner-document-platform-aggregate.pure.js';
import {
  buildInvoiceFamilySectionModel,
  buildInvoiceFamilyWidgetCatalog,
} from '../../src/domains/owner-document-platform/owner-document-invoice-family.adapter.pure.js';
import {
  listOwnerDocumentTemplateFamilies,
  registerOwnerDocumentTemplateFamily,
  resetOwnerDocumentTemplateRegistryForTests,
  resolveActiveOwnerDocumentTemplateFamily,
} from '../../src/domains/owner-document-platform/owner-document-template-registry.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(dir, '../../../web/src');

test('invoice family still produces sectioned GM layout + widgets', () => {
  resetOwnerDocumentTemplateRegistryForTests();
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const widgets = buildInvoiceFamilyWidgetCatalog();
  const sections = buildInvoiceFamilySectionModel(def);
  assert.ok(widgets.length > 10);
  assert.ok(widgets.every((w) => w.widget_key.startsWith('invoice.')));
  assert.ok(sections.some((s) => s.section_key === 'customer'));
  assert.ok(sections.every((s) => typeof s.label === 'string' && s.label.length > 0));
});

test('builder zones use registry labels (not FE-hardcoded invoice concepts)', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const { zones } = buildOwnerInvoiceBuilderZones({
    definition: def,
    editable: true,
    sample_logo_present: false,
    section_labels: { customer: 'Party Block', totals: 'Amounts' },
  });
  assert.equal(zones.find((z) => z.zone_key === 'customer')?.label, 'Party Block');
  assert.equal(zones.find((z) => z.zone_key === 'totals')?.label, 'Amounts');
});

test('template registry lists families; invoice active; others pending', () => {
  resetOwnerDocumentTemplateRegistryForTests();
  const families = listOwnerDocumentTemplateFamilies();
  assert.ok(families.some((f) => f.template_family === 'invoice' && f.status === 'active'));
  assert.ok(families.some((f) => f.template_family === 'receipt' && f.status === 'registered_pending'));
  assert.ok(families.some((f) => f.template_family === 'contract'));
  assert.equal(resolveActiveOwnerDocumentTemplateFamily('receipt'), 'invoice');
  assert.equal(resolveActiveOwnerDocumentTemplateFamily('invoice'), 'invoice');
});

test('future template registration possible via registry hook', () => {
  resetOwnerDocumentTemplateRegistryForTests();
  registerOwnerDocumentTemplateFamily({
    template_family: 'receipt',
    label: 'Receipt',
    status: 'active',
    default_layout_key: 'receipt_il_v1',
    allowed_document_type_groups: ['receipt'],
    country_codes: ['IL'],
    section_labels: { header: 'Header' },
    widget_catalog: [],
    branding_bounds: null,
    country_pack_hooks: {
      may_contribute_widgets: true,
      may_contribute_required_widgets: true,
      may_contribute_labels: true,
    },
    note: 'test registration',
  });
  assert.equal(resolveActiveOwnerDocumentTemplateFamily('receipt'), 'receipt');
  resetOwnerDocumentTemplateRegistryForTests();
});

test('platform aggregate slice exposes universal models', () => {
  resetOwnerDocumentTemplateRegistryForTests();
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const slice = buildOwnerDocumentPlatformAggregateSlice({
    template_family: 'invoice',
    definition: def,
  });
  assert.equal(slice.template_family, 'invoice');
  assert.ok(Array.isArray(slice.document_template_families));
  assert.ok(Array.isArray(slice.widget_catalog));
  assert.ok(Array.isArray(slice.section_model));
  assert.ok(Array.isArray(slice.widget_catalog_groups));
  assert.equal(
    (slice.universal_pipeline as { renderer?: string }).renderer,
    'unified_income_document_renderer',
  );
});

test('legacy issued path unchanged', () => {
  assert.equal(isLegacyIssuedLayoutPath({}), true);
  assert.equal(
    isLegacyIssuedLayoutPath({
      owner_layout_version_id: null,
      owner_layout_snapshot_json: null,
    }),
    true,
  );
});

test('FE catalog groups come from document_platform; no hardcoded issuer/customer order required', () => {
  const pure = readFileSync(join(webRoot, 'pages/owner-invoice-document-builder.pure.ts'), 'utf8');
  assert.match(pure, /resolveWidgetCatalogGroups/);
  assert.equal(pure.includes("issuer: 'Issuer'"), false);
  assert.equal(pure.includes("customer: 'Customer'"), false);
  const section = readFileSync(
    join(webRoot, 'pages/OwnerInvoiceDocumentBuilderSection.tsx'),
    'utf8',
  );
  assert.match(section, /template_family/);
  assert.match(section, /document_template_families|templateFamilies/);
  assert.match(section, /resolveWidgetCatalogGroups/);
});

test('migration 156 adds template_family', () => {
  const mig = readFileSync(
    join(dir, '../../../../supabase/migrations/156_owner_document_layout_template_family.sql'),
    'utf8',
  );
  assert.match(mig, /template_family/);
  assert.match(mig, /default 'invoice'/);
});
