import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canPublishLanguage,
  defaultUiLanguageFromCountry,
  flattenMessageTree,
  isIso4217Code,
  placeholdersMatch,
  publishedCurrencyOptions,
  publishedLanguageOptions,
  resolvePersistedUiLanguage,
  translationCompleteness,
  uiLanguageDirection,
  validateLocalizationPreferences,
} from '../../src/domains/platform-localization/platform-localization.pure.js';

test('ISO currency and published-only options', () => {
  assert.equal(isIso4217Code('GBP'), true);
  assert.equal(isIso4217Code('gb'), false);
  const options = publishedCurrencyOptions([
    { code: 'ILS', name_en: 'Shekel', symbol: '₪', status: 'published' },
    { code: 'GBP', name_en: 'Pound', symbol: '£', status: 'draft' },
  ]);
  assert.deepEqual(options.map((row) => row.code), ['ILS']);
});

test('draft languages are not selectable and incomplete catalogs cannot publish', () => {
  const languages = publishedLanguageOptions([
    { locale_code: 'en', name: 'English', direction: 'ltr', status: 'published' },
    { locale_code: 'es', name: 'Español', direction: 'ltr', status: 'draft' },
  ]);
  assert.deepEqual(languages.map((row) => row.locale), ['en']);
  assert.equal(canPublishLanguage({ catalogSize: 10, translatedCount: 9, placeholderFailures: 0 }).ok, false);
  assert.equal(canPublishLanguage({ catalogSize: 10, translatedCount: 10, placeholderFailures: 1 }).ok, false);
  assert.equal(canPublishLanguage({ catalogSize: 10, translatedCount: 10, placeholderFailures: 0 }).ok, true);
});

test('placeholder integrity and localization preference validation', () => {
  assert.equal(placeholdersMatch('Hello {{name}}', 'שלום {{name}}'), true);
  assert.equal(placeholdersMatch('Hello {{name}}', 'Hello'), false);
  const flat = flattenMessageTree({ settings: { save: 'Save' }, clients: { create: 'New client' } });
  assert.equal(flat['settings.save'], 'Save');
  assert.equal(translationCompleteness({ catalogSize: 4, translatedCount: 2 }).complete, false);
  assert.equal(
    validateLocalizationPreferences({
      languageCode: 'en',
      timezone: 'Asia/Jerusalem',
      dateFormat: 'DD/MM/YYYY',
      displayCurrencyCode: 'ILS',
      publishedLanguageLocales: ['en', 'he'],
      publishedCurrencyCodes: ['ILS', 'USD', 'EUR'],
    }).ok,
    true,
  );
});

test('registration-country default is first-time only: IL → he, every other country → en', () => {
  assert.equal(defaultUiLanguageFromCountry('IL'), 'he');
  assert.equal(defaultUiLanguageFromCountry('il'), 'he');
  assert.equal(defaultUiLanguageFromCountry(' Israel '), 'en');
  assert.equal(defaultUiLanguageFromCountry('US'), 'en');
  assert.equal(defaultUiLanguageFromCountry('GB'), 'en');
  assert.equal(defaultUiLanguageFromCountry(''), 'en');
  assert.equal(defaultUiLanguageFromCountry(null), 'en');
  assert.equal(defaultUiLanguageFromCountry(undefined), 'en');
});

test('persisted explicit preference wins over country; unknown/null falls back to English', () => {
  assert.equal(resolvePersistedUiLanguage('he'), 'he');
  assert.equal(resolvePersistedUiLanguage('HE'), 'he');
  assert.equal(resolvePersistedUiLanguage('en'), 'en');
  assert.equal(resolvePersistedUiLanguage(null), 'en');
  assert.equal(resolvePersistedUiLanguage(''), 'en');
  assert.equal(resolvePersistedUiLanguage('fr'), 'en');
  assert.equal(uiLanguageDirection('he'), 'rtl');
  assert.equal(uiLanguageDirection('en'), 'ltr');
});
