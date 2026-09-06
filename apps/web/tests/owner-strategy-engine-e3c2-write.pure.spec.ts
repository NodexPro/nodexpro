import assert from 'node:assert/strict';
import test from 'node:test';
import type { OwnerTaxStrategyAllowedAction } from '../src/pages/owner-legal-control-types.ts';
import {
  buildCreateExclusiveGroupPayload,
  buildCreateTaxStrategyPayload,
  buildCreateTaxStrategyVersionPayload,
  buildStrategyAuthoredMetadataJson,
  buildUpdateExclusiveGroupPayload,
  buildUpdateTaxStrategyMetadataPayload,
  buildUpdateTaxStrategyVersionDraftPayload,
  enabledStrategyAction,
  newlineListToStrings,
  supersedePairsFromStrategyAction,
  versionFormFromAggregate,
} from '../src/pages/owner-strategy-engine-panel.tsx';

const versionForm = {
  title: 'Draft path',
  effective_from: '2026-01-01',
  effective_to: '',
  requires_professional_judgment: true,
  exclusive_group_id: '',
  explanation: 'why',
  benefits: 'a\nb',
  risks: 'r1',
  constraints: '',
  costs_tradeoffs: 'cost',
  category: 'capital',
  domain: 'income',
  tags: 'tag-a\ntag-b',
};

test('E3C2 gating: actions appear only when backend enabled action_key exists', () => {
  const actions: OwnerTaxStrategyAllowedAction[] = [
    { action_key: 'create_tax_strategy', enabled: true, payload: {} },
    { action_key: 'update_tax_strategy_metadata', enabled: false, payload: {} },
  ];
  assert.equal(enabledStrategyAction(actions, 'create_tax_strategy')?.action_key, 'create_tax_strategy');
  assert.equal(enabledStrategyAction(actions, 'update_tax_strategy_metadata'), null);
  assert.equal(enabledStrategyAction(actions, 'create_tax_strategy_exclusive_group'), null);
  assert.equal(enabledStrategyAction([], 'activate_tax_strategy_version'), null);
});

test('E3C2 create strategy payload uses shared country and optional blanks omitted', () => {
  assert.deepEqual(buildCreateTaxStrategyPayload('IL', { strategy_code: 'cap', admin_label: '', owner_note: '' }), {
    country_code: 'IL',
    strategy_code: 'cap',
  });
  assert.deepEqual(
    buildCreateTaxStrategyPayload('IL', { strategy_code: 'cap', admin_label: 'Label', owner_note: 'note' }),
    { country_code: 'IL', strategy_code: 'cap', admin_label: 'Label', owner_note: 'note' },
  );
});

test('E3C2 identity/group update payloads send exact ids and omit immutable codes', () => {
  const identity = buildUpdateTaxStrategyMetadataPayload('s1', { admin_label: '', owner_note: 'kept' });
  assert.equal(identity.tax_strategy_id, 's1');
  assert.equal('country_code' in identity, false);
  assert.equal('strategy_code' in identity, false);
  const group = buildUpdateExclusiveGroupPayload('g1', { title: 'Title', owner_note: '' });
  assert.equal(group.tax_strategy_exclusive_group_id, 'g1');
  assert.equal('country_code' in group, false);
  assert.equal('group_code' in group, false);
  const created = buildCreateExclusiveGroupPayload('IL', { group_code: 'cap', title: 'Capital', owner_note: '' });
  assert.deepEqual(created, { country_code: 'IL', group_code: 'cap', title: 'Capital' });
});

test('E3C2 authored_metadata_json is built from human fields, not raw JSON text', () => {
  assert.deepEqual(newlineListToStrings('a\n\nb \n'), ['a', 'b']);
  const authored = buildStrategyAuthoredMetadataJson(versionForm);
  assert.deepEqual(authored, {
    explanation: 'why',
    benefits: ['a', 'b'],
    risks: ['r1'],
    constraints: [],
    costs_tradeoffs: ['cost'],
    category: 'capital',
    domain: 'income',
    tags: ['tag-a', 'tag-b'],
  });
});

test('E3C2 create/update version payloads use named commands and full draft state', () => {
  const created = buildCreateTaxStrategyVersionPayload('s1', versionForm);
  assert.equal(created.tax_strategy_id, 's1');
  assert.equal(created.title, 'Draft path');
  assert.equal(created.effective_from, '2026-01-01');
  assert.equal(created.effective_to, '');
  assert.equal(created.requires_professional_judgment, true);
  assert.equal(created.exclusive_group_id, '');
  assert.deepEqual(created.authored_metadata_json, buildStrategyAuthoredMetadataJson(versionForm));

  const draft = buildUpdateTaxStrategyVersionDraftPayload('v1', {
    ...versionForm,
    exclusive_group_id: 'g1',
    effective_to: '2026-12-31',
  });
  assert.equal(draft.tax_strategy_version_id, 'v1');
  assert.equal(draft.exclusive_group_id, 'g1');
  assert.equal(draft.effective_to, '2026-12-31');
  assert.equal('status' in draft, false);
});

test('E3C2 version form populate preserves authored lists without inventing values', () => {
  const form = versionFormFromAggregate({
    id: 'v1',
    tax_strategy_id: 's1',
    country_code: 'IL',
    version_no: 2,
    status: 'draft',
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    title: 'Draft path',
    requires_professional_judgment: true,
    exclusive_group_id: null,
    exclusive_group_code: null,
    exclusive_group_title: null,
    authored_metadata_json: {
      explanation: 'why',
      benefits: ['a', 'b'],
      tags: ['tag-a'],
    },
    strategy_checksum: 'x',
    supersedes_version_id: null,
    superseded_by_version_id: null,
    activated_at: null,
    retired_at: null,
    retired_reason: null,
    created_at: '2026-01-01T00:00:00.000Z',
    rule_pins: [],
    calculation_pins: [],
    allowed_actions: [],
  });
  assert.equal(form.effective_from, '2026-01-01');
  assert.equal(form.effective_to, '');
  assert.equal(form.exclusive_group_id, '');
  assert.equal(form.benefits, 'a\nb');
  assert.equal(form.risks, '');
});

test('E3C2 supersede uses exact backend candidate ids only', () => {
  const missing = supersedePairsFromStrategyAction(null);
  assert.deepEqual(missing, []);
  const fromCandidates = supersedePairsFromStrategyAction({
    action_key: 'supersede_tax_strategy_version',
    enabled: true,
    payload: {},
    candidates: [
      {
        new_tax_strategy_version_id: 'new-1',
        old_tax_strategy_version_id: 'old-1',
      },
    ],
  });
  assert.deepEqual(fromCandidates, [
    { new_tax_strategy_version_id: 'new-1', old_tax_strategy_version_id: 'old-1' },
  ]);
  const fromPayload = supersedePairsFromStrategyAction({
    action_key: 'supersede_tax_strategy_version',
    enabled: true,
    payload: {
      new_tax_strategy_version_id: 'new-2',
      old_tax_strategy_version_id: 'old-2',
    },
  });
  assert.deepEqual(fromPayload, [
    { new_tax_strategy_version_id: 'new-2', old_tax_strategy_version_id: 'old-2' },
  ]);
});
