import { taxRulePayloadChecksum } from '../tax-knowledge/tax-knowledge-checksum.pure.js';
import {
  compareTaxDecimals,
  maxTaxDecimal,
  minTaxDecimal,
  parseTaxDecimal,
  parseTaxInteger,
  percentOfTaxDecimal,
  roundTaxDecimal,
  taxDecimalToCanonicalString,
  taxDecimalToScaledString,
  taxIntegerToCanonicalString,
  type TaxDecimalInstance,
} from './tax-calculation-engine-decimal.pure.js';
import { parseConstScalar, validateTaxCalculationExpression } from './tax-calculation-engine-validate.pure.js';
import {
  isTaxCalcRoundingMode,
  isTaxCalcValueType,
  type TaxCalcBlocked,
  type TaxCalcEvaluation,
  type TaxCalcEvaluationInput,
  type TaxCalcExpr,
  type TaxCalcFacts,
  type TaxCalcPinnedLegalValue,
  type TaxCalcRounding,
  type TaxCalcRoundingSource,
  type TaxCalcTraceEntry,
  type TaxCalcTraceInput,
  type TaxCalcTypedValue,
  type TaxCalcValueRef,
  type TaxCalcValueType,
} from './tax-calculation-engine.types.js';

type EvalOk = { ok: true; value: TaxCalcTypedValue; ref: TaxCalcValueRef };
type EvalBlocked = { ok: false; blocked: TaxCalcBlocked };
type EvalResult = EvalOk | EvalBlocked;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function blocked(code: TaxCalcBlocked['code'], message: string, node_id?: string): EvalBlocked {
  return { ok: false, blocked: node_id ? { code, message, node_id } : { code, message } };
}

function checksumPayload(payload: Record<string, unknown>): string {
  return taxRulePayloadChecksum(payload);
}

function parseRoundingPolicy(value: unknown): TaxCalcRounding | EvalBlocked | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    return blocked('invalid_expression', 'default_rounding must be an object');
  }
  if (!isTaxCalcRoundingMode(value.mode) || typeof value.scale !== 'number' || !Number.isInteger(value.scale)) {
    return blocked('invalid_expression', 'default_rounding is invalid');
  }
  return { mode: value.mode, scale: value.scale };
}

function parseFacts(value: unknown): { ok: true; facts: TaxCalcFacts } | EvalBlocked {
  if (value === undefined || value === null) return { ok: true, facts: {} };
  if (!isPlainObject(value)) return blocked('invalid_expression', 'facts must be an object');
  const facts: TaxCalcFacts = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim() || key !== key.trim()) {
      return blocked('invalid_expression', 'facts keys must be non-empty strings');
    }
    const parsed = parseTypedValue(raw, `facts.${key}`);
    if (!parsed.ok) return parsed;
    facts[key] = parsed.value;
  }
  return { ok: true, facts };
}

function parseLegalValues(value: unknown): { ok: true; pins: Map<string, TaxCalcPinnedLegalValue> } | EvalBlocked {
  if (value === undefined || value === null) return { ok: true, pins: new Map() };
  if (!Array.isArray(value)) return blocked('invalid_expression', 'legal_values must be an array');
  const pins = new Map<string, TaxCalcPinnedLegalValue>();
  for (const raw of value) {
    if (!isPlainObject(raw)) return blocked('invalid_expression', 'legal_values entries must be objects');
    if (typeof raw.legal_value_version_id !== 'string' || !raw.legal_value_version_id.trim()) {
      return blocked('invalid_expression', 'legal_values.legal_value_version_id is required');
    }
    if (typeof raw.value_key !== 'string' || !raw.value_key.trim()) {
      return blocked('invalid_expression', 'legal_values.value_key is required');
    }
    if (!isTaxCalcValueType(raw.type)) {
      return blocked('invalid_expression', 'legal_values.type is required');
    }
    const parsed = parseConstScalar(raw.type, raw.value, raw.currency, raw.legal_value_version_id);
    if ('ok' in parsed) {
      return blocked(parsed.code, parsed.message, parsed.node_id);
    }
    if (pins.has(raw.legal_value_version_id)) {
      return blocked('invalid_expression', 'legal_values legal_value_version_id must be unique');
    }
    pins.set(raw.legal_value_version_id, {
      legal_value_version_id: raw.legal_value_version_id,
      value_key: raw.value_key,
      type: raw.type,
      value: parsed.value,
      ...(parsed.currency ? { currency: parsed.currency } : {}),
    });
  }
  return { ok: true, pins };
}

