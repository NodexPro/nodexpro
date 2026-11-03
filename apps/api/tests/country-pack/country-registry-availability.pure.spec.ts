import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canAssignOrganizationCountry,
  isIso3166UserAssignedAlpha2,
  isOfficiallyAssignedIso3166Alpha2,
  isUserFacingRegistryCountry,
  normalizeCountryRegistryCode,
  selectUserFacingRegistryCountries,
} from '../../src/domains/country-pack/country-registry-availability.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('user-facing registry countries use official ISO assignment + active status', () => {
  assert.equal(isOfficiallyAssignedIso3166Alpha2('IL'), true);
  assert.equal(isOfficiallyAssignedIso3166Alpha2('US'), true);
  assert.equal(isOfficiallyAssignedIso3166Alpha2('GB'), true);
  assert.equal(isOfficiallyAssignedIso3166Alpha2('ZZ'), false);
  assert.equal(isOfficiallyAssignedIso3166Alpha2('W8'), false);
  assert.equal(isOfficiallyAssignedIso3166Alpha2('XX'), false);
  assert.equal(isIso3166UserAssignedAlpha2('ZZ'), true);
  assert.equal(isIso3166UserAssignedAlpha2('AA'), true);
  assert.equal(isIso3166UserAssignedAlpha2('QM'), true);
  assert.equal(isIso3166UserAssignedAlpha2('IL'), false);

  assert.equal(isUserFacingRegistryCountry({ code: 'IL', status: 'active' }), true);
  assert.equal(isUserFacingRegistryCountry({ code: 'US', status: 'active' }), true);
  assert.equal(isUserFacingRegistryCountry({ code: 'ZZ', status: 'active' }), false);
  assert.equal(isUserFacingRegistryCountry({ code: 'IL', status: 'disabled' }), false);
  assert.equal(isUserFacingRegistryCountry({ code: 'W8', status: 'active' }), false);

  const rows = selectUserFacingRegistryCountries([
    { code: 'ZZ', status: 'active', name: 'cp-verify-1777042857266-w8xiu-country' },
    { code: 'us', status: 'active', name: 'United States' },
    { code: 'IL', status: 'active', name: 'Israel' },
    { code: 'W8', status: 'active', name: 'verify leftover' },
    { code: 'XX', status: 'disabled', name: 'Draftland' },
  ]);
  assert.deepEqual(
    rows.map((row) => normalizeCountryRegistryCode(row.code)),
    ['IL', 'US'],
  );
});

test('current organization country stays assignable even when it is not user-facing', () => {
  assert.equal(canAssignOrganizationCountry({ code: 'ZZ', currentOrganizationCountryCode: 'ZZ' }), true);
  assert.equal(canAssignOrganizationCountry({ code: 'ZZ', currentOrganizationCountryCode: 'IL' }), false);
  assert.equal(canAssignOrganizationCountry({ code: 'IL', currentOrganizationCountryCode: 'US' }), true);
});

test('Settings session list and PATCH use registry availability, not a name prefix', () => {
  const filter = read('../../src/domains/country-pack/country-registry-availability.pure.ts');
  const session = read('../../src/domains/auth/session-preferences.service.ts');
  const settings = read('../../src/domains/organization-settings/organization-settings.service.ts');
  const ownerAdmin = read('../../src/domains/country-pack/country-pack-read-models.service.ts');
  assert.match(filter, /isOfficiallyAssignedIso3166Alpha2/);
  assert.match(filter, /status !== 'active'/);
  assert.doesNotMatch(filter, /cp-verify/);
  assert.match(session, /selectUserFacingRegistryCountries/);
  assert.doesNotMatch(session, /cp-verify/);
  assert.match(settings, /canAssignOrganizationCountry/);
  assert.match(settings, /COUNTRY_NOT_AVAILABLE/);
  assert.match(ownerAdmin, /from\('countries'\)\.select\('code, name, status, default_timezone, created_at'\)/);
});

test('verification leftovers stay off production and never delete Israel or US', () => {
  const verification = read('../../tests/country-pack/verification.spec.ts');
  assert.match(verification, /PRODUCTION_HOST/);
  assert.match(verification, /liveCountryPackDbConfigured/);
  assert.match(verification, /PROTECTED_COUNTRY_CODES/);
  assert.match(verification, /allocateTemporaryCountryCode/);
  assert.doesNotMatch(verification, /function randomCountryCode/);
  assert.match(verification, /!PROTECTED_COUNTRY_CODES\.has/);
});
