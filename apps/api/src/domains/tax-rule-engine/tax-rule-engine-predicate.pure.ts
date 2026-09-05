import {
  TAX_RULE_ENGINE_FACT_TYPES,
  TAX_RULE_ENGINE_MAX_PREDICATE_DEPTH,
  TAX_RULE_ENGINE_MAX_PREDICATE_NODES,
  TAX_RULE_ENGINE_PREDICATE_OPS,
  isCanonicalIsoDate,
  type TaxRuleEngineFactType,
  type TaxRuleEngineFactValue,
  type TaxRuleEngineFacts,
  type TaxRuleEnginePredicateOp,
  type TaxRuleEnginePredicateReason,
} from './tax-rule-engine.types.js';

export type TaxRuleEnginePredicateKind = 'true' | 'false' | 'missing' | 'unsupported';

export type TaxRuleEnginePredicateResult = {
  kind: TaxRuleEnginePredicateKind;
  missing_facts: string[];
  reason?: TaxRuleEnginePredicateReason;
};

export type TaxRuleEnginePredicateValidation =
  | { ok: true }
  | { ok: false; reason: TaxRuleEnginePredicateReason; message: string };

const NO_VALUE_OPS = new Set<TaxRuleEnginePredicateOp>(['exists', 'is_null', 'is_not_null']);
const INEQUALITY_OPS = new Set<TaxRuleEnginePredicateOp>(['gt', 'gte', 'lt', 'lte']);

function resultTrue(): TaxRuleEnginePredicateResult {
  return { kind: 'true', missing_facts: [] };
}

function resultFalse(): TaxRuleEnginePredicateResult {
  return { kind: 'false', missing_facts: [] };
}

function resultMissing(keys: string[]): TaxRuleEnginePredicateResult {
  return { kind: 'missing', missing_facts: uniqueSorted(keys), reason: 'missing_facts' };
}

function resultUnsupported(): TaxRuleEnginePredicateResult {
  return { kind: 'unsupported', missing_facts: [], reason: 'predicate_unsupported' };
}

function resultTypeMismatch(): TaxRuleEnginePredicateResult {
  return { kind: 'unsupported', missing_facts: [], reason: 'type_mismatch' };
}

