import { taxRulePayloadChecksum } from '../tax-knowledge/tax-knowledge-checksum.pure.js';
import { evaluateTaxCalculation } from './tax-calculation-engine-evaluate.pure.js';
import { parseConstScalar } from './tax-calculation-engine-validate.pure.js';
import {
  isTaxCalcCanonicalDate,
  isTaxCalcRoundingMode,
  isTaxCalcValueType,
  type TaxCalcFacts,
  type TaxCalcPinnedLegalValue,
  type TaxCalcRounding,
  type TaxCalcTypedValue,
} from './tax-calculation-engine.types.js';
import {
  toTaxCalcContextBlocked,
  type TaxCalcCalculationBasisEntry,
  type TaxCalcContextBlocked,
  type TaxCalcContextEvaluation,
  type TaxCalcContextEvaluationInput,
  type TaxCalcDefinitionIdentity,
  type TaxCalcExecutionContext,
  type TaxCalcLegalValueSnapshot,
  type TaxCalcResolvedCalculationBasis,
  type TaxCalcRulePin,
  type TaxCalcUnresolvedCalculationBasis,
} from './tax-calculation-engine-context.types.js';

type ParseOk<T> = { ok: true; value: T };
type ParseErr = { ok: false; blocked: TaxCalcContextBlocked };
type ParseResult<T> = ParseOk<T> | ParseErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: TaxCalcContextBlocked['code'], message: string): ParseErr {
  return { ok: false, blocked: { code, message } };
}

function nonEmptyString(value: unknown, field: string): string | ParseErr {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    return fail('invalid_expression', `${field} must be a non-empty string`);
  }
  return value;
}

function optionalNonEmptyString(value: unknown, field: string): string | undefined | ParseErr {
  if (value === undefined) return undefined;
  return nonEmptyString(value, field);
}

function optionalDate(value: unknown, field: string): string | null | undefined | ParseErr {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isTaxCalcCanonicalDate(value)) {
    return fail('invalid_expression', `${field} must be a canonical Gregorian YYYY-MM-DD`);
  }
  return value;
}

function checksumPayload(payload: Record<string, unknown>): string {
  return taxRulePayloadChecksum(payload);
}

function compareId(a: string, b: string): number {
  return a.localeCompare(b);
}

function asOfInWindow(asOf: string, from?: string, to?: string | null): boolean {
  if (from !== undefined && asOf < from) return false;
  if (to !== undefined && to !== null && asOf > to) return false;
  return true;
}

function sortRulePins(pins: TaxCalcRulePin[]): TaxCalcRulePin[] {
  return pins.slice().sort((a, b) => compareId(a.tax_rule_version_id, b.tax_rule_version_id));
}

function sortLegalPins(pins: TaxCalcLegalValueSnapshot[]): TaxCalcLegalValueSnapshot[] {
  return pins.slice().sort((a, b) => compareId(a.legal_value_version_id, b.legal_value_version_id));
}

function basisSortKey(entry: TaxCalcCalculationBasisEntry): string {
  if (entry.kind === 'resolved') {
    return `resolved:${entry.relationship_id ?? `${entry.from_tax_rule_version_id}:${entry.to_tax_rule_version_id}`}`;
  }
  return `unresolved:${entry.unresolved_legal_reference_id}`;
}

function sortBasis(entries: TaxCalcCalculationBasisEntry[]): TaxCalcCalculationBasisEntry[] {
  return entries.slice().sort((a, b) => compareId(basisSortKey(a), basisSortKey(b)));
}

function pinRecord(pin: TaxCalcRulePin): Record<string, unknown> {
  return {
    tax_rule_version_id: pin.tax_rule_version_id,
    country_code: pin.country_code,
    ...(pin.tax_rule_id ? { tax_rule_id: pin.tax_rule_id } : {}),
    ...(pin.version_no !== undefined ? { version_no: pin.version_no } : {}),
    ...(pin.payload_checksum ? { payload_checksum: pin.payload_checksum } : {}),
    ...(pin.effective_from ? { effective_from: pin.effective_from } : {}),
    ...(pin.effective_to !== undefined ? { effective_to: pin.effective_to } : {}),
  };
}

