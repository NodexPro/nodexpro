import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  taxStrategyChecksum,
  type TaxStrategyChecksumInput,
} from '../../src/domains/tax-strategy-engine/tax-strategy-engine-checksum.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function baseInput(overrides: Partial<TaxStrategyChecksumInput> = {}): TaxStrategyChecksumInput {
  return {
    country_code: 'IL',
    title: 'Accelerated depreciation',
    requires_professional_judgment: false,
    exclusive_group_id: null,
    required_tax_rule_version_ids: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    prohibited_tax_rule_version_ids: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    calculation_definition_version_ids: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
    authored_metadata_json: {
      explanation: 'note',
      tags: ['b', 'a'],
      category: 'capital',
    },
    ...overrides,
  };
}

test('TAX-E3A checksum: same semantic content produces the same SHA-256', () => {
  const a = taxStrategyChecksum(baseInput());
  const b = taxStrategyChecksum(baseInput());
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
});

test('TAX-E3A checksum: pin order is irrelevant', () => {
  const left = taxStrategyChecksum(baseInput());
  const right = taxStrategyChecksum(
    baseInput({
      required_tax_rule_version_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      prohibited_tax_rule_version_ids: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
      calculation_definition_version_ids: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
    }),
  );
  assert.equal(left, right);
});

test('TAX-E3A checksum: authored_metadata_json key order is irrelevant', () => {
  const left = taxStrategyChecksum(baseInput());
  const right = taxStrategyChecksum(
    baseInput({
      authored_metadata_json: {
        category: 'capital',
        explanation: 'note',
        tags: ['b', 'a'],
      },
    }),
  );
  assert.equal(left, right);
});

test('TAX-E3A checksum: included field change changes checksum', () => {
  const base = taxStrategyChecksum(baseInput());
  assert.notEqual(base, taxStrategyChecksum(baseInput({ title: 'Other title' })));
  assert.notEqual(base, taxStrategyChecksum(baseInput({ country_code: 'US' })));
  assert.notEqual(base, taxStrategyChecksum(baseInput({ requires_professional_judgment: true })));
  assert.notEqual(
    base,
    taxStrategyChecksum(baseInput({ exclusive_group_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' })),
  );
  assert.notEqual(base, taxStrategyChecksum(baseInput({ required_tax_rule_version_ids: [] })));
  assert.notEqual(
    base,
    taxStrategyChecksum(baseInput({ authored_metadata_json: { explanation: 'changed', tags: ['b', 'a'], category: 'capital' } })),
  );
});

test('TAX-E3A checksum: effective window and admin fields are not in the helper contract', () => {
  const helperSrc = readFileSync(
    join(repoRoot, 'apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-checksum.pure.ts'),
    'utf8',
  );
  assert.doesNotMatch(helperSrc, /effective_from/);
  assert.doesNotMatch(helperSrc, /effective_to/);
  assert.doesNotMatch(helperSrc, /admin_label/);
  assert.doesNotMatch(helperSrc, /owner_note/);
  assert.doesNotMatch(helperSrc, /version_no/);
  assert.doesNotMatch(helperSrc, /taxRulePayloadChecksum/);

  const versionLike = {
    ...baseInput(),
    effective_from: '2020-01-01',
    effective_to: '2020-12-31',
    admin_label: 'catalog nick',
    owner_note: 'owner only',
    status: 'active',
    version_no: 3,
  };
  const shiftedWindow = {
    ...versionLike,
    effective_from: '2024-01-01',
    effective_to: null,
    admin_label: 'other nick',
    owner_note: 'changed note',
    status: 'draft',
    version_no: 9,
  };
  assert.equal(
    taxStrategyChecksum({
      country_code: versionLike.country_code,
      title: versionLike.title,
      requires_professional_judgment: versionLike.requires_professional_judgment,
      exclusive_group_id: versionLike.exclusive_group_id,
      required_tax_rule_version_ids: versionLike.required_tax_rule_version_ids,
      prohibited_tax_rule_version_ids: versionLike.prohibited_tax_rule_version_ids,
      calculation_definition_version_ids: versionLike.calculation_definition_version_ids,
      authored_metadata_json: versionLike.authored_metadata_json,
    }),
    taxStrategyChecksum({
      country_code: shiftedWindow.country_code,
      title: shiftedWindow.title,
      requires_professional_judgment: shiftedWindow.requires_professional_judgment,
      exclusive_group_id: shiftedWindow.exclusive_group_id,
      required_tax_rule_version_ids: shiftedWindow.required_tax_rule_version_ids,
      prohibited_tax_rule_version_ids: shiftedWindow.prohibited_tax_rule_version_ids,
      calculation_definition_version_ids: shiftedWindow.calculation_definition_version_ids,
      authored_metadata_json: shiftedWindow.authored_metadata_json,
    }),
  );
});
