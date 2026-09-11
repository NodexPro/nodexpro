import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildOwnerCommandPayloadFromHints } from '../src/pages/owner-legal-control-panel-actions.tsx';
import {
  OwnerFactDictionaryPanel,
  ownerFactDictionaryCommandPrefill,
  parseFactDictionaryAggregate,
} from '../src/pages/owner-fact-dictionary-panel.tsx';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function actionKeys(html: string): string[] {
  return [...html.matchAll(/data-action-key="([^"]+)"/g)].map((match) => match[1]);
}

const draftVersionActions = [
  {
    action_key: 'update_tax_fact_definition_version_draft',
    enabled: true,
    payload: { tax_fact_definition_version_id: 'uuid' },
  },
  {
    action_key: 'add_tax_fact_enum_option',
    enabled: true,
    payload: { tax_fact_definition_version_id: 'uuid', code: 'snake_case', sort_order: 'integer >= 0' },
  },
  {
    action_key: 'activate_tax_fact_definition_version',
    enabled: true,
    payload: { tax_fact_definition_version_id: 'uuid' },
  },
  {
    action_key: 'retire_tax_fact_definition_version',
    enabled: true,
    payload: { tax_fact_definition_version_id: 'uuid' },
  },
];

const activeVersionActions = [
  {
    action_key: 'close_tax_fact_definition_version_effective_to',
    enabled: true,
    payload: { tax_fact_definition_version_id: 'uuid', effective_to: 'YYYY-MM-DD' },
  },
  {
    action_key: 'retire_tax_fact_definition_version',
    enabled: true,
    payload: { tax_fact_definition_version_id: 'uuid' },
  },
];

const backendSlice = {
  selected_country_code: 'IL',
  selected_scope: 'country',
  countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
  allowed_actions: [
    {
      action_key: 'create_tax_fact_definition',
      enabled: true,
      payload: { fact_key: 'snake_case engine key' },
    },
  ],
  implemented_commands: ['create_tax_fact_definition', 'activate_tax_fact_definition_version'],
  value_type_options: [{ value: 'enum', label: 'enum' }, { value: 'money', label: 'money' }],
  warnings: [],
  definitions: [
    {
      id: 'def-1',
      fact_key: 'marital_status',
      country_code: 'IL',
      scope: 'country',
      status: 'active',
      semantic_title: 'Marital status',
      owner_note: null,
      retired_at: null,
      retired_reason: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      allowed_actions: [
        {
          action_key: 'create_tax_fact_definition_version',
          enabled: true,
          payload: { tax_fact_definition_id: 'uuid' },
        },
        {
          action_key: 'create_tax_fact_presentation',
          enabled: true,
          payload: { tax_fact_definition_id: 'uuid' },
        },
      ],
      presentations: [
        {
          id: 'pres-1',
          tax_fact_definition_id: 'def-1',
          country_code: 'IL',
          locale: 'he',
          label: 'מצב משפחתי',
          professional_question: 'מה מצב המשפחתי?',
          client_question: null,
          help_text: null,
          aliases: ['family_status'],
          enum_option_labels: { married: 'נשוי', single: 'רווק' },
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          allowed_actions: [
            {
              action_key: 'update_tax_fact_presentation',
              enabled: true,
              payload: { tax_fact_presentation_id: 'uuid' },
            },
            {
              action_key: 'delete_tax_fact_presentation',
              enabled: true,
              payload: { tax_fact_presentation_id: 'uuid' },
            },
          ],
        },
      ],
      versions: [
        {
          id: 'ver-draft',
          tax_fact_definition_id: 'def-1',
          country_code: 'IL',
          version_no: 2,
          status: 'draft',
          value_type: 'enum',
          unit_code: null,
          currency_policy: null,
          validation_json: {},
          definition_checksum: 'abc123checksum',
          checksum_matches: true,
          effective_from: '2026-01-01',
          effective_to: null,
          activated_at: null,
          retired_at: null,
          retired_reason: null,
          created_at: '2026-01-02T00:00:00.000Z',
          allowed_actions: draftVersionActions,
          enum_options: [
            {
              id: 'enum-1',
              tax_fact_definition_version_id: 'ver-draft',
              code: 'married',
              sort_order: 0,
              created_at: '2026-01-02T00:00:00.000Z',
              allowed_actions: [
                {
                  action_key: 'update_tax_fact_enum_option',
                  enabled: true,
                  payload: { tax_fact_enum_option_id: 'uuid' },
                },
                {
                  action_key: 'remove_tax_fact_enum_option',
                  enabled: true,
                  payload: { tax_fact_enum_option_id: 'uuid' },
                },
              ],
            },
          ],
        },
        {
          id: 'ver-active',
          tax_fact_definition_id: 'def-1',
          country_code: 'IL',
          version_no: 1,
          status: 'active',
          value_type: 'money',
          unit_code: 'ils',
          currency_policy: { required: true, allowed_currencies: ['ILS'] },
          validation_json: { min: 0 },
          definition_checksum: 'def456checksum',
          checksum_matches: false,
          effective_from: '2025-01-01',
          effective_to: '2025-12-31',
          activated_at: '2025-01-01T00:00:00.000Z',
          retired_at: null,
          retired_reason: null,
          created_at: '2025-01-01T00:00:00.000Z',
          allowed_actions: activeVersionActions,
          enum_options: [],
        },
      ],
    },
  ],
};