function snapshotRecord(pin: TaxCalcLegalValueSnapshot): Record<string, unknown> {
  return {
    legal_value_id: pin.legal_value_id,
    legal_value_version_id: pin.legal_value_version_id,
    value_key: pin.value_key,
    country_code: pin.country_code,
    type: pin.type,
    value: pin.value,
    ...(pin.currency ? { currency: pin.currency } : {}),
    ...(pin.effective_from ? { effective_from: pin.effective_from } : {}),
    ...(pin.effective_to !== undefined ? { effective_to: pin.effective_to } : {}),
    ...(pin.source_checksum ? { source_checksum: pin.source_checksum } : {}),
    ...(pin.snapshot_checksum ? { snapshot_checksum: pin.snapshot_checksum } : {}),
  };
}

function basisRecord(entry: TaxCalcCalculationBasisEntry): Record<string, unknown> {
  if (entry.kind === 'resolved') {
    return {
      kind: 'resolved',
      required: entry.required,
      from_tax_rule_version_id: entry.from_tax_rule_version_id,
      to_tax_rule_version_id: entry.to_tax_rule_version_id,
      country_code: entry.country_code,
      ...(entry.relationship_id ? { relationship_id: entry.relationship_id } : {}),
    };
  }
  return {
    kind: 'unresolved',
    required: entry.required,
    unresolved_legal_reference_id: entry.unresolved_legal_reference_id,
    relationship_intent: entry.relationship_intent,
    ...(entry.country_code ? { country_code: entry.country_code } : {}),
    ...(entry.from_tax_rule_version_id ? { from_tax_rule_version_id: entry.from_tax_rule_version_id } : {}),
    ...(entry.locator ? { locator: entry.locator } : {}),
    ...(entry.cited_title ? { cited_title: entry.cited_title } : {}),
    ...(entry.cited_number ? { cited_number: entry.cited_number } : {}),
  };
}

export function canonicalTaxCalculationContext(context: TaxCalcExecutionContext): Record<string, unknown> {
  return {
    country_code: context.country_code,
    as_of: context.as_of,
    currency: context.currency,
    facts: context.facts as unknown as Record<string, unknown>,
    required_tax_rule_version_ids: context.required_tax_rule_version_ids.slice().sort(compareId),
    rule_pins: sortRulePins(context.rule_pins).map(pinRecord),
    legal_value_pins: sortLegalPins(context.legal_value_pins).map(snapshotRecord),
    calculation_basis: sortBasis(context.calculation_basis).map(basisRecord),
    ...(context.definition
      ? {
          definition: {
            ...(context.definition.calculation_definition_id
              ? { calculation_definition_id: context.definition.calculation_definition_id }
              : {}),
            ...(context.definition.calculation_definition_version_id
              ? { calculation_definition_version_id: context.definition.calculation_definition_version_id }
              : {}),
            ...(context.definition.expression_checksum
              ? { expression_checksum: context.definition.expression_checksum }
              : {}),
          },
        }
      : {}),
    ...(context.default_rounding ? { default_rounding: context.default_rounding } : {}),
  };
}

export function taxCalculationContextChecksum(context: TaxCalcExecutionContext): string {
  return checksumPayload(canonicalTaxCalculationContext(context));
}

function parseFacts(value: unknown): ParseResult<TaxCalcFacts> {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (!isPlainObject(value)) return fail('invalid_expression', 'facts must be an object');
  const facts: TaxCalcFacts = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim() || key !== key.trim()) {
      return fail('invalid_expression', 'facts keys must be non-empty strings');
    }
    if (!isPlainObject(raw) || !isTaxCalcValueType(raw.type)) {
      return fail('invalid_expression', `facts.${key} must be a typed value`);
    }
    const parsed = parseConstScalar(raw.type, raw.value, raw.currency, `facts.${key}`);
    if ('ok' in parsed) return fail(parsed.code, parsed.message);
    if (raw.type === 'money') {
      facts[key] = { type: 'money', value: parsed.value as string, currency: parsed.currency as string };
    } else if (raw.type === 'boolean') {
      facts[key] = { type: 'boolean', value: parsed.value as boolean };
    } else {
      facts[key] = { type: raw.type, value: parsed.value as string } as TaxCalcTypedValue;
    }
  }
  return { ok: true, value: facts };
}

