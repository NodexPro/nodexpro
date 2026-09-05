import {
  isCanonicalDecimalString,
  isCanonicalIntegerString,
} from './tax-calculation-engine-decimal.pure.js';
import {
  TAX_CALCULATION_ENGINE_MAX_EXPRESSION_DEPTH,
  TAX_CALCULATION_ENGINE_MAX_EXPRESSION_NODES,
  TAX_CALCULATION_ENGINE_MAX_ROUNDING_SCALE,
  isTaxCalcCanonicalDate,
  isTaxCalcOp,
  isTaxCalcRoundingMode,
  isTaxCalcValueType,
  type TaxCalcBlockedCode,
  type TaxCalcBracketTable,
  type TaxCalcExpr,
  type TaxCalcRounding,
  type TaxCalcValueType,
} from './tax-calculation-engine.types.js';

export type TaxCalcValidationOk = { ok: true; expression: TaxCalcExpr };
export type TaxCalcValidationErr = {
  ok: false;
  code: Extract<TaxCalcBlockedCode, 'invalid_expression' | 'invalid_bracket_table'>;
  message: string;
  node_id?: string;
};
export type TaxCalcValidation = TaxCalcValidationOk | TaxCalcValidationErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(
  code: TaxCalcValidationErr['code'],
  message: string,
  node_id?: string,
): TaxCalcValidationErr {
  return node_id ? { ok: false, code, message, node_id } : { ok: false, code, message };
}

function extraKeys(node: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(node).filter((key) => !allowed.includes(key)).sort((a, b) => a.localeCompare(b));
}

function parseRounding(value: unknown, nodeId: string): TaxCalcRounding | TaxCalcValidationErr | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    return fail('invalid_expression', 'rounding must be an object', nodeId);
  }
  const extra = extraKeys(value, ['mode', 'scale']);
  if (extra.length) {
    return fail('invalid_expression', `rounding has unknown keys: ${extra.join(', ')}`, nodeId);
  }
  if (!isTaxCalcRoundingMode(value.mode)) {
    return fail('invalid_expression', 'rounding.mode is required', nodeId);
  }
  if (typeof value.scale === 'number' && !Number.isInteger(value.scale)) {
    return fail('invalid_expression', 'rounding.scale must be an integer', nodeId);
  }
  if (
    typeof value.scale !== 'number' ||
    !Number.isInteger(value.scale) ||
    value.scale < 0 ||
    value.scale > TAX_CALCULATION_ENGINE_MAX_ROUNDING_SCALE
  ) {
    return fail(
      'invalid_expression',
      `rounding.scale must be an integer 0..${TAX_CALCULATION_ENGINE_MAX_ROUNDING_SCALE}`,
      nodeId,
    );
  }
  return { mode: value.mode, scale: value.scale };
}

function parseNodeId(value: unknown): string | TaxCalcValidationErr {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    return fail('invalid_expression', 'node_id must be a non-empty string');
  }
  return value;
}

function parseNonEmptyString(value: unknown, field: string, nodeId: string): string | TaxCalcValidationErr {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    return fail('invalid_expression', `${field} must be a non-empty string`, nodeId);
  }
  return value;
}

function parseCurrency(value: unknown, nodeId: string): string | TaxCalcValidationErr {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    return fail('invalid_expression', 'currency must be a non-empty string', nodeId);
  }
  return value;
}

export function parseConstScalar(
  type: TaxCalcValueType,
  value: unknown,
  currency: unknown,
  nodeId: string,
): TaxCalcValidationErr | { value: string | boolean; currency?: string } {
  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      return fail('invalid_expression', 'boolean const value must be a boolean', nodeId);
    }
    if (currency !== undefined) {
      return fail('invalid_expression', 'boolean const cannot have currency', nodeId);
    }
    return { value };
  }
  if (type === 'date') {
    if (!isTaxCalcCanonicalDate(value)) {
      return fail('invalid_expression', 'date must be a canonical Gregorian YYYY-MM-DD', nodeId);
    }
    if (currency !== undefined) {
      return fail('invalid_expression', 'date const cannot have currency', nodeId);
    }
    return { value };
  }
  if (type === 'enum' || type === 'string') {
    if (typeof value !== 'string') {
      return fail('invalid_expression', `${type} const value must be a string`, nodeId);
    }
    if (currency !== undefined) {
      return fail('invalid_expression', `${type} const cannot have currency`, nodeId);
    }
    return { value };
  }
  if (type === 'integer') {
    if (typeof value === 'number') {
      return fail('invalid_expression', 'integer const cannot use a JS number', nodeId);
    }
    if (!isCanonicalIntegerString(value)) {
      return fail('invalid_expression', 'integer const must be a canonical integer string', nodeId);
    }
    if (currency !== undefined) {
      return fail('invalid_expression', 'integer const cannot have currency', nodeId);
    }
    return { value };
  }
  if (type === 'money') {
    if (typeof value === 'number') {
      return fail('invalid_expression', 'money const cannot use a JS number', nodeId);
    }
    if (!isCanonicalDecimalString(value)) {
      return fail('invalid_expression', 'money const must be a canonical decimal string', nodeId);
    }
    const parsedCurrency = parseCurrency(currency, nodeId);
    if (typeof parsedCurrency !== 'string') return parsedCurrency;
    return { value, currency: parsedCurrency };
  }
  if (typeof value === 'number') {
    return fail('invalid_expression', `${type} const cannot use a JS number`, nodeId);
  }
  if (!isCanonicalDecimalString(value)) {
    return fail('invalid_expression', `${type} const must be a canonical decimal string`, nodeId);
  }
  if (currency !== undefined) {
    return fail('invalid_expression', `${type} const cannot have currency`, nodeId);
  }
  return { value };
}

