import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_AUTOSAVE_DEBOUNCE_MS,
  bankPatchFromForm,
  documentPatchFromForm,
  fieldDomain,
  hasPendingAutosaveWork,
  isKnownCountryCode,
  isStaleAutosaveGeneration,
  isWebsiteReadyToPersist,
  localizationCommandFromForm,
  mergeFormKeepingDirty,
  nextAutosaveGeneration,
  payloadsEqual,
  profilePatchFromForm,
  signaturePatchFromForm,
} from '../src/pages/settings-autosave.pure.ts';

const COUNTRIES = [{ code: 'IL' }, { code: 'US' }];

test('autosave debounce is 800ms and country must be known before persist', () => {
  assert.equal(SETTINGS_AUTOSAVE_DEBOUNCE_MS, 800);
  assert.equal(isKnownCountryCode('il', COUNTRIES), true);
  assert.equal(isKnownCountryCode('', COUNTRIES), false);
  assert.equal(isKnownCountryCode('XX', COUNTRIES), false);
  assert.equal(
    profilePatchFromForm(
      { country: 'XX', website: '' },
      { countryOptions: COUNTRIES, includeCountry: true, persistWebsite: true, websitePhase: 'blur' },
    ),
    null,
  );
  assert.deepEqual(
    profilePatchFromForm(
      { organizationName: 'Acme', country: 'IL', website: '' },
      { countryOptions: COUNTRIES, includeCountry: true, persistWebsite: true, websitePhase: 'blur' },
    ),
    {
      organizationName: 'Acme',
      legalEntityType: null,
      legalIdNumber: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      postalCode: null,
      phone: null,
      website: null,
      country: 'IL',
    },
  );
});

test('incomplete website is not persisted on debounce and empty website is allowed', () => {
  assert.equal(isWebsiteReadyToPersist('', 'debounce'), true);
  assert.equal(isWebsiteReadyToPersist('https://', 'debounce'), false);
  assert.equal(isWebsiteReadyToPersist('ab', 'debounce'), false);
  assert.equal(isWebsiteReadyToPersist('https://nodexpro.com', 'debounce'), true);
  assert.equal(
    profilePatchFromForm(
      { website: 'https://' },
      { countryOptions: COUNTRIES, includeCountry: false, persistWebsite: true, websitePhase: 'debounce' },
    ),
    null,
  );
  assert.equal(
    profilePatchFromForm(
      { organizationName: 'Acme', website: 'https://' },
      { countryOptions: COUNTRIES, includeCountry: false, persistWebsite: false, websitePhase: 'debounce' },
    )?.organizationName,
    'Acme',
  );
});

test('stale autosave generations and dirty-field merge protect newer edits', () => {
  assert.equal(nextAutosaveGeneration(3), 4);
  assert.equal(isStaleAutosaveGeneration(3, 4), true);
  assert.equal(isStaleAutosaveGeneration(4, 4), false);
  const merged = mergeFormKeepingDirty(
    { organizationName: 'Server', city: 'Tel Aviv', phone: '1' },
    { organizationName: 'Local newer', city: 'Tel Aviv', phone: '2' },
    ['organizationName'],
  );
  assert.equal(merged.organizationName, 'Local newer');
  assert.equal(merged.city, 'Tel Aviv');
  assert.equal(merged.phone, '1');
});

test('domain payloads stay scoped and localization rejects empty codes', () => {
  assert.equal(fieldDomain('organizationName'), 'profile');
  assert.equal(fieldDomain('documentFooterNote'), 'document');
  assert.equal(fieldDomain('iban'), 'bank');
  assert.equal(fieldDomain('signatureText'), 'signature');
  assert.equal(fieldDomain('additionalEmail'), null);
  assert.deepEqual(documentPatchFromForm({ displayPhoneOnDocuments: true }), {
    displayNameOnDocuments: null,
    displayPhoneOnDocuments: true,
    displayWebsiteOnDocuments: false,
    displayAddressOnDocuments: false,
    documentFooterNote: null,
  });
  assert.equal(bankPatchFromForm({ bankName: 'Leumi' }).bankName, 'Leumi');
  assert.equal(signaturePatchFromForm({ signatureText: 'Regards' }).signatureText, 'Regards');
  assert.equal(localizationCommandFromForm({ language_code: '', timezone: 'UTC', date_format: 'YYYY-MM-DD', display_currency_code: 'ILS' }), null);
  assert.deepEqual(
    localizationCommandFromForm({ language_code: 'he', timezone: 'UTC', date_format: 'YYYY-MM-DD', display_currency_code: 'ILS' }),
    { language_code: 'he', timezone: 'UTC', date_format: 'YYYY-MM-DD', display_currency_code: 'ILS' },
  );
  assert.equal(payloadsEqual({ a: 1 }, { a: 1 }), true);
  assert.equal(payloadsEqual({ a: 1 }, { a: 2 }), false);
});

test('pending autosave includes dirty, in-flight, and failed states', () => {
  assert.equal(hasPendingAutosaveWork({ statuses: { profile: 'idle' }, dirtyCount: 0 }), false);
  assert.equal(hasPendingAutosaveWork({ statuses: { profile: 'saving' }, dirtyCount: 0 }), true);
  assert.equal(hasPendingAutosaveWork({ statuses: { localization: 'error' }, dirtyCount: 0 }), true);
  assert.equal(hasPendingAutosaveWork({ statuses: { profile: 'saved' }, dirtyCount: 1 }), true);
});