function parseRulePin(raw: unknown): ParseResult<TaxCalcRulePin> {
  if (!isPlainObject(raw)) return fail('invalid_expression', 'rule_pins entries must be objects');
  const tax_rule_version_id = nonEmptyString(raw.tax_rule_version_id, 'rule_pins.tax_rule_version_id');
  if (typeof tax_rule_version_id !== 'string') return tax_rule_version_id;
  const country_code = nonEmptyString(raw.country_code, 'rule_pins.country_code');
  if (typeof country_code !== 'string') return country_code;
  const tax_rule_id = optionalNonEmptyString(raw.tax_rule_id, 'rule_pins.tax_rule_id');
  if (tax_rule_id && typeof tax_rule_id !== 'string') return tax_rule_id;
  const payload_checksum = optionalNonEmptyString(raw.payload_checksum, 'rule_pins.payload_checksum');
  if (payload_checksum && typeof payload_checksum !== 'string') return payload_checksum;
  if (raw.version_no !== undefined && (typeof raw.version_no !== 'number' || !Number.isInteger(raw.version_no))) {
    return fail('invalid_expression', 'rule_pins.version_no must be an integer');
  }
  const effective_from = optionalDate(raw.effective_from, 'rule_pins.effective_from');
  if (effective_from !== undefined && effective_from !== null && typeof effective_from === 'object' && 'ok' in effective_from) {
    return effective_from;
  }
  const effective_to = optionalDate(raw.effective_to, 'rule_pins.effective_to');
  if (effective_to !== undefined && effective_to !== null && typeof effective_to === 'object' && 'ok' in effective_to) {
    return effective_to;
  }
  return {
    ok: true,
    value: {
      tax_rule_version_id,
      country_code,
      ...(typeof tax_rule_id === 'string' ? { tax_rule_id } : {}),
      ...(typeof raw.version_no === 'number' ? { version_no: raw.version_no } : {}),
      ...(typeof payload_checksum === 'string' ? { payload_checksum } : {}),
      ...(typeof effective_from === 'string' ? { effective_from } : {}),
      ...(effective_to !== undefined ? { effective_to } : {}),
    },
  };
}

function parseLegalSnapshot(raw: unknown): ParseResult<TaxCalcLegalValueSnapshot> {
  if (!isPlainObject(raw)) return fail('invalid_expression', 'legal_value_pins entries must be objects');
  const legal_value_id = nonEmptyString(raw.legal_value_id, 'legal_value_pins.legal_value_id');
  if (typeof legal_value_id !== 'string') return legal_value_id;
  const legal_value_version_id = nonEmptyString(raw.legal_value_version_id, 'legal_value_pins.legal_value_version_id');
  if (typeof legal_value_version_id !== 'string') return legal_value_version_id;
  const value_key = nonEmptyString(raw.value_key, 'legal_value_pins.value_key');
  if (typeof value_key !== 'string') return value_key;
  const country_code = nonEmptyString(raw.country_code, 'legal_value_pins.country_code');
  if (typeof country_code !== 'string') return country_code;
  if (!isTaxCalcValueType(raw.type)) return fail('invalid_expression', 'legal_value_pins.type is required');
  const parsed = parseConstScalar(raw.type, raw.value, raw.currency, legal_value_version_id);
  if ('ok' in parsed) return fail(parsed.code, parsed.message);
  const source_checksum = optionalNonEmptyString(raw.source_checksum, 'legal_value_pins.source_checksum');
  if (source_checksum && typeof source_checksum !== 'string') return source_checksum;
  const snapshot_checksum = optionalNonEmptyString(raw.snapshot_checksum, 'legal_value_pins.snapshot_checksum');
  if (snapshot_checksum && typeof snapshot_checksum !== 'string') return snapshot_checksum;
  const effective_from = optionalDate(raw.effective_from, 'legal_value_pins.effective_from');
  if (effective_from !== undefined && effective_from !== null && typeof effective_from === 'object' && 'ok' in effective_from) {
    return effective_from;
  }
  const effective_to = optionalDate(raw.effective_to, 'legal_value_pins.effective_to');
  if (effective_to !== undefined && effective_to !== null && typeof effective_to === 'object' && 'ok' in effective_to) {
    return effective_to;
  }
  return {
    ok: true,
    value: {
      legal_value_id,
      legal_value_version_id,
      value_key,
      country_code,
      type: raw.type,
      value: parsed.value,
      ...(parsed.currency ? { currency: parsed.currency } : {}),
      ...(typeof effective_from === 'string' ? { effective_from } : {}),
      ...(effective_to !== undefined ? { effective_to } : {}),
      ...(typeof source_checksum === 'string' ? { source_checksum } : {}),
      ...(typeof snapshot_checksum === 'string' ? { snapshot_checksum } : {}),
    },
  };
}

