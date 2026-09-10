import { badRequest } from '../../shared/errors.js';
import { TAX_RULE_RELATIONSHIP_TYPES } from '../tax-knowledge/tax-knowledge.types.js';

export const TAX_RULE_ENGINE_COMMANDS = ['evaluate_tax_rules'] as const;

export type TaxRuleEngineCommandName = (typeof TAX_RULE_ENGINE_COMMANDS)[number];

export const TAX_RULE_ENGINE_AGGREGATE_KEY = 'tax_rule_engine_evaluation_aggregate' as const;

export const EVALUATION_AS_OF_FACT = 'evaluation_as_of';

export const TAX_RULE_ENGINE_MAX_PREDICATE_DEPTH = 8;
export const TAX_RULE_ENGINE_MAX_PREDICATE_NODES = 64;

export const TAX_RULE_ENGINE_FACT_TYPES = ['string', 'number', 'boolean', 'date', 'enum'] as const;

export type TaxRuleEngineFactType = (typeof TAX_RULE_ENGINE_FACT_TYPES)[number];

export const TAX_RULE_ENGINE_PREDICATE_OPS = [
  'eq',
  'neq',
  'exists',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'between',
  'is_null',
  'is_not_null',
] as const;

export type TaxRuleEnginePredicateOp = (typeof TAX_RULE_ENGINE_PREDICATE_OPS)[number];

export type TaxRuleEngineFactValue = string | number | boolean | null;

export type TaxRuleEngineFacts = Record<string, TaxRuleEngineFactValue>;

export type TaxRuleEngineClassification = 'applicable' | 'not_applicable' | 'undetermined';

export type TaxRuleEngineClassificationReason =
  | 'applies_if_true'
  | 'applies_if_false'
  | 'does_not_apply_if_true'
  | 'missing_facts'
  | 'predicate_unsupported'
  | 'type_mismatch';

export type TaxRuleEnginePredicateReason = 'missing_facts' | 'predicate_unsupported' | 'type_mismatch';

export const TAX_RULE_ENGINE_BLOCKING_RELATIONSHIP_TYPES = [
  'depends_on',
  'conflicts_with',
  'exception_to',
  'overrides',
] as const;

export type TaxRuleEngineBlockingRelationshipType =
  (typeof TAX_RULE_ENGINE_BLOCKING_RELATIONSHIP_TYPES)[number];

export const TAX_RULE_ENGINE_TRACE_RELATIONSHIP_TYPES = [
  'special_case_of',
  'elaborates',
  'alternative_to',
] as const;

export type TaxRuleEngineTraceRelationshipType =
  (typeof TAX_RULE_ENGINE_TRACE_RELATIONSHIP_TYPES)[number];

export type TaxRuleEngineBlockingEffect =
  | 'unmet_dependency'
  | 'conflict'
  | 'exception'
  | 'override';

export type TaxRuleEngineLinkedRequirementEffect =
  | 'unmet_companion'
  | 'unmet_procedure'
  | 'unresolved_dependency';

export type TaxRuleEngineEvaluateInput = {
  country_code: string;
  as_of: string;
  facts: TaxRuleEngineFacts;
};

export type TaxRuleEngineSourcePin = {
  tax_rule_version_source_id: string;
  tax_source_id: string;
  source_code: string;
  title: string;
  provenance_type: string;
  locator: string | null;
};

export type TaxRuleEngineLegalValueBinding = {
  tax_rule_version_legal_value_id: string;
  legal_value_id: string;
  value_key: string;
  label: string;
};

export type TaxRuleEngineEvaluatedRule = {
  tax_rule_id: string;
  rule_code: string;
  tax_rule_version_id: string;
  version_no: number;
  payload_checksum: string;
  statement: string | null;
  classification: TaxRuleEngineClassification;
  classification_reason: TaxRuleEngineClassificationReason;
  predicate_reason: TaxRuleEnginePredicateReason | null;
  missing_facts: string[];
  sources: TaxRuleEngineSourcePin[];
  legal_value_bindings: TaxRuleEngineLegalValueBinding[];
};

export type TaxRuleEngineBlocking = {
  relationship_id: string;
  relationship_type: TaxRuleEngineBlockingRelationshipType;
  effect: TaxRuleEngineBlockingEffect;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string;
};

export type TaxRuleEngineRelationshipTrace = {
  relationship_id: string;
  relationship_type: TaxRuleEngineTraceRelationshipType;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string;
};

export type TaxRuleEngineLinkedRule = {
  relationship_id: string;
  relationship_type: string;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string;
  effect: 'companion' | 'procedural_guidance';
};

export type TaxRuleEngineCalculationLink = {
  relationship_id: string;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string;
  relationship_type: 'calculation_basis';
};

export type TaxRuleEngineBlockingLinkedRequirement = {
  relationship_id: string | null;
  unresolved_legal_reference_id: string | null;
  relationship_type: string;
  effect: TaxRuleEngineLinkedRequirementEffect;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string | null;
};