function parseTypedValue(raw: unknown, field: string): EvalOk | EvalBlocked {
  if (!isPlainObject(raw) || !isTaxCalcValueType(raw.type)) {
    return blocked('invalid_expression', `${field} must be a typed value`);
  }
  const parsed = parseConstScalar(raw.type, raw.value, raw.currency, field);
  if ('ok' in parsed) {
    return blocked(parsed.code, parsed.message, parsed.node_id);
  }
  return { ok: true, value: typedFromScalar(raw.type, parsed.value, parsed.currency), ref: { kind: 'const' } };
}

function typedFromScalar(type: TaxCalcValueType, value: string | boolean, currency?: string): TaxCalcTypedValue {
  if (type === 'money') {
    return { type, value: value as string, currency: currency as string };
  }
  if (type === 'boolean') return { type, value: value as boolean };
  if (type === 'date') return { type, value: value as string };
  if (type === 'enum') return { type, value: value as string };
  if (type === 'string') return { type, value: value as string };
  if (type === 'integer') return { type, value: value as string };
  if (type === 'percentage') return { type, value: value as string };
  return { type: 'decimal', value: value as string };
}

function pinToTyped(pin: TaxCalcPinnedLegalValue): TaxCalcTypedValue {
  return typedFromScalar(pin.type, pin.value, pin.currency);
}

function numericTypes(type: TaxCalcValueType): boolean {
  return type === 'money' || type === 'decimal' || type === 'percentage' || type === 'integer';
}

function decimalOf(value: TaxCalcTypedValue, field: string): TaxDecimalInstance {
  if (value.type === 'integer') return parseTaxInteger(value.value, field);
  if (value.type === 'money' || value.type === 'decimal' || value.type === 'percentage') {
    return parseTaxDecimal(value.value, field);
  }
  throw new Error(`${field} is not numeric`);
}

function sameFamily(left: TaxCalcTypedValue, right: TaxCalcTypedValue): boolean {
  return left.type === 'money' && right.type === 'money'
    ? left.currency === right.currency
    : left.type === right.type;
}

function currencyOf(value: TaxCalcTypedValue): string | undefined {
  return value.type === 'money' ? value.currency : undefined;
}

function rebuildNumeric(type: TaxCalcValueType, amount: TaxDecimalInstance, currency?: string): TaxCalcTypedValue {
  if (type === 'integer') return { type, value: taxIntegerToCanonicalString(amount) };
  if (type === 'money') return { type, value: taxDecimalToCanonicalString(amount), currency: currency as string };
  if (type === 'percentage') return { type, value: taxDecimalToCanonicalString(amount) };
  return { type: 'decimal', value: taxDecimalToCanonicalString(amount) };
}

function rebuildRounded(
  type: TaxCalcValueType,
  amount: TaxDecimalInstance,
  scale: number,
  currency?: string,
): TaxCalcTypedValue {
  if (type === 'integer') return { type, value: taxIntegerToCanonicalString(amount) };
  const value = taxDecimalToScaledString(amount, scale);
  if (type === 'money') return { type, value, currency: currency as string };
  if (type === 'percentage') return { type, value };
  return { type: 'decimal', value };
}

function applyRounding(
  value: TaxCalcTypedValue,
  rounding: TaxCalcRounding | undefined,
  nodeId: string,
): EvalOk | EvalBlocked {
  if (!rounding) return { ok: true, value, ref: { kind: 'node', node_id: nodeId } };
  if (!numericTypes(value.type)) {
    return blocked('type_mismatch', 'rounding applies only to numeric types', nodeId);
  }
  try {
    const rounded = roundTaxDecimal(decimalOf(value, nodeId), rounding);
    if (value.type === 'integer' && rounding.scale !== 0) {
      return blocked('type_mismatch', 'integer rounding scale must be 0', nodeId);
    }
    return {
      ok: true,
      value: rebuildRounded(value.type, rounded, rounding.scale, currencyOf(value)),
      ref: { kind: 'node', node_id: nodeId },
    };
  } catch (error) {
    return blocked('invalid_expression', error instanceof Error ? error.message : 'rounding failed', nodeId);
  }
}

