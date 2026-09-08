import { createHash } from 'node:crypto';

export type TaxFactDefinitionChecksumInput = {
  fact_key: string;
  country_code: string | null;
  value_type: string;
  unit_code: string | null;
  currency_policy: Record<string, unknown> | null;
  validation_json: Record<string, unknown>;
  enum_codes: readonly string[];
};

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

function normalizeCountryCode(value: string | null): string | null {
  if (value == null || !value.trim()) return null;
  return value.trim().toUpperCase();
}

function sortedEnumCodes(codes: readonly string[]): string[] {
  return [...codes]
    .map((code) => code.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function canonicalizeCurrencyPolicy(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (value == null) return null;
  const out: Record<string, unknown> = {};
  if ('allowed_currencies' in value) {
    const raw = value.allowed_currencies;
    const codes = Array.isArray(raw)
      ? raw.map((item) => String(item).trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))
      : raw;
    out.allowed_currencies = codes;
  }
  if ('required' in value) {
    out.required = value.required === true;
  }
  return sortKeys(out) as Record<string, unknown>;
}

/**
 * Canonical JSON for persisted definition_checksum.
 * Includes only semantic content. Presentation, titles, notes, windows, status, and ids are excluded.
 */
export function canonicalizeTaxFactDefinitionChecksumPayload(input: TaxFactDefinitionChecksumInput): string {
  const validation = isPlainJsonObject(input.validation_json) ? input.validation_json : {};
  return JSON.stringify({
    country_code: normalizeCountryCode(input.country_code),
    currency_policy: canonicalizeCurrencyPolicy(input.currency_policy),
    enum_codes: sortedEnumCodes(input.enum_codes),
    fact_key: input.fact_key.trim(),
    unit_code: input.unit_code == null || !input.unit_code.trim() ? null : input.unit_code.trim(),
    validation_json: sortKeys(validation),
    value_type: input.value_type.trim(),
  });
}

export function taxFactDefinitionSemanticSnapshot(
  input: TaxFactDefinitionChecksumInput,
): Record<string, unknown> {
  return JSON.parse(canonicalizeTaxFactDefinitionChecksumPayload(input)) as Record<string, unknown>;
}

export function taxFactDefinitionChecksum(input: TaxFactDefinitionChecksumInput): string {
  return createHash('sha256').update(canonicalizeTaxFactDefinitionChecksumPayload(input), 'utf8').digest('hex');
}
