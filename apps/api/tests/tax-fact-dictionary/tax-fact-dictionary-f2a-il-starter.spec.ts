import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  normalizeCountryLocalization,
  OWNER_COUNTRY_LOCALE_CATALOG,
  pickPresentationForLocale,
} from '../../src/domains/country-pack/country-localization.pure.js';
import { IL_STARTER_DEFERRED_FACTS, IL_STARTER_FACT_KEYS, IL_STARTER_FACT_SPECS } from '../../src/domains/tax-fact-dictionary/il-fact-starter-catalog.pure.js';
import { taxFactDefinitionChecksum } from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-checksum.pure.js';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('country localization is backend-owned and Canada can be en+fr', () => {
  const ca = normalizeCountryLocalization({
    default_locale: 'en',
    supported_locales: ['en', 'fr'],
    required: true,
  });
  assert.deepEqual(ca, { default_locale: 'en', supported_locales: ['en', 'fr'] });
  const codes = OWNER_COUNTRY_LOCALE_CATALOG.map((row) => row.code);
  assert.equal(codes.includes('en'), true);
  assert.equal(codes.includes('fr'), true);
  assert.equal(codes.includes('he'), true);
  assert.equal(codes.includes('lv'), true);
  assert.equal(capabilityRequiredForOwnerCommand('update_country_localization'), 'platform_owner_only');
});

test('presentation pick uses locale data, not country if-branches', () => {
  const rows = [
    { locale: 'en', label: 'Date of birth' },
    { locale: 'he', label: 'תאריך לידה' },
  ];
  assert.equal(pickPresentationForLocale(rows, 'he')?.label, 'תאריך לידה');
  assert.equal(pickPresentationForLocale(rows, 'en')?.label, 'Date of birth');
  assert.equal(pickPresentationForLocale(rows, 'fr')?.label, undefined);
  assert.equal(pickPresentationForLocale([{ locale: 'he', label: 'תאריך לידה' }], null)?.label, 'תאריך לידה');
});

test('IL starter keys are language-neutral and Hebrew is presentation-only', () => {
  assert.equal(new Set(IL_STARTER_FACT_KEYS).size, IL_STARTER_FACT_KEYS.length);
  for (const spec of IL_STARTER_FACT_SPECS) {
    assert.match(spec.fact_key, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    assert.doesNotMatch(spec.fact_key, /^(he|il|israel)_/);
    assert.ok(spec.he_label.trim());
    assert.doesNotMatch(spec.he_label, /[A-Za-z]{4,}/);
    for (const option of spec.enum_options) {
      assert.match(option.code, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      assert.doesNotMatch(option.code, /רווק|נשוי|גרוש|אלמן/);
    }
  }
  const marital = IL_STARTER_FACT_SPECS.find((row) => row.fact_key === 'marital_status');
  assert.deepEqual(
    marital?.enum_options.map((row) => row.code),
    ['single', 'married', 'divorced', 'widowed'],
  );
  for (const deferred of IL_STARTER_DEFERRED_FACTS) {
    assert.equal(IL_STARTER_FACT_KEYS.includes(deferred.proposed_key), false, deferred.proposed_key);
  }
});

test('changing presentation cannot change canonical checksum', () => {
  const base = {
    fact_key: 'date_of_birth',
    country_code: 'IL' as string | null,
    value_type: 'date',
    unit_code: null as string | null,
    currency_policy: null as Record<string, unknown> | null,
    validation_json: {} as Record<string, unknown>,
    enum_codes: [] as string[],
  };
  const a = taxFactDefinitionChecksum(base);
  const withPresentation = {
    ...base,
    presentations: [{ locale: 'he', label: 'תאריך לידה' }],
  };
  const b = taxFactDefinitionChecksum(withPresentation);
  assert.equal(a, b);
});

test('no SQL catalog seed and no K3/K4/strategy/F2B/law changes in this slice', () => {
  const authoring = readRepo(
    'apps/api/src/domains/tax-fact-dictionary/il-fact-starter-catalog.authoring.service.ts',
  );
  const migration = readRepo('supabase/migrations/621_country_localization.sql');
  assert.match(authoring, /executeTaxFactDictionaryCommand/);
  assert.match(authoring, /create_tax_fact_presentation/);
  assert.doesNotMatch(authoring, /\.from\('tax_fact_definitions'\)\s*\.insert/);
  assert.doesNotMatch(migration, /tax_fact_definitions/);
  assert.doesNotMatch(migration, /tax_sources/);
  assert.match(migration, /default_locale/);
  assert.match(migration, /supported_locales/);
  assert.doesNotMatch(readRepo('apps/api/src/domains/tax-rule-engine/tax-rule-engine.types.ts'), /IL_STARTER/);
  assert.doesNotMatch(readRepo('apps/api/src/domains/tax-calculation-engine/tax-calculation-engine-commands.types.ts'), /IL_STARTER/);
});
