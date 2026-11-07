import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModuleLocalizationAudit,
  isWrongLanguageSystemText,
  liveDisplayValue,
  overlayValueAllowedForLocale,
  translationEmptyExplanation,
  translationValueOrigin,
} from '../../src/domains/platform-localization/platform-localization-audit.pure.js';

test('bundled-only keys are not missing live translations', () => {
  assert.equal(
    translationValueOrigin({ ownerValue: '', ownerStatus: 'published', bundledValue: 'Client name' }),
    'bundled',
  );
  assert.equal(
    translationEmptyExplanation({ ownerValue: '', bundledValue: 'Client name', placeholderOk: true }),
    'no_owner_override',
  );
  assert.equal(
    liveDisplayValue({ ownerValue: '', ownerStatus: 'published', bundledValue: 'Client name' }),
    'Client name',
  );
  assert.equal(
    liveDisplayValue({ ownerValue: 'שם לקוח', ownerStatus: 'draft', bundledValue: 'Client name' }),
    'Client name',
  );
  assert.equal(
    liveDisplayValue({ ownerValue: 'שם לקוח', ownerStatus: 'published', bundledValue: 'Client name' }),
    'שם לקוח',
  );
});

test('wrong-language detection allows brands and legal glosses', () => {
  assert.equal(isWrongLanguageSystemText('שם לקוח', 'en'), true);
  assert.equal(isWrongLanguageSystemText('Client name', 'en'), false);
  assert.equal(isWrongLanguageSystemText('DocFlow', 'he'), false);
  assert.equal(isWrongLanguageSystemText('Exempt dealer (עוסק פטור)', 'en'), false);
  assert.equal(overlayValueAllowedForLocale('שם לקוח', 'en'), false);
  assert.equal(overlayValueAllowedForLocale('Client name', 'en'), true);
});

test('Client Operations English audit reports confirmed issues only', () => {
  const audit = buildModuleLocalizationAudit({
    locale: 'en',
    direction: 'ltr',
    moduleGroup: 'clientOperations',
    entries: [
      {
        key: 'clientOperations.registry.columns.clientName',
        module_group: 'clientOperations',
        source_en: 'Client name',
        owner_value: '',
        owner_status: 'published',
        bundled_value: 'Client name',
        live_value: 'Client name',
        value_origin: 'bundled',
        empty_explanation: 'no_owner_override',
        placeholder_ok: true,
      },
      {
        key: 'clientOperations.search',
        module_group: 'clientOperations',
        source_en: 'Search',
        owner_value: 'חיפוש',
        owner_status: 'published',
        bundled_value: 'Search',
        live_value: 'חיפוש',
        value_origin: 'owner_published',
        empty_explanation: null,
        placeholder_ok: true,
      },
      {
        key: 'nav.dashboard',
        module_group: 'nav',
        source_en: 'Dashboard',
        owner_value: '',
        owner_status: 'draft',
        bundled_value: 'Dashboard',
        live_value: 'Dashboard',
        value_origin: 'bundled',
        empty_explanation: 'no_owner_override',
        placeholder_ok: true,
      },
    ],
    hardcodedSurfaces: [],
    unverifiedSurfaces: [],
  });
  assert.equal(audit.catalog_size, 2);
  assert.equal(audit.live_translated_count, 2);
  assert.equal(audit.owner_override_count, 1);
  assert.equal(audit.issues.length, 1);
  assert.equal(audit.issues[0]?.kind, 'wrong_language_system_text');
  assert.equal(audit.issues[0]?.localization_key, 'clientOperations.search');
  assert.equal(audit.issues[0]?.editable, true);
  assert.equal(audit.issues[0]?.requires_code_fix, false);
});

test('hardcoded surfaces require a code fix and are not editable', () => {
  const audit = buildModuleLocalizationAudit({
    locale: 'en',
    direction: 'ltr',
    moduleGroup: 'clientOperations',
    entries: [],
    hardcodedSurfaces: [
      {
        id: 'test-hardcoded',
        tab: 'Registry',
        location: 'Test chrome',
        displayed_text: 'טקסט קשיח',
        localization_key: null,
        requires_code_fix: true,
        reason: 'Unconnected chrome.',
        target_locales: ['en'],
        usage_locations: [{ tab: 'Registry', location: 'Test chrome' }],
      },
    ],
    unverifiedSurfaces: [],
  });
  const hardcoded = audit.issues.find((issue) => issue.kind === 'hardcoded_unconnected');
  assert.ok(hardcoded);
  assert.equal(hardcoded?.requires_code_fix, true);
  assert.equal(hardcoded?.editable, false);
});

test('API error banners are connected to common.errors and are not a hardcoded English issue', () => {
  const audit = buildModuleLocalizationAudit({
    locale: 'en',
    direction: 'ltr',
    moduleGroup: 'clientOperations',
    entries: [
      {
        key: 'common.errors.forbidden',
        module_group: 'clientOperations',
        source_en: 'You do not have permission to perform this action.',
        owner_value: '',
        owner_status: 'published',
        bundled_value: 'You do not have permission to perform this action.',
        live_value: 'You do not have permission to perform this action.',
        value_origin: 'bundled',
        empty_explanation: 'no_owner_override',
        placeholder_ok: true,
      },
    ],
    unverifiedSurfaces: [],
  });
  assert.equal(audit.issues.length, 0);
  assert.equal(audit.live_translated_count, 1);
});
