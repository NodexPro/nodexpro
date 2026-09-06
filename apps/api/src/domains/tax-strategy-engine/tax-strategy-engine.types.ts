import type { TaxCalculationResultAggregate } from '../tax-calculation-engine/tax-calculation-engine-commands.types.js';
import type { TaxRuleEngineEvaluationAggregate } from '../tax-rule-engine/tax-rule-engine.types.js';

export const TAX_STRATEGY_ENGINE_EVALUATION_KEY = 'tax_strategy_engine_evaluation' as const;

export const TAX_STRATEGY_STATUSES = [
  'unavailable',
  'unevaluable',
  'legally_constrained',
  'judgment_required',
  'available',
] as const;

export type TaxStrategyStatus = (typeof TAX_STRATEGY_STATUSES)[number];

export const TAX_STRATEGY_STATUS_PRECEDENCE: readonly TaxStrategyStatus[] = TAX_STRATEGY_STATUSES;

export const TAX_STRATEGY_FINDING_SEVERITIES = [
  'closes',
  'incomplete',
  'constrains',
  'judgment',
  'info',
] as const;

export type TaxStrategyFindingSeverity = (typeof TAX_STRATEGY_FINDING_SEVERITIES)[number];

export const TAX_STRATEGY_FINDING_CODES = [
  'prohibited_rule_applicable',
  'required_rule_not_applicable',
  'required_rule_not_evaluated',
  'missing_facts',
  'calculation_not_supplied',
  'calculation_pin_mismatch',
  'calculation_missing_inputs',
  'exclusive_group_peer_not_resolved',
  'conflict',
  'exception',
  'override',
  'unmet_dependency',
  'unmet_companion',
  'unmet_procedure',
  'unresolved_legal_reference_blocking',
  'exclusive_group_collision',
  'requires_professional_judgment',
  'unresolved_legal_reference',
  'calculation_blocked',
] as const;

export type TaxStrategyFindingCode = (typeof TAX_STRATEGY_FINDING_CODES)[number];

export const TAX_STRATEGY_FINDING_SEVERITY_BY_CODE: Record<
  TaxStrategyFindingCode,
  TaxStrategyFindingSeverity
> = {
  prohibited_rule_applicable: 'closes',
  required_rule_not_applicable: 'closes',
  required_rule_not_evaluated: 'incomplete',
  missing_facts: 'incomplete',
  calculation_not_supplied: 'incomplete',
  calculation_pin_mismatch: 'incomplete',
  calculation_missing_inputs: 'incomplete',
  exclusive_group_peer_not_resolved: 'incomplete',
  conflict: 'constrains',
  exception: 'constrains',
  override: 'constrains',
  unmet_dependency: 'constrains',
  unmet_companion: 'constrains',
  unmet_procedure: 'constrains',
  unresolved_legal_reference_blocking: 'constrains',
  exclusive_group_collision: 'constrains',
  requires_professional_judgment: 'judgment',
  unresolved_legal_reference: 'info',
  calculation_blocked: 'info',
};

export const TAX_STRATEGY_STATUS_BY_SEVERITY: Record<
  Exclude<TaxStrategyFindingSeverity, 'info'>,
  TaxStrategyStatus
> = {
  closes: 'unavailable',
  incomplete: 'unevaluable',
  constrains: 'legally_constrained',
  judgment: 'judgment_required',
};

export type TaxStrategyFinding = {
  code: TaxStrategyFindingCode;
  severity: TaxStrategyFindingSeverity;
  tax_rule_version_id?: string;
  relationship_id?: string | null;
  unresolved_legal_reference_id?: string | null;
  calculation_definition_version_id?: string;
  exclusive_group_id?: string;
  missing_facts?: string[];
  k4_blocking_codes?: string[];
  peer_strategy_version_ids?: string[];
};

export type TaxStrategyRulePin = {
  tax_rule_version_id: string;
};

export type TaxStrategyCalculationPin = {
  calculation_definition_version_id: string;
};

export type TaxStrategyVersionInput = {
  strategy_id: string;
  strategy_version_id: string;
  strategy_code: string;
  country_code: string;
  title?: string;
  exclusive_group_id?: string | null;
  requires_professional_judgment?: boolean;
  required_rule_pins: TaxStrategyRulePin[];
  prohibited_rule_pins?: TaxStrategyRulePin[];
  calculation_pins?: TaxStrategyCalculationPin[];
};

export type TaxStrategyAttachedCalculation = {
  calculation_definition_version_id: string;
  status: 'calculated' | 'blocked';
  result: TaxCalculationResultAggregate['result'];
  result_checksum: string;
  k4_blocking_codes: string[];
};

export type TaxStrategyMemberEvaluation = {
  strategy_id: string;
  strategy_version_id: string;
  strategy_code: string;
  country_code: string;
  exclusive_group_id: string | null;
  status: TaxStrategyStatus;
  findings: TaxStrategyFinding[];
  calculations: TaxStrategyAttachedCalculation[];
};

export type TaxStrategyEvaluation = {
  evaluation_key: typeof TAX_STRATEGY_ENGINE_EVALUATION_KEY;
  country_code: string;
  as_of: string;
  members: TaxStrategyMemberEvaluation[];
  evaluation_checksum: string;
};

export type TaxStrategyEvaluateInput = {
  country_code: string;
  as_of: string;
  strategies: TaxStrategyVersionInput[];
  rule_evaluation: TaxRuleEngineEvaluationAggregate;
  calculations?: TaxCalculationResultAggregate[];
};

export function hasLatestVersionResolver(): boolean {
  return false;
}
