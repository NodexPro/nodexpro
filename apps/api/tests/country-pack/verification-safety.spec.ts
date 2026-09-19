import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PERMANENT_DEV_SUPABASE_REF,
  VERIFICATION_RESERVED_COUNTRY_CODES,
  assertCountryPackVerificationAllowed,
  disposableVerificationCountryCodes,
  formatCleanupError,
  isPermanentDevSupabaseUrl,
  nextVerificationCountryCode,
  shouldRunInFilter,
} from './verification-safety.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const DEV_URL = `https://${PERMANENT_DEV_SUPABASE_REF}.supabase.co`;

test('shared DEV cannot be polluted by the country-pack verification suite', () => {
  assert.equal(isPermanentDevSupabaseUrl(DEV_URL), true);
  assert.equal(isPermanentDevSupabaseUrl(`https://${PERMANENT_DEV_SUPABASE_REF}.supabase.co/rest/v1`), true);
  assert.equal(isPermanentDevSupabaseUrl('https://other-project.supabase.co'), false);
  assert.equal(isPermanentDevSupabaseUrl(''), false);
  assert.throws(
    () => assertCountryPackVerificationAllowed(DEV_URL),
    /refuse destructive country-pack verification against permanent DEV/i,
  );

  const spec = readRepo('apps/api/tests/country-pack/verification.spec.ts');
  const guard = readRepo('apps/api/tests/country-pack/verification-safety.pure.ts');
  assert.match(spec, /isPermanentDevSupabaseUrl\(process\.env\.SUPABASE_URL\)/);
  assert.match(spec, /assertCountryPackVerificationAllowed/);
  assert.match(spec, /t\.skip/);
  assert.match(guard, /jgxezhjctrgfbmmkqqhn/);
  assert.doesNotMatch(spec, /function randomCountryCode/);
  assert.doesNotMatch(spec, /Math\.random\(\) \* alphabet/);

  const createCountry = readRepo('apps/api/src/domains/country-pack/country-pack-commands.service.ts');
  const start = createCountry.indexOf('async function handleCreateCountry');
  const end = createCountry.indexOf('async function handleCreateCountryPack');
  assert.ok(start >= 0 && end > start);
  const fn = createCountry.slice(start, end);
  assert.match(fn, /\.from\('countries'\)/);
  assert.match(fn, /\.insert\(insertRow\)/);
  assert.doesNotMatch(fn, /jgxezhjctrgfbmmkqqhn|isPermanentDev|TAX-646A/);
});

test('verification countries use reserved user-assigned codes, not arbitrary real ISO-2', () => {
  const first = nextVerificationCountryCode([]);
  const second = nextVerificationCountryCode([first]);
  assert.equal(first, 'QZ');
  assert.equal(second, 'QY');
  assert.notEqual(first, 'IL');
  assert.notEqual(first, 'US');
  assert.notEqual(first, 'PE');
  assert.notEqual(first, 'HP');
  for (const code of VERIFICATION_RESERVED_COUNTRY_CODES) {
    assert.match(code, /^Q[M-Z]$/);
  }
  assert.throws(() => nextVerificationCountryCode([...VERIFICATION_RESERVED_COUNTRY_CODES]), /no reserved/);
  assert.deepEqual(disposableVerificationCountryCodes(['QZ', 'IL', 'us', 'QY']), ['QZ', 'QY']);
});

test('cleanup skips empty in() filters and surfaces delete errors', () => {
  assert.equal(shouldRunInFilter([]), false);
  assert.equal(shouldRunInFilter(['QZ']), true);
  assert.equal(formatCleanupError('countries', null), null);
  assert.equal(formatCleanupError('countries', { message: 'boom' })?.message, 'countries: boom');

  const spec = readRepo('apps/api/tests/country-pack/verification.spec.ts');
  assert.match(spec, /shouldRunInFilter/);
  assert.match(spec, /formatCleanupError/);
  assert.match(spec, /disposableVerificationCountryCodes/);
  assert.match(spec, /countries still present after cleanup/);
  assert.doesNotMatch(spec, /\.in\(\[\]\)/);
});