function parseBracketTable(value: unknown, nodeId: string): TaxCalcBracketTable | TaxCalcValidationErr {
  if (!isPlainObject(value)) {
    return fail('invalid_bracket_table', 'bracket table must be an object', nodeId);
  }
  const extra = extraKeys(value, ['brackets']);
  if (extra.length) {
    return fail('invalid_bracket_table', `bracket table has unknown keys: ${extra.join(', ')}`, nodeId);
  }
  if (!Array.isArray(value.brackets) || value.brackets.length === 0) {
    return fail('invalid_bracket_table', 'bracket table requires a non-empty brackets array', nodeId);
  }

  const brackets: TaxCalcBracketTable['brackets'] = [];
  let previousUpTo: string | null = null;
  for (let index = 0; index < value.brackets.length; index += 1) {
    const row = value.brackets[index];
    const isLast = index === value.brackets.length - 1;
    if (!isPlainObject(row)) {
      return fail('invalid_bracket_table', `brackets[${index}] must be an object`, nodeId);
    }
    const rowExtra = extraKeys(row, ['up_to', 'rate']);
    if (rowExtra.length) {
      return fail('invalid_bracket_table', `brackets[${index}] has unknown keys: ${rowExtra.join(', ')}`, nodeId);
    }
    if (typeof row.rate === 'number') {
      return fail('invalid_bracket_table', `brackets[${index}].rate cannot use a JS number`, nodeId);
    }
    if (!isCanonicalDecimalString(row.rate)) {
      return fail('invalid_bracket_table', `brackets[${index}].rate must be a canonical decimal string`, nodeId);
    }
    if (row.up_to === null) {
      if (!isLast) {
        return fail('invalid_bracket_table', 'only the final bracket may be open-ended', nodeId);
      }
      brackets.push({ up_to: null, rate: row.rate });
      continue;
    }
    if (typeof row.up_to === 'number') {
      return fail('invalid_bracket_table', `brackets[${index}].up_to cannot use a JS number`, nodeId);
    }
    if (!isCanonicalDecimalString(row.up_to)) {
      return fail('invalid_bracket_table', `brackets[${index}].up_to must be a canonical decimal string or null`, nodeId);
    }
    if (row.up_to.startsWith('-') || row.up_to === '0') {
      return fail('invalid_bracket_table', `brackets[${index}].up_to must be greater than 0`, nodeId);
    }
    if (previousUpTo !== null && !isStrictlyGreaterDecimalString(row.up_to, previousUpTo)) {
      return fail('invalid_bracket_table', 'bracket ceilings must be strictly increasing', nodeId);
    }
    previousUpTo = row.up_to;
    brackets.push({ up_to: row.up_to, rate: row.rate });
  }
  return { brackets };
}

/** Compare two canonical non-negative decimal strings without JS number arithmetic. */
function isStrictlyGreaterDecimalString(left: string, right: string): boolean {
  const [lInt, lFrac = ''] = left.split('.');
  const [rInt, rFrac = ''] = right.split('.');
  if (lInt.length !== rInt.length) return lInt.length > rInt.length;
  if (lInt !== rInt) return lInt > rInt;
  const maxFrac = Math.max(lFrac.length, rFrac.length);
  const lPad = lFrac.padEnd(maxFrac, '0');
  const rPad = rFrac.padEnd(maxFrac, '0');
  return lPad > rPad;
}

