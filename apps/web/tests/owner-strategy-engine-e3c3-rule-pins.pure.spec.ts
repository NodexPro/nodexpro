import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyTaxKnowledgeAggregate, type TaxKnowledgeAggregate } from '../src/pages/owner-legal-control-types.ts';
import {
  buildPinTaxStrategyRulePayload,
  buildUnpinTaxStrategyRulePayload,
  enabledStrategyAction,
  taxKnowledgeRuleVersionPickerLabel,
  taxKnowledgeRuleVersionPickerRows,
} from '../src/pages/owner-strategy-engine-panel.tsx';

function knowledgeWithVersions(): TaxKnowledgeAggregate {
  return {
    ...emptyTaxKnowledgeAggregate(),
    selected_country_code: 'IL',
    rules: [
      {
        id: 'r1',
        country_code: 'IL',
        rule_code: 'R-1',
        title: 'Rule one',
        rule_kind: 'legal',
        status: 'active',
        usage_hint: null,
        owner_note: null,
        created_at: '',
        updated_at: '',
        allowed_actions: [],
        versions: [
          {
            id: 'rv-old',
            tax_rule_id: 'r1',
            country_code: 'IL',
            version_no: 1,
            status: 'retired',
            country_pack_id: '',
            country_pack_ruleset_id: '',
            effective_from: '2020-01-01',
            effective_to: null,
            payload_json: {},
            payload_checksum: '',
            supersedes_version_id: null,
            superseded_by_version_id: null,
            retired_at: null,
            retired_reason: null,
            created_at: '',
            sources: [],
            legal_value_bindings: [],
            relationships: [],
            unresolved_legal_references: [],
            allowed_actions: [],
          },
          {
            id: 'rv-new',
            tax_rule_id: 'r1',
            country_code: 'IL',
            version_no: 2,
            status: 'active',
            country_pack_id: '',
            country_pack_ruleset_id: '',
            effective_from: '2021-01-01',
            effective_to: null,
            payload_json: {},
            payload_checksum: '',
            supersedes_version_id: null,
            superseded_by_version_id: null,
            retired_at: null,
            retired_reason: null,
            created_at: '',
            sources: [],
            legal_value_bindings: [],
            relationships: [],
            unresolved_legal_references: [],
            allowed_actions: [],
          },
        ],
      },
    ],
  };
}

test('E3C3 gating: pin/unpin only when backend enabled action exists', () => {
  assert.equal(
    enabledStrategyAction([{ action_key: 'pin_tax_strategy_rule', enabled: true, payload: {} }], 'pin_tax_strategy_rule')
      ?.action_key,
    'pin_tax_strategy_rule',
  );
  assert.equal(
    enabledStrategyAction([{ action_key: 'pin_tax_strategy_rule', enabled: false, payload: {} }], 'pin_tax_strategy_rule'),
    null,
  );
  assert.equal(enabledStrategyAction([], 'pin_tax_strategy_rule'), null);
  assert.equal(
    enabledStrategyAction(
      [{ action_key: 'unpin_tax_strategy_rule', enabled: true, payload: {} }],
      'unpin_tax_strategy_rule',
    )?.action_key,
    'unpin_tax_strategy_rule',
  );
  assert.equal(enabledStrategyAction([], 'unpin_tax_strategy_rule'), null);
});

test('E3C3 picker: same aggregate tax_knowledge exact versions, no newest default', () => {
  const rows = taxKnowledgeRuleVersionPickerRows(knowledgeWithVersions());
  assert.deepEqual(
    rows.map((row) => row.tax_rule_version_id),
    ['rv-old', 'rv-new'],
  );
  assert.equal(taxKnowledgeRuleVersionPickerLabel(rows[0]), 'R-1 — Rule one — v1 (retired)');
  assert.equal(taxKnowledgeRuleVersionPickerLabel(rows[1]), 'R-1 — Rule one — v2 (active)');
  assert.deepEqual(taxKnowledgeRuleVersionPickerRows(emptyTaxKnowledgeAggregate()), []);
});

test('E3C3 pin/unpin payloads use exact E3B identifiers and roles', () => {
  assert.deepEqual(buildPinTaxStrategyRulePayload('sv-1', 'rv-old', 'required'), {
    tax_strategy_version_id: 'sv-1',
    tax_rule_version_id: 'rv-old',
    pin_role: 'required',
  });
  assert.deepEqual(buildPinTaxStrategyRulePayload('sv-1', 'rv-new', 'prohibited'), {
    tax_strategy_version_id: 'sv-1',
    tax_rule_version_id: 'rv-new',
    pin_role: 'prohibited',
  });
  assert.deepEqual(buildUnpinTaxStrategyRulePayload('pin-9'), {
    tax_strategy_version_rule_pin_id: 'pin-9',
  });
});
