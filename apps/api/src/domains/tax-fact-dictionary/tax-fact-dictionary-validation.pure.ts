import { badRequest } from '../../shared/errors.js';
import {
  FACT_KEY_SNAKE_CASE,
  RESERVED_FACT_KEY,
  TAX_FACT_VALUE_TYPES,
  type TaxFactValueType,
} from './tax-fact-dictionary.types.js';

const ENUM_MEMBERSHIP_KEYS = new Set([
  'allowed_codes',
  'allowed_values',
  'codes',
  'enum_codes',
  'enum_options',
  'members',
  'options',
  'values',
]);

export type TaxFactCurrencyPolicy = {
  required: boolean;
  allowed_currencies?: string[];
};

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function assertFactKey(value: unknown, field = 'fact_key'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const factKey = value.trim();
  if (factKey === RESERVED_FACT_KEY) {
    throw badRequest(`${RESERVED_FACT_KEY} is reserved and cannot be created`);
  }
  if (!FACT_KEY_SNAKE_CASE.test(factKey)) {
    throw badRequest(`${field} must be snake_case`);
  }
  return factKey;
}

export function assertEnumCode(value: unknown, field = 'code'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const code = value.trim();
  if (!FACT_KEY_SNAKE_CASE.test(code)) {
    throw badRequest(`${field} must be snake_case`);
  }
  return code;
}

export function assertValueType(value: unknown): TaxFactValueType {
  if (typeof value !== 'string' || !(TAX_FACT_VALUE_TYPES as readonly string[]).includes(value)) {
    throw badRequest(`value_type must be one of: ${TAX_FACT_VALUE_TYPES.join(', ')}`);
  }
  return value as TaxFactValueType;
}

export function assertOptionalUnitCode(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('unit_code must be a string');
  const unit = value.trim();
  if (!unit) return null;
  if (!FACT_KEY_SNAKE_CASE.test(unit)) {
    throw badRequest('unit_code must be snake_case');
  }
  return unit;
}

function assertJsonSafe(value: unknown, path: string): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw badRequest(`validation_json${path} cannot use JS floating-point numbers`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (isPlainJsonObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) {
        throw badRequest(`validation_json${path}.${key} cannot be undefined`);
      }
      assertJsonSafe(child, `${path}.${key}`);
    }
    return;
  }
  throw badRequest(`validation_json${path} must be JSON-safe`);
}

export function assertValidationJson(value: unknown, valueType: TaxFactValueType): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isPlainJsonObject(value)) {
    throw badRequest('validation_json must be a JSON object');
  }
  assertJsonSafe(value, '');
  if (valueType === 'enum') {
    for (const key of Object.keys(value)) {
      if (ENUM_MEMBERSHIP_KEYS.has(key)) {
        throw badRequest('validation_json must not define enum membership; use tax_fact_enum_options');
      }
    }
  }
  return value;
}

/**
 * 613 money currency_policy: { required: boolean, allowed_currencies?: ISO-4217[] }.
 * Omitted allowed_currencies means no dictionary-side currency restriction (no implicit default).
 * Present allowed_currencies must be a non-empty ISO-4217 list — empty [] is rejected here.
 */
export function assertCurrencyPolicy(value: unknown, valueType: TaxFactValueType): TaxFactCurrencyPolicy | null {
  if (valueType !== 'money') {
    if (value !== undefined && value !== null) {
      throw badRequest('currency_policy must be null unless value_type is money');
    }
    return null;
  }
  if (!isPlainJsonObject(value)) {
    throw badRequest('money facts require currency_policy { required: boolean, allowed_currencies?: string[] }');
  }
  const extra = Object.keys(value).filter((key) => key !== 'required' && key !== 'allowed_currencies');
  if (extra.length) {
    throw badRequest(`currency_policy contains unsupported keys: ${extra.join(', ')}`);
  }
  if (typeof value.required !== 'boolean') {
    throw badRequest('currency_policy.required must be a boolean');
  }
  const policy: TaxFactCurrencyPolicy = { required: value.required };
  if ('allowed_currencies' in value) {
    const raw = value.allowed_currencies;
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string' || !/^[A-Z]{3}$/.test(item))) {
      throw badRequest('currency_policy.allowed_currencies must be ISO-4217 codes');
    }
    if (raw.length === 0) {
      throw badRequest('currency_policy.allowed_currencies cannot be empty');
    }
    policy.allowed_currencies = [...raw];
  }
  return policy;
}

export function assertEnumReadyForActivation(valueType: TaxFactValueType, enumCodes: readonly string[]): void {
  if (valueType === 'enum' && enumCodes.length < 1) {
    throw badRequest('enum versions require at least one enum option before activation');
  }
  if (valueType !== 'enum' && enumCodes.length > 0) {
    throw badRequest('non-enum versions cannot have enum options');
  }
}