test('Fact Dictionary parse keeps versions, enum_options, and presentations', () => {
  const parsed = parseFactDictionaryAggregate(backendSlice);
  assert.equal(parsed.definitions.length, 1);
  assert.equal(parsed.definitions[0].versions.length, 2);
  assert.equal(parsed.definitions[0].versions[0].enum_options.length, 1);
  assert.equal(parsed.definitions[0].versions[0].enum_options[0].code, 'married');
  assert.equal(parsed.definitions[0].presentations.length, 1);
  assert.equal(parsed.definitions[0].presentations[0].label, 'מצב משפחתי');
  assert.equal(parsed.definitions[0].presentations[0].enum_option_labels.married, 'נשוי');
  assert.equal(parsed.definition_versions.length, 2);
  assert.equal(parsed.enum_options.length, 1);
  assert.equal(parsed.presentations.length, 1);
  assert.equal(parsed.definitions[0].versions[0].checksum_matches, true);
  assert.equal(parsed.definitions[0].versions[1].checksum_matches, false);
});

test('Fact Dictionary publish UI renders version rows and only backend allowed_actions', () => {
  const parsed = parseFactDictionaryAggregate(backendSlice);
  const html = renderToStaticMarkup(
    createElement(OwnerFactDictionaryPanel, {
      factDictionary: parsed,
      busy: false,
      onOpenCommand: () => undefined,
    }),
  );

  assert.match(html, /marital_status/);
  assert.match(html, />2</);
  assert.match(html, /draft/i);
  assert.match(html, /2026-01-01/);
  assert.match(html, /2025-12-31/);
  assert.match(html, /enum/);
  assert.match(html, /ils \/ required; ILS/);
  assert.match(html, /abc123checksum/);
  assert.match(html, /\(matches\)/);
  assert.match(html, /\(mismatch\)/);
  assert.match(html, /married/);
  assert.match(html, /מצב משפחתי/);
  assert.match(html, /married: נשוי/);
  assert.match(html, /Engine identity is the option code/);

  const keys = actionKeys(html);
  assert.ok(keys.includes('update_tax_fact_definition_version_draft'));
  assert.ok(keys.includes('add_tax_fact_enum_option'));
  assert.ok(keys.includes('activate_tax_fact_definition_version'));
  assert.ok(keys.includes('retire_tax_fact_definition_version'));
  assert.ok(keys.includes('close_tax_fact_definition_version_effective_to'));
  assert.ok(keys.includes('update_tax_fact_enum_option'));
  assert.ok(keys.includes('remove_tax_fact_enum_option'));
  assert.ok(keys.includes('update_tax_fact_presentation'));
  assert.ok(keys.includes('create_tax_fact_definition_version'));
  assert.ok(keys.includes('create_tax_fact_presentation'));
  assert.ok(!keys.includes('ingest_fact_from_llm'));
  assert.ok(!keys.includes('evaluate_tax_rules'));
  assert.ok(!keys.includes('set_tax_advisory_case_fact'));
  assert.match(html, /Create Tax Fact Definition/);
});

test('draft version, enum, and activate commands prefill the named command payloads', () => {
  const parsed = parseFactDictionaryAggregate(backendSlice);
  const definition = parsed.definitions[0];
  const draft = definition.versions[0];
  const option = draft.enum_options[0];
  const presentation = definition.presentations[0];

  const updateDraft = ownerFactDictionaryCommandPrefill({
    actionKey: 'update_tax_fact_definition_version_draft',
    selectedCountryCode: 'IL',
    definition,
    version: draft,
  });
  assert.equal(updateDraft.tax_fact_definition_version_id, 'ver-draft');
  assert.equal(updateDraft.value_type, 'enum');
  assert.equal(updateDraft.selected_country_code, 'IL');

  const activate = ownerFactDictionaryCommandPrefill({
    actionKey: 'activate_tax_fact_definition_version',
    selectedCountryCode: 'IL',
    version: draft,
  });
  assert.equal(activate.tax_fact_definition_version_id, 'ver-draft');
  assert.equal(activate.value_type, undefined);

  const addEnum = ownerFactDictionaryCommandPrefill({
    actionKey: 'add_tax_fact_enum_option',
    selectedCountryCode: 'IL',
    version: draft,
  });
  assert.equal(addEnum.tax_fact_definition_version_id, 'ver-draft');

  const updateEnum = ownerFactDictionaryCommandPrefill({
    actionKey: 'update_tax_fact_enum_option',
    selectedCountryCode: 'IL',
    enumOption: option,
  });
  assert.equal(updateEnum.tax_fact_enum_option_id, 'enum-1');
  assert.equal(updateEnum.code, 'married');
  assert.equal(updateEnum.sort_order, 0);

  const removeEnum = ownerFactDictionaryCommandPrefill({
    actionKey: 'remove_tax_fact_enum_option',
    selectedCountryCode: 'IL',
    enumOption: option,
  });
  assert.equal(removeEnum.tax_fact_enum_option_id, 'enum-1');
  assert.equal(removeEnum.code, undefined);

  const updatePresentation = ownerFactDictionaryCommandPrefill({
    actionKey: 'update_tax_fact_presentation',
    selectedCountryCode: 'IL',
    presentation,
  });
  assert.equal(updatePresentation.tax_fact_presentation_id, 'pres-1');
  assert.equal(updatePresentation.locale, 'he');
});

