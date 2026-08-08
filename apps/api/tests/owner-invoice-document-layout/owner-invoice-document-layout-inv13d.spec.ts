/**
 * INV-13D — Simplified Owner Document Builder UX tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOwnerInvoiceBuilderZones } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-builder-zones.pure.js';
import {
  moveOwnerInvoiceLayoutField,
  moveOwnerInvoiceLayoutSection,
  resizeOwnerInvoiceLayoutSection,
  setOwnerInvoiceFieldVisibility,
} from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-mutations.pure.js';
import { buildSectionedGoldenMasterLayoutDefinitionV1 } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-seed.pure.js';
import { fieldHideRejectedReason } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-field-catalog.pure.js';
import { isLegacyIssuedLayoutPath } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-resolver.pure.js';
import { OWNER_INVOICE_LAYOUT_COMMANDS } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(dir, '../../../web/src');

function readFe(path: string): string {
  return readFileSync(join(webRoot, path), 'utf8');
}

test('A: Seed/read-only banner + create-draft CTA present; edit chrome gated', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  const pure = readFe('pages/owner-invoice-document-builder.pure.ts');
  assert.match(pure, /ownerBuilderReadOnlyBannerText/);
  assert.match(section, /oidb-readonly-banner|Create Draft to edit this template/);
  assert.match(section, /ownerBuilderIsEditable/);
  assert.match(section, /!editable/);
});

test('B: Create Draft command wiring present for edit flow', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.create_draft/);
  assert.match(section, /oidb-create-draft/);
});

test('C: Move section up/down uses named command and swaps orders', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const sorted = [...def.sections].sort((a, b) => a.order - b.order);
  const a = sorted[0]!;
  const b = sorted[1]!;
  const next = moveOwnerInvoiceLayoutSection(def, { section_key: a.key, order: b.order });
  const a2 = next.sections.find((s) => s.key === a.key)!;
  const b2 = next.sections.find((s) => s.key === b.key)!;
  assert.equal(a2.order, b.order);
  assert.equal(b2.order, a.order);
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.move_section/);
  assert.match(section, /moveSection\(/);
});

test('D: Width resize command accepts col_span presets from constraints shape', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const section = def.sections.find((s) => s.key === 'customer')!;
  const next = resizeOwnerInvoiceLayoutSection(def, {
    section_key: 'customer',
    col_span: Math.min(12, section.col_span === 6 ? 12 : 6),
  });
  assert.ok(next.sections.find((s) => s.key === 'customer')!.col_span >= 1);
  const fe = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(fe, /setSectionWidth|col_span/);
  assert.match(fe, /allowedWidthSpans|widthPercentLabelForSpan/);
});

test('E: Invalid width rejected by backend bounds', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  assert.throws(
    () =>
      resizeOwnerInvoiceLayoutSection(def, {
        section_key: 'customer',
        col_span: 99,
      }),
    /out of bounds|grid/i,
  );
});

test('F: Click preview section opens Sections inspector (source)', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /selectZone/);
  assert.match(section, /setRightTab\('sections'\)/);
  assert.match(section, /oidb-sections-panel/);
  assert.match(section, /nx-oidb__zone--selected/);
});

test('G: Optional field Add/Hide without drag', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.place_field/);
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.set_field_visibility/);
  assert.equal(section.includes('draggable='), false);
  assert.equal(section.includes('onDrop'), false);
});

test('H: Required/legal field cannot be hidden', () => {
  assert.ok(fieldHideRejectedReason('legal_wording'));
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  assert.throws(
    () =>
      setOwnerInvoiceFieldVisibility(def, {
        field_key: 'legal_wording',
        visible: false,
      }),
    /cannot|hide|legal|required/i,
  );
});

test('I: Field section dropdown uses backend allowed_sections only', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /allowed_section_keys/);
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.move_field/);
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  assert.throws(
    () =>
      moveOwnerInvoiceLayoutField(def, {
        field_key: 'issuer_name',
        section_key: 'totals',
      }),
    /cannot be moved|not allowed|section/i,
  );
});

test('J: Table order/width/alignment controls wired', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /oidb-table-panel/);
  assert.match(section, /OWNER_INVOICE_LAYOUT_COMMANDS\.set_table_column/);
  assert.match(section, /width_px/);
  assert.match(section, /align/);
});

test('K: Logo zone controls visible and understandable', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const { zones } = buildOwnerInvoiceBuilderZones({
    definition: def,
    editable: true,
    sample_logo_present: false,
  });
  const logo = zones.find((z) => z.zone_key === 'logo');
  assert.ok(logo);
  assert.match(String(logo?.logo_placeholder?.label ?? ''), /Logo zone/i);
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /Logo zone/);
  assert.match(section, /Allowed logo sizes/);
  assert.match(section, /does not upload tenant logo/i);
});

test('L: Tenant structural controls remain absent', () => {
  const pure = readFe('pages/owner-invoice-document-builder.pure.ts');
  assert.match(pure, /tenantBrandingStudioAllowsStructuralLayoutControls/);
  assert.match(pure, /return false/);
});

test('M: Universal template-family selector still works', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /template_family/);
  assert.match(section, /document_template_families|templateFamilies/);
  assert.match(section, /Document Type/);
});

test('N: No FE layout truth / no document rebuild in React', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /preview_html/);
  assert.match(section, /srcDoc=\{iframeSrcDoc\}/);
  assert.equal(section.includes('dangerouslySetInnerHTML'), false);
  assert.match(section, /refreshed\.aggregate/);
});

test('O: No PATCH; advanced drag mode off by default', () => {
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  const pure = readFe('pages/owner-invoice-document-builder.pure.ts');
  assert.equal(section.includes("method: 'PATCH'"), false);
  assert.equal(section.includes('method: "PATCH"'), false);
  assert.match(pure, /ownerBuilderAdvancedDragModeEnabled/);
  assert.match(pure, /export function ownerBuilderAdvancedDragModeEnabled\(\): false/);
  assert.equal(isLegacyIssuedLayoutPath({}), true);
  assert.equal(OWNER_INVOICE_LAYOUT_COMMANDS.resize_section, 'resize_owner_invoice_layout_section');
});

test('alignment update via resize command', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const next = resizeOwnerInvoiceLayoutSection(def, {
    section_key: 'customer',
    alignment: 'center',
  });
  assert.equal(next.sections.find((s) => s.key === 'customer')!.alignment, 'center');
});

test('FE tabs are Sections/Fields/Table/History (controlled UX)', () => {
  const types = readFe('pages/owner-invoice-document-builder-types.ts');
  assert.match(types, /'sections' \| 'fields' \| 'table' \| 'history'/);
  const section = readFe('pages/OwnerInvoiceDocumentBuilderSection.tsx');
  assert.match(section, /\['sections', 'Sections'\]/);
  assert.match(section, /\['fields', 'Fields'\]/);
  assert.equal(section.includes("['catalog', 'Catalog']"), false);
});
