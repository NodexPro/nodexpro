import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleStrategyEngineSlice,
  eligibleStrategySupersessionPairs,
  mapCalculationPin,
  mapExclusiveGroup,
  mapRulePin,
  mapStrategyIdentity,
  mapStrategyVersion,
  pairingRowFromVersion,
  strategyVersionAllowedActions,
} from '../../src/domains/tax-strategy-engine/tax-strategy-engine-read-models.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const draftRow = {
  id: '11111111-1111-4111-8111-111111111111',
  tax_strategy_id: '22222222-2222-4222-8222-222222222222',
  country_code: 'IL',
  version_no: 1,
  status: 'draft',
  effective_from: '2020-01-01',
  effective_to: null,
  title: 'Draft strategy',
  requires_professional_judgment: false,
  exclusive_group_id: '33333333-3333-4333-8333-333333333333',
  authored_metadata_json: { explanation: 'x' },
  strategy_checksum: 'abc',
  supersedes_version_id: null,
  superseded_by_version_id: null,
  activated_at: null,
  retired_at: null,
  retired_reason: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

const activeRow = {
  ...draftRow,
  id: '44444444-4444-4444-8444-444444444444',
  version_no: 2,
  status: 'active',
  title: 'Active strategy',
  exclusive_group_id: null,
};

const retiredRow = {
  ...draftRow,
  id: '55555555-5555-4555-8555-555555555555',
  version_no: 3,
  status: 'retired',
  title: 'Retired strategy',
  exclusive_group_id: null,
  retired_at: '2026-02-01T00:00:00.000Z',
  retired_reason: 'replaced',
};

const group = mapExclusiveGroup({
  id: '33333333-3333-4333-8333-333333333333',
  country_code: 'IL',
  group_code: 'cap',
  title: 'Capital group',
  owner_note: 'note',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
});