export function assertLocale(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('locale is required');
  }
  const locale = value.trim().toLowerCase();
  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(locale)) {
    throw badRequest('locale must be xx or xx-yy');
  }
  return locale;
}

export function assertStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw badRequest(`${field} must be a non-empty-string array`);
  }
  return value.map((item) => item.trim());
}

export function assertEnumOptionLabels(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isPlainJsonObject(value)) {
    throw badRequest('enum_option_labels must be an object');
  }
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(value)) {
    if (!FACT_KEY_SNAKE_CASE.test(key)) {
      throw badRequest('enum_option_labels keys must be snake_case option codes');
    }
    if (typeof label !== 'string' || !label.trim()) {
      throw badRequest('enum_option_labels values must be non-blank strings');
    }
    out[key] = label.trim();
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;

export type TaxFactAnswerValueContext = {
  value_type: TaxFactValueType;
  enum_codes?: readonly string[];
  currency_policy?: TaxFactCurrencyPolicy | null;
};

function rejectEmptyString(value: unknown): void {
  if (value === '') {
    throw badRequest('empty string is not a valid fact answer', 'EMPTY_STRING_REJECTED');
  }
}

/**
 * Canonical typed tenant answer for a Fact Dictionary version.
 * Rejects JSON null, empty string, and implicit coercion. Preserves false and 0.
 */
export function assertTaxFactAnswerValue(value: unknown, ctx: TaxFactAnswerValueContext): unknown {
  if (value === undefined) {
    throw badRequest('value is required', 'FACT_VALUE_INVALID');
  }
  if (value === null) {
    throw badRequest('null is not a valid fact answer', 'NULL_ANSWER_REJECTED');
  }
  rejectEmptyString(value);

  switch (ctx.value_type) {
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw badRequest('boolean facts require true or false', 'FACT_TYPE_MISMATCH');
      }
      return value;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
        throw badRequest('integer facts require a finite integer', 'FACT_TYPE_MISMATCH');
      }
      return value;
    }
    case 'decimal':
    case 'percentage': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw badRequest(`${ctx.value_type} facts require a finite number`, 'FACT_TYPE_MISMATCH');
      }
      return value;
    }
    case 'date': {
      if (typeof value !== 'string' || !ISO_DATE.test(value)) {
        throw badRequest('date facts require YYYY-MM-DD', 'FACT_TYPE_MISMATCH');
      }
      return value;
    }
    case 'string': {
      if (typeof value !== 'string') {
        throw badRequest('string facts require a string', 'FACT_TYPE_MISMATCH');
      }
      if (value === '') {
        throw badRequest('empty string is not a valid fact answer', 'EMPTY_STRING_REJECTED');
      }
      return value;
    }
    case 'enum': {
      if (typeof value !== 'string') {
        throw badRequest('enum facts require an option code', 'FACT_TYPE_MISMATCH');
      }
      if (value === '') {
        throw badRequest('empty string is not a valid fact answer', 'EMPTY_STRING_REJECTED');
      }
      const codes = ctx.enum_codes ?? [];
      if (!codes.includes(value)) {
        throw badRequest('enum value is not an allowed option', 'FACT_TYPE_MISMATCH');
      }
      return value;
    }
    case 'money': {
      if (!isPlainJsonObject(value)) {
        throw badRequest('money facts require { amount, currency? }', 'FACT_TYPE_MISMATCH');
      }
      if (typeof value.amount !== 'number' || !Number.isFinite(value.amount)) {
        throw badRequest('money.amount must be a finite number', 'FACT_TYPE_MISMATCH');
      }
      const policy = ctx.currency_policy;
      const currencyRaw = value.currency;
      if (policy?.required) {
        if (typeof currencyRaw !== 'string' || !ISO_CURRENCY.test(currencyRaw)) {
          throw badRequest('money.currency is required as ISO-4217', 'FACT_TYPE_MISMATCH');
        }
      } else if (currencyRaw !== undefined && currencyRaw !== null) {
        if (typeof currencyRaw !== 'string' || !ISO_CURRENCY.test(currencyRaw)) {
          throw badRequest('money.currency must be ISO-4217 when present', 'FACT_TYPE_MISMATCH');
        }
      }
      if (typeof currencyRaw === 'string' && policy?.allowed_currencies?.length) {
        if (!policy.allowed_currencies.includes(currencyRaw)) {
          throw badRequest('money.currency is not allowed by the fact definition', 'FACT_TYPE_MISMATCH');
        }
      }
      const out: Record<string, unknown> = { amount: value.amount };
      if (typeof currencyRaw === 'string') out.currency = currencyRaw;
      return out;
    }
    default:
      throw badRequest('unsupported value_type', 'FACT_TYPE_MISMATCH');
  }
}