test('empty versions, enums, and presentations do not crash', () => {
  const parsed = parseFactDictionaryAggregate({
    selected_country_code: 'IL',
    selected_scope: 'country',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    allowed_actions: [],
    warnings: [],
    definitions: [
      {
        id: 'def-empty',
        fact_key: 'residence_city',
        country_code: 'IL',
        scope: 'country',
        status: 'draft',
        semantic_title: 'Residence city',
        versions: [],
        presentations: [],
        allowed_actions: [],
      },
    ],
  });
  const html = renderToStaticMarkup(
    createElement(OwnerFactDictionaryPanel, {
      factDictionary: parsed,
      busy: false,
      onOpenCommand: () => undefined,
    }),
  );
  assert.match(html, /residence_city/);
  assert.match(html, /No versions/);
  assert.match(html, /No presentations/);
  assert.equal(actionKeys(html).length, 0);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test('non-owner empty allowed_actions cannot gain Fact Dictionary mutation buttons', () => {
  const parsed = parseFactDictionaryAggregate({
    selected_country_code: 'IL',
    definitions: [
      {
        id: 'def-1',
        fact_key: 'marital_status',
        status: 'active',
        semantic_title: 'Marital status',
        versions: [
          {
            id: 'ver-1',
            version_no: 1,
            status: 'draft',
            value_type: 'enum',
            definition_checksum: '',
            checksum_matches: false,
            effective_from: '2026-01-01',
            enum_options: [{ id: 'e1', code: 'married', sort_order: 0, allowed_actions: [] }],
            allowed_actions: [],
          },
        ],
        presentations: [],
        allowed_actions: [],
      },
    ],
    allowed_actions: [],
    warnings: [],
  });
  const html = renderToStaticMarkup(
    createElement(OwnerFactDictionaryPanel, {
      factDictionary: parsed,
      busy: false,
      onOpenCommand: () => undefined,
    }),
  );
  assert.equal(actionKeys(html).length, 0);
  assert.doesNotMatch(html, /Activate Tax Fact Definition Version/);
  assert.doesNotMatch(html, /Create Tax Fact Definition/);
});

test('owner command path consumes refreshed aggregate and does not hidden-GET after command', () => {
  const page = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const panel = readRepo('apps/web/src/pages/owner-fact-dictionary-panel.tsx');
  assert.match(page, /OWNER\.command/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /aggregate_key === 'owner_legal_control_panel_aggregate'/);
  assert.match(page, /This page is available only for platform owner/);
  const sendFn = page.slice(page.indexOf('async function sendOwnerCommand'), page.indexOf('async function toggleCountryPack'));
  assert.match(sendFn, /OWNER\.command/);
  assert.doesNotMatch(sendFn, /OWNER\.legalControl/);
  assert.doesNotMatch(sendFn, /loadCore/);
  assert.doesNotMatch(sendFn, /method: 'GET'/);
  assert.doesNotMatch(sendFn, /method: 'PATCH'/);
  assert.doesNotMatch(panel, /apiJson\(/);
  assert.doesNotMatch(panel, /OWNER\.legalControl/);
  assert.doesNotMatch(panel, /ingest_fact_from_llm/);
  assert.match(panel, /data-action-key=\{action\.action_key\}/);
  assert.match(panel, /onOpenCommand\(\s*action\.action_key/);
  assert.match(panel, /update_tax_fact_definition_version_draft/);
  assert.match(panel, /update_tax_fact_enum_option/);
});

test('command modal hint coercion supports enum sort_order and JSON objects', () => {
  const payload = buildOwnerCommandPayloadFromHints(
    {
      sort_order: '3',
      currency_policy: '{"required":true,"allowed_currencies":["ILS"]}',
      unit_code: 'null',
      value_type: 'enum',
    },
    {
      sort_order: 'integer >= 0',
      currency_policy: 'required for money; null otherwise',
      unit_code: 'optional snake_case or null',
      value_type: 'optional boolean|integer|enum',
    },
  );
  assert.equal(payload.sort_order, 3);
  assert.deepEqual(payload.currency_policy, { required: true, allowed_currencies: ['ILS'] });
  assert.equal(payload.unit_code, null);
  assert.equal(payload.value_type, 'enum');
});
