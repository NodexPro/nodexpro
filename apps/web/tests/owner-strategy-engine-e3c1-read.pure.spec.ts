import assert from 'node:assert/strict';
import test from 'node:test';
import { ownerLegalControlCountryQueryParams } from '../src/pages/owner-legal-control-types.ts';
import {
  exactPinnedVersionLabel,
  parseStrategyEngineAggregate,
  strategyAuthoredMetadataDisplay,
  strategyVersionLineageLabel,
  strategyVersionsPresentInAggregate,
} from '../src/pages/owner-strategy-engine-panel.tsx';

const siblingId = '11111111-1111-4111-8111-111111111111';
const missingId = '99999999-9999-4999-8999-999999999999';

const fixture = {
  selected_country_code: 'IL',
  countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
  exclusive_groups: [
    {
      id: 'g1',
      country_code: 'IL',
      group_code: 'cap',
      title: 'Capital group',
      owner_note: 'group note',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      allowed_actions: [{ action_key: 'update_tax_strategy_exclusive_group', enabled: true, payload: {} }],
    },
  ],
  strategies: [
    {
      id: 's1',
      country_code: 'IL',
      strategy_code: 'cap_gains',
      admin_label: 'Capital gains',
      owner_note: 'strategy note',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      allowed_actions: [{ action_key: 'create_tax_strategy_version', enabled: true, payload: {} }],
      versions: [
        {
          id: siblingId,
          tax_strategy_id: 's1',
          country_code: 'IL',
          version_no: 2,
          status: 'active',
          effective_from: '2020-01-01',
          effective_to: null,
          title: 'Active strategy',
          requires_professional_judgment: true,
          exclusive_group_id: 'g1',
          exclusive_group_code: 'cap',
          exclusive_group_title: 'Capital group',
          authored_metadata_json: {
            explanation: 'why this path',
            benefits: ['a', 'b'],
            risks: ['r1'],
            constraints: ['c1'],
            costs_tradeoffs: ['cost'],
            category: 'capital',
            domain: 'income',
            tags: ['tag-a', 'tag-b'],
          },
          strategy_checksum: 'abc123',
          supersedes_version_id: missingId,
          superseded_by_version_id: null,
          activated_at: '2026-02-01T00:00:00.000Z',
          retired_at: null,
          retired_reason: null,
          created_at: '2026-01-01T00:00:00.000Z',
          allowed_actions: [{ action_key: 'retire_tax_strategy_version', enabled: true, payload: {} }],
          rule_pins: [
            {
              id: 'rp1',
              tax_strategy_version_id: siblingId,
              tax_rule_version_id: 'rv1',
              tax_rule_id: 'r1',
              rule_code: 'R-1',
              rule_title: 'Rule one',
              version_no: 4,
              status: 'active',
              pin_role: 'required',
              created_at: '2026-01-01T00:00:00.000Z',
              allowed_actions: [],
            },
          ],
          calculation_pins: [
            {
              id: 'cp1',
              tax_strategy_version_id: siblingId,
              calculation_definition_version_id: 'cv1',
              tax_calculation_definition_id: 'c1',
              calculation_code: 'C-1',
              calculation_title: 'Calc one',
              version_no: 7,
              status: 'active',
              created_at: '2026-01-01T00:00:00.000Z',
              allowed_actions: [],
            },
          ],
        },
      ],
    },
  ],
  strategy_versions: [],
  allowed_actions: [{ action_key: 'create_tax_strategy', enabled: true, payload: {} }],
  warnings: [],
};

test('E3C1 parse: Strategy Engine section reads aggregate fields only', () => {
  const slice = parseStrategyEngineAggregate(fixture);
  assert.equal(slice.selected_country_code, 'IL');
  assert.equal(slice.exclusive_groups[0]?.group_code, 'cap');
  assert.equal(slice.strategies[0]?.strategy_code, 'cap_gains');
  assert.equal(slice.strategies[0]?.versions.length, 1);
  assert.equal(slice.strategies[0]?.versions[0]?.rule_pins[0]?.rule_title, 'Rule one');
  assert.equal(slice.strategies[0]?.versions[0]?.calculation_pins[0]?.calculation_title, 'Calc one');
  assert.equal(slice.allowed_actions[0]?.action_key, 'create_tax_strategy');
});

test('E3C1 parse: empty raw and no-country slice stay empty', () => {
  assert.deepEqual(parseStrategyEngineAggregate(null).strategies, []);
  const empty = parseStrategyEngineAggregate({
    selected_country_code: null,
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    exclusive_groups: [],
    strategies: [],
    strategy_versions: [],
    allowed_actions: [],
    warnings: ['strategy_engine_schema_not_applied'],
  });
  assert.equal(empty.selected_country_code, null);
  assert.deepEqual(empty.warnings, ['strategy_engine_schema_not_applied']);
});

test('E3C1 country: one selection drives both existing GET query parameters', () => {
  assert.equal(ownerLegalControlCountryQueryParams(''), null);
  assert.equal(ownerLegalControlCountryQueryParams('   '), null);
  assert.deepEqual(ownerLegalControlCountryQueryParams('IL'), {
    tax_knowledge_country_code: 'IL',
    strategy_engine_country_code: 'IL',
  });
  assert.deepEqual(ownerLegalControlCountryQueryParams('  il  '), {
    tax_knowledge_country_code: 'il',
    strategy_engine_country_code: 'il',
  });
});

test('E3C1 authored metadata: human-readable fields, not raw JSON', () => {
  const slice = parseStrategyEngineAggregate(fixture);
  const authored = strategyAuthoredMetadataDisplay(slice.strategies[0].versions[0].authored_metadata_json);
  assert.equal(authored.explanation, 'why this path');
  assert.equal(authored.benefits, 'a, b');
  assert.equal(authored.risks, 'r1');
  assert.equal(authored.constraints, 'c1');
  assert.equal(authored.costs_tradeoffs, 'cost');
  assert.equal(authored.category, 'capital');
  assert.equal(authored.domain, 'income');
  assert.equal(authored.tags, 'tag-a, tag-b');
  assert.equal(JSON.stringify(authored).includes('authored_metadata_json'), false);
});

test('E3C1 pins: exact version labels, never latest', () => {
  assert.equal(exactPinnedVersionLabel(4), 'v4');
  assert.equal(exactPinnedVersionLabel(7), 'v7');
  assert.equal(exactPinnedVersionLabel(null), '');
  const slice = parseStrategyEngineAggregate(fixture);
  const rulePin = slice.strategies[0].versions[0].rule_pins[0];
  const calcPin = slice.strategies[0].versions[0].calculation_pins[0];
  assert.equal(exactPinnedVersionLabel(rulePin.version_no), 'v4');
  assert.equal(exactPinnedVersionLabel(calcPin.version_no), 'v7');
  assert.notEqual(exactPinnedVersionLabel(rulePin.version_no), 'latest');
});

test('E3C1 lineage: exact sibling ids in current aggregate only', () => {
  const slice = parseStrategyEngineAggregate(fixture);
  const present = strategyVersionsPresentInAggregate(slice);
  assert.deepEqual(
    strategyVersionLineageLabel(siblingId, present),
    { kind: 'resolved', label: 'Active strategy — v2' },
  );
  assert.deepEqual(strategyVersionLineageLabel(missingId, present), { kind: 'unresolved', id: missingId });
  assert.deepEqual(strategyVersionLineageLabel(null, present), { kind: 'empty' });
  assert.equal(strategyVersionLineageLabel(missingId, present).kind !== 'resolved', true);
});
