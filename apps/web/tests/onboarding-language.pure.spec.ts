/**
 * Onboarding language and localization options.
 * HE/RTL and EN/LTR, including register → confirm → F5 → re-login contracts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  firstLocalizationOptionValue,
  localizationValueAllowed,
} from '../src/lib/onboarding-form.pure.ts';
import { resolvePublicUiLang } from '../src/lib/public-ui-lang.pure.ts';
import { decideSessionLanguageApply } from '../src/lib/session-language-bootstrap.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('onboarding country and timezone come only from backend localization options', () => {
  const options = [
    { code: 'IL', value: 'Asia/Jerusalem' },
    { code: 'US', value: 'America/New_York' },
  ];
  assert.equal(localizationValueAllowed('IL', options), true);
  assert.equal(localizationValueAllowed('DE', options), false);
  assert.equal(localizationValueAllowed('', options), false);
  assert.equal(firstLocalizationOptionValue([]), '');
  const page = read('../src/pages/CreateOrganization.tsx');
  assert.match(page, /localizationValueAllowed/);
  assert.match(page, /localization\?\.country\.options/);
  assert.match(page, /localization\?\.timezone\.options/);
  assert.doesNotMatch(page, /United States/);
  assert.doesNotMatch(page, /useState\('US'\)/);
  assert.doesNotMatch(page, /useState\('Asia\//);
  assert.match(page, /countryOptions\.map/);
  assert.match(page, /timezoneOptions\.map/);
});

test('PublicAuthShell is HE RTL and EN LTR; register persists the chosen language', () => {
  const shell = read('../src/components/auth/PublicAuthShell.tsx');
  const register = read('../src/pages/Register.tsx');
  const sync = read('../src/components/auth/SessionLanguageSync.tsx');
  const i18n = read('../src/i18n/I18nProvider.tsx');
  assert.match(shell, /const dir = lang === 'he' \? 'rtl' : 'ltr'/);
  assert.match(shell, /dir=\{dir\}/);
  assert.match(shell, /lang=\{lang\}/);
  assert.match(register, /language_code: lang/);
  assert.match(register, /AUTH\.setUiLanguageCommand/);
  assert.match(sync, /sidebar_account_block\?\.language_selector\?\.current_value/);
  assert.match(sync, /decideSessionLanguageApply/);
  assert.doesNotMatch(sync, /geoCountry|nx-geo-country|navigator\.language/);
  assert.equal(decideSessionLanguageApply({ storedPublicLang: 'he', sessionLang: 'en' }), 'he');
  assert.equal(
    decideSessionLanguageApply({ storedPublicLang: 'en', sessionLang: 'he', sessionPersisted: false }),
    'en',
  );
  assert.equal(
    decideSessionLanguageApply({ storedPublicLang: 'en', sessionLang: 'he', sessionPersisted: true }),
    'he',
  );
  assert.match(i18n, /PUBLIC_LANG_STORAGE_KEY/);
  assert.match(i18n, /readInitialUiLang/);
  assert.equal(resolvePublicUiLang({ stored: 'he', geoCountry: 'US' }), 'he');
  assert.equal(resolvePublicUiLang({ stored: 'en', geoCountry: 'IL' }), 'en');
  assert.equal(resolvePublicUiLang({ stored: null, geoCountry: 'IL' }), 'he');
});

test('onboarding copy exists in HE and EN and is not English in Hebrew', () => {
  const en = JSON.parse(read('../src/i18n/en.json')) as { auth: Record<string, string> };
  const he = JSON.parse(read('../src/i18n/he.json')) as { auth: Record<string, string> };
  for (const key of [
    'onboardingTitle',
    'organizationName',
    'country',
    'timezone',
    'selectCountry',
    'selectTimezone',
    'createOrganization',
    'creatingOrganization',
    'organizationNameRequired',
    'countryRequired',
    'timezoneRequired',
    'createOrganizationFailed',
    'organizationCreatedSessionFailed',
  ]) {
    assert.equal(typeof en.auth[key], 'string', `missing EN auth.${key}`);
    assert.equal(typeof he.auth[key], 'string', `missing HE auth.${key}`);
    assert.notEqual(he.auth[key], en.auth[key], `HE auth.${key} should not copy EN`);
  }
  assert.match(he.auth.onboardingTitle, /ארגון/);
});
