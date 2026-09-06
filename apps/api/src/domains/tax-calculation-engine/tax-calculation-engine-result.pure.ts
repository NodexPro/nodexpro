import type { TaxCalcContextEvaluation } from './tax-calculation-engine-context.types.js';
import type { TaxCalcExecutionContext } from './tax-calculation-engine-context.types.js';
import {
  TAX_CALCULATION_DIALECT,
  TAX_CALCULATION_DIALECT_VERSION,
  TAX_CALCULATION_RESULT_AGGREGATE_KEY,
  type TaxCalculationResultAggregate,
} from './tax-calculation-engine-commands.types.js';

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function missingInputsFromBlocking(
  blocking: TaxCalculationResultAggregate['blocking'],
): string[] {
  const keys: string[] = [];
  for (const item of blocking) {
    if (item.code !== 'missing_input') continue;
    const prefix = 'missing_input:';
    keys.push(item.message.startsWith(prefix) ? item.message.slice(prefix.length) : item.message);
  }
  return uniqueSorted(keys);
}

export function buildTaxCalculationResultAggregate(
  context: TaxCalcExecutionContext,
  evaluation: TaxCalcContextEvaluation,
): TaxCalculationResultAggregate {
  const blocking = evaluation.ok ? [] : evaluation.blocking;
  return {
    aggregate_key: TAX_CALCULATION_RESULT_AGGREGATE_KEY,
    country_code: context.country_code,
    as_of: context.as_of,
    currency: context.currency,
    status: evaluation.ok ? 'calculated' : 'blocked',
    definition: context.definition ?? null,
    result: evaluation.ok ? evaluation.result : null,
    blocking,
    missing_inputs: missingInputsFromBlocking(blocking),
    rule_pins: evaluation.rule_pins,
    legal_value_pins: evaluation.legal_value_pins,
    calculation_basis_pins: evaluation.calculation_basis_pins,
    unresolved_calculation_basis: evaluation.unresolved_calculation_basis,
    trace: evaluation.trace,
    context_checksum: evaluation.context_checksum,
    input_checksum: evaluation.input_checksum ?? null,
    result_checksum: evaluation.result_checksum,
    execution_checksum: evaluation.execution_checksum ?? null,
    engine: {
      dialect: TAX_CALCULATION_DIALECT,
      dialect_version: TAX_CALCULATION_DIALECT_VERSION,
    },
  };
}
