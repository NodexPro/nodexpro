import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnerAddCountryControl } from '../src/pages/owner-add-country-control.tsx';
import { parseFactDictionaryAggregate } from '../src/pages/owner-fact-dictionary-panel.tsx';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('frontend has no hardcoded country-to-language map', () => {
  const files = [
    'apps/web/src/pages/owner-fact-dictionary-panel.tsx',
    'apps/web/src/pages/owner-add-country-control.tsx',
    'apps/web/src/pages/owner-country-context-panel.tsx',
    'apps/web/src/pages/PlatformOwnerLegalControl.tsx',
  ];
  for (const rel of files) {
    const src = readRepo(rel);
    assert.doesNotMatch(src, /if\s*\(\s*country\s*===\s*['"]IL['"]/);
    assert.doesNotMatch(src, /countryCode\s*===\s*['"]IL['"]\s*\?\s*['"]he['"]/);
    assert.doesNotMatch(src, /IL:\s*['"]he['"]/);
  }
});

test('Client Facts list prefers backend display_label over canonical key', () => {
  const parsed = parseFactDictionaryAggregate({
    selected_country_code: 'IL',
    country_localization: { country_code: 'IL', default_locale: 'he', supported_locales: ['he'] },
    countries: [{ code: 'IL', name: 'Israel', status: 'active', default_locale: 'he', supported_locales: ['he'] }],
    definitions: [
      {
        id: 'def-1',
        fact_key: 'date_of_birth',
        country_code: 'IL',
        scope: 'country',
        status: 'active',
        semantic_title: 'Date of birth',
        display_label: 'תאריך לידה',
        display_locale: 'he',
        presentations: [
          {
            id: 'p1',
            tax_fact_definition_id: 'def-1',
            country_code: 'IL',
            locale: 'he',
            label: 'תאריך לידה',
            professional_question: 'מהו תאריך הלידה של הלקוח?',
            client_question: null,
            help_text: null,
            aliases: [],
            enum_option_labels: {},
            allowed_actions: [],
          },
        ],
        versions: [],
        allowed_actions: [],
      },
    ],
    allowed_actions: [],
    implemented_commands: [],
    value_type_options: [],
    warnings: [],
  });
  assert.equal(parsed.definitions[0].display_label, 'תאריך לידה');
  assert.equal(parsed.definitions[0].fact_key, 'date_of_birth');
  assert.equal(parsed.country_localization.default_locale, 'he');
});

test('Add Country locale checkboxes come from backend catalog, not ISO country code', () => {
  const src = readRepo('apps/web/src/pages/owner-add-country-control.tsx');
  assert.match(src, /localeCatalog/);
  assert.match(src, /Default language/);
  assert.match(src, /localeCatalog\.map/);
  assert.doesNotMatch(src, /if\s*\(\s*country\s*===\s*['"]IL['"]/);
  assert.doesNotMatch(src, /CA:\s*\[['"]en['"],\s*['"]fr['"]\]/);
  const html = renderToStaticMarkup(
    createElement(OwnerAddCountryControl, {
      action: { action_key: 'create_country', enabled: true },
      existingCountryCodes: [],
      busy: false,
      localeCatalog: [
        { code: 'en', label: 'English' },
        { code: 'fr', label: 'Français' },
      ],
      onSubmit: async () => undefined,
    }),
  );
  assert.match(html, /create_country/);
  assert.doesNotMatch(html, /עברית/);
});