function validateChild(
  value: unknown,
  depth: number,
  counter: { nodes: number },
  ids: Set<string>,
  field: string,
  parentId: string,
): TaxCalcValidation {
  const result = validateNode(value, depth, counter, ids);
  if (!result.ok && !result.node_id) {
    return { ...result, node_id: parentId, message: `${field}: ${result.message}` };
  }
  return result;
}

function validateNode(
  value: unknown,
  depth: number,
  counter: { nodes: number },
  ids: Set<string>,
): TaxCalcValidation {
  counter.nodes += 1;
  if (depth > TAX_CALCULATION_ENGINE_MAX_EXPRESSION_DEPTH) {
    return fail(
      'invalid_expression',
      `expression exceeds max depth ${TAX_CALCULATION_ENGINE_MAX_EXPRESSION_DEPTH}`,
    );
  }
  if (counter.nodes > TAX_CALCULATION_ENGINE_MAX_EXPRESSION_NODES) {
    return fail(
      'invalid_expression',
      `expression exceeds max nodes ${TAX_CALCULATION_ENGINE_MAX_EXPRESSION_NODES}`,
    );
  }
  if (!isPlainObject(value)) {
    return fail('invalid_expression', 'expression node must be an object');
  }
  if (!isTaxCalcOp(value.op)) {
    return fail('invalid_expression', 'expression node op is required');
  }
  const nodeId = parseNodeId(value.node_id);
  if (typeof nodeId !== 'string') return nodeId;
  if (ids.has(nodeId)) {
    return fail('invalid_expression', 'node_id must be unique', nodeId);
  }
  ids.add(nodeId);

  const rounding = parseRounding(value.rounding, nodeId);
  if (rounding && 'ok' in rounding && rounding.ok === false) return rounding;
  const roundingValue = rounding && !('ok' in rounding) ? rounding : undefined;

  switch (value.op) {
    case 'const': {
      const extra = extraKeys(value, ['op', 'node_id', 'type', 'value', 'currency', 'rounding']);
      if (extra.length) return fail('invalid_expression', `const has unknown keys: ${extra.join(', ')}`, nodeId);
      if (!isTaxCalcValueType(value.type)) {
        return fail('invalid_expression', 'const.type is required', nodeId);
      }
      const parsed = parseConstScalar(value.type, value.value, value.currency, nodeId);
      if ('ok' in parsed) return parsed;
      return {
        ok: true,
        expression: {
          op: 'const',
          node_id: nodeId,
          type: value.type,
          value: parsed.value,
          ...(parsed.currency ? { currency: parsed.currency } : {}),
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'input': {
      const extra = extraKeys(value, ['op', 'node_id', 'key', 'type', 'rounding']);
      if (extra.length) return fail('invalid_expression', `input has unknown keys: ${extra.join(', ')}`, nodeId);
      const key = parseNonEmptyString(value.key, 'key', nodeId);
      if (typeof key !== 'string') return key;
      if (value.type !== undefined && !isTaxCalcValueType(value.type)) {
        return fail('invalid_expression', 'input.type is invalid', nodeId);
      }
      return {
        ok: true,
        expression: {
          op: 'input',
          node_id: nodeId,
          key,
          ...(value.type ? { type: value.type } : {}),
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'legal_value': {
      const extra = extraKeys(value, ['op', 'node_id', 'legal_value_version_id', 'value_key', 'rounding']);
      if (extra.length) return fail('invalid_expression', `legal_value has unknown keys: ${extra.join(', ')}`, nodeId);
      const versionId = parseNonEmptyString(value.legal_value_version_id, 'legal_value_version_id', nodeId);
      if (typeof versionId !== 'string') return versionId;
      let valueKey: string | undefined;
      if (value.value_key !== undefined) {
        const parsedKey = parseNonEmptyString(value.value_key, 'value_key', nodeId);
        if (typeof parsedKey !== 'string') return parsedKey;
        valueKey = parsedKey;
      }
      return {
        ok: true,
        expression: {
          op: 'legal_value',
          node_id: nodeId,
          legal_value_version_id: versionId,
          ...(valueKey ? { value_key: valueKey } : {}),
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'add':
    case 'sub':
    case 'mul':
    case 'div': {
      const extra = extraKeys(value, ['op', 'node_id', 'left', 'right', 'rounding']);
      if (extra.length) return fail('invalid_expression', `${value.op} has unknown keys: ${extra.join(', ')}`, nodeId);
      const left = validateChild(value.left, depth + 1, counter, ids, 'left', nodeId);
      if (!left.ok) return left;
      const right = validateChild(value.right, depth + 1, counter, ids, 'right', nodeId);
      if (!right.ok) return right;
      return {
        ok: true,
        expression: {
          op: value.op,
          node_id: nodeId,
          left: left.expression,
          right: right.expression,
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'min':
    case 'max': {
      const extra = extraKeys(value, ['op', 'node_id', 'args', 'rounding']);
      if (extra.length) return fail('invalid_expression', `${value.op} has unknown keys: ${extra.join(', ')}`, nodeId);
      if (!Array.isArray(value.args) || value.args.length < 2) {
        return fail('invalid_expression', `${value.op} requires at least two args`, nodeId);
      }
      const args: TaxCalcExpr[] = [];
      for (let index = 0; index < value.args.length; index += 1) {
        const child = validateChild(value.args[index], depth + 1, counter, ids, `args[${index}]`, nodeId);
        if (!child.ok) return child;
        args.push(child.expression);
      }
      return {
        ok: true,
        expression: {
          op: value.op,
          node_id: nodeId,
          args,
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'clamp': {
      const extra = extraKeys(value, ['op', 'node_id', 'value', 'min', 'max', 'rounding']);
      if (extra.length) return fail('invalid_expression', 'clamp has unknown keys: ' + extra.join(', '), nodeId);
      const inner = validateChild(value.value, depth + 1, counter, ids, 'value', nodeId);
      if (!inner.ok) return inner;
      const min = validateChild(value.min, depth + 1, counter, ids, 'min', nodeId);
      if (!min.ok) return min;
      const max = validateChild(value.max, depth + 1, counter, ids, 'max', nodeId);
      if (!max.ok) return max;
      return {
        ok: true,
        expression: {
          op: 'clamp',
          node_id: nodeId,
          value: inner.expression,
          min: min.expression,
          max: max.expression,
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'if': {
      const extra = extraKeys(value, ['op', 'node_id', 'cond', 'then', 'else', 'rounding']);
      if (extra.length) return fail('invalid_expression', 'if has unknown keys: ' + extra.join(', '), nodeId);
      const cond = validateChild(value.cond, depth + 1, counter, ids, 'cond', nodeId);
      if (!cond.ok) return cond;
      const thenNode = validateChild(value.then, depth + 1, counter, ids, 'then', nodeId);
      if (!thenNode.ok) return thenNode;
      const elseNode = validateChild(value.else, depth + 1, counter, ids, 'else', nodeId);
      if (!elseNode.ok) return elseNode;
      return {
        ok: true,
        expression: {
          op: 'if',
          node_id: nodeId,
          cond: cond.expression,
          then: thenNode.expression,
          else: elseNode.expression,
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'percent_of': {
      const extra = extraKeys(value, ['op', 'node_id', 'base', 'rate', 'rounding']);
      if (extra.length) return fail('invalid_expression', 'percent_of has unknown keys: ' + extra.join(', '), nodeId);
      const base = validateChild(value.base, depth + 1, counter, ids, 'base', nodeId);
      if (!base.ok) return base;
      const rate = validateChild(value.rate, depth + 1, counter, ids, 'rate', nodeId);
      if (!rate.ok) return rate;
      return {
        ok: true,
        expression: {
          op: 'percent_of',
          node_id: nodeId,
          base: base.expression,
          rate: rate.expression,
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'round': {
      const extra = extraKeys(value, ['op', 'node_id', 'value', 'rounding']);
      if (extra.length) return fail('invalid_expression', 'round has unknown keys: ' + extra.join(', '), nodeId);
      const inner = validateChild(value.value, depth + 1, counter, ids, 'value', nodeId);
      if (!inner.ok) return inner;
      return {
        ok: true,
        expression: {
          op: 'round',
          node_id: nodeId,
          value: inner.expression,
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
    case 'bracket_apply': {
      const extra = extraKeys(value, ['op', 'node_id', 'amount', 'table', 'rounding']);
      if (extra.length) return fail('invalid_expression', 'bracket_apply has unknown keys: ' + extra.join(', '), nodeId);
      const amount = validateChild(value.amount, depth + 1, counter, ids, 'amount', nodeId);
      if (!amount.ok) return amount;
      const table = parseBracketTable(value.table, nodeId);
      if ('ok' in table) return table;
      return {
        ok: true,
        expression: {
          op: 'bracket_apply',
          node_id: nodeId,
          amount: amount.expression,
          table,
          ...(roundingValue ? { rounding: roundingValue } : {}),
        },
      };
    }
  }
}

export function validateTaxCalculationExpression(value: unknown): TaxCalcValidation {
  return validateNode(value, 1, { nodes: 0 }, new Set());
}
