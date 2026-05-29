import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLineFieldUpdate,
  createEmptyDraftLine,
  normalizeDraftLines,
  serializeDraftLines,
} from '../../src/domains/income/income-document-draft-lines.pure.js';
import {
  computeDraftTotalsPreview,
  DEFAULT_DOCUMENT_SETTINGS,
} from '../../src/domains/income/income-document-draft-totals.pure.js';
import {
  computeDiscountAmountIls,
  validateDocumentDiscount,
} from '../../src/domains/income/income-document-discount.pure.js';
import { incomeDraftVatFallbackResolution } from '../../src/domains/income/income-draft-vat-fallback.pure.js';

const vat = incomeDraftVatFallbackResolution();
const date = '2026-05-21';

async function lineTotals100Ils() {
  const lines = normalizeDraftLines(serializeDraftLines([createEmptyDraftLine(0)]));
  const updated = applyLineFieldUpdate(lines, lines[0].line_id, {
    unit_price_reference: 100,
    quantity: 1,
    currency: 'ILS',
    price_includes_vat: false,
    vat_rate_code: 'standard',
  });
  return updated;
}

test('10% discount before VAT recalculates VAT on discounted subtotal', async () => {
  const lines = await lineTotals100Ils();
  const settings = {
    ...DEFAULT_DOCUMENT_SETTINGS,
    discount: { enabled: true, type: 'percent' as const, value: 10 },
  };
  const totals = await computeDraftTotalsPreview(lines, 'ILS', settings, vat, date);
  assert.equal(totals.subtotal_before_discount_reference, 100);
  assert.equal(totals.discount_amount_reference, 10);
  assert.equal(totals.subtotal_after_discount_reference, 90);
  assert.equal(totals.vat_reference, 16.2);
  assert.equal(totals.grand_total_reference, 106.2);
});

test('fixed amount discount before VAT', async () => {
  const lines = await lineTotals100Ils();
  const settings = {
    ...DEFAULT_DOCUMENT_SETTINGS,
    discount: { enabled: true, type: 'fixed_amount' as const, value: 25 },
  };
  const totals = await computeDraftTotalsPreview(lines, 'ILS', settings, vat, date);
  assert.equal(totals.discount_amount_reference, 25);
  assert.equal(totals.subtotal_after_discount_reference, 75);
  assert.equal(totals.vat_reference, 13.5);
  assert.equal(totals.grand_total_reference, 88.5);
});

test('fixed discount cannot exceed subtotal before VAT', () => {
  const errors = validateDocumentDiscount(
    { enabled: true, type: 'fixed_amount', value: 150 },
    100,
  );
  assert.ok(errors.value);
});

test('percent cannot exceed 100', () => {
  const errors = validateDocumentDiscount({ enabled: true, type: 'percent', value: 101 }, 100);
  assert.ok(errors.value);
});

test('computeDiscountAmountIls caps fixed discount at subtotal', () => {
  const amount = computeDiscountAmountIls(
    { enabled: true, type: 'fixed_amount', value: 500 },
    100,
    'none',
  );
  assert.equal(amount, 100);
});

test('mixed VAT row: exempt line keeps zero VAT after document discount', async () => {
  const a = createEmptyDraftLine(0);
  const b = createEmptyDraftLine(1);
  let lines = normalizeDraftLines(serializeDraftLines([a, b]));
  lines = applyLineFieldUpdate(lines, lines[0].line_id, {
    unit_price_reference: 100,
    quantity: 1,
    vat_rate_code: 'standard',
    price_includes_vat: false,
  });
  lines = applyLineFieldUpdate(lines, lines[1].line_id, {
    unit_price_reference: 50,
    quantity: 1,
    vat_rate_code: 'exempt',
    price_includes_vat: false,
  });
  const settings = {
    ...DEFAULT_DOCUMENT_SETTINGS,
    discount: { enabled: true, type: 'percent' as const, value: 10 },
  };
  const totals = await computeDraftTotalsPreview(lines, 'ILS', settings, vat, date);
  assert.equal(totals.subtotal_before_discount_reference, 150);
  assert.equal(totals.discount_amount_reference, 15);
  assert.equal(totals.vat_reference, 16.2);
});