function parseBasis(raw: unknown): ParseResult<TaxCalcCalculationBasisEntry> {
  if (!isPlainObject(raw)) return fail('invalid_expression', 'calculation_basis entries must be objects');
  const required = raw.required === undefined ? true : raw.required;
  if (typeof required !== 'boolean') return fail('invalid_expression', 'calculation_basis.required must be a boolean');
  if (raw.kind === 'resolved') {
    const from_tax_rule_version_id = nonEmptyString(raw.from_tax_rule_version_id, 'calculation_basis.from_tax_rule_version_id');
    if (typeof from_tax_rule_version_id !== 'string') return from_tax_rule_version_id;
    const to_tax_rule_version_id = nonEmptyString(raw.to_tax_rule_version_id, 'calculation_basis.to_tax_rule_version_id');
    if (typeof to_tax_rule_version_id !== 'string') return to_tax_rule_version_id;
    const country_code = nonEmptyString(raw.country_code, 'calculation_basis.country_code');
    if (typeof country_code !== 'string') return country_code;
    const relationship_id = optionalNonEmptyString(raw.relationship_id, 'calculation_basis.relationship_id');
    if (relationship_id && typeof relationship_id !== 'string') return relationship_id;
    return {
      ok: true,
      value: {
        kind: 'resolved',
        required,
        from_tax_rule_version_id,
        to_tax_rule_version_id,
        country_code,
        ...(typeof relationship_id === 'string' ? { relationship_id } : {}),
      },
    };
  }
  if (raw.kind === 'unresolved') {
    const unresolved_legal_reference_id = nonEmptyString(
      raw.unresolved_legal_reference_id,
      'calculation_basis.unresolved_legal_reference_id',
    );
    if (typeof unresolved_legal_reference_id !== 'string') return unresolved_legal_reference_id;
    if (raw.relationship_intent !== 'calculation_basis') {
      return fail('invalid_expression', 'unresolved calculation_basis.relationship_intent must be calculation_basis');
    }
    const country_code = optionalNonEmptyString(raw.country_code, 'calculation_basis.country_code');
    if (country_code && typeof country_code !== 'string') return country_code;
    const from_tax_rule_version_id = optionalNonEmptyString(
      raw.from_tax_rule_version_id,
      'calculation_basis.from_tax_rule_version_id',
    );
    if (from_tax_rule_version_id && typeof from_tax_rule_version_id !== 'string') return from_tax_rule_version_id;
    const locator = optionalNonEmptyString(raw.locator, 'calculation_basis.locator');
    if (locator && typeof locator !== 'string') return locator;
    const cited_title = optionalNonEmptyString(raw.cited_title, 'calculation_basis.cited_title');
    if (cited_title && typeof cited_title !== 'string') return cited_title;
    const cited_number = optionalNonEmptyString(raw.cited_number, 'calculation_basis.cited_number');
    if (cited_number && typeof cited_number !== 'string') return cited_number;
    return {
      ok: true,
      value: {
        kind: 'unresolved',
        required,
        unresolved_legal_reference_id,
        relationship_intent: 'calculation_basis',
        ...(typeof country_code === 'string' ? { country_code } : {}),
        ...(typeof from_tax_rule_version_id === 'string' ? { from_tax_rule_version_id } : {}),
        ...(typeof locator === 'string' ? { locator } : {}),
        ...(typeof cited_title === 'string' ? { cited_title } : {}),
        ...(typeof cited_number === 'string' ? { cited_number } : {}),
      },
    };
  }
  return fail('invalid_expression', 'calculation_basis.kind must be resolved or unresolved');
}