function pushTrace(
  trace: TaxCalcTraceEntry[],
  node: TaxCalcExpr,
  inputs: TaxCalcTraceInput[],
  output: TaxCalcTypedValue,
  rounding?: TaxCalcRounding,
  legalValue?: { legal_value_version_id: string; value_key: string },
  roundingSource?: TaxCalcRoundingSource,
): void {
  const entry: TaxCalcTraceEntry = {
    node_id: node.node_id,
    op: node.op,
    inputs,
    output,
  };
  if (rounding) {
    entry.rounding = rounding;
    entry.rounding_source = roundingSource ?? 'explicit';
  }
  if (legalValue) entry.legal_value = legalValue;
  trace.push(entry);
}

function rootAlreadyDeterminedFinalRounding(node: TaxCalcExpr): boolean {
  return node.op === 'round' || node.rounding !== undefined;
}

function typeMismatch(nodeId: string, message = 'type_mismatch'): EvalBlocked {
  return blocked('type_mismatch', message, nodeId);
}

function currencyMismatch(nodeId: string): EvalBlocked {
  return blocked('currency_mismatch', 'currency_mismatch', nodeId);
}

function evalConst(
  node: Extract<TaxCalcExpr, { op: 'const' }>,
  _defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  const raw = typedFromScalar(node.type, node.value, node.currency);
  const rounding = node.rounding;
  const applied = applyRounding(raw, rounding, node.node_id);
  if (!applied.ok) return applied;
  pushTrace(
    trace,
    node,
    [{ role: 'const', value: raw, ref: { kind: 'const' } }],
    applied.value,
    rounding,
    undefined,
    rounding ? 'explicit' : undefined,
  );
  return { ok: true, value: applied.value, ref: { kind: 'const' } };
}

function evalInput(
  node: Extract<TaxCalcExpr, { op: 'input' }>,
  facts: TaxCalcFacts,
  _defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  const fact = facts[node.key];
  if (!fact) {
    return blocked('missing_input', `missing_input:${node.key}`, node.node_id);
  }
  if (node.type && fact.type !== node.type) {
    return typeMismatch(node.node_id, `input ${node.key} type_mismatch`);
  }
  const rounding = node.rounding;
  const applied = applyRounding(fact, rounding, node.node_id);
  if (!applied.ok) return applied;
  pushTrace(
    trace,
    node,
    [{ role: 'input', value: fact, ref: { kind: 'input', key: node.key } }],
    applied.value,
    rounding,
    undefined,
    rounding ? 'explicit' : undefined,
  );
  return { ok: true, value: applied.value, ref: { kind: 'input', key: node.key } };
}

function evalLegalValue(
  node: Extract<TaxCalcExpr, { op: 'legal_value' }>,
  pins: Map<string, TaxCalcPinnedLegalValue>,
  _defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  const pin = pins.get(node.legal_value_version_id);
  if (!pin) {
    return blocked('missing_legal_value', `missing_legal_value:${node.legal_value_version_id}`, node.node_id);
  }
  if (node.value_key && node.value_key !== pin.value_key) {
    return typeMismatch(node.node_id, 'legal_value value_key does not match pin');
  }
  const typed = pinToTyped(pin);
  const rounding = node.rounding;
  const applied = applyRounding(typed, rounding, node.node_id);
  if (!applied.ok) return applied;
  const legalRef = { legal_value_version_id: pin.legal_value_version_id, value_key: pin.value_key };
  pushTrace(
    trace,
    node,
    [{ role: 'legal_value', value: typed, ref: { kind: 'legal_value', ...legalRef } }],
    applied.value,
    rounding,
    legalRef,
    rounding ? 'explicit' : undefined,
  );
  return { ok: true, value: applied.value, ref: { kind: 'legal_value', ...legalRef } };
}

