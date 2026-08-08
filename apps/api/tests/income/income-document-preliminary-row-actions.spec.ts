import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allowedConversionTargetsForSource,
  buildPreliminaryEditAction,
} from '../../src/domains/income/income-document-conversion.pure.js';
import { SECTIONED_GOLDEN_MASTER } from '../../src/domains/income/income-document-sectioned-golden-master.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-branding-preview.renderer.ts'),
  'utf8',
);
const readModelSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
  ),
  'utf8',
);
const modalSource = readFileSync(
  join(
    dir,
    '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx',
  ),
  'utf8',
);
const cssSource = readFileSync(
  join(dir, '../../../web/src/styles/nx-work-engine-client-documents.css'),
  'utf8',
);

test('A/B — sectioned party names use GM 18px / 800', () => {
  assert.equal(SECTIONED_GOLDEN_MASTER.upper.company_name_font_size_px, 18);
  assert.equal(SECTIONED_GOLDEN_MASTER.upper.company_name_font_weight, 800);
  assert.match(rendererSource, /\.nx-doc--sectioned \.nx-doc__issuer-name/);
  assert.match(rendererSource, /\.nx-doc--sectioned \.nx-doc__customer-name/);
  assert.match(rendererSource, /company_name_font_size_px/);
  assert.match(rendererSource, /company_name_font_weight/);
});

test('C — no local Quote/Deal party typography override; classic scoped with :not(sectioned)', () => {
  assert.doesNotMatch(rendererSource, /quote.*issuer-name|deal_invoice.*customer-name/);
  assert.match(
    rendererSource,
    /\.nx-doc--unified:not\(\.nx-doc--sectioned\) \.nx-doc__issuer-name/,
  );
  assert.match(
    rendererSource,
    /\.nx-doc--unified:not\(\.nx-doc--sectioned\) \.nx-doc__customer-name/,
  );
  assert.match(rendererSource, /\.nx-doc:not\(\.nx-doc--sectioned\) \.nx-doc__issuer-name/);
  assert.match(rendererSource, /\.nx-doc:not\(\.nx-doc--sectioned\) \.nx-doc__customer-name/);
});

test('D/E — preliminary rows expose edit + convert + cancel; UI uses horizontal icon buttons', () => {
  assert.match(readModelSource, /edit_action = buildPreliminaryEditAction/);
  assert.match(readModelSource, /convert_action/);
  assert.match(readModelSource, /cancel_action/);
  assert.match(cssSource, /flex-direction:\s*row/);
  assert.match(cssSource, /\.nx-we-documents-modal__icon-btn/);
  assert.match(modalSource, /nx-we-documents-modal__icon-btn/);
  assert.match(modalSource, /handleEditPreliminary/);
});

test('F — edit action uses begin_edit command (existing wizard path)', () => {
  const active = buildPreliminaryEditAction({ sourceStatus: 'issued', canEdit: true });
  assert.equal(active.enabled, true);
  assert.equal(active.command, 'begin_edit_income_preliminary_document');
  assert.match(modalSource, /begin_edit_income_preliminary_document|editAction\.command/);
  assert.match(modalSource, /onOpenConvertedDraft/);
});

test('G — cancelled preliminary disables edit/convert', () => {
  const edit = buildPreliminaryEditAction({
    sourceStatus: 'cancelled_future',
    canEdit: true,
  });
  assert.equal(edit.enabled, false);
});

test('H — tax documents have no edit/cancel from conversion matrix helpers', () => {
  assert.deepEqual(allowedConversionTargetsForSource('tax_invoice'), []);
  // Edit/convert/cancel only assigned inside preliminaryType branch.
  assert.match(readModelSource, /if \(preliminaryType\) \{[\s\S]*buildPreliminaryEditAction/);
  assert.match(
    readModelSource,
    /documentTypeKey === 'tax_invoice'\s*\?\s*TAX_INVOICE_TABLE_COLUMNS/,
  );
});

test('I — plus conversion targets unchanged', () => {
  assert.deepEqual(allowedConversionTargetsForSource('quote'), [
    'deal_invoice',
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
  assert.deepEqual(allowedConversionTargetsForSource('deal_invoice'), [
    'tax_invoice',
    'tax_invoice_receipt',
  ]);
});

test('J — conversion command wiring still present', () => {
  assert.match(readModelSource, /INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT/);
  assert.match(readModelSource, /INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT/);
});
