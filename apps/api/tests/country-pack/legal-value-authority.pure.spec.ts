import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import {
  assembleAuthorValuePayload,
  assertCountriesMatch,
  assertLegalValueVersionPayloadMutable,
  buildLegalBasisPathLabel,
  formatLegalValueDisplay,
  generateLegalValueKey,
} from '../../src/domains/country-pack/legal-value-authority.pure.js';
import {
  buildLegalBasisPickerOptions,
  buildLegalValueWorkspaceCards,
} from '../../src/domains/country-pack/legal-value-workspace.pure.js';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';

test('machine keys are backend-generated and Hebrew labels do not become latin slugs', () => {
  assert.equal(generateLegalValueKey('Income ceiling', 'a1b2c3d4-e5f6'), 'lv_income_ceiling_a1b2c3d4e5');
  assert.equal(generateLegalValueKey('תקרת הכנסה', 'a1b2c3d4-e5f6'), 'lv_a1b2c3d4e5');
});

test('cross-country authority pin is rejected', () => {
  assert.throws(
    () => assertCountriesMatch('IL', 'US', 'tax_rule_version_id must belong to the same country as the legal value'),
    (error: unknown) => error instanceof AppError && /same country/.test(error.message),
  );
});

test('active historical version cannot be overwritten', () => {
  assert.throws(
    () => assertLegalValueVersionPayloadMutable('active'),
    (error: unknown) => error instanceof AppError && /cannot be overwritten/.test(error.message),
  );
  assert.doesNotThrow(() => assertLegalValueVersionPayloadMutable('draft'));
});

test('author payload reuses canonical value types', () => {
  assert.equal(assembleAuthorValuePayload('money', '120000'), 120000);
  assert.equal(assembleAuthorValuePayload('percentage', 17), 17);
  assert.equal(assembleAuthorValuePayload('boolean', 'true'), true);
  assert.equal(formatLegalValueDisplay('percentage', 17), '17%');
});

test('draft manage does not imply activate', () => {
  assert.equal(capabilityRequiredForOwnerCommand('author_country_legal_value'), 'legal_values.manage');
  assert.equal(capabilityRequiredForOwnerCommand('pin_legal_value_version_authority'), 'legal_values.manage');
  assert.equal(capabilityRequiredForOwnerCommand('activate_legal_value_version'), 'legal_knowledge.activate');
});

test('picker options come from Legal Library tree + rule versions', () => {
  const options = buildLegalBasisPickerOptions({
    domains: [
      {
        id: 'dom-1',
        title: 'Income Tax',
        sources: [
          {
            id: 'src-1',
            title: 'Ordinance',
            nodes: [
              {
                id: 'node-1',
                title: 'Ceiling',
                kind_label: 'Section',
                node_number: '1',
                linked_rules: [{ tax_rule_id: 'rule-1', title: 'Ceiling rule' }],
                children: [],
              },
            ],
          },
        ],
      },
    ],
    rules: [
      {
        id: 'rule-1',
        title: 'Ceiling rule',
        versions: [{ id: 'ver-1', version_no: 1, status: 'draft' }],
      },
    ],
  });
  assert.equal(options.length, 1);
  assert.equal(options[0].tax_rule_version_id, 'ver-1');
  assert.match(options[0].label, /Income Tax → Ordinance → Section 1 Ceiling → Ceiling rule/);
});

test('workspace cards render empty history-safe current/upcoming without frontend legal status math beyond backend statuses', () => {
  const cards = buildLegalValueWorkspaceCards(
    [
      {
        id: 'lv-1',
        country_code: 'IL',
        label: 'Ceiling',
        value_type: 'money',
        status: 'draft',
        versions: [
          {
            id: 'vv-old',
            status: 'active',
            effective_from: '2025-01-01',
            effective_to: '2025-12-31',
            value_payload_json: 100,
            authorities: [{ path_label: 'Income Tax → Ordinance → Section 1', domain_id: 'dom-1', source_id: 'src-1' }],
          },
          {
            id: 'vv-new',
            status: 'active',
            effective_from: '2026-01-01',
            effective_to: '2026-12-31',
            value_payload_json: 200,
            authorities: [{ path_label: 'Income Tax → Ordinance → Section 1', domain_id: 'dom-1', source_id: 'src-1' }],
          },
        ],
      },
    ],
    { IL: 'Israel' },
    '2026-06-01',
    { kind: 'platform_owner', canManage: true, canActivate: true },
  );
  assert.equal(cards[0].current_value_display, '200');
  assert.equal(cards[0].country_name, 'Israel');
  assert.deepEqual(cards[0].legal_basis_display, ['Income Tax → Ordinance → Section 1']);
  assert.equal(cards[0].versions.length, 2);
});

test('legal basis path is assembled from backend titles only', () => {
  assert.equal(buildLegalBasisPathLabel(['Income Tax', 'Ordinance', 'Section 1', 'Ceiling rule']), 'Income Tax → Ordinance → Section 1 → Ceiling rule');
});
