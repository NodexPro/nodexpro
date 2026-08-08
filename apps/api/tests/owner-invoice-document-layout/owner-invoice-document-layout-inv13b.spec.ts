/**
 * INV-13B — Real Visual Owner Invoice Builder tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOwnerInvoiceBuilderZones } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-builder-zones.pure.js';
import { getOwnerInvoiceFieldCatalog } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-field-catalog.pure.js';
import {
  placeOwnerInvoiceLayoutField,
  setOwnerInvoiceSectionLock,
} from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-mutations.pure.js';
import { buildSectionedGoldenMasterLayoutDefinitionV1 } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-seed.pure.js';
import { OWNER_INVOICE_LAYOUT_COMMANDS } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout.types.js';
import { isLegacyIssuedLayoutPath } from '../../src/domains/owner-invoice-document-layout/owner-invoice-document-layout-resolver.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(dir, '../../../web/src');

test('builder zones include Logo + core editable zones', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const { chrome, zones } = buildOwnerInvoiceBuilderZones({
    definition: def,
    editable: true,
    sample_logo_present: false,
  });
  assert.equal(chrome.zones_builder_only, true);
  assert.equal(chrome.grid.columns, 12);
  assert.equal(chrome.grid.show_rulers, true);
  const keys = new Set(zones.map((z) => z.zone_key));
  for (const k of [
    'logo',
    'issuer_branding',
    'document_identity',
    'customer',
    'lines',
    'totals',
    'payments',
    'notes',
    'legal_footer',
  ]) {
    assert.ok(keys.has(k), `missing zone ${k}`);
  }
  const logo = zones.find((z) => z.zone_key === 'logo');
  assert.ok(logo?.logo_placeholder?.show);
  assert.match(String(logo?.logo_placeholder?.label ?? ''), /Logo zone/i);
});

test('catalog covers INV-13B field groups without inventing VAT rate', () => {
  const catalog = getOwnerInvoiceFieldCatalog();
  const byKey = new Map(catalog.map((f) => [f.field_key, f]));
  for (const key of [
    'logo',
    'issuer_name',
    'tax_id',
    'registration_number',
    'currency',
    'customer_contact',
    'customer_tax_id',
    'discount',
    'subtotal',
    'vat_total',
    'grand_total',
    'balance',
    'signature_block',
    'stamp',
    'notes',
    'legal_wording',
  ]) {
    assert.ok(byKey.has(key), `missing catalog field ${key}`);
  }
  assert.equal(byKey.get('issuer_name')?.label, 'Company Name');
  assert.equal(byKey.get('vat_total')?.label, 'VAT Amount');
  assert.ok(!byKey.has('vat_rate'));
});

test('place optional field into allowed section', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const next = placeOwnerInvoiceLayoutField(def, {
    field_key: 'registration_number',
    section_key: 'issuer_branding',
  });
  assert.ok(next.fields.some((f) => f.field_key === 'registration_number' && f.visible));
});

test('section lock toggle', () => {
  const def = buildSectionedGoldenMasterLayoutDefinitionV1();
  const unlocked = setOwnerInvoiceSectionLock(def, {
    section_key: 'customer',
    owner_locked: true,
  });
  assert.equal(unlocked.sections.find((s) => s.key === 'customer')?.owner_locked, true);
});

test('new commands registered', () => {
  assert.equal(OWNER_INVOICE_LAYOUT_COMMANDS.place_field, 'place_owner_invoice_layout_field');
  assert.equal(OWNER_INVOICE_LAYOUT_COMMANDS.set_section_lock, 'set_owner_invoice_section_lock');
});

test('legacy path still bypasses builder zones', () => {
  assert.equal(isLegacyIssuedLayoutPath({}), true);
});

test('FE visual editor uses aggregate zones + named commands; no PATCH; no HTML rebuild', () => {
  const section = readFileSync(
    join(webRoot, 'pages/OwnerInvoiceDocumentBuilderSection.tsx'),
    'utf8',
  );
  assert.match(section, /builder_zones|resolveBuilderZones/);
  assert.match(section, /nx-oidb__zone--logo/);
  assert.match(section, /logo_placeholder|Logo zone/);
  assert.match(section, /place_field|OWNER_INVOICE_LAYOUT_COMMANDS\.place_field/);
  assert.match(section, /set_section_lock/);
  assert.match(section, /srcDoc=\{iframeSrcDoc\}/);
  assert.equal(section.includes('method: \'PATCH\''), false);
  assert.equal(section.includes('dangerouslySetInnerHTML'), false);
  assert.equal(section.includes('draggable='), false);
});

test('zones chrome never claimed for PDF/issued in notes', () => {
  const zonesSrc = readFileSync(
    join(dir, '../../src/domains/owner-invoice-document-layout/owner-invoice-document-builder-zones.pure.ts'),
    'utf8',
  );
  assert.match(zonesSrc, /never rendered in Preview\/PDF\/issued/i);
});