function finishNumeric(
  node: TaxCalcExpr,
  value: TaxCalcTypedValue,
  inputs: TaxCalcTraceInput[],
  _defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  const rounding = node.rounding;
  const applied = applyRounding(value, rounding, node.node_id);
  if (!applied.ok) return applied;
  pushTrace(trace, node, inputs, applied.value, rounding, undefined, rounding ? 'explicit' : undefined);
  return { ok: true, value: applied.value, ref: { kind: 'node', node_id: node.node_id } };
}

function evalBinary(
  node: Extract<TaxCalcExpr, { op: 'add' | 'sub' | 'mul' | 'div' }>,
  left: EvalOk,
  right: EvalOk,
  defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  const inputs: TaxCalcTraceInput[] = [
    { role: 'left', value: left.value, ref: left.ref },
    { role: 'right', value: right.value, ref: right.ref },
  ];
  try {
    if (node.op === 'add' || node.op === 'sub') {
      if (left.value.type !== right.value.type) return typeMismatch(node.node_id);
      if (left.value.type === 'money' && right.value.type === 'money' && left.value.currency !== right.value.currency) {
        return currencyMismatch(node.node_id);
      }
      if (!numericTypes(left.value.type)) return typeMismatch(node.node_id);
      const l = decimalOf(left.value, `${node.node_id}.left`);
      const r = decimalOf(right.value, `${node.node_id}.right`);
      const result = node.op === 'add' ? l.plus(r) : l.minus(r);
      if (left.value.type === 'integer' && !result.isInteger()) return typeMismatch(node.node_id);
      return finishNumeric(
        node,
        rebuildNumeric(left.value.type, result, currencyOf(left.value)),
        inputs,
        defaultRounding,
        trace,
      );
    }

    if (node.op === 'div') {
      if (!numericTypes(left.value.type) || !numericTypes(right.value.type)) return typeMismatch(node.node_id);
      if (left.value.type === 'money' && right.value.type === 'money' && left.value.currency !== right.value.currency) {
        return currencyMismatch(node.node_id);
      }
      const l = decimalOf(left.value, `${node.node_id}.left`);
      const r = decimalOf(right.value, `${node.node_id}.right`);
      if (r.isZero()) return blocked('division_by_zero', 'division_by_zero', node.node_id);
      const result = l.dividedBy(r);
      if (left.value.type === 'money' && right.value.type === 'money') {
        return finishNumeric(node, rebuildNumeric('decimal', result), inputs, defaultRounding, trace);
      }
      if (left.value.type === 'money' && (right.value.type === 'decimal' || right.value.type === 'integer')) {
        return finishNumeric(node, rebuildNumeric('money', result, left.value.currency), inputs, defaultRounding, trace);
      }
      if (left.value.type === right.value.type && left.value.type !== 'money') {
        const outType = left.value.type === 'integer' ? 'decimal' : left.value.type;
        return finishNumeric(node, rebuildNumeric(outType, result, currencyOf(left.value)), inputs, defaultRounding, trace);
      }
      return typeMismatch(node.node_id);
    }

    if (!numericTypes(left.value.type) || !numericTypes(right.value.type)) return typeMismatch(node.node_id);
    if (left.value.type === 'money' && right.value.type === 'money') return typeMismatch(node.node_id);
    if (left.value.type === 'percentage' && right.value.type === 'percentage') return typeMismatch(node.node_id);
    if (left.value.type === 'money' && right.value.type === 'percentage') return typeMismatch(node.node_id);
    if (right.value.type === 'money' && left.value.type === 'percentage') return typeMismatch(node.node_id);
    const l = decimalOf(left.value, `${node.node_id}.left`);
    const r = decimalOf(right.value, `${node.node_id}.right`);
    const result = l.times(r);
    if (left.value.type === 'money' && (right.value.type === 'decimal' || right.value.type === 'integer')) {
      return finishNumeric(node, rebuildNumeric('money', result, left.value.currency), inputs, defaultRounding, trace);
    }
    if (right.value.type === 'money' && (left.value.type === 'decimal' || left.value.type === 'integer')) {
      return finishNumeric(node, rebuildNumeric('money', result, right.value.currency), inputs, defaultRounding, trace);
    }
    if (left.value.type === 'percentage' && (right.value.type === 'decimal' || right.value.type === 'integer')) {
      return finishNumeric(node, rebuildNumeric('percentage', result), inputs, defaultRounding, trace);
    }
    if (right.value.type === 'percentage' && (left.value.type === 'decimal' || left.value.type === 'integer')) {
      return finishNumeric(node, rebuildNumeric('percentage', result), inputs, defaultRounding, trace);
    }
    if (left.value.type === 'integer' && right.value.type === 'integer') {
      if (!result.isInteger()) return typeMismatch(node.node_id);
      return finishNumeric(node, rebuildNumeric('integer', result), inputs, defaultRounding, trace);
    }
    if (
      (left.value.type === 'decimal' || left.value.type === 'integer') &&
      (right.value.type === 'decimal' || right.value.type === 'integer')
    ) {
      return finishNumeric(node, rebuildNumeric('decimal', result), inputs, defaultRounding, trace);
    }
    return typeMismatch(node.node_id);
  } catch (error) {
    return blocked('invalid_expression', error instanceof Error ? error.message : 'arithmetic failed', node.node_id);
  }
}

