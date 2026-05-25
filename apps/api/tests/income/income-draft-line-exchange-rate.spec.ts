import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLineFieldUpdate,
  createEmptyDraftLine,
  normalizeDraftLines,
} from '../../src/domains/income/income-document-draft-lines.pure.js';
import {
  buildDraftExchangeRateResolution,
  DRAFT_LINE_EXCHANGE_RATE_INVALID_MESSAGE,
  parseDraftLineCurrency,
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

  const fx = buildDraftExchangeRateResolution('ILS', documentDate, null, null)!;
  const amounts = computeDraftLineAmounts(updated[0], settings, vat, fx);
  assert.equal(amounts.line_total_ils, 236);
  assert.equal(fx.rate_to_ils, 1);
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

test('non-ILS row without override uses official rate in compute', () => {
  const line = createEmptyDraftLine(0, { currency: 'USD' });
  line.unit_price_reference = 100;
  const official = {
    currency: 'USD',
    rate_to_ils: 3.65,
    rate_display: '3.6500',
    rate_date: '2026-05-21',
    requested_date: '2026-05-21',
    exact_date_match: true,
    source: 'boi_sdmx' as const,
  };
  const fx = buildDraftExchangeRateResolution('USD', documentDate, official, null)!;
  const amounts = computeDraftLineAmounts(line, settings, vat, fx);
  assert.ok(amounts.line_total_ils != null && amounts.line_total_ils > 100);
});