function parseDefinition(value: unknown): ParseResult<TaxCalcDefinitionIdentity | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!isPlainObject(value)) return fail('invalid_expression', 'definition must be an object');
  const calculation_definition_id = optionalNonEmptyString(value.calculation_definition_id, 'definition.calculation_definition_id');
  if (calculation_definition_id && typeof calculation_definition_id !== 'string') return calculation_definition_id;
  const calculation_definition_version_id = optionalNonEmptyString(
    value.calculation_definition_version_id,
    'definition.calculation_definition_version_id',
  );
  if (calculation_definition_version_id && typeof calculation_definition_version_id !== 'string') {
    return calculation_definition_version_id;
  }
  const expression_checksum = optionalNonEmptyString(value.expression_checksum, 'definition.expression_checksum');
  if (expression_checksum && typeof expression_checksum !== 'string') return expression_checksum;
  return {
    ok: true,
    value: {
      ...(typeof calculation_definition_id === 'string' ? { calculation_definition_id } : {}),
      ...(typeof calculation_definition_version_id === 'string' ? { calculation_definition_version_id } : {}),
      ...(typeof expression_checksum === 'string' ? { expression_checksum } : {}),
    },
  };
}

function parseRounding(value: unknown): ParseResult<TaxCalcRounding | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!isPlainObject(value) || !isTaxCalcRoundingMode(value.mode) || typeof value.scale !== 'number' || !Number.isInteger(value.scale)) {
    return fail('invalid_expression', 'default_rounding is invalid');
  }
  return { ok: true, value: { mode: value.mode, scale: value.scale } };
}