function evalMinMax(
  node: Extract<TaxCalcExpr, { op: 'min' | 'max' }>,
  values: EvalOk[],
  defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  const first = values[0].value;
  if (!numericTypes(first.type)) return typeMismatch(node.node_id);
  for (const item of values) {
    if (item.value.type !== first.type) return typeMismatch(node.node_id);
    if (first.type === 'money' && item.value.type === 'money' && item.value.currency !== first.currency) {
      return currencyMismatch(node.node_id);
    }
  }
  const decimals = values.map((item, index) => decimalOf(item.value, `${node.node_id}.args[${index}]`));
  const result = node.op === 'min' ? minTaxDecimal(decimals) : maxTaxDecimal(decimals);
  return finishNumeric(
    node,
    rebuildNumeric(first.type, result, currencyOf(first)),
    values.map((item, index) => ({ role: `args[${index}]`, value: item.value, ref: item.ref })),
    defaultRounding,
    trace,
  );
}

function evalClamp(
  node: Extract<TaxCalcExpr, { op: 'clamp' }>,
  value: EvalOk,
  min: EvalOk,
  max: EvalOk,
  defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  const clampValues = [value.value, min.value, max.value];
  const moneyCurrencies = [...new Set(clampValues.filter((item) => item.type === 'money').map((item) => item.currency))];
  if (moneyCurrencies.length > 1) return currencyMismatch(node.node_id);
  if (!sameFamily(value.value, min.value) || !sameFamily(value.value, max.value)) {
    return typeMismatch(node.node_id);
  }
  if (!numericTypes(value.value.type)) return typeMismatch(node.node_id);
  const amount = decimalOf(value.value, `${node.node_id}.value`);
  const lower = decimalOf(min.value, `${node.node_id}.min`);
  const upper = decimalOf(max.value, `${node.node_id}.max`);
  if (compareTaxDecimals(lower, upper) > 0) {
    return blocked('invalid_expression', 'clamp.min must be <= clamp.max', node.node_id);
  }
  const clamped = compareTaxDecimals(amount, lower) < 0 ? lower : compareTaxDecimals(amount, upper) > 0 ? upper : amount;
  return finishNumeric(
    node,
    rebuildNumeric(value.value.type, clamped, currencyOf(value.value)),
    [
      { role: 'value', value: value.value, ref: value.ref },
      { role: 'min', value: min.value, ref: min.ref },
      { role: 'max', value: max.value, ref: max.ref },
    ],
    defaultRounding,
    trace,
  );
}

