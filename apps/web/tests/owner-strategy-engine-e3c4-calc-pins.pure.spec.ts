import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyStrategyEngineAggregate,
  type OwnerTaxStrategyPinCatalog,
} from '../src/pages/owner-legal-control-types.ts';
import {
  buildPinTaxStrategyCalculationPayload,
  buildUnpinTaxStrategyCalculationPayload,
  enabledStrategyAction,
  parseStrategyEngineAggregate,
  strategyCalculationVersionPickerLabel,
  strategyCalculationVersionPickerRows,
} from '../src/pages/owner-strategy-engine-panel.tsx';

function catalog(): OwnerTaxStrategyPinCatalog {
  return {
    calculation_definition_versions: [
      {
        id: 'cv-old',
        tax_calculation_definition_id: 'cd-1',
        calculation_code: 'DEP',
        title: 'Depreciation',
        version_no: 1,
        status: 'retired',
        effective_from: '2020-01-01',
        effective_to: '2020-12-31',
      },
      {
        id: 'cv-new',
        tax_calculation_definition_id: 'cd-1',
        calculation_code: 'DEP',
        title: 'Depreciation',
        version_no: 2,
        status: 'active',
        effective_from: '2021-01-01',
        effective_to: null,
      },
    ],
  };
}

test('E3C4 gating: pin/unpin only when backend enabled action exists', () => {
  assert.equal(
    enabledStrategyAction(
      [{ action_key: 'pin_tax_strategy_calculation', enabled: true, payload: {} }],
      'pin_tax_strategy_calculation',
    )?.action_key,
    'pin_tax_strategy_calculation',
  );
  assert.equal(
    enabledStrategyAction(
      [{ action_key: 'pin_tax_strategy_calculation', enabled: false, payload: {} }],
      'pin_tax_strategy_calculation',
    ),
    null,
  );
  assert.equal(enabledStrategyAction([], 'pin_tax_strategy_calculation'), null);
  assert.equal(
    enabledStrategyAction(
      [{ action_key: 'unpin_tax_strategy_calculation', enabled: true, payload: {} }],
      'unpin_tax_strategy_calculation',
    )?.action_key,
    'unpin_tax_strategy_calculation',
  );
  assert.equal(enabledStrategyAction([], 'unpin_tax_strategy_calculation'), null);
});

test('E3C4 picker: same aggregate pin_catalog exact versions, no newest default', () => {
  const rows = strategyCalculationVersionPickerRows(catalog());
  assert.deepEqual(
    rows.map((row) => row.id),
    ['cv-old', 'cv-new'],
  );
  assert.equal(strategyCalculationVersionPickerLabel(rows[0]), 'DEP — Depreciation — v1 (retired)');
  assert.equal(strategyCalculationVersionPickerLabel(rows[1]), 'DEP — Depreciation — v2 (active)');
  assert.deepEqual(
    strategyCalculationVersionPickerRows(emptyStrategyEngineAggregate().pin_catalog),
    [],
  );
  const parsed = parseStrategyEngineAggregate({
    selected_country_code: 'IL',
    pin_catalog: catalog(),
  });
  assert.deepEqual(
    parsed.pin_catalog.calculation_definition_versions.map((row) => row.id),
    ['cv-old', 'cv-new'],
  );
  assert.deepEqual(parseStrategyEngineAggregate(null).pin_catalog.calculation_definition_versions, []);
});

test('E3C4 pin/unpin payloads use exact E3B identifiers', () => {
  assert.deepEqual(buildPinTaxStrategyCalculationPayload('sv-1', 'cv-old'), {
    tax_strategy_version_id: 'sv-1',
    calculation_definition_version_id: 'cv-old',
  });
  assert.deepEqual(buildUnpinTaxStrategyCalculationPayload('pin-c'), {
    tax_strategy_version_calculation_pin_id: 'pin-c',
  });
});
