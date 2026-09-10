import { Decimal } from 'decimal.js';
import {
  TAX_CALCULATION_ENGINE_MAX_ROUNDING_SCALE,
  type TaxCalcRounding,
  type TaxCalcRoundingMode,
} from './tax-calculation-engine.types.js';

export const TaxDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -21,
  toExpPos: 21,
  crypto: false,
});

export type TaxDecimalInstance = InstanceType<typeof TaxDecimal>;

const DECIMAL_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const INTEGER_RE = /^-?(0|[1-9]\d*)$/;

const ROUNDING_MODE_MAP: Record<TaxCalcRoundingMode, Decimal.Rounding> = {
  half_up: Decimal.ROUND_HALF_UP,
  half_even: Decimal.ROUND_HALF_EVEN,
  floor: Decimal.ROUND_FLOOR,
  ceil: Decimal.ROUND_CEIL,
};

export function isCanonicalDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_RE.test(value);
}

export function isCanonicalIntegerString(value: unknown): value is string {
  return typeof value === 'string' && INTEGER_RE.test(value);
}

export function parseTaxDecimal(value: unknown, field: string): TaxDecimalInstance {
  if (typeof value === 'number') {
    throw new Error(`${field} must be a decimal string; JS number is not allowed`);
  }
  if (!isCanonicalDecimalString(value)) {
    throw new Error(`${field} must be a canonical decimal string`);
  }
  const parsed = new TaxDecimal(value);
  if (!parsed.isFinite()) {
    throw new Error(`${field} must be a finite decimal`);
  }
  return parsed;
}

export function parseTaxInteger(value: unknown, field: string): TaxDecimalInstance {
  if (typeof value === 'number') {
    throw new Error(`${field} must be an integer string; JS number is not allowed`);
  }
  if (!isCanonicalIntegerString(value)) {
    throw new Error(`${field} must be a canonical integer string`);
  }
  const parsed = new TaxDecimal(value);
  if (!parsed.isFinite() || !parsed.isInteger()) {
    throw new Error(`${field} must be a finite integer`);
  }
  return parsed;
}

export function taxDecimalToCanonicalString(value: TaxDecimalInstance): string {
  if (!value.isFinite()) {
    throw new Error('decimal result is not finite');
  }
  if (value.isZero()) return '0';
  return value.toFixed();
}

export function taxDecimalToScaledString(value: TaxDecimalInstance, scale: number): string {
  if (!value.isFinite()) {
    throw new Error('decimal result is not finite');
  }
  return value.toFixed(scale);
}

export function taxIntegerToCanonicalString(value: TaxDecimalInstance): string {
  if (!value.isFinite() || !value.isInteger()) {
    throw new Error('integer result is not an integer');
  }
  if (value.isZero()) return '0';
  return value.toFixed(0);
}

export function compareTaxDecimals(left: TaxDecimalInstance, right: TaxDecimalInstance): number {
  return left.cmp(right);
}

export function minTaxDecimal(values: TaxDecimalInstance[]): TaxDecimalInstance {
  if (values.length === 0) {
    throw new Error('min requires at least one value');
  }
  return values.reduce((acc, current) => (current.lt(acc) ? current : acc));
}

export function maxTaxDecimal(values: TaxDecimalInstance[]): TaxDecimalInstance {
  if (values.length === 0) {
    throw new Error('max requires at least one value');
  }
  return values.reduce((acc, current) => (current.gt(acc) ? current : acc));
}

export function assertRounding(rounding: TaxCalcRounding, field: string): TaxCalcRounding {
  if (!Number.isInteger(rounding.scale) || rounding.scale < 0 || rounding.scale > TAX_CALCULATION_ENGINE_MAX_ROUNDING_SCALE) {
    throw new Error(`${field}.scale must be an integer 0..${TAX_CALCULATION_ENGINE_MAX_ROUNDING_SCALE}`);
  }
  return rounding;
}

export function roundTaxDecimal(value: TaxDecimalInstance, rounding: TaxCalcRounding): TaxDecimalInstance {
  assertRounding(rounding, 'rounding');
  return value.toDecimalPlaces(rounding.scale, ROUNDING_MODE_MAP[rounding.mode]);
}

export function percentOfTaxDecimal(base: TaxDecimalInstance, rate: TaxDecimalInstance): TaxDecimalInstance {
  return base.times(rate).dividedBy(100);
}
