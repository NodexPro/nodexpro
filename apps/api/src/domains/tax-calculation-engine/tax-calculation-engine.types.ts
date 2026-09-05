import { isCanonicalIsoDate } from '../tax-rule-engine/tax-rule-engine.types.js';

/** Conservative AST limits, same magnitude as K3B predicate limits (depth 8 / nodes 64). */
export const TAX_CALCULATION_ENGINE_MAX_EXPRESSION_DEPTH = 8;
export const TAX_CALCULATION_ENGINE_MAX_EXPRESSION_NODES = 64;
export const TAX_CALCULATION_ENGINE_MAX_ROUNDING_SCALE = 18;

export const TAX_CALCULATION_VALUE_TYPES = [
  'money',
  'decimal',
  'percentage',
  'integer',
  'boolean',
  'date',
  'enum',
  'string',
] as const;

export type TaxCalcValueType = (typeof TAX_CALCULATION_VALUE_TYPES)[number];

export const TAX_CALCULATION_OPS = [
  'const',
  'input',
  'legal_value',
  'add',
  'sub',
  'mul',
  'div',
  'min',
  'max',
  'clamp',
  'if',
  'percent_of',
  'round',
  'bracket_apply',
] as const;

export type TaxCalcOp = (typeof TAX_CALCULATION_OPS)[number];

export const TAX_CALCULATION_ROUNDING_MODES = ['half_up', 'half_even', 'floor', 'ceil'] as const;

export type TaxCalcRoundingMode = (typeof TAX_CALCULATION_ROUNDING_MODES)[number];

export const TAX_CALCULATION_BLOCKED_CODES = [
  'missing_input',
  'missing_legal_value',
  'type_mismatch',
  'division_by_zero',
  'currency_mismatch',
  'invalid_bracket_table',
  'invalid_expression',
] as const;

export type TaxCalcBlockedCode = (typeof TAX_CALCULATION_BLOCKED_CODES)[number];

export type TaxCalcRounding = {
  mode: TaxCalcRoundingMode;
  scale: number;
};

/** Where a rounded trace output came from. Absent means the node output is exact. */
export type TaxCalcRoundingSource = 'explicit' | 'round_default' | 'final_default';

export type TaxCalcTypedValue =
  | { type: 'money'; value: string; currency: string }
  | { type: 'decimal'; value: string }
  | { type: 'percentage'; value: string }
  | { type: 'integer'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'enum'; value: string }
  | { type: 'string'; value: string };

export type TaxCalcFacts = Record<string, TaxCalcTypedValue>;

export type TaxCalcPinnedLegalValue = {
  legal_value_version_id: string;
  value_key: string;
  type: TaxCalcValueType;
  value: string | boolean;
  currency?: string;
};

export type TaxCalcBracketRow = {
  up_to: string | null;
  rate: string;
};

export type TaxCalcBracketTable = {
  brackets: TaxCalcBracketRow[];
};

export type TaxCalcRoundingNode = {
  rounding?: TaxCalcRounding;
};

export type TaxCalcConstNode = TaxCalcRoundingNode & {
  op: 'const';
  node_id: string;
  type: TaxCalcValueType;
  value: string | boolean;
  currency?: string;
};

export type TaxCalcInputNode = TaxCalcRoundingNode & {
  op: 'input';
  node_id: string;
  key: string;
  type?: TaxCalcValueType;
};

export type TaxCalcLegalValueNode = TaxCalcRoundingNode & {
  op: 'legal_value';
  node_id: string;
  legal_value_version_id: string;
  value_key?: string;
};

export type TaxCalcBinaryNode = TaxCalcRoundingNode & {
  op: 'add' | 'sub' | 'mul' | 'div';
  node_id: string;
  left: TaxCalcExpr;
  right: TaxCalcExpr;
};

export type TaxCalcNaryNode = TaxCalcRoundingNode & {
  op: 'min' | 'max';
  node_id: string;
  args: TaxCalcExpr[];
};

export type TaxCalcClampNode = TaxCalcRoundingNode & {
  op: 'clamp';
  node_id: string;
  value: TaxCalcExpr;
  min: TaxCalcExpr;
  max: TaxCalcExpr;
};

export type TaxCalcIfNode = TaxCalcRoundingNode & {
  op: 'if';
  node_id: string;
  cond: TaxCalcExpr;
  then: TaxCalcExpr;
  else: TaxCalcExpr;
};

export type TaxCalcPercentOfNode = TaxCalcRoundingNode & {
  op: 'percent_of';
  node_id: string;
  base: TaxCalcExpr;
  rate: TaxCalcExpr;
};

export type TaxCalcRoundNode = TaxCalcRoundingNode & {
  op: 'round';
  node_id: string;
  value: TaxCalcExpr;
};

export type TaxCalcBracketApplyNode = TaxCalcRoundingNode & {
  op: 'bracket_apply';
  node_id: string;
  amount: TaxCalcExpr;
  table: TaxCalcBracketTable;
};

export type TaxCalcExpr =
  | TaxCalcConstNode
  | TaxCalcInputNode
  | TaxCalcLegalValueNode
  | TaxCalcBinaryNode
  | TaxCalcNaryNode
  | TaxCalcClampNode
  | TaxCalcIfNode
  | TaxCalcPercentOfNode
  | TaxCalcRoundNode
  | TaxCalcBracketApplyNode;

export type TaxCalcValueRef =
  | { kind: 'input'; key: string }
  | { kind: 'legal_value'; legal_value_version_id: string; value_key: string }
  | { kind: 'const' }
  | { kind: 'node'; node_id: string };

export type TaxCalcTraceInput = {
  role: string;
  value: TaxCalcTypedValue;
  ref: TaxCalcValueRef;
};

export type TaxCalcTraceEntry = {
  node_id: string;
  op: TaxCalcOp;
  inputs: TaxCalcTraceInput[];
  output: TaxCalcTypedValue;
  rounding?: TaxCalcRounding;
  rounding_source?: TaxCalcRoundingSource;
  legal_value?: { legal_value_version_id: string; value_key: string };
};

export type TaxCalcBlocked = {
  code: TaxCalcBlockedCode;
  message: string;
  node_id?: string;
};

export type TaxCalcEvaluationInput = {
  expression: unknown;
  facts?: unknown;
  legal_values?: unknown;
  default_rounding?: unknown;
};

export type TaxCalcEvaluationOk = {
  ok: true;
  result: TaxCalcTypedValue;
  trace: TaxCalcTraceEntry[];
  input_checksum: string;
  result_checksum: string;
};

export type TaxCalcEvaluationBlocked = {
  ok: false;
  blocked: TaxCalcBlocked;
  trace: TaxCalcTraceEntry[];
  input_checksum: string;
  result_checksum: string;
};

export type TaxCalcEvaluation = TaxCalcEvaluationOk | TaxCalcEvaluationBlocked;

export function isTaxCalcValueType(value: unknown): value is TaxCalcValueType {
  return typeof value === 'string' && (TAX_CALCULATION_VALUE_TYPES as readonly string[]).includes(value);
}

export function isTaxCalcOp(value: unknown): value is TaxCalcOp {
  return typeof value === 'string' && (TAX_CALCULATION_OPS as readonly string[]).includes(value);
}

export function isTaxCalcRoundingMode(value: unknown): value is TaxCalcRoundingMode {
  return typeof value === 'string' && (TAX_CALCULATION_ROUNDING_MODES as readonly string[]).includes(value);
}

export function isTaxCalcCanonicalDate(value: unknown): value is string {
  return isCanonicalIsoDate(value);
}
