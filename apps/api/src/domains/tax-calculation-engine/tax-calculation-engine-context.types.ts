import {
  TAX_CALCULATION_BLOCKED_CODES,
  type TaxCalcBlocked,
  type TaxCalcFacts,
  type TaxCalcRounding,
  type TaxCalcTraceEntry,
  type TaxCalcTypedValue,
  type TaxCalcValueType,
} from './tax-calculation-engine.types.js';

export const TAX_CALCULATION_CONTEXT_BLOCKED_CODES = [
  ...TAX_CALCULATION_BLOCKED_CODES,
  'missing_rule_pin',
  'unresolved_calculation_basis',
  'missing_calculation_basis_pin',
  'country_mismatch',
  'pin_not_effective_as_of',
] as const;

export type TaxCalcContextBlockedCode = (typeof TAX_CALCULATION_CONTEXT_BLOCKED_CODES)[number];

export type TaxCalcContextBlocked = {
  code: TaxCalcContextBlockedCode;
  message: string;
  node_id?: string;
};

export type TaxCalcRulePin = {
  tax_rule_version_id: string;
  country_code: string;
  tax_rule_id?: string;
  version_no?: number;
  payload_checksum?: string;
  effective_from?: string;
  effective_to?: string | null;
};

export type TaxCalcLegalValueSnapshot = {
  legal_value_id: string;
  legal_value_version_id: string;
  value_key: string;
  country_code: string;
  type: TaxCalcValueType;
  value: string | boolean;
  currency?: string;
  effective_from?: string;
  effective_to?: string | null;
  source_checksum?: string;
  snapshot_checksum?: string;
};

export type TaxCalcResolvedCalculationBasis = {
  kind: 'resolved';
  required: boolean;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string;
  country_code: string;
  relationship_id?: string;
};

export type TaxCalcUnresolvedCalculationBasis = {
  kind: 'unresolved';
  required: boolean;
  unresolved_legal_reference_id: string;
  relationship_intent: 'calculation_basis';
  country_code?: string;
  from_tax_rule_version_id?: string;
  locator?: string;
  cited_title?: string;
  cited_number?: string;
};

export type TaxCalcCalculationBasisEntry = TaxCalcResolvedCalculationBasis | TaxCalcUnresolvedCalculationBasis;

export type TaxCalcDefinitionIdentity = {
  calculation_definition_id?: string;
  calculation_definition_version_id?: string;
  expression_checksum?: string;
};

export type TaxCalcExecutionContext = {
  country_code: string;
  as_of: string;
  currency: string;
  facts: TaxCalcFacts;
  rule_pins: TaxCalcRulePin[];
  required_tax_rule_version_ids: string[];
  legal_value_pins: TaxCalcLegalValueSnapshot[];
  calculation_basis: TaxCalcCalculationBasisEntry[];
  definition?: TaxCalcDefinitionIdentity;
  default_rounding?: TaxCalcRounding;
};

export type TaxCalcContextEvaluationInput = {
  context: unknown;
  expression: unknown;
};

export type TaxCalcContextEvaluationOk = {
  ok: true;
  result: TaxCalcTypedValue;
  blocking: [];
  trace: TaxCalcTraceEntry[];
  context_checksum: string;
  input_checksum: string;
  result_checksum: string;
  execution_checksum: string;
  rule_pins: TaxCalcRulePin[];
  legal_value_pins: TaxCalcLegalValueSnapshot[];
  calculation_basis_pins: TaxCalcResolvedCalculationBasis[];
  unresolved_calculation_basis: TaxCalcUnresolvedCalculationBasis[];
};

export type TaxCalcContextEvaluationBlocked = {
  ok: false;
  blocked: TaxCalcContextBlocked;
  blocking: TaxCalcContextBlocked[];
  trace: TaxCalcTraceEntry[];
  context_checksum: string;
  input_checksum?: string;
  result_checksum: string;
  execution_checksum?: string;
  rule_pins: TaxCalcRulePin[];
  legal_value_pins: TaxCalcLegalValueSnapshot[];
  calculation_basis_pins: TaxCalcResolvedCalculationBasis[];
  unresolved_calculation_basis: TaxCalcUnresolvedCalculationBasis[];
};

export type TaxCalcContextEvaluation = TaxCalcContextEvaluationOk | TaxCalcContextEvaluationBlocked;

export function isTaxCalcContextBlockedCode(value: unknown): value is TaxCalcContextBlockedCode {
  return typeof value === 'string' && (TAX_CALCULATION_CONTEXT_BLOCKED_CODES as readonly string[]).includes(value);
}

export function toTaxCalcContextBlocked(blocked: TaxCalcBlocked): TaxCalcContextBlocked {
  return blocked;
}