function evalPercentOf(
  node: Extract<TaxCalcExpr, { op: 'percent_of' }>,
  base: EvalOk,
  rate: EvalOk,
  defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  if (rate.value.type !== 'percentage') return typeMismatch(node.node_id, 'percent_of rate must be percentage');
  if (base.value.type !== 'money' && base.value.type !== 'decimal' && base.value.type !== 'integer') {
    return typeMismatch(node.node_id, 'percent_of base must be money, decimal, or integer');
  }
  const result = percentOfTaxDecimal(
    decimalOf(base.value, `${node.node_id}.base`),
    decimalOf(rate.value, `${node.node_id}.rate`),
  );
  const outType = base.value.type === 'money' ? 'money' : 'decimal';
  return finishNumeric(
    node,
    rebuildNumeric(outType, result, currencyOf(base.value)),
    [
      { role: 'base', value: base.value, ref: base.ref },
      { role: 'rate', value: rate.value, ref: rate.ref },
    ],
    defaultRounding,
    trace,
  );
}

function evalIf(
  node: Extract<TaxCalcExpr, { op: 'if' }>,
  cond: EvalOk,
  thenValue: EvalOk,
  elseValue: EvalOk,
  _defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  if (cond.value.type !== 'boolean') return typeMismatch(node.node_id, 'if cond must be boolean');
  if (thenValue.value.type !== elseValue.value.type) return typeMismatch(node.node_id, 'if branches must share a type');
  if (
    thenValue.value.type === 'money' &&
    elseValue.value.type === 'money' &&
    thenValue.value.currency !== elseValue.value.currency
  ) {
    return currencyMismatch(node.node_id);
  }
  const chosen = cond.value.value ? thenValue : elseValue;
  const rounding = node.rounding;
  const applied = applyRounding(chosen.value, rounding, node.node_id);
  if (!applied.ok) return applied;
  pushTrace(
    trace,
    node,
    [
      { role: 'cond', value: cond.value, ref: cond.ref },
      { role: 'then', value: thenValue.value, ref: thenValue.ref },
      { role: 'else', value: elseValue.value, ref: elseValue.ref },
    ],
    applied.value,
    rounding,
    undefined,
    rounding ? 'explicit' : undefined,
  );
  return { ok: true, value: applied.value, ref: { kind: 'node', node_id: node.node_id } };
}

function evalRound(
  node: Extract<TaxCalcExpr, { op: 'round' }>,
  inner: EvalOk,
  defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  const rounding = node.rounding ?? defaultRounding;
  if (!rounding) return blocked('invalid_expression', 'round requires rounding or default_rounding', node.node_id);
  const applied = applyRounding(inner.value, rounding, node.node_id);
  if (!applied.ok) return applied;
  const source: TaxCalcRoundingSource = node.rounding ? 'explicit' : 'round_default';
  pushTrace(trace, node, [{ role: 'value', value: inner.value, ref: inner.ref }], applied.value, rounding, undefined, source);
  return { ok: true, value: applied.value, ref: { kind: 'node', node_id: node.node_id } };
}

function evalBracketApply(
  node: Extract<TaxCalcExpr, { op: 'bracket_apply' }>,
  amount: EvalOk,
  defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  if (amount.value.type !== 'money' && amount.value.type !== 'decimal') {
    return typeMismatch(node.node_id, 'bracket_apply amount must be money or decimal');
  }
  const amountDec = decimalOf(amount.value, `${node.node_id}.amount`);
  if (amountDec.isNeg()) {
    return blocked('invalid_expression', 'bracket_apply amount cannot be negative', node.node_id);
  }
  let previous = parseTaxDecimal('0', `${node.node_id}.zero`);
  let tax = parseTaxDecimal('0', `${node.node_id}.tax`);
  const lastIndex = node.table.brackets.length - 1;
  for (let index = 0; index < node.table.brackets.length; index += 1) {
    const row = node.table.brackets[index];
    const rate = parseTaxDecimal(row.rate, `${node.node_id}.rate[${index}]`);
    const isLast = index === lastIndex;
    if (row.up_to === null) {
      const slice = amountDec.greaterThan(previous) ? amountDec.minus(previous) : parseTaxDecimal('0', 'zero');
      tax = tax.plus(percentOfTaxDecimal(slice, rate));
      previous = amountDec;
      continue;
    }
    const ceiling = parseTaxDecimal(row.up_to, `${node.node_id}.up_to[${index}]`);
    const upper = amountDec.lessThan(ceiling) ? amountDec : ceiling;
    const slice = upper.greaterThan(previous) ? upper.minus(previous) : parseTaxDecimal('0', 'zero');
    tax = tax.plus(percentOfTaxDecimal(slice, rate));
    previous = ceiling;
    if (isLast && amountDec.greaterThan(ceiling)) {
      return blocked('invalid_expression', 'amount exceeds closed bracket table', node.node_id);
    }
  }
  return finishNumeric(
    node,
    rebuildNumeric(amount.value.type === 'money' ? 'money' : 'decimal', tax, currencyOf(amount.value)),
    [{ role: 'amount', value: amount.value, ref: amount.ref }],
    defaultRounding,
    trace,
  );
}

