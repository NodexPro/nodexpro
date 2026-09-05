import {
  TAX_RULE_ENGINE_PREDICATE_OPS,
  type TaxRuleEngineFacts,
  type TaxRuleEngineFactValue,
  type TaxRuleEnginePredicateOp,
} from './tax-rule-engine.types.js';

export type TaxRuleEnginePredicateKind = 'true' | 'false' | 'missing' | 'unsupported';

export type TaxRuleEnginePredicateResult = {
  kind: TaxRuleEnginePredicateKind;
  missing_facts: string[];
};

function resultTrue(): TaxRuleEnginePredicateResult {
  return { kind: 'true', missing_facts: [] };
}

function resultFalse(): TaxRuleEnginePredicateResult {
  return { kind: 'false', missing_facts: [] };
}

function resultMissing(keys: string[]): TaxRuleEnginePredicateResult {
  return { kind: 'missing', missing_facts: uniqueSorted(keys) };
}

function resultUnsupported(): TaxRuleEnginePredicateResult {
  return { kind: 'unsupported', missing_facts: [] };
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

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareInequality(
  left: TaxRuleEngineFactValue,
  right: unknown,
  op: 'gt' | 'gte' | 'lt' | 'lte',
): TaxRuleEnginePredicateResult {
  const l = finiteNumber(left);
  const r = finiteNumber(right);
  if (l == null || r == null) return resultUnsupported();
  switch (op) {
    case 'gt':
      return l > r ? resultTrue() : resultFalse();
    case 'gte':
      return l >= r ? resultTrue() : resultFalse();
    case 'lt':
      return l < r ? resultTrue() : resultFalse();
    case 'lte':
      return l <= r ? resultTrue() : resultFalse();
  }
}

function evaluateLeaf(node: Record<string, unknown>, facts: TaxRuleEngineFacts): TaxRuleEnginePredicateResult {
  const keys = Object.keys(node);
  const extra = keys.filter((key) => key !== 'fact' && key !== 'op' && key !== 'value');
  if (extra.length > 0) return resultUnsupported();
  if (typeof node.fact !== 'string' || !node.fact.trim()) return resultUnsupported();
  if (typeof node.op !== 'string' || !isPredicateOp(node.op)) return resultUnsupported();

  const factKey = node.fact;
  const op = node.op;
  if (!(factKey in facts)) {
    return resultMissing([factKey]);
  }

  const actual = facts[factKey];
  if (op === 'exists') {
    return actual === null ? resultFalse() : resultTrue();
  }

  if (!('value' in node)) return resultUnsupported();
  const expected = node.value;
  if (
    expected !== null &&
    typeof expected !== 'string' &&
    typeof expected !== 'boolean' &&
    !(typeof expected === 'number' && Number.isFinite(expected))
  ) {
    return resultUnsupported();
  }

  if (op === 'eq') {
    return Object.is(actual, expected) ? resultTrue() : resultFalse();
  }
  if (op === 'neq') {
    return Object.is(actual, expected) ? resultFalse() : resultTrue();
  }
  return compareInequality(actual, expected, op);
}

function evaluateNode(node: unknown, facts: TaxRuleEngineFacts): TaxRuleEnginePredicateResult {
  if (!isPlainObject(node)) return resultUnsupported();

  const keys = Object.keys(node);
  if ('all' in node) {
    if (keys.length !== 1 || !Array.isArray(node.all)) return resultUnsupported();
    const missing: string[] = [];
    let sawUnsupported = false;
    let sawMissing = false;
    for (const child of node.all) {
      const childResult = evaluateNode(child, facts);
      if (childResult.kind === 'false') return resultFalse();
      if (childResult.kind === 'unsupported') sawUnsupported = true;
      if (childResult.kind === 'missing') {
        sawMissing = true;
        missing.push(...childResult.missing_facts);
      }
    }
    if (sawUnsupported) return resultUnsupported();
    if (sawMissing) return resultMissing(missing);
    return resultTrue();
  }

  if ('any' in node) {
    if (keys.length !== 1 || !Array.isArray(node.any)) return resultUnsupported();
    const missing: string[] = [];
    let sawUnsupported = false;
    let sawMissing = false;
    for (const child of node.any) {
      const childResult = evaluateNode(child, facts);
      if (childResult.kind === 'true') return resultTrue();
      if (childResult.kind === 'unsupported') sawUnsupported = true;
      if (childResult.kind === 'missing') {
        sawMissing = true;
        missing.push(...childResult.missing_facts);
      }
    }
    if (sawUnsupported) return resultUnsupported();
    if (sawMissing) return resultMissing(missing);
    return resultFalse();
  }

  if ('not' in node) {
    if (keys.length !== 1) return resultUnsupported();
    const inner = evaluateNode(node.not, facts);
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
  return evaluateNode(value, facts);
}

/** Null/omitted does_not_apply_if is vacuously false. */
export function evaluateDoesNotApplyIf(
  value: unknown,
  facts: TaxRuleEngineFacts,
): TaxRuleEnginePredicateResult {
  if (value === undefined || value === null) return resultFalse();
  return evaluateNode(value, facts);
}

export function evaluateTaxRulePredicate(
  value: unknown,
  facts: TaxRuleEngineFacts,
): TaxRuleEnginePredicateResult {
  return evaluateNode(value, facts);
}
