/**
 * Conversion acceptance: discount copy + issue lineage (integration-level contracts).
 * No FE arithmetic. Reuses canonical totals engine + issue orchestration hooks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyLineFieldUpdate,
  createEmptyDraftLine,
  normalizeDraftLines,
  serializeDraftLines,
} from '../../src/domains/income/income-document-draft-lines.pure.js';
import {
  computeDraftTotalsPreview,
  DEFAULT_DOCUMENT_SETTINGS,
  parseDocumentSettingsJson,
} from '../../src/domains/income/income-document-draft-totals.pure.js';
import { incomeDraftVatFallbackResolution } from '../../src/domains/income/income-draft-vat-fallback.pure.js';
import {
  CANCEL_SOURCE_CONVERSION_LINEAGE_RULE,
  decideConversionTargetDocumentLink,
  draftLinesFromIssuedSnapshot,
  resolveDocumentSettingsForConversion,
  resolveIssuedConversionChain,
  serializeConversionDocumentSettings,
  serializeConvertedDraftLines,
} from '../../src/domains/income/income-document-conversion.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const conversionServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-conversion.service.ts'),
  'utf8',
);
const issueServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const migration158 = readFileSync(
  join(dir, '../../../../supabase/migrations/158_income_document_conversion_and_preliminary_cancel.sql'),
  'utf8',
);

const vat = incomeDraftVatFallbackResolution();
const date = '2026-07-15';

async function linesSubtotal10000Ils() {
  const lines = normalizeDraftLines(serializeDraftLines([createEmptyDraftLine(0)]));
  return applyLineFieldUpdate(lines, lines[0].line_id, {
    description: 'שירות',
    unit_price_reference: 10000,
    quantity: 1,
    currency: 'ILS',
    price_includes_vat: false,
    vat_rate_code: 'standard',
  });
}

function issuedLinesSnapshotFromDraftLines(lines: Awaited<ReturnType<typeof linesSubtotal10000Ils>>) {
  return serializeDraftLines(lines);
}

test('A — Quote 10% document discount → Deal Invoice draft settings preserve discount', async () => {
  const sourceSettings = {
    ...DEFAULT_DOCUMENT_SETTINGS,
    discount: { enabled: true, type: 'percent' as const, value: 10 },
  };
  const resolved = resolveDocumentSettingsForConversion({
    sourceDraftSettingsJson: serializeConversionDocumentSettings(sourceSettings),
    sourceTotalsSnapshotJson: null,
  });
  assert.equal(resolved.discount.enabled, true);
  assert.equal(resolved.discount.type, 'percent');
  assert.equal(resolved.discount.value, 10);
  assert.equal(resolved.retainer_template, undefined);

  const sourceLines = await linesSubtotal10000Ils();
  const convertedLines = draftLinesFromIssuedSnapshot(
    issuedLinesSnapshotFromDraftLines(sourceLines),
    'ILS',
  );
  const sourceTotals = await computeDraftTotalsPreview(sourceLines, 'ILS', sourceSettings, vat, date);
  const targetTotals = await computeDraftTotalsPreview(convertedLines, 'ILS', resolved, vat, date);
  assert.equal(sourceTotals.subtotal_before_discount_reference, 10000);
  assert.equal(sourceTotals.subtotal_after_discount_reference, 9000);
  assert.equal(targetTotals.subtotal_after_discount_reference, 9000);
  assert.equal(targetTotals.discount_amount_reference, 1000);
});

test('B — Quote discount → Tax Invoice draft totals reconcile before VAT', async () => {
  const sourceSettings = {
    ...DEFAULT_DOCUMENT_SETTINGS,
    discount: { enabled: true, type: 'percent' as const, value: 10 },
  };
  const sourceLines = await linesSubtotal10000Ils();
  const resolved = resolveDocumentSettingsForConversion({
    sourceDraftSettingsJson: serializeConversionDocumentSettings(sourceSettings),
    sourceTotalsSnapshotJson: null,
  });
  const convertedLines = draftLinesFromIssuedSnapshot(
    issuedLinesSnapshotFromDraftLines(sourceLines),
    'ILS',
  );
  const targetTotals = await computeDraftTotalsPreview(convertedLines, 'ILS', resolved, vat, date);
  assert.equal(targetTotals.subtotal_before_discount_reference, 10000);
  assert.equal(targetTotals.discount_amount_reference, 1000);
  assert.equal(targetTotals.subtotal_after_discount_reference, 9000);
});

test('C — Deal Invoice discount → Tax Invoice draft preserves document discount', async () => {
  const sourceSettings = {
    ...DEFAULT_DOCUMENT_SETTINGS,
    discount: { enabled: true, type: 'fixed_amount' as const, value: 500 },
  };
  const resolved = resolveDocumentSettingsForConversion({
    sourceDraftSettingsJson: serializeConversionDocumentSettings(sourceSettings),
    sourceTotalsSnapshotJson: { discount_enabled: true, discount_amount_reference: 500 },
  });
  assert.deepEqual(resolved.discount, { enabled: true, type: 'fixed_amount', value: 500 });
  const sourceLines = await linesSubtotal10000Ils();
  const convertedLines = draftLinesFromIssuedSnapshot(
    issuedLinesSnapshotFromDraftLines(sourceLines),
    'ILS',
  );
  const totals = await computeDraftTotalsPreview(convertedLines, 'ILS', resolved, vat, date);
  assert.equal(totals.discount_amount_reference, 500);
  assert.equal(totals.subtotal_after_discount_reference, 9500);
});

test('D — converted draft issue populates conversion.target_document_id (hook + schema)', () => {
  assert.match(issueServiceSource, /linkIncomeDocumentConversionTargetOnIssue/);
  assert.match(conversionServiceSource, /export async function linkIncomeDocumentConversionTargetOnIssue/);
  assert.match(conversionServiceSource, /status: 'target_issued'/);
  assert.match(conversionServiceSource, /target_document_id: params\.issuedDocumentId/);
  assert.match(migration158, /target_document_id uuid null/);
  assert.match(migration158, /target_issued/);

  const decision = decideConversionTargetDocumentLink({
    conversionRow: { target_document_id: null },
    issuedDocumentId: 'issued-d1',
  });
  assert.equal(decision.action, 'link');
});

test('E — issue retry does not duplicate / corrupt lineage', () => {
  assert.match(issueServiceSource, /finishIdempotentIssue/);
  const finishIdx = issueServiceSource.indexOf('async function finishIdempotentIssue');
  const finishBody = issueServiceSource.slice(finishIdx, finishIdx + 1200);
  assert.match(finishBody, /linkIncomeDocumentConversionTargetOnIssue/);

  assert.equal(
    decideConversionTargetDocumentLink({
      conversionRow: { target_document_id: 'issued-d1' },
      issuedDocumentId: 'issued-d1',
    }).action,
    'idempotent',
  );
  const conflict = decideConversionTargetDocumentLink({
    conversionRow: { target_document_id: 'issued-other' },
    issuedDocumentId: 'issued-d1',
  });
  assert.equal(conflict.action, 'conflict');
});

test('F — Quote → Deal → Tax full lineage chain resolvable by IDs', () => {
  const chain = resolveIssuedConversionChain({
    startDocumentId: 'quote-q1',
    conversions: [
      { source_document_id: 'quote-q1', target_document_id: 'deal-d1' },
      { source_document_id: 'deal-d1', target_document_id: 'tax-t1' },
      { source_document_id: 'quote-q1', target_document_id: null }, // open draft ignored
    ],
  });
  assert.deepEqual(chain, ['quote-q1', 'deal-d1', 'tax-t1']);
});

test('G — cancelled source keeps conversion lineage (no delete)', () => {
  assert.equal(
    CANCEL_SOURCE_CONVERSION_LINEAGE_RULE,
    'cancel_source_keeps_conversion_rows_and_open_target_drafts',
  );
  assert.doesNotMatch(conversionServiceSource, /from\('income_document_conversions'\)\.delete/);
  assert.match(conversionServiceSource, /CANCEL_SOURCE_CONVERSION_LINEAGE_RULE/);
  assert.match(conversionServiceSource, /document_status: 'cancelled_future'/);
});

test('H — no FE arithmetic / conversion uses backend settings + totals engine', () => {
  assert.match(conversionServiceSource, /resolveDocumentSettingsForConversion/);
  assert.match(conversionServiceSource, /document_settings_json: documentSettingsJson/);
  // Convert insert must not force settings to null (legacy blocker).
  assert.doesNotMatch(
    conversionServiceSource,
    /document_settings_json:\s*null\s+as\s+Record/,
  );
  // Settings round-trip stays on canonical draft contract.
  const settings = resolveDocumentSettingsForConversion({
    sourceDraftSettingsJson: {
      vat_mode: 'standard',
      amount_rounding: 'none',
      discount: { enabled: true, type: 'percent', value: 10 },
      retainer_template: true,
    },
    sourceTotalsSnapshotJson: null,
  });
  const serialized = serializeConversionDocumentSettings(settings);
  const parsed = parseDocumentSettingsJson(serialized);
  assert.equal(parsed.discount.type, 'percent');
  assert.equal(parsed.discount.value, 10);
  assert.equal(serialized.retainer_template, undefined);
  // Converted lines serializer is backend-owned.
  assert.equal(typeof serializeConvertedDraftLines, 'function');
});

test('conversion recovers discount from totals snapshot when draft settings missing', () => {
  const recovered = resolveDocumentSettingsForConversion({
    sourceDraftSettingsJson: null,
    sourceTotalsSnapshotJson: {
      discount_enabled: true,
      discount_amount_reference: 1000,
      subtotal_after_discount_reference: 9000,
    },
  });
  assert.deepEqual(recovered.discount, {
    enabled: true,
    type: 'fixed_amount',
    value: 1000,
  });
});

test('noop when draft is not from a conversion row', () => {
  assert.equal(
    decideConversionTargetDocumentLink({
      conversionRow: null,
      issuedDocumentId: 'doc-1',
    }).action,
    'noop',
  );
});