export function parseTaxCalculationExecutionContext(value: unknown): ParseResult<TaxCalcExecutionContext> {
  if (!isPlainObject(value)) return fail('invalid_expression', 'context must be an object');
  const country_code = nonEmptyString(value.country_code, 'country_code');
  if (typeof country_code !== 'string') return country_code;
  if (!isTaxCalcCanonicalDate(value.as_of)) {
    return fail('invalid_expression', 'as_of must be a canonical Gregorian YYYY-MM-DD');
  }
  const currency = nonEmptyString(value.currency, 'currency');
  if (typeof currency !== 'string') return currency;
  const facts = parseFacts(value.facts);
  if (!facts.ok) return facts;
  if (value.rule_pins !== undefined && !Array.isArray(value.rule_pins)) {
    return fail('invalid_expression', 'rule_pins must be an array');
  }
  const rule_pins: TaxCalcRulePin[] = [];
  const ruleIds = new Set<string>();
  for (const raw of value.rule_pins ?? []) {
    const parsed = parseRulePin(raw);
    if (!parsed.ok) return parsed;
    if (ruleIds.has(parsed.value.tax_rule_version_id)) {
      return fail('invalid_expression', 'rule_pins tax_rule_version_id must be unique');
    }
    ruleIds.add(parsed.value.tax_rule_version_id);
    rule_pins.push(parsed.value);
  }
  const required: string[] = [];
  if (value.required_tax_rule_version_ids !== undefined) {
    if (!Array.isArray(value.required_tax_rule_version_ids)) {
      return fail('invalid_expression', 'required_tax_rule_version_ids must be an array');
    }
    for (const id of value.required_tax_rule_version_ids) {
      const parsed = nonEmptyString(id, 'required_tax_rule_version_ids');
      if (typeof parsed !== 'string') return parsed;
      required.push(parsed);
    }
  }
  if (value.legal_value_pins !== undefined && !Array.isArray(value.legal_value_pins)) {
    return fail('invalid_expression', 'legal_value_pins must be an array');
  }
  const legal_value_pins: TaxCalcLegalValueSnapshot[] = [];
  const legalIds = new Set<string>();
  for (const raw of value.legal_value_pins ?? []) {
    const parsed = parseLegalSnapshot(raw);
    if (!parsed.ok) return parsed;
    if (legalIds.has(parsed.value.legal_value_version_id)) {
      return fail('invalid_expression', 'legal_value_pins legal_value_version_id must be unique');
    }
    legalIds.add(parsed.value.legal_value_version_id);
    legal_value_pins.push(parsed.value);
  }
  if (value.calculation_basis !== undefined && !Array.isArray(value.calculation_basis)) {
    return fail('invalid_expression', 'calculation_basis must be an array');
  }
  const calculation_basis: TaxCalcCalculationBasisEntry[] = [];
  for (const raw of value.calculation_basis ?? []) {
    const parsed = parseBasis(raw);
    if (!parsed.ok) return parsed;
    calculation_basis.push(parsed.value);
  }
  const definition = parseDefinition(value.definition);
  if (!definition.ok) return definition;
  const default_rounding = parseRounding(value.default_rounding);
  if (!default_rounding.ok) return default_rounding;
  return {
    ok: true,
    value: {
      country_code,
      as_of: value.as_of,
      currency,
      facts: facts.value,
      rule_pins,
      required_tax_rule_version_ids: required,
      legal_value_pins,
      calculation_basis,
      ...(definition.value ? { definition: definition.value } : {}),
      ...(default_rounding.value ? { default_rounding: default_rounding.value } : {}),
    },
  };
}

function validateContext(context: TaxCalcExecutionContext): ParseErr | null {
  for (const pin of context.rule_pins) {
    if (pin.country_code !== context.country_code) {
      return fail('country_mismatch', `rule pin ${pin.tax_rule_version_id} country_mismatch`);
    }
    if (!asOfInWindow(context.as_of, pin.effective_from, pin.effective_to)) {
      return fail('pin_not_effective_as_of', `rule pin ${pin.tax_rule_version_id} is not effective as_of`);
    }
  }
  for (const pin of context.legal_value_pins) {
    if (pin.country_code !== context.country_code) {
      return fail('country_mismatch', `legal value ${pin.legal_value_version_id} country_mismatch`);
    }
    if (pin.type === 'money' && pin.currency !== context.currency) {
      return fail('currency_mismatch', `legal value ${pin.legal_value_version_id} currency_mismatch`);
    }
    if (!asOfInWindow(context.as_of, pin.effective_from, pin.effective_to)) {
      return fail('pin_not_effective_as_of', `legal value ${pin.legal_value_version_id} is not effective as_of`);
    }
  }
  for (const [key, fact] of Object.entries(context.facts)) {
    if (fact.type === 'money' && fact.currency !== context.currency) {
      return fail('currency_mismatch', `facts.${key} currency_mismatch`);
    }
  }
  const ruleIds = new Set(context.rule_pins.map((pin) => pin.tax_rule_version_id));
  for (const required of context.required_tax_rule_version_ids) {
    if (!ruleIds.has(required)) {
      return fail('missing_rule_pin', `missing_rule_pin:${required}`);
    }
  }
  for (const entry of context.calculation_basis) {
    if (entry.kind === 'resolved') {
      if (entry.country_code !== context.country_code) {
        return fail('country_mismatch', `calculation_basis ${entry.to_tax_rule_version_id} country_mismatch`);
      }
      if (entry.required && !ruleIds.has(entry.to_tax_rule_version_id)) {
        return fail('missing_calculation_basis_pin', `missing_calculation_basis_pin:${entry.to_tax_rule_version_id}`);
      }
      continue;
    }
    if (entry.country_code && entry.country_code !== context.country_code) {
      return fail('country_mismatch', `unresolved calculation_basis ${entry.unresolved_legal_reference_id} country_mismatch`);
    }
    if (entry.required) {
      return fail('unresolved_calculation_basis', `unresolved_calculation_basis:${entry.unresolved_legal_reference_id}`);
    }
  }
  return null;
}

