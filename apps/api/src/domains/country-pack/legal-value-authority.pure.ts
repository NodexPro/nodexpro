import { badRequest } from '../../shared/errors.js';

export const LEGAL_VALUE_AUTHORITY_SCHEMA_NOT_APPLIED = 'legal_value_authority_schema_not_applied';

export const LEGAL_VALUE_AUTHOR_COMMAND = 'author_country_legal_value';
export const PIN_LEGAL_VALUE_VERSION_AUTHORITY = 'pin_legal_value_version_authority';
export const UNPIN_LEGAL_VALUE_VERSION_AUTHORITY = 'unpin_legal_value_version_authority';

export const LEGAL_VALUE_VALUE_TYPES = [
  'number',
  'percentage',
  'boolean',
  'string',
  'json',
  'money',
  'date',
] as const;

export const LEGAL_VALUE_CATEGORIES = [
  'VAT',
  'Income Tax',
  'National Insurance',
  'Credit Points',
  'Pricing',
  'Reports',
  'Calendar',
  'Modules',
] as const;

export const TAX_BRAIN_LEGAL_VALUE_MODULE_SCOPE = 'tax_knowledge';

export type LegalValueAuthorityPin = {
  id: string;
  country_legal_value_version_id: string;
  country_code: string;
  tax_rule_version_id: string;
};

export type LegalBasisPickerOption = {
  tax_rule_version_id: string;
  tax_rule_id: string;
  domain_id: string | null;
  source_id: string | null;
  node_id: string | null;
  label: string;
  domain_title: string | null;
  source_title: string | null;
  node_title: string | null;
  rule_title: string;
  version_no: number | null;
  version_status: string;
};

export type LegalValueWorkspaceCard = {
  id: string;
  country_code: string;
  country_name: string;
  title: string;
  current_value_display: string;
  upcoming_value_display: string | null;
  effective_display: string;
  legal_basis_display: string[];
  status_label: string;
  filter_domain_ids: string[];
  filter_source_ids: string[];
  filter_status: string;
  filter_effective_years: string[];
  allowed_actions: Array<{ action_key: string; enabled: boolean; button_label: string }>;
  technical: Record<string, string>;
  versions: Array<{
    id: string;
    status: string;
    status_label: string;
    effective_from: string;
    effective_to: string | null;
    value_display: string;
    legal_basis_display: string[];
    is_current: boolean;
    is_upcoming: boolean;
  }>;
};

export function generateLegalValueKey(label: string, id: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const suffix = id.replace(/-/g, '').slice(0, 10);
  return slug ? `lv_${slug}_${suffix}` : `lv_${suffix}`;
}

export function assembleAuthorValuePayload(valueType: string, initialValue: unknown): unknown {
  if (initialValue !== undefined && initialValue !== null && typeof initialValue === 'object' && !Array.isArray(initialValue)) {
    return initialValue;
  }
  if (valueType === 'json') {
    if (typeof initialValue === 'string') {
      try {
        return JSON.parse(initialValue);
      } catch {
        throw badRequest('initial_value must be valid JSON for value_type json');
      }
    }
    return initialValue ?? {};
  }
  if (valueType === 'boolean') {
    if (typeof initialValue === 'boolean') return initialValue;
    if (initialValue === 'true' || initialValue === '1') return true;
    if (initialValue === 'false' || initialValue === '0') return false;
    throw badRequest('initial_value must be a boolean');
  }
  if (valueType === 'number' || valueType === 'percentage' || valueType === 'money') {
    const n = typeof initialValue === 'number' ? initialValue : Number(initialValue);
    if (!Number.isFinite(n)) throw badRequest('initial_value must be a number');
    return n;
  }
  if (initialValue == null || String(initialValue).trim() === '') {
    throw badRequest('initial_value is required');
  }
  return String(initialValue);
}

export function formatLegalValueDisplay(valueType: string, payload: unknown): string {
  if (payload == null) return '—';
  if (typeof payload === 'number') {
    if (valueType === 'percentage') return `${payload}%`;
    if (valueType === 'money') return String(payload);
    return String(payload);
  }
  if (typeof payload === 'boolean') return payload ? 'Yes' : 'No';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload && 'amount' in payload) {
    const amount = (payload as { amount?: unknown }).amount;
    const currency = (payload as { currency?: unknown }).currency;
    return currency ? `${String(amount)} ${String(currency)}` : String(amount ?? '—');
  }
  if (typeof payload === 'object' && payload && 'value' in payload) {
    return formatLegalValueDisplay(valueType, (payload as { value?: unknown }).value);
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return '—';
  }
}

export function formatEffectiveDisplay(from: string | null | undefined, to: string | null | undefined): string {
  const start = from ? String(from) : '—';
  const end = to ? String(to) : 'open';
  return `${start} – ${end}`;
}

export function assertDraftLegalValueVersion(status: string, action: string): void {
  if (status !== 'draft') {
    throw badRequest(`${action} is allowed only on draft legal value versions`);
  }
}

export function assertLegalValueVersionPayloadMutable(status: string): void {
  if (status !== 'draft') {
    throw badRequest('Active or historical legal value versions cannot be overwritten; create a new version');
  }
}

export function assertCountriesMatch(left: string, right: string, message: string): void {
  if (left.toUpperCase() !== right.toUpperCase()) {
    throw badRequest(message);
  }
}

export function buildLegalBasisPathLabel(parts: Array<string | null | undefined>): string {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join(' → ');
}

export function yearFromDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const year = String(value).slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}