function evaluateNode(
  node: TaxCalcExpr,
  facts: TaxCalcFacts,
  pins: Map<string, TaxCalcPinnedLegalValue>,
  defaultRounding: TaxCalcRounding | undefined,
  trace: TaxCalcTraceEntry[],
): EvalResult {
  switch (node.op) {
    case 'const':
      return evalConst(node, defaultRounding, trace);
    case 'input':
      return evalInput(node, facts, defaultRounding, trace);
    case 'legal_value':
      return evalLegalValue(node, pins, defaultRounding, trace);
    case 'add':
    case 'sub':
    case 'mul':
    case 'div': {
      const left = evaluateNode(node.left, facts, pins, defaultRounding, trace);
      if (!left.ok) return left;
      const right = evaluateNode(node.right, facts, pins, defaultRounding, trace);
      if (!right.ok) return right;
      return evalBinary(node, left, right, defaultRounding, trace);
    }
    case 'min':
    case 'max': {
      const values: EvalOk[] = [];
      for (const child of node.args) {
        const result = evaluateNode(child, facts, pins, defaultRounding, trace);
        if (!result.ok) return result;
        values.push(result);
      }
      return evalMinMax(node, values, defaultRounding, trace);
    }
    case 'clamp': {
      const value = evaluateNode(node.value, facts, pins, defaultRounding, trace);
      if (!value.ok) return value;
      const min = evaluateNode(node.min, facts, pins, defaultRounding, trace);
      if (!min.ok) return min;
      const max = evaluateNode(node.max, facts, pins, defaultRounding, trace);
      if (!max.ok) return max;
      return evalClamp(node, value, min, max, defaultRounding, trace);
    }
    case 'if': {
      const cond = evaluateNode(node.cond, facts, pins, defaultRounding, trace);
      if (!cond.ok) return cond;
      const thenValue = evaluateNode(node.then, facts, pins, defaultRounding, trace);
      if (!thenValue.ok) return thenValue;
      const elseValue = evaluateNode(node.else, facts, pins, defaultRounding, trace);
      if (!elseValue.ok) return elseValue;
      return evalIf(node, cond, thenValue, elseValue, defaultRounding, trace);
    }
    case 'percent_of': {
      const base = evaluateNode(node.base, facts, pins, defaultRounding, trace);
      if (!base.ok) return base;
      const rate = evaluateNode(node.rate, facts, pins, defaultRounding, trace);
      if (!rate.ok) return rate;
      return evalPercentOf(node, base, rate, defaultRounding, trace);
    }
    case 'round': {
      const inner = evaluateNode(node.value, facts, pins, defaultRounding, trace);
      if (!inner.ok) return inner;
      return evalRound(node, inner, defaultRounding, trace);
    }
    case 'bracket_apply': {
      const amount = evaluateNode(node.amount, facts, pins, defaultRounding, trace);
      if (!amount.ok) return amount;
      return evalBracketApply(node, amount, defaultRounding, trace);
    }
  }
}

function finish(inputChecksum: string, result: EvalResult, trace: TaxCalcTraceEntry[]): TaxCalcEvaluation {
  if (result.ok) {
    const resultChecksum = checksumPayload({
      ok: true,
      result: result.value as unknown as Record<string, unknown>,
      trace: trace as unknown as Record<string, unknown>,
    });
    return { ok: true, result: result.value, trace, input_checksum: inputChecksum, result_checksum: resultChecksum };
  }
  const resultChecksum = checksumPayload({
    ok: false,
    blocked: result.blocked as unknown as Record<string, unknown>,
    trace: trace as unknown as Record<string, unknown>,
  });
  return { ok: false, blocked: result.blocked, trace, input_checksum: inputChecksum, result_checksum: resultChecksum };
}

