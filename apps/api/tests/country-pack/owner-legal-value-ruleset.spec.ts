import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ownerLegalValueRulesetMissingMessage,
  resolveOwnerLegalValueRulesetContextFromTables,
} from '../../src/domains/country-pack/owner-legal-value-ruleset.pure.js';
import { buildOwnerLegalValueEditorDescriptor, IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY } from '../../src/domains/country-pack/owner-legal-value-editor.pure.js';
import { buildOwnerLegalValuesTableModel } from '../../src/domains/country-pack/owner-legal-values-table.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

const IL_CATALOG = {
  countries: [{ code: 'IL', name: 'Israel' }],
  countryPacks: [{ id: 'pack-1', country_code: 'IL', name: 'Israel Default Pack', status: 'enabled' }],
  rulesets: [
    {
      id: 'ruleset-1',
      country_pack_id: 'pack-1',
      ruleset_code: 'default',
      ruleset_version: '1.0',
      status: 'active',
      effective_from: '2020-01-01',
      effective_to: null,
    },
  ],
};

const IL_TABLE_CATALOG = {
  countries: IL_CATALOG.countries,
  country_packs: IL_CATALOG.countryPacks,
  rulesets: IL_CATALOG.rulesets,
};

test('resolveOwnerLegalValueRulesetContextFromTables finds active ruleset for country', () => {
  const context = resolveOwnerLegalValueRulesetContextFromTables({
    countryCode: 'IL',
    effectiveDate: '2026-07-01',
    ...IL_CATALOG,
  });
  assert.ok(context);
  assert.equal(context?.active_ruleset_id, 'ruleset-1');
  assert.match(context?.ruleset_label ?? '', /Israel Default Pack/);
});

test('issue month window editor no longer exposes ruleset UUID field', () => {
  const editor = buildOwnerLegalValueEditorDescriptor({
    value_key: IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY,
    value_type: 'json',
    current_payload: { months_back: 1, months_ahead: 3 },
    country_code: 'IL',
    country_catalog: IL_TABLE_CATALOG,
  });
  assert.ok(editor);
  const versionKeys = editor!.version_fields.map((f) => f.key);
  assert.equal(versionKeys.includes('country_pack_ruleset_id'), false);
  assert.equal(versionKeys.includes('status'), false);
  assert.equal(editor!.active_ruleset_id, 'ruleset-1');
  assert.equal(editor!.context_display.length, 2);
  assert.match(editor!.context_display[1]?.value ?? '', /Israel Default Pack/);
});

test('create version action disabled when no active ruleset exists', () => {
  const model = buildOwnerLegalValuesTableModel(
    [
      {
        country_code: 'IL',
        value_key: IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY,
        label: 'Income issue month window',
        category: 'VAT',
        module_scope: 'income',
        value_type: 'json',
        current_active_value: { months_back: 1, months_ahead: 3 },
        versions: [],
      },
    ],
    [{ action_key: 'create_legal_value_version', enabled: true }],
    { countries: IL_TABLE_CATALOG.countries, country_packs: [], rulesets: [] },
  );
  const createAction = model.rows[0]?.actions.find((a) => a.action_key === 'create_legal_value_version');
  assert.equal(createAction?.enabled, false);
  assert.equal(createAction?.disabled_reason, ownerLegalValueRulesetMissingMessage('IL'));
});

test('command path auto-resolves ruleset when UUID omitted', () => {
  const commandsSource = readFileSync(join(dir, '../../src/domains/country-pack/country-pack-commands.service.ts'), 'utf8');
  const legalValueSource = readFileSync(join(dir, '../../src/domains/country-pack/legal-value.service.ts'), 'utf8');
  assert.ok(legalValueSource.includes('resolveOwnerLegalValueRulesetContextForCountry'));
  assert.ok(commandsSource.includes('resolveOwnerLegalValueRulesetContextForCountry'));
  assert.equal(commandsSource.includes('country_pack_ruleset_id or ruleset_code is required'), false);
});
