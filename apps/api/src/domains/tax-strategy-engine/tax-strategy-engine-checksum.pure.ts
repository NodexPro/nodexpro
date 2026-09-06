import { createHash } from 'node:crypto';

export type TaxStrategyChecksumInput = {
  country_code: string;
  title: string;
  requires_professional_judgment: boolean;
  exclusive_group_id: string | null;
  required_tax_rule_version_ids: readonly string[];
  prohibited_tax_rule_version_ids: readonly string[];
  calculation_definition_version_ids: readonly string[];
  authored_metadata_json: Record<string, unknown>;
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

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].map((id) => id.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function canonicalizeAuthoredMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return sortKeys(value) as Record<string, unknown>;
}

/** Canonical JSON for persisted strategy_checksum. Array order of pin ids is normalized; object keys sorted. */
export function canonicalizeTaxStrategyChecksumPayload(input: TaxStrategyChecksumInput): string {
  const authored = isPlainJsonObject(input.authored_metadata_json) ? input.authored_metadata_json : {};
  return JSON.stringify({
    authored_metadata_json: canonicalizeAuthoredMetadata(authored),
    calculation_definition_version_ids: sortedIds(input.calculation_definition_version_ids),
    country_code: input.country_code.trim().toUpperCase(),
    exclusive_group_id: input.exclusive_group_id,
    prohibited_tax_rule_version_ids: sortedIds(input.prohibited_tax_rule_version_ids),
    required_tax_rule_version_ids: sortedIds(input.required_tax_rule_version_ids),
    requires_professional_judgment: input.requires_professional_judgment === true,
    title: input.title,
  });
}

export function taxStrategyChecksum(input: TaxStrategyChecksumInput): string {
  return createHash('sha256').update(canonicalizeTaxStrategyChecksumPayload(input), 'utf8').digest('hex');
}

export type TaxStrategyDraftChecksumState = {
  country_code: string;
  title: string;
  requires_professional_judgment: boolean;
  exclusive_group_id: string | null;
  authored_metadata_json: Record<string, unknown>;
  rule_pins: ReadonlyArray<{ pin_role: string; tax_rule_version_id: string }>;
  calculation_pins: ReadonlyArray<{ calculation_definition_version_id: string }>;
};

/** Checksum from persisted draft pins + authored fields. Does not hash windows, status, or lineage. */
export function taxStrategyChecksumFromDraftState(state: TaxStrategyDraftChecksumState): string {
  return taxStrategyChecksum({
    country_code: state.country_code,
    title: state.title,
    requires_professional_judgment: state.requires_professional_judgment,
    exclusive_group_id: state.exclusive_group_id,
    required_tax_rule_version_ids: state.rule_pins
      .filter((pin) => pin.pin_role === 'required')
      .map((pin) => pin.tax_rule_version_id),
    prohibited_tax_rule_version_ids: state.rule_pins
      .filter((pin) => pin.pin_role === 'prohibited')
      .map((pin) => pin.tax_rule_version_id),
    calculation_definition_version_ids: state.calculation_pins.map(
      (pin) => pin.calculation_definition_version_id,
    ),
    authored_metadata_json: state.authored_metadata_json,
  });
}
