import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLineFieldUpdate,
  createEmptyDraftLine,
  normalizeDraftLines,
} from '../../src/domains/income/income-document-draft-lines.pure.js';
import {
  DRAFT_LINE_EXCHANGE_RATE_INVALID_MESSAGE,
  parseDraftLineCurrency,
  resolveDraftExchangeRateToIls,
} from '../../src/domains/income/income-draft-exchange-rate.pure.js';
import { computeDraftLineAmounts } from '../../src/domains/income/income-draft-line-compute.pure.js';
import { incomeDraftVatFallbackResolution } from '../../src/domains/income/income-draft-vat-fallback.pure.js';

const settings = { vat_mode: 'standard' as const, amount_rounding: 'none' as const };
const vat = incomeDraftVatFallbackResolution();
const documentDate = '2026-05-21';

test('parseDraftLineCurrency maps ₪ to ILS', () => {
  assert.equal(parseDraftLineCurrency('₪'), 'ILS');
  assert.equal(parseDraftLineCurrency('ILS'), 'ILS');
});

test('ILS row update with quantity + unit_price and no exchange_rate succeeds', () => {
  const line = createEmptyDraftLine(0, { currency: 'ILS' });
  const updated = applyLineFieldUpdate([line], line.line_id, {
    quantity: 2,
    unit_price_reference: 100,
    currency: 'ILS',
    exchange_rate_to_ils_override: null,
  });
  assert.equal(updated[0].currency, 'ILS');
  assert.equal(updated[0].exchange_rate_to_ils_override, null);
  assert.equal(updated[0].quantity, 2);
  assert.equal(updated[0].unit_price_reference, 100);

  const amounts = computeDraftLineAmounts(updated[0], settings, vat, documentDate);
  assert.equal(amounts.line_total_ils, 236);
  assert.equal(resolveDraftExchangeRateToIls('ILS', documentDate, null).rate_to_ils, 1);
});

test('ILS row update ignores explicit zero exchange override', () => {
  const line = createEmptyDraftLine(0, { currency: 'ILS' });
  const updated = applyLineFieldUpdate([line], line.line_id, {
    unit_price_reference: 50,
    quantity: 1,
    exchange_rate_to_ils_override: 0,
  });
  assert.equal(updated[0].exchange_rate_to_ils_override, null);
});

test('normalized ILS lines never keep exchange override', () => {
  const lines = normalizeDraftLines([
    {
      currency: '₪',
      quantity: 1,
      unit_price_reference: 10,
      exchange_rate_to_ils_override: 3.5,
    },
  ]);
  assert.equal(lines[0].currency, 'ILS');
  assert.equal(lines[0].exchange_rate_to_ils_override, null);
});

test('non-ILS row with zero exchange override fails with Hebrew message', () => {
  const line = createEmptyDraftLine(0, { currency: 'USD' });
  assert.throws(
    () =>
      applyLineFieldUpdate([line], line.line_id, {
        exchange_rate_to_ils_override: 0,
      }),
    (err: Error) => {
      assert.equal(err.message, DRAFT_LINE_EXCHANGE_RATE_INVALID_MESSAGE);
      return true;
    },
  );
});

test('non-ILS row without override uses backend default rate', () => {
  const line = createEmptyDraftLine(0, { currency: 'USD' });
  line.unit_price_reference = 100;
  const updated = applyLineFieldUpdate([line], line.line_id, {
    quantity: 1,
    currency: 'USD',
  });
  assert.equal(updated[0].exchange_rate_to_ils_override, null);
  const fx = resolveDraftExchangeRateToIls('USD', documentDate, null);
  assert.ok(fx.rate_to_ils > 0);
  const amounts = computeDraftLineAmounts(updated[0], settings, vat, documentDate);
  assert.ok(amounts.line_total_ils != null && amounts.line_total_ils > 100);
});