test('TAX-E3A aggregate composition: strategy_engine sibling, no new GET', () => {
  const panel = readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');
  assert.match(panel, /buildOwnerStrategyEngineAggregate/);
  assert.match(panel, /strategy_engine: strategyEngine/);
  assert.match(panel, /strategy_engine_country_code/);
  assert.match(panel, /'tax_strategy'/);
  assert.match(panel, /'tax_strategy_exclusive_group'/);
  assert.match(panel, /'tax_strategy_version'/);
  assert.match(panel, /'tax_strategy_version_rule_pin'/);
  assert.match(panel, /'tax_strategy_version_calculation_pin'/);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /router\.get\('\/legal-control'/);
  assert.match(routes, /strategy_engine_country_code/);
  assert.doesNotMatch(routes, /router\.get\('\/strategy-engine'/);
  assert.doesNotMatch(routes, /\/owner\/tax-strategies/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
});

test('TAX-E3A mapping: identity, version, group, exact pins', () => {
  const rulePin = mapRulePin(
    {
      id: '66666666-6666-4666-8666-666666666666',
      tax_strategy_version_id: draftRow.id,
      tax_rule_version_id: '77777777-7777-4777-8777-777777777777',
      pin_role: 'required',
      created_at: '2026-01-03T00:00:00.000Z',
    },
    { tax_rule_id: '88888888-8888-4888-8888-888888888888', version_no: 4, status: 'active' },
    { rule_code: 'SEC-14', title: 'Section 14' },
    true,
  );
  const calcPin = mapCalculationPin(
    {
      id: '99999999-9999-4999-8999-999999999999',
      tax_strategy_version_id: draftRow.id,
      calculation_definition_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      created_at: '2026-01-04T00:00:00.000Z',
    },
    { tax_calculation_definition_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', version_no: 2, status: 'active' },
    { calculation_code: 'dep', title: 'Depreciation calc' },
    true,
  );

  const version = mapStrategyVersion(draftRow, group, [rulePin], [calcPin], [
    pairingRowFromVersion(draftRow),
    pairingRowFromVersion(activeRow),
  ]);
  const identity = mapStrategyIdentity(
    {
      id: draftRow.tax_strategy_id,
      country_code: 'IL',
      strategy_code: 'accel-dep',
      admin_label: 'Admin nick',
      owner_note: 'Owner only',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-05T00:00:00.000Z',
    },
    [version],
  );

  assert.equal(identity.strategy_code, 'accel-dep');
  assert.equal(identity.admin_label, 'Admin nick');
  assert.equal(identity.versions[0]?.id, draftRow.id);
  assert.equal(version.title, 'Draft strategy');
  assert.equal(version.exclusive_group_id, group.id);
  assert.equal(version.exclusive_group_code, 'cap');
  assert.equal(version.exclusive_group_title, 'Capital group');
  assert.equal(version.rule_pins[0]?.tax_rule_version_id, '77777777-7777-4777-8777-777777777777');
  assert.equal(version.rule_pins[0]?.tax_rule_id, '88888888-8888-4888-8888-888888888888');
  assert.equal(version.rule_pins[0]?.pin_role, 'required');
  assert.equal(version.calculation_pins[0]?.calculation_definition_version_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(version.calculation_pins[0]?.calculation_code, 'dep');
  assert.equal(group.group_code, 'cap');

  const slice = assembleStrategyEngineSlice({
    selectedCountryCode: 'IL',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    exclusiveGroups: [group],
    strategies: [identity],
    strategyVersions: [version],
    warnings: [],
  });
  assert.equal(slice.selected_country_code, 'IL');
  assert.equal(slice.strategies[0]?.versions[0]?.rule_pins[0]?.id, rulePin.id);
  assert.equal('implemented_commands' in slice, false);
  assert.deepEqual(slice.allowed_actions, []);
  assert.deepEqual(identity.allowed_actions, []);
  assert.deepEqual(version.allowed_actions, []);
  assert.deepEqual(group.allowed_actions, []);
  assert.deepEqual(rulePin.allowed_actions, []);
  assert.deepEqual(calcPin.allowed_actions, []);
});

test('TAX-E3A mapping: does not resolve another version', () => {
  const pinned = mapRulePin(
    {
      id: 'pin-1',
      tax_strategy_version_id: draftRow.id,
      tax_rule_version_id: 'pinned-version',
      pin_role: 'prohibited',
      created_at: '2026-01-03T00:00:00.000Z',
    },
    { tax_rule_id: 'rule-1', version_no: 1, status: 'retired' },
    { rule_code: 'OLD', title: 'Pinned exact' },
    true,
  );
  assert.equal(pinned.tax_rule_version_id, 'pinned-version');
  assert.equal(pinned.version_no, 1);
  assert.equal(pinned.status, 'retired');
  const src = readRepo('apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-read-models.pure.ts');
  const service = readRepo(
    'apps/api/src/domains/tax-strategy-engine/owner-read/tax-strategy-engine-read-models.service.ts',
  );
  assert.doesNotMatch(src, /latest_version|resolveLatest|current_active/);
  assert.doesNotMatch(service, /latest_version|resolveLatest|current_active/);
});

test('TAX-E3A allowed_actions: published slice is empty until E3B handlers exist', () => {
  const src = readRepo('apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-read-models.pure.ts');
  assert.doesNotMatch(src, /implemented_commands/);
  const service = readRepo(
    'apps/api/src/domains/tax-strategy-engine/owner-read/tax-strategy-engine-read-models.service.ts',
  );
  assert.doesNotMatch(service, /implemented_commands/);

  const identity = mapStrategyIdentity(
    {
      id: draftRow.tax_strategy_id,
      country_code: 'IL',
      strategy_code: 'accel-dep',
      admin_label: null,
      owner_note: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    [],
  );
  const version = mapStrategyVersion(draftRow, group, [], [], [pairingRowFromVersion(draftRow)]);
  const unpin = mapRulePin(
    {
      id: 'pin-1',
      tax_strategy_version_id: draftRow.id,
      tax_rule_version_id: 'rv-1',
      pin_role: 'required',
      created_at: '2026-01-03T00:00:00.000Z',
    },
    undefined,
    undefined,
    true,
  );
  const calcPin = mapCalculationPin(
    {
      id: 'pin-c',
      tax_strategy_version_id: draftRow.id,
      calculation_definition_version_id: 'cv-1',
      created_at: '2026-01-04T00:00:00.000Z',
    },
    undefined,
    undefined,
    true,
  );
  const slice = assembleStrategyEngineSlice({
    selectedCountryCode: 'IL',
    countries: [],
    exclusiveGroups: [group],
    strategies: [identity],
    strategyVersions: [version],
    warnings: [],
  });

  assert.deepEqual(slice.allowed_actions, []);
  assert.deepEqual(identity.allowed_actions, []);
  assert.deepEqual(group.allowed_actions, []);
  assert.deepEqual(version.allowed_actions, []);
  assert.deepEqual(unpin.allowed_actions, []);
  assert.deepEqual(calcPin.allowed_actions, []);
  assert.equal(slice.allowed_actions.some((row) => row.enabled), false);
});

test('TAX-E3A helper: draft / active / retired lifecycle stays internal', () => {
  const siblings = [pairingRowFromVersion(draftRow), pairingRowFromVersion(activeRow), pairingRowFromVersion(retiredRow)];

  const draftActions = strategyVersionAllowedActions(pairingRowFromVersion(draftRow), siblings).map((row) => row.action_key);
  assert.deepEqual(draftActions, [
    'update_tax_strategy_version_draft',
    'pin_tax_strategy_version_rule',
    'pin_tax_strategy_version_calculation',
    'activate_tax_strategy_version',
    'retire_tax_strategy_version',
    'supersede_tax_strategy_version',
  ]);

  const activeActions = strategyVersionAllowedActions(pairingRowFromVersion(activeRow), siblings).map((row) => row.action_key);
  assert.deepEqual(activeActions, [
    'close_tax_strategy_version_effective_to',
    'retire_tax_strategy_version',
    'supersede_tax_strategy_version',
  ]);

  const retiredActions = strategyVersionAllowedActions(pairingRowFromVersion(retiredRow), siblings);
  assert.deepEqual(retiredActions, []);
});

test('TAX-E3A supersede candidates are exact ids only', () => {
  const pairs = eligibleStrategySupersessionPairs(pairingRowFromVersion(draftRow), [
    pairingRowFromVersion(draftRow),
    pairingRowFromVersion(activeRow),
  ]);
  assert.deepEqual(pairs, [
    {
      new_tax_strategy_version_id: draftRow.id,
      old_tax_strategy_version_id: activeRow.id,
    },
  ]);
});
