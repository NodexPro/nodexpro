import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canPublishLanguage,
  defaultUiLanguageFromCountry,
  flattenMessageTree,
  isIso4217Code,
  mergePublishedCatalog,
  moduleCompleteness,
  placeholdersMatch,
  publishedCurrencyOptions,
  publishedLanguageOptions,
  resolvePersistedUiLanguage,
  translationCompleteness,
  translationEntryFilterStatus,
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

test('published overlay keeps last snapshot when a later draft hides the live published row', () => {
  const merged = mergePublishedCatalog({
    bundled: { 'nav.dashboard': 'Dashboard', 'settings.save': 'Save' },
    snapshot: { 'settings.save': 'Save published' },
    livePublished: { 'nav.dashboard': 'Owner dashboard' },
  });
  assert.equal(merged['nav.dashboard'], 'Owner dashboard');
  assert.equal(merged['settings.save'], 'Save published');
});

test('module completeness is measured per group against the full catalog', () => {
  const rows = moduleCompleteness([
    { module_group: 'clientOperations', value: 'Search', placeholder_ok: true },
    { module_group: 'clientOperations', value: '', placeholder_ok: true },
    { module_group: 'settings', value: 'Save', placeholder_ok: true },
  ]);
  const co = rows.find((row) => row.module_group === 'clientOperations');
  const settings = rows.find((row) => row.module_group === 'settings');
  assert.equal(co?.catalog_size, 2);
  assert.equal(co?.translated_count, 1);
  assert.equal(co?.missing_count, 1);
  assert.equal(settings?.ratio, 1);
  assert.equal(translationEntryFilterStatus({ value: '', status: 'draft', placeholder_ok: true }), 'missing');
  assert.equal(
    translationEntryFilterStatus({ value: '', status: 'draft', placeholder_ok: true, bundled_value: 'Search' }),
    'bundled',
  );
  assert.equal(translationEntryFilterStatus({ value: 'Hi', status: 'draft', placeholder_ok: true }), 'draft');
  assert.equal(translationEntryFilterStatus({ value: 'Hi', status: 'published', placeholder_ok: true }), 'published');
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