export type TaxRuleEngineUnresolvedLegalReference = {
  id: string;
  from_tax_rule_version_id: string;
  relationship_intent: string;
  activation_critical: boolean | null;
  cited_title: string | null;
  cited_law_name: string | null;
  cited_instrument_kind: string;
  cited_provision_number: string | null;
  locator_text: string;
  status: string;
};

export type TaxRuleEngineEvaluationAggregate = {
  aggregate_key: typeof TAX_RULE_ENGINE_AGGREGATE_KEY;
  country_code: string;
  as_of: string;
  evaluated_version_ids: string[];
  applicable: TaxRuleEngineEvaluatedRule[];
  not_applicable: TaxRuleEngineEvaluatedRule[];
  undetermined: TaxRuleEngineEvaluatedRule[];
  missing_facts: string[];
  blocking: TaxRuleEngineBlocking[];
  relationship_trace: TaxRuleEngineRelationshipTrace[];
  linked_rules: TaxRuleEngineLinkedRule[];
  unresolved_legal_references: TaxRuleEngineUnresolvedLegalReference[];
  calculation_links: TaxRuleEngineCalculationLink[];
  blocking_linked_requirements: TaxRuleEngineBlockingLinkedRequirement[];
};

export type TaxRuleEngineCommandResponse = {
  ok: true;
  command: TaxRuleEngineCommandName;
  refreshed: {
    aggregate_key: typeof TAX_RULE_ENGINE_AGGREGATE_KEY;
    aggregate: TaxRuleEngineEvaluationAggregate;
  };
};

export type TaxRuleEngineCandidate = {
  tax_rule_id: string;
  rule_code: string;
  tax_rule_version_id: string;
  country_code: string;
  version_no: number;
  payload_json: Record<string, unknown>;
  payload_checksum: string;
  sources: TaxRuleEngineSourcePin[];
  legal_value_bindings: TaxRuleEngineLegalValueBinding[];
};

export type TaxRuleEngineRelationshipEdge = {
  id: string;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string;
  relationship_type: string;
  status: string;
  activation_critical?: boolean | null;
};

const FORBIDDEN_EVALUATE_FIELDS = [
  'organization_id',
  'client_id',
  'tax_rule_id',
  'tax_rule_version_id',
  'tax_rule_version_ids',
  'country_codes',
] as const;

export function isTaxRuleEngineCommand(command: string): command is TaxRuleEngineCommandName {
  return (TAX_RULE_ENGINE_COMMANDS as readonly string[]).includes(command);
}

export function isTaxRuleEngineBlockingType(
  value: string,
): value is TaxRuleEngineBlockingRelationshipType {
  return (TAX_RULE_ENGINE_BLOCKING_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

export function isTaxRuleEngineTraceType(value: string): value is TaxRuleEngineTraceRelationshipType {
  return (TAX_RULE_ENGINE_TRACE_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

export function isKnownTaxRuleRelationshipType(value: string): boolean {
  return (TAX_RULE_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

export function parseEvaluateTaxRulesInput(payload: Record<string, unknown>): TaxRuleEngineEvaluateInput {
  for (const field of FORBIDDEN_EVALUATE_FIELDS) {
    if (field in payload) {
      throw badRequest(`evaluate_tax_rules does not accept ${field}`);
    }
  }

  const countryCode = parseCountryCode(payload.country_code);
  const asOf = parseIsoDate(payload.as_of, 'as_of');
  const facts = parseTaxRuleEngineFacts(payload.facts);
  return { country_code: countryCode, as_of: asOf, facts };
}

export function parseCountryCode(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('country_code is required');
  }
  const countryCode = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw badRequest('country_code must be ISO 3166-1 alpha-2');
  }
  return countryCode;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isGregorianLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Canonical YYYY-MM-DD that exists on the Gregorian calendar. No Date/timezone. */
export function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, isGregorianLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

export function parseIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const date = value.trim();
  if (!isCanonicalIsoDate(date)) {
    throw badRequest(`${field} must be a valid YYYY-MM-DD calendar date`);
  }
  return date;
}

export function parseTaxRuleEngineFacts(value: unknown): TaxRuleEngineFacts {
  if (value === undefined || value === null) {
    throw badRequest('facts is required');
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('facts must be an object');
  }
  const facts: TaxRuleEngineFacts = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) {
      throw badRequest('facts keys must be non-empty strings');
    }
    if (key === EVALUATION_AS_OF_FACT) {
      throw badRequest('facts.evaluation_as_of is reserved and must not be supplied by the client');
    }
    if (raw === null) {
      facts[key] = null;
      continue;
    }
    const t = typeof raw;
    if (t === 'string' || t === 'boolean') {
      facts[key] = raw as string | boolean;
      continue;
    }
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        throw badRequest(`facts.${key} must be a finite number`);
      }
      facts[key] = raw;
      continue;
    }
    throw badRequest(`facts.${key} must be a string, number, boolean, or null`);
  }
  return facts;
}

export function versionInEffectiveWindow(
  effectiveFrom: string,
  effectiveTo: string | null,
  asOf: string,
): boolean {
  return effectiveFrom <= asOf && (effectiveTo == null || effectiveTo >= asOf);
}
