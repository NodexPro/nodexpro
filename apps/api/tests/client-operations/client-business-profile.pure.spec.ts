import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  projectBusinessProfileCanonicalDates,
  toCanonicalIsoDateOnly,
} from '../../src/domains/client-operations/client-business-profile.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const serviceSrc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-business-profile.service.ts'),
  'utf8',
);

test('canonical ISO date-only keeps YYYY-MM-DD and empty stays empty', () => {
  assert.equal(toCanonicalIsoDateOnly('2019-03-01'), '2019-03-01');
  assert.equal(toCanonicalIsoDateOnly(null), null);
  assert.equal(toCanonicalIsoDateOnly(''), null);
  assert.equal(toCanonicalIsoDateOnly('not-a-date'), null);
});

test('business profile dates project from Client Details created_at / ended_at', () => {
  assert.deepEqual(
    projectBusinessProfileCanonicalDates({
      clientCreatedAt: '2019-03-01T08:15:00.000Z',
      clientEndedAt: '2026-01-31',
    }),
    { business_open_date: '2019-03-01', business_close_date: '2026-01-31' },
  );
  assert.deepEqual(
    projectBusinessProfileCanonicalDates({ clientCreatedAt: null, clientEndedAt: null }),
    { business_open_date: null, business_close_date: null },
  );
});

test('Accounting Settings section projects canonical dates and hides peak months without clearing storage', () => {
  assert.match(serviceSrc, /projectBusinessProfileCanonicalDates/);
  assert.match(serviceSrc, /select\('created_at, ended_at'\)/);
  assert.match(serviceSrc, /editable: false,\s*\n\s*visible: true,/);
  assert.match(serviceSrc, /const visiblePeakMonths = false/);
  assert.match(serviceSrc, /value: peakMonths/);
  assert.match(serviceSrc, /business_open_date = existingRec\?\.business_open_date \?\? null/);
  assert.match(serviceSrc, /peak_months = uniqueSortedMonths\(Array\.isArray\(preservedPeakRaw\)/);
  assert.doesNotMatch(serviceSrc, /business_open_date = parseDateOnlyOptional\(body\.business_open_date\)/);
});