export function taxCalculationInputChecksum(input: {
  expression: TaxCalcExpr;
  facts: TaxCalcFacts;
  legal_values: TaxCalcPinnedLegalValue[];
  default_rounding?: TaxCalcRounding;
}): string {
  return checksumPayload({
    expression: input.expression as unknown as Record<string, unknown>,
    facts: input.facts as unknown as Record<string, unknown>,
    legal_values: input.legal_values
      .slice()
      .sort((a, b) => a.legal_value_version_id.localeCompare(b.legal_value_version_id)) as unknown as Record<
      string,
      unknown
    >,
    ...(input.default_rounding ? { default_rounding: input.default_rounding } : {}),
  });
}

export function evaluateTaxCalculation(input: TaxCalcEvaluationInput): TaxCalcEvaluation {
  const validated = validateTaxCalculationExpression(input.expression);
  const factsParsed = parseFacts(input.facts);
  const pinsParsed = parseLegalValues(input.legal_values);
  const roundingParsed = parseRoundingPolicy(input.default_rounding);

  if (!factsParsed.ok) {
    return {
      ok: false,
      blocked: factsParsed.blocked,
      trace: [],
      input_checksum: checksumPayload({ error: 'facts' }),
      result_checksum: checksumPayload({ ok: false, blocked: factsParsed.blocked as unknown as Record<string, unknown> }),
    };
  }
  if (!pinsParsed.ok) {
    return {
      ok: false,
      blocked: pinsParsed.blocked,
      trace: [],
      input_checksum: checksumPayload({ error: 'legal_values' }),
      result_checksum: checksumPayload({ ok: false, blocked: pinsParsed.blocked as unknown as Record<string, unknown> }),
    };
  }
  if (roundingParsed && 'ok' in roundingParsed && roundingParsed.ok === false) {
    return {
      ok: false,
      blocked: roundingParsed.blocked,
      trace: [],
      input_checksum: checksumPayload({ error: 'default_rounding' }),
      result_checksum: checksumPayload({
        ok: false,
        blocked: roundingParsed.blocked as unknown as Record<string, unknown>,
      }),
    };
  }
  const defaultRounding = roundingParsed && !('ok' in roundingParsed) ? roundingParsed : undefined;

  if (!validated.ok) {
    const blockedValue = { code: validated.code, message: validated.message, ...(validated.node_id ? { node_id: validated.node_id } : {}) };
    return {
      ok: false,
      blocked: blockedValue,
      trace: [],
      input_checksum: checksumPayload({ error: 'expression' }),
      result_checksum: checksumPayload({ ok: false, blocked: blockedValue }),
    };
  }

  const inputChecksum = taxCalculationInputChecksum({
    expression: validated.expression,
    facts: factsParsed.facts,
    legal_values: [...pinsParsed.pins.values()],
    default_rounding: defaultRounding,
  });
  const trace: TaxCalcTraceEntry[] = [];
  const result = evaluateNode(validated.expression, factsParsed.facts, pinsParsed.pins, defaultRounding, trace);
  if (!result.ok) {
    return finish(inputChecksum, result, trace);
  }
  if (
    defaultRounding &&
    numericTypes(result.value.type) &&
    !rootAlreadyDeterminedFinalRounding(validated.expression)
  ) {
    const applied = applyRounding(result.value, defaultRounding, validated.expression.node_id);
    if (!applied.ok) {
      return finish(inputChecksum, applied, trace);
    }
    trace.push({
      node_id: validated.expression.node_id,
      op: validated.expression.op,
      inputs: [{ role: 'unrounded', value: result.value, ref: { kind: 'node', node_id: validated.expression.node_id } }],
      output: applied.value,
      rounding: defaultRounding,
      rounding_source: 'final_default',
    });
    return finish(inputChecksum, { ok: true, value: applied.value, ref: result.ref }, trace);
  }
  return finish(inputChecksum, result, trace);
}

export function hasLatestVersionResolver(): false {
  return false;
}
