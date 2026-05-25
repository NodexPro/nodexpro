import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseBoiSdmxJsonObservations,
  pickBoiRateForDate,
} from '../../src/domains/income/income-boi-exchange-rate.pure.js';
import {
  buildDraftExchangeRateResolution,
} from '../../src/domains/income/income-draft-exchange-rate.pure.js';
import {
  clearIncomeExchangeRateCacheForTests,
  resolveOfficialBoiExchangeRate,
  setIncomeExchangeRateFetchForTests,
} from '../../src/domains/income/income-exchange-rate.service.js';

const dir = dirname(fileURLToPath(import.meta.url));
const sdmxFixture = JSON.parse(
  readFileSync(join(dir, '../fixtures/boi-usd-sdmx.json'), 'utf8'),
);

test('parseBoiSdmxJsonObservations reads representative USD series', () => {
  const obs = parseBoiSdmxJsonObservations(sdmxFixture);
  assert.equal(obs.length, 3);
  assert.equal(obs[2].date, '2026-05-21');
  assert.equal(obs[2].rate, 3.7245);
});

test('pickBoiRateForDate uses exact date when available', () => {
  const obs = parseBoiSdmxJsonObservations(sdmxFixture);
  const pick = pickBoiRateForDate(obs, '2026-05-20');
  assert.equal(pick.exact_date_match, true);
  assert.equal(pick.observation?.rate, 3.7123);
});

test('pickBoiRateForDate uses latest previous when date missing', () => {
  const obs = parseBoiSdmxJsonObservations(sdmxFixture);
  const pick = pickBoiRateForDate(obs, '2026-05-18');
  assert.equal(pick.exact_date_match, false);
  assert.equal(pick.observation?.date, '2026-05-19');
});

test('USD row resolves official backend rate from BOI SDMX (mocked)', async () => {
  clearIncomeExchangeRateCacheForTests();
  setIncomeExchangeRateFetchForTests(async (url) => {
    if (String(url).includes('RER_USD_ILS') && String(url).includes('sdmx-json')) {
      return new Response(JSON.stringify(sdmxFixture), { status: 200 });
    }
    if (String(url).includes('RER_USD_ILS') && String(url).includes('format=csv')) {
      return new Response('TIME_PERIOD,RER_USD_ILS\n2026-05-21,3.7245\n', { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

  const official = await resolveOfficialBoiExchangeRate('USD', '2026-05-21');
  assert.equal(official.rate_to_ils, 3.7245);
  assert.equal(official.source, 'boi_sdmx');
  assert.equal(official.exact_date_match, true);

  clearIncomeExchangeRateCacheForTests();
  setIncomeExchangeRateFetchForTests(null);
});

test('override replaces official effective rate', () => {
  const official = {
    currency: 'USD',
    rate_to_ils: 3.7245,
    rate_display: '3.7245',
    rate_date: '2026-05-21',
    requested_date: '2026-05-21',
    exact_date_match: true,
    source: 'boi_sdmx' as const,
  };
  const fx = buildDraftExchangeRateResolution('USD', '2026-05-21', official, 4.1);
  assert.equal(fx?.rate_to_ils, 4.1);
  assert.equal(fx?.source_label, 'שער מותאם');
  assert.equal(fx?.rate_official_display, '3.7245');
});

test('ILS hides rate and uses 1', () => {
  const fx = buildDraftExchangeRateResolution('ILS', '2026-05-21', null, null);
  assert.equal(fx?.rate_to_ils, 1);
  assert.equal(fx?.source, 'ils');
});

test('non-ILS zero override still allows official rate in resolution', () => {
  const official = {
    currency: 'EUR',
    rate_to_ils: 3.3794,
    rate_display: '3.3794',
    rate_date: '2026-05-21',
    requested_date: '2026-05-21',
    exact_date_match: true,
    source: 'boi_sdmx' as const,
  };
  const fx = buildDraftExchangeRateResolution('EUR', '2026-05-21', official, null);
  assert.equal(fx?.rate_to_ils, 3.3794);
  assert.match(fx?.source_label ?? '', /שער יציג/);
});
