import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applyLineFieldUpdate,
  createEmptyDraftLine,
  normalizeDraftLines,
  serializeDraftLines,
} from '../../src/domains/income/income-document-draft-lines.pure.js';
import { computeDraftTotalsPreview } from '../../src/domains/income/income-document-draft-totals.pure.js';
import { computeDraftLineAmounts } from '../../src/domains/income/income-draft-line-compute.pure.js';
import { resolveDraftExchangeRateToIls } from '../../src/domains/income/income-draft-exchange-rate.pure.js';
import { incomeDraftVatFallbackResolution } from '../../src/domains/income/income-draft-vat-fallback.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const frontendSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineDocumentDetailsStep.tsx'),
  'utf8',
);
const buildersSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);

const vat = incomeDraftVatFallbackResolution();
const settings = { vat_mode: 'standard' as const, amount_rounding: 'none' as const };
const documentDate = '2026-05-21';

test('each line can have its own currency', () => {
  const a = createEmptyDraftLine(0, { currency: 'ILS' });
  const b = createEmptyDraftLine(1, { currency: 'USD' });
  b.unit_price_reference = 100;
  b.quantity = 1;
  const lines = normalizeDraftLines(serializeDraftLines([a, b]));
  assert.equal(lines[0].currency, 'ILS');
  assert.equal(lines[1].currency, 'USD');
  assert.ok(buildersSource.includes('allowed_currencies'));
  assert.ok(buildersSource.includes('currency: {'));
});

test('non-ILS row exposes default exchange rate and override field', () => {
  const line = createEmptyDraftLine(0, { currency: 'USD' });
  line.unit_price_reference = 10;
  const fx = resolveDraftExchangeRateToIls('USD', documentDate, null);
  assert.ok(fx.rate_to_ils > 0);
  assert.match(fx.source_label, /שער/);
  assert.ok(buildersSource.includes('exchange_rate_default'));
  assert.ok(buildersSource.includes('exchange_rate_override'));
  assert.ok(frontendSource.includes('שער יציג להיום'));
  assert.ok(frontendSource.includes('שער מותאם'));
});

test('price_includes_vat options exist per row in aggregate', () => {
  assert.ok(buildersSource.includes('price_mode_options'));
  assert.ok(buildersSource.includes('price_includes_vat'));
  assert.ok(frontendSource.includes('price_mode_options'));
});

test('VAT rate still comes from backend legal resolver module', () => {
  assert.ok(buildersSource.includes('resolveIncomeDraftVatForOrg'));
  assert.ok(buildersSource.includes('compactVatSelectLabel'));
  assert.equal(vat.standard_rate, 0.18);
});

test('frontend does not calculate totals VAT or exchange rate', () => {
  assert.ok(!frontendSource.includes('standard_rate'));
  assert.ok(!frontendSource.includes('rate_to_ils *'));
  assert.ok(!frontendSource.match(/vat.*\*.*0\./));
  assert.ok(frontendSource.includes('line_total_display'));
  assert.ok(frontendSource.includes('exchange_rate_default'));
});

test('per-line USD with override recalculates ILS total on backend', () => {
  let line = createEmptyDraftLine(0, { currency: 'USD', price_includes_vat: false, vat_rate_code: 'standard' });
  line.unit_price_reference = 100;
  line.quantity = 1;
  line = applyLineFieldUpdate([line], line.line_id, { exchange_rate_to_ils_override: 4 })[0];
  const amounts = computeDraftLineAmounts(line, settings, vat, documentDate);
  assert.equal(amounts.line_total_ils, 472);
});

test('price includes VAT uses gross split on backend', () => {
  let line = createEmptyDraftLine(0, { currency: 'ILS', price_includes_vat: true, vat_rate_code: 'standard' });
  line.unit_price_reference = 118;
  line.quantity = 1;
  const amounts = computeDraftLineAmounts(line, settings, vat, documentDate);
  assert.equal(amounts.line_total_ils, 118);
  assert.equal(amounts.line_vat_ils, 18);
});

test('document totals are backend-calculated from line ILS amounts', () => {
  let line = createEmptyDraftLine(0);
  line.unit_price_reference = 100;
  line.quantity = 1;
  const lines = normalizeDraftLines(serializeDraftLines([line]));
  const totals = computeDraftTotalsPreview(lines, 'ILS', settings, vat, documentDate);
  assert.equal(totals.grand_total_reference, 118);
  assert.equal(totals.not_financial_truth, true);
});

test('frontend has V confirm button and no per-keystroke command', () => {
  assert.ok(frontendSource.includes('nx-we-doc-details__confirm'));
  assert.ok(frontendSource.includes('commitDraft'));
  assert.ok(!frontendSource.includes('onChange={(e) => void runCommand'));
});

test('aggregate columns include row_number drag and confirm', () => {
  for (const key of ['row_number', 'drag', 'confirm', 'delete']) {
    assert.ok(buildersSource.includes(`key: '${key}'`), `missing column ${key}`);
  }
});