function uniqueSorted(keys: string[]): string[] {
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPredicateOp(value: string): value is TaxRuleEnginePredicateOp {
  return (TAX_RULE_ENGINE_PREDICATE_OPS as readonly string[]).includes(value);
}

function isFactType(value: string): value is TaxRuleEngineFactType {
  return (TAX_RULE_ENGINE_FACT_TYPES as readonly string[]).includes(value);
}

function isIsoDate(value: unknown): value is string {
  return isCanonicalIsoDate(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  if (value === null) return true;
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function jsonTypeOf(value: TaxRuleEngineFactValue): 'string' | 'number' | 'boolean' | 'null' {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function valueMatchesType(value: unknown, type: TaxRuleEngineFactType): boolean {
  if (value === null) return false;
  switch (type) {
    case 'string':
    case 'enum':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return isIsoDate(value);
  }
}

function inferredCompareKind(
  left: TaxRuleEngineFactValue,
  right: unknown,
  declared?: TaxRuleEngineFactType,
): 'number' | 'date' | 'mismatch' {
  if (declared === 'number') {
    return valueMatchesType(left, 'number') && valueMatchesType(right, 'number') ? 'number' : 'mismatch';
  }
  if (declared === 'date') {
    return valueMatchesType(left, 'date') && valueMatchesType(right, 'date') ? 'date' : 'mismatch';
  }
  if (typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right)) {
    return 'number';
  }
  if (isIsoDate(left) && isIsoDate(right)) {
    return 'date';
  }
  return 'mismatch';
}

function compareOrdered(
  left: string | number,
  right: string | number,
  op: 'gt' | 'gte' | 'lt' | 'lte',
): boolean {
  switch (op) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
}

function validateLimit(depth: number, nodes: number): TaxRuleEnginePredicateValidation | null {
  if (depth > TAX_RULE_ENGINE_MAX_PREDICATE_DEPTH) {
    return { ok: false, reason: 'predicate_unsupported', message: 'predicate exceeds max depth 8' };
  }
  if (nodes > TAX_RULE_ENGINE_MAX_PREDICATE_NODES) {
    return { ok: false, reason: 'predicate_unsupported', message: 'predicate exceeds max nodes 64' };
  }
  return null;
}

function validateBetweenValue(value: unknown, declared?: TaxRuleEngineFactType): TaxRuleEnginePredicateValidation {
  if (!isPlainObject(value) || !('from' in value) || !('to' in value)) {
    return { ok: false, reason: 'predicate_unsupported', message: 'between requires { from, to }' };
  }
  const extra = Object.keys(value).filter((key) => key !== 'from' && key !== 'to');
  if (extra.length) {
    return { ok: false, reason: 'predicate_unsupported', message: 'between allows only from and to' };
  }
  const from = value.from;
  const to = value.to;
  const type = declared ?? (typeof from === 'number' && typeof to === 'number' ? 'number' : isIsoDate(from) && isIsoDate(to) ? 'date' : null);
  if (type !== 'number' && type !== 'date') {
    return { ok: false, reason: 'type_mismatch', message: 'between requires number or date bounds' };
  }
  if (!valueMatchesType(from, type) || !valueMatchesType(to, type)) {
    return { ok: false, reason: 'type_mismatch', message: 'between bounds must match the declared type' };
  }
  if ((from as string | number) > (to as string | number)) {
    return { ok: false, reason: 'predicate_unsupported', message: 'between.from must be <= between.to' };
  }
  return { ok: true };
}

function validateInValue(value: unknown, declared?: TaxRuleEngineFactType): TaxRuleEnginePredicateValidation {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: 'predicate_unsupported', message: 'in/not_in requires a non-empty array' };
  }
  let memberJsonType: ReturnType<typeof jsonTypeOf> | null = null;
  for (const item of value) {
    if (!isScalar(item) || item === null) {
      return { ok: false, reason: 'predicate_unsupported', message: 'in/not_in members must be scalars' };
    }
    if (declared && !valueMatchesType(item, declared === 'enum' ? 'string' : declared)) {
      return { ok: false, reason: 'type_mismatch', message: 'in/not_in members must match the declared type' };
    }
    const current = jsonTypeOf(item);
    if (!memberJsonType) memberJsonType = current;
    if (current !== memberJsonType) {
      return { ok: false, reason: 'type_mismatch', message: 'in/not_in members must be the same type' };
    }
  }
  return { ok: true };
}

function validateLeaf(node: Record<string, unknown>): TaxRuleEnginePredicateValidation {
  const keys = Object.keys(node);
  const extra = keys.filter((key) => key !== 'fact' && key !== 'op' && key !== 'value' && key !== 'type');
  if (extra.length > 0) {
    return { ok: false, reason: 'predicate_unsupported', message: 'predicate leaf has unsupported keys' };
  }
  if (typeof node.fact !== 'string' || !node.fact.trim()) {
    return { ok: false, reason: 'predicate_unsupported', message: 'predicate fact is required' };
  }
  if (typeof node.op !== 'string' || !isPredicateOp(node.op)) {
    return { ok: false, reason: 'predicate_unsupported', message: 'predicate operator is unsupported' };
  }
  let declared: TaxRuleEngineFactType | undefined;
  if ('type' in node) {
    if (typeof node.type !== 'string' || !isFactType(node.type)) {
      return { ok: false, reason: 'predicate_unsupported', message: 'predicate type is unsupported' };
    }
    declared = node.type;
  }

  if (NO_VALUE_OPS.has(node.op)) {
    if ('value' in node) {
      return { ok: false, reason: 'predicate_unsupported', message: `${node.op} does not accept value` };
    }
    return { ok: true };
  }

  if (!('value' in node)) {
    return { ok: false, reason: 'predicate_unsupported', message: `${node.op} requires value` };
  }

  if (node.op === 'between') {
    return validateBetweenValue(node.value, declared);
  }
  if (node.op === 'in' || node.op === 'not_in') {
    return validateInValue(node.value, declared);
  }
  if (!isScalar(node.value)) {
    return { ok: false, reason: 'predicate_unsupported', message: 'predicate value must be a scalar' };
  }
  if (INEQUALITY_OPS.has(node.op)) {
    if (declared && declared !== 'number' && declared !== 'date') {
      return { ok: false, reason: 'type_mismatch', message: 'inequality requires number or date type' };
    }
    if (declared && !valueMatchesType(node.value, declared)) {
      return { ok: false, reason: 'type_mismatch', message: 'inequality value does not match declared type' };
    }
    if (!declared && !(typeof node.value === 'number' && Number.isFinite(node.value)) && !isIsoDate(node.value)) {
      return { ok: false, reason: 'type_mismatch', message: 'inequality requires number or date value' };
    }
  }
  if (declared && node.value !== null && !valueMatchesType(node.value, declared === 'enum' ? 'string' : declared)) {
    return { ok: false, reason: 'type_mismatch', message: 'predicate value does not match declared type' };
  }
  return { ok: true };
}

function validateNode(node: unknown, depth: number, counter: { nodes: number }): TaxRuleEnginePredicateValidation {
  counter.nodes += 1;
  const limit = validateLimit(depth, counter.nodes);
  if (limit) return limit;
  if (!isPlainObject(node)) {
    return { ok: false, reason: 'predicate_unsupported', message: 'predicate must be an object' };
  }

  const keys = Object.keys(node);
  if ('all' in node) {
    if (keys.length !== 1 || !Array.isArray(node.all)) {
      return { ok: false, reason: 'predicate_unsupported', message: 'all must be the only key and an array' };
    }
    for (const child of node.all) {
      const childResult = validateNode(child, depth + 1, counter);
      if (!childResult.ok) return childResult;
    }
    return { ok: true };
  }
  if ('any' in node) {
    if (keys.length !== 1 || !Array.isArray(node.any)) {
      return { ok: false, reason: 'predicate_unsupported', message: 'any must be the only key and an array' };
    }
    for (const child of node.any) {
      const childResult = validateNode(child, depth + 1, counter);
      if (!childResult.ok) return childResult;
    }
    return { ok: true };
  }
  if ('not' in node) {
    if (keys.length !== 1) {
      return { ok: false, reason: 'predicate_unsupported', message: 'not must be the only key' };
    }
    return validateNode(node.not, depth + 1, counter);
  }
  if ('fact' in node && 'op' in node) {
    return validateLeaf(node);
  }
  return { ok: false, reason: 'predicate_unsupported', message: 'predicate shape is unsupported' };
}

export function parseAndValidatePredicate(value: unknown): TaxRuleEnginePredicateValidation {
  return validateNode(value, 1, { nodes: 0 });
}

export function validateTaxRulePayloadPredicates(payload: Record<string, unknown>): TaxRuleEnginePredicateValidation {
  for (const field of ['applies_if', 'does_not_apply_if'] as const) {
    const condition = payload[field];
    if (condition === undefined || condition === null) continue;
    const validated = parseAndValidatePredicate(condition);
    if (!validated.ok) {
      return { ok: false, reason: validated.reason, message: `${field} is not a valid tax-rule predicate: ${validated.message}` };
    }
  }
  return { ok: true };
}

function evaluateBetween(
  actual: TaxRuleEngineFactValue,
  value: unknown,
  declared?: TaxRuleEngineFactType,
): TaxRuleEnginePredicateResult {
  const validated = validateBetweenValue(value, declared);
  if (!validated.ok) {
    return validated.reason === 'type_mismatch' ? resultTypeMismatch() : resultUnsupported();
  }
  const bounds = value as { from: string | number; to: string | number };
  const kind = inferredCompareKind(actual, bounds.from, declared);
  if (kind === 'mismatch' || inferredCompareKind(actual, bounds.to, declared) === 'mismatch') {
    return resultTypeMismatch();
  }
  return actual >= bounds.from && actual <= bounds.to ? resultTrue() : resultFalse();
}

function evaluateMembership(
  actual: TaxRuleEngineFactValue,
  value: unknown,
  op: 'in' | 'not_in',
  declared?: TaxRuleEngineFactType,
): TaxRuleEnginePredicateResult {
  const validated = validateInValue(value, declared);
  if (!validated.ok) {
    return validated.reason === 'type_mismatch' ? resultTypeMismatch() : resultUnsupported();
  }
  if (actual === null) return resultTypeMismatch();
  const members = value as Array<string | number | boolean>;
  if (declared && !valueMatchesType(actual, declared === 'enum' ? 'string' : declared)) {
    return resultTypeMismatch();
  }
  const sameType = members.every((item) => jsonTypeOf(item) === jsonTypeOf(actual) || (declared === 'date' && isIsoDate(item) && isIsoDate(actual)));
  if (!sameType && !declared) {
    return resultTypeMismatch();
  }
  const found = members.some((item) => Object.is(item, actual));
  if (op === 'in') return found ? resultTrue() : resultFalse();
  return found ? resultFalse() : resultTrue();
}

function evaluateLeaf(node: Record<string, unknown>, facts: TaxRuleEngineFacts): TaxRuleEnginePredicateResult {
  const validated = validateLeaf(node);
  if (!validated.ok) {
    return validated.reason === 'type_mismatch' ? resultTypeMismatch() : resultUnsupported();
  }

  const factKey = String(node.fact);
  const op = node.op as TaxRuleEnginePredicateOp;
  const declared = typeof node.type === 'string' && isFactType(node.type) ? node.type : undefined;
  if (!(factKey in facts)) {
    return resultMissing([factKey]);
  }

  const actual = facts[factKey];
  if (op === 'exists') {
    return actual === null ? resultFalse() : resultTrue();
  }
  if (op === 'is_null') {
    return actual === null ? resultTrue() : resultFalse();
  }
  if (op === 'is_not_null') {
    return actual === null ? resultFalse() : resultTrue();
  }
  if (declared && actual !== null && !valueMatchesType(actual, declared === 'enum' ? 'string' : declared)) {
    return resultTypeMismatch();
  }
  if (op === 'between') {
    return evaluateBetween(actual, node.value, declared);
  }
  if (op === 'in' || op === 'not_in') {
    return evaluateMembership(actual, node.value, op, declared);
  }

  const expected = node.value;
  if (INEQUALITY_OPS.has(op)) {
    const kind = inferredCompareKind(actual, expected, declared);
    if (kind === 'mismatch') return resultTypeMismatch();
    return compareOrdered(actual as string | number, expected as string | number, op) ? resultTrue() : resultFalse();
  }

  if (actual !== null && expected !== null && jsonTypeOf(actual) !== jsonTypeOf(expected as TaxRuleEngineFactValue)) {
    return resultTypeMismatch();
  }
  if (op === 'eq') {
    return Object.is(actual, expected) ? resultTrue() : resultFalse();
  }
  return Object.is(actual, expected) ? resultFalse() : resultTrue();
}

function evaluateNode(
  node: unknown,
  facts: TaxRuleEngineFacts,
  depth: number,
  counter: { nodes: number },
): TaxRuleEnginePredicateResult {
  counter.nodes += 1;
  if (depth > TAX_RULE_ENGINE_MAX_PREDICATE_DEPTH || counter.nodes > TAX_RULE_ENGINE_MAX_PREDICATE_NODES) {
    return resultUnsupported();
  }
  if (!isPlainObject(node)) return resultUnsupported();

  const keys = Object.keys(node);
  if ('all' in node) {
    if (keys.length !== 1 || !Array.isArray(node.all)) return resultUnsupported();
    const missing: string[] = [];
    let sawUnsupported = false;
    let sawTypeMismatch = false;
    let sawMissing = false;
    for (const child of node.all) {
      const childResult = evaluateNode(child, facts, depth + 1, counter);
      if (childResult.kind === 'false') return resultFalse();
      if (childResult.kind === 'unsupported') {
        sawUnsupported = true;
        if (childResult.reason === 'type_mismatch') sawTypeMismatch = true;
      }
      if (childResult.kind === 'missing') {
        sawMissing = true;
        missing.push(...childResult.missing_facts);
      }
    }
    if (sawTypeMismatch) return resultTypeMismatch();
    if (sawUnsupported) return resultUnsupported();
    if (sawMissing) return resultMissing(missing);
    return resultTrue();
  }

  if ('any' in node) {
    if (keys.length !== 1 || !Array.isArray(node.any)) return resultUnsupported();
    const missing: string[] = [];
    let sawUnsupported = false;
    let sawTypeMismatch = false;
    let sawMissing = false;
    for (const child of node.any) {
      const childResult = evaluateNode(child, facts, depth + 1, counter);
      if (childResult.kind === 'true') return resultTrue();
      if (childResult.kind === 'unsupported') {
        sawUnsupported = true;
        if (childResult.reason === 'type_mismatch') sawTypeMismatch = true;
      }
      if (childResult.kind === 'missing') {
        sawMissing = true;
        missing.push(...childResult.missing_facts);
      }
    }
    if (sawTypeMismatch) return resultTypeMismatch();
    if (sawUnsupported) return resultUnsupported();
    if (sawMissing) return resultMissing(missing);
    return resultFalse();
  }

  if ('not' in node) {
    if (keys.length !== 1) return resultUnsupported();
    const inner = evaluateNode(node.not, facts, depth + 1, counter);
    if (inner.kind === 'true') return resultFalse();
    if (inner.kind === 'false') return resultTrue();
    return inner;
  }

  if ('fact' in node && 'op' in node) {
    return evaluateLeaf(node, facts);
  }

  return resultUnsupported();
}

/** Null/omitted applies_if is vacuously true. */
export function evaluateAppliesIf(
  value: unknown,
  facts: TaxRuleEngineFacts,
): TaxRuleEnginePredicateResult {
  if (value === undefined || value === null) return resultTrue();
  return evaluateNode(value, facts, 1, { nodes: 0 });
}

/** Null/omitted does_not_apply_if is vacuously false. */
export function evaluateDoesNotApplyIf(
  value: unknown,
  facts: TaxRuleEngineFacts,
): TaxRuleEnginePredicateResult {
  if (value === undefined || value === null) return resultFalse();
  return evaluateNode(value, facts, 1, { nodes: 0 });
}

export function evaluateTaxRulePredicate(
  value: unknown,
  facts: TaxRuleEngineFacts,
): TaxRuleEnginePredicateResult {
  return evaluateNode(value, facts, 1, { nodes: 0 });
}
