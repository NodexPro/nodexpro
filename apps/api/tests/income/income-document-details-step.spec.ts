import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ActiveIncomeIssuerScope } from '../../src/domains/income/income.guards.js';
import { buildDocumentDetailsHeaderTitle } from '../../src/domains/income/income-document-details-header.pure.js';
import {
  IL_DRAFT_VAT_FALLBACK_RATE,
  incomeDraftVatFallbackResolution,
} from '../../src/domains/income/income-draft-vat-fallback.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const buildersSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);
const docDetailsStepSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineDocumentDetailsStep.tsx'),
  'utf8',
);
const draftEditorSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-draft-editor.service.ts'),
  'utf8',
);
const vatResolverSource = readFileSync(
  join(dir, '../../src/domains/income/income-draft-vat-resolver.ts'),
  'utf8',
);

const officeScope: ActiveIncomeIssuerScope = {
  org_id: 'a1111111-1111-4111-8111-111111111111',
  actor_user_id: 'b2222222-2222-4222-8222-222222222222',
  acting_mode: 'office_representative',
  issuer_business_id: 'd4444444-4444-4444-8444-444444444444',
  represented_client_id: 'd4444444-4444-4444-8444-444444444444',
  issuer_label: 'Office Firm',
  represented_client_label: 'Test4',
  permissions: { view: true, edit: true, issue: true, issue_on_behalf: true },
};

test('document details header title includes office client, type, number preview, recipient', () => {
  const title = buildDocumentDetailsHeaderTitle(officeScope, 'הצעת מחיר', '1000', 'NYC');
  assert.equal(title, 'לקוח המשרד Test4 מפיק הצעת מחיר 1000 ל-NYC');
});

test('line table column schema matches document details spec', () => {
  const expectedKeys = [
    'drag',
    'row_number',
    'description',
    'quantity',
    'unit_price',
    'currency',
    'vat',
    'confirm',
    'line_total',
    'delete',
  ];
  for (const key of expectedKeys) {
    assert.ok(buildersSource.includes(`key: '${key}'`), `missing column key: ${key}`);
  }
  assert.ok(buildersSource.includes("label: 'פירוט *'"));
  assert.ok(buildersSource.includes('הוסף שורה'));
  assert.ok(buildersSource.includes('line_total_display'));
  assert.ok(buildersSource.includes('price_includes_vat'));
  assert.ok(!buildersSource.includes("value: 'zero'"));
  assert.ok(!buildersSource.includes('מע״מ אפס'));
});

test('VAT default uses IL fallback 18% from legal resolver module', () => {
  const vat = incomeDraftVatFallbackResolution();
  assert.equal(IL_DRAFT_VAT_FALLBACK_RATE, 0.18);
  assert.equal(vat.standard_rate, 0.18);
  assert.match(vat.standard_vat_mode_option_label, /18%/);
  assert.ok(buildersSource.includes('resolveIncomeDraftVatForOrg'));
  assert.ok(vatResolverSource.includes('il_standard_vat_rate'));
});

test('add_income_document_line returns refreshed overlay via draft editor', () => {
  assert.ok(draftEditorSource.includes('export async function addIncomeDocumentLine'));
  assert.ok(draftEditorSource.includes('createEmptyDraftLine(lines.length,'));
  assert.ok(draftEditorSource.includes('wizardDraftMutationOverlay'));
});

test('update_income_document_line returns refreshed overlay', () => {
  assert.ok(draftEditorSource.includes('export async function updateIncomeDocumentLine'));
  assert.ok(draftEditorSource.includes('wizardDraftMutationOverlay'));
});

test('document details UI does not calculate financial totals', () => {
  assert.ok(!/subtotal_reference|vat_reference|grand_total_reference/.test(docDetailsStepSource));
  assert.ok(!/amount_reference\s*\*|\.reduce\(/.test(docDetailsStepSource));
  assert.ok(docDetailsStepSource.includes('step.line_items.totals.subtotal.display'));
});

test('document details UI does not hardcode VAT 18%', () => {
  assert.ok(!/0\.18/.test(docDetailsStepSource));
  assert.ok(!/מע״מ רגיל \(18%\)/.test(docDetailsStepSource));
  assert.ok(!/17%/.test(docDetailsStepSource));
});

test('line edits commit via V button without global busy lock', () => {
  assert.ok(docDetailsStepSource.includes('lockUi: false'));
  assert.ok(docDetailsStepSource.includes('nx-we-doc-details__confirm'));
  assert.ok(docDetailsStepSource.includes('commitDraft'));
  assert.ok(!docDetailsStepSource.includes('scheduleLineUpdate'));
});
