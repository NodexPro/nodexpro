import type {
  TaxCalcContextBlocked,
  TaxCalcDefinitionIdentity,
  TaxCalcLegalValueSnapshot,
  TaxCalcResolvedCalculationBasis,
  TaxCalcRulePin,
  TaxCalcUnresolvedCalculationBasis,
} from './tax-calculation-engine-context.types.js';
import type { TaxCalcTraceEntry, TaxCalcTypedValue } from './tax-calculation-engine.types.js';

export const TAX_CALCULATION_ENGINE_COMMANDS = ['calculate_tax'] as const;

export type TaxCalculationEngineCommandName = (typeof TAX_CALCULATION_ENGINE_COMMANDS)[number];

export const TAX_CALCULATION_RESULT_AGGREGATE_KEY = 'tax_calculation_result_aggregate' as const;

export const TAX_CALCULATION_DIALECT = 'tax_calculation_k4' as const;
export const TAX_CALCULATION_DIALECT_VERSION = 'K4C' as const;

export const CALCULATE_TAX_PAYLOAD_FIELDS = [
  'country_code',
  'as_of',
  'currency',
  'expression',
  'facts',
  'rule_pins',
  'required_tax_rule_version_ids',
  'legal_value_pins',
  'calculation_basis',
  'definition',
  'default_rounding',
] as const;

export type TaxCalculationResultStatus = 'calculated' | 'blocked';

export type TaxCalculationEngineMetadata = {
  dialect: typeof TAX_CALCULATION_DIALECT;
  dialect_version: typeof TAX_CALCULATION_DIALECT_VERSION;
};

export type TaxCalculationResultAggregate = {
  aggregate_key: typeof TAX_CALCULATION_RESULT_AGGREGATE_KEY;
  country_code: string;
  as_of: string;
  currency: string;
  status: TaxCalculationResultStatus;
  definition: TaxCalcDefinitionIdentity | null;
  result: TaxCalcTypedValue | null;
  blocking: TaxCalcContextBlocked[];
  missing_inputs: string[];
  rule_pins: TaxCalcRulePin[];
  legal_value_pins: TaxCalcLegalValueSnapshot[];
  calculation_basis_pins: TaxCalcResolvedCalculationBasis[];
  unresolved_calculation_basis: TaxCalcUnresolvedCalculationBasis[];
  trace: TaxCalcTraceEntry[];
  context_checksum: string;
  input_checksum: string | null;
  result_checksum: string;
  execution_checksum: string | null;
  engine: TaxCalculationEngineMetadata;
};

export type TaxCalculationEngineCommandResponse = {
  ok: true;
  command: 'calculate_tax';
  refreshed: {
    aggregate_key: typeof TAX_CALCULATION_RESULT_AGGREGATE_KEY;
    aggregate: TaxCalculationResultAggregate;
  };
};

export function isTaxCalculationEngineCommand(command: string): command is TaxCalculationEngineCommandName {
  return (TAX_CALCULATION_ENGINE_COMMANDS as readonly string[]).includes(command);
}