function toK4aLegalPins(pins: TaxCalcLegalValueSnapshot[]): TaxCalcPinnedLegalValue[] {
  return pins.map((pin) => ({
    legal_value_version_id: pin.legal_value_version_id,
    value_key: pin.value_key,
    type: pin.type,
    value: pin.value,
    ...(pin.currency ? { currency: pin.currency } : {}),
  }));
}

function emptyPins(): Pick<
  TaxCalcContextEvaluation,
  'rule_pins' | 'legal_value_pins' | 'calculation_basis_pins' | 'unresolved_calculation_basis'
> {
  return {
    rule_pins: [],
    legal_value_pins: [],
    calculation_basis_pins: [],
    unresolved_calculation_basis: [],
  };
}

function contextPins(context: TaxCalcExecutionContext) {
  return {
    rule_pins: sortRulePins(context.rule_pins),
    legal_value_pins: sortLegalPins(context.legal_value_pins),
    calculation_basis_pins: sortBasis(context.calculation_basis).filter(
      (entry): entry is TaxCalcResolvedCalculationBasis => entry.kind === 'resolved',
    ),
    unresolved_calculation_basis: sortBasis(context.calculation_basis).filter(
      (entry): entry is TaxCalcUnresolvedCalculationBasis => entry.kind === 'unresolved',
    ),
  };
}

function blockedResult(
  blocked: TaxCalcContextBlocked,
  context: TaxCalcExecutionContext | null,
): TaxCalcContextEvaluation {
  const pins = context ? contextPins(context) : emptyPins();
  const context_checksum = context
    ? taxCalculationContextChecksum(context)
    : checksumPayload({ error: blocked.code, message: blocked.message });
  return {
    ok: false,
    blocked,
    blocking: [blocked],
    trace: [],
    context_checksum,
    result_checksum: checksumPayload({ ok: false, blocked: blocked as unknown as Record<string, unknown> }),
    ...pins,
  };
}

export function evaluateTaxCalculationWithContext(input: TaxCalcContextEvaluationInput): TaxCalcContextEvaluation {
  const parsed = parseTaxCalculationExecutionContext(input.context);
  if (!parsed.ok) return blockedResult(parsed.blocked, null);
  const invalid = validateContext(parsed.value);
  if (invalid) return blockedResult(invalid.blocked, parsed.value);

  const context_checksum = taxCalculationContextChecksum(parsed.value);
  const evaluated = evaluateTaxCalculation({
    expression: input.expression,
    facts: parsed.value.facts,
    legal_values: toK4aLegalPins(parsed.value.legal_value_pins),
    default_rounding: parsed.value.default_rounding,
  });
  const pins = contextPins(parsed.value);
  if (!evaluated.ok) {
    const blocked = toTaxCalcContextBlocked(evaluated.blocked);
    return {
      ok: false,
      blocked,
      blocking: [blocked],
      trace: evaluated.trace,
      context_checksum,
      input_checksum: evaluated.input_checksum,
      result_checksum: evaluated.result_checksum,
      execution_checksum: checksumPayload({
        context_checksum,
        input_checksum: evaluated.input_checksum,
        result_checksum: evaluated.result_checksum,
      }),
      ...pins,
    };
  }
  return {
    ok: true,
    result: evaluated.result,
    blocking: [],
    trace: evaluated.trace,
    context_checksum,
    input_checksum: evaluated.input_checksum,
    result_checksum: evaluated.result_checksum,
    execution_checksum: checksumPayload({
      context_checksum,
      input_checksum: evaluated.input_checksum,
      result_checksum: evaluated.result_checksum,
    }),
    ...pins,
  };
}

export function hasApplicabilityEvaluation(): false {
  return false;
}

export function hasLatestPinResolver(): false {
  return false;
}
