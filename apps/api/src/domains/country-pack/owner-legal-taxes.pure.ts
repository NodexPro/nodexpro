/**
 * Platform Owner Taxes — projection of Country Pack legal values.
 * Not a second tax database: VAT / Income Tax / National Insurance rows only.
 */

export const OWNER_TAX_CATEGORIES = ['VAT', 'Income Tax', 'National Insurance'] as const;
export type OwnerTaxCategory = (typeof OWNER_TAX_CATEGORIES)[number];

export const OWNER_TAX_VALUE_TYPES = ['percentage', 'number'] as const;
export const OWNER_TAX_CONDITION_KEYS = ['seller_context', 'applies_to', 'tax_status'] as const;
export const OWNER_TAX_SELLER_CONTEXTS = ['nodexpro_platform'] as const;
export const OWNER_TAX_APPLIES_TO = ['platform_sales', 'extra_staff_seats', 'module_sales'] as const;
export const OWNER_TAX_STATUSES = ['standard', 'exempt', 'zero'] as const;
export const OWNER_TAXES_AGGREGATE_KEY = 'owner_taxes_aggregate' as const;

const BLOCKED_CONDITION_KEYS = ['script', 'code', 'eval', 'fn', 'function', 'javascript', 'expr', 'expression'];

export type TaxConditionObject = {
  seller_context?: (typeof OWNER_TAX_SELLER_CONTEXTS)[number];
  applies_to?: (typeof OWNER_TAX_APPLIES_TO)[number];
  tax_status?: (typeof OWNER_TAX_STATUSES)[number];
};

export type TaxRatePayload = {
  rate: number;
  calculation_type: 'percentage';
  name_he: string;
  name_en: string;
  description_he: string;
  description_en: string;
  conditions: TaxConditionObject | null;
};

export function isOwnerTaxCategory(raw: unknown): raw is OwnerTaxCategory {
  return OWNER_TAX_CATEGORIES.includes(String(raw ?? '').trim() as OwnerTaxCategory);
}

export function isOwnerTaxLegalValueRow(row: Record<string, unknown>): boolean {
  return isOwnerTaxCategory(row.category);
}

export function parseTaxRateFraction(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw < 0) return null;
    return raw > 1 ? raw / 100 : raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.replace('%', '').trim());
    if (!Number.isFinite(n) || n < 0) return null;
    return n > 1 ? n / 100 : n;
  }
  return null;
}

export function parseTaxRatePayload(payload: unknown): TaxRatePayload | null {
  if (payload == null) return null;
  if (typeof payload === 'number' && Number.isFinite(payload)) {
    const rate = parseTaxRateFraction(payload);
    if (rate == null || rate > 1) return null;
    return {
      rate,
      calculation_type: 'percentage',
      name_he: '',
      name_en: '',
      description_he: '',
      description_en: '',
      conditions: null,
    };
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) return null;
  const o = payload as Record<string, unknown>;
  const rate = parseTaxRateFraction(o.rate ?? o.value ?? o.percent ?? o.percentage);
  if (rate == null || rate > 1) return null;
  const conditions = o.conditions == null ? null : parseTaxConditions(o.conditions);
  if (o.conditions != null && conditions === undefined) return null;
  return {
    rate,
    calculation_type: 'percentage',
    name_he: String(o.name_he ?? '').trim(),
    name_en: String(o.name_en ?? '').trim(),
    description_he: String(o.description_he ?? '').trim(),
    description_en: String(o.description_en ?? '').trim(),
    conditions: conditions ?? null,
  };
}

/** Returns undefined when the object is present but invalid (caller should reject). */
export function parseTaxConditions(raw: unknown): TaxConditionObject | null | undefined {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return parseTaxConditions(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.some((key) => BLOCKED_CONDITION_KEYS.includes(key.toLowerCase()))) return undefined;
  for (const key of keys) {
    if (!OWNER_TAX_CONDITION_KEYS.includes(key as (typeof OWNER_TAX_CONDITION_KEYS)[number])) return undefined;
  }
  const seller = o.seller_context == null ? undefined : String(o.seller_context).trim();
  const applies = o.applies_to == null ? undefined : String(o.applies_to).trim();
  const status = o.tax_status == null ? undefined : String(o.tax_status).trim();
  if (seller && !OWNER_TAX_SELLER_CONTEXTS.includes(seller as (typeof OWNER_TAX_SELLER_CONTEXTS)[number])) {
    return undefined;
  }
  if (applies && !OWNER_TAX_APPLIES_TO.includes(applies as (typeof OWNER_TAX_APPLIES_TO)[number])) {
    return undefined;
  }
  if (status && !OWNER_TAX_STATUSES.includes(status as (typeof OWNER_TAX_STATUSES)[number])) {
    return undefined;
  }
  const out: TaxConditionObject = {};
  if (seller) out.seller_context = seller as TaxConditionObject['seller_context'];
  if (applies) out.applies_to = applies as TaxConditionObject['applies_to'];
  if (status) out.tax_status = status as TaxConditionObject['tax_status'];
  return out;
}

export function assembleTaxRatePayload(input: Record<string, unknown>): TaxRatePayload | null {
  const rate = parseTaxRateFraction(input.rate);
  if (rate == null || rate > 1) return null;
  const conditions = parseTaxConditions(input.conditions);
  if (input.conditions != null && input.conditions !== '' && conditions === undefined) return null;
  return {
    rate,
    calculation_type: 'percentage',
    name_he: String(input.name_he ?? '').trim(),
    name_en: String(input.name_en ?? '').trim(),
    description_he: String(input.description_he ?? '').trim(),
    description_en: String(input.description_en ?? '').trim(),
    conditions: conditions ?? null,
  };
}

export function formatTaxPercentLabel(rate: number): string {
  return `${Math.round(rate * 10000) / 100}%`;
}

export function dayBeforeYmd(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export type OwnerTaxVersionRow = {
  version_id: string;
  ruleset_id: string;
  ruleset_label: string;
  rate_label: string;
  calculation_type: string;
  name_he: string;
  name_en: string;
  description_he: string;
  description_en: string;
  conditions_label: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  is_current: boolean;
};

export type OwnerTaxRuleRow = {
  row_id: string;
  country_code: string;
  country_name: string;
  tax_type: string;
  value_key: string;
  name_he: string;
  name_en: string;
  description_he: string;
  description_en: string;
  rate_label: string;
  calculation_type: string;
  scope: string;
  conditions_label: string;
  effective_from: string;
  effective_to: string | null;
  version_label: string;
  status: string;
  current_version_id: string | null;
  history: OwnerTaxVersionRow[];
  actions: Array<{
    action_key: string;
    enabled: boolean;
    button_label: string;
    disabled_reason: string | null;
    prefill: Record<string, unknown>;
    payload?: Record<string, string>;
  }>;
};

function conditionsLabel(conditions: TaxConditionObject | null, empty: string): string {
  if (!conditions) return empty;
  const parts = [
    conditions.seller_context,
    conditions.applies_to,
    conditions.tax_status,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : empty;
}

function pickName(payload: TaxRatePayload | null, fallback: string, lang: 'he' | 'en'): string {
  if (!payload) return fallback;
  const named = lang === 'he' ? payload.name_he || payload.name_en : payload.name_en || payload.name_he;
  return named || fallback;
}

function pickDescription(payload: TaxRatePayload | null, fallback: string, lang: 'he' | 'en'): string {
  if (!payload) return fallback;
  const named =
    lang === 'he' ? payload.description_he || payload.description_en : payload.description_en || payload.description_he;
  return named || fallback;
}

export function buildOwnerTaxRuleRows(input: {
  legalRows: Array<Record<string, unknown>>;
  asOfDate: string;
  lang: 'he' | 'en';
  copy: Record<string, string>;
}): OwnerTaxRuleRow[] {
  const today = input.asOfDate;
  const empty = input.copy.none ?? '—';
  const out: OwnerTaxRuleRow[] = [];
  for (const row of input.legalRows) {
    if (!isOwnerTaxLegalValueRow(row)) continue;
    const versions = Array.isArray(row.versions) ? (row.versions as Array<Record<string, unknown>>) : [];
    const history: OwnerTaxVersionRow[] = versions
      .map((ver) => {
        const parsed = parseTaxRatePayload(ver.value_payload_json);
        const from = String(ver.effective_from ?? '');
        const to = ver.effective_to == null ? null : String(ver.effective_to);
        const status = String(ver.status ?? '');
        const isCurrent =
          status === 'active' && from <= today && (to == null || to >= today);
        return {
          version_id: String(ver.id ?? ''),
          ruleset_id: String(ver.country_pack_ruleset_id ?? ''),
          ruleset_label: String(ver.country_pack_ruleset_id ?? empty),
          rate_label: parsed ? formatTaxPercentLabel(parsed.rate) : empty,
          calculation_type: parsed?.calculation_type ?? String(row.value_type ?? empty),
          name_he: parsed?.name_he ?? '',
          name_en: parsed?.name_en ?? '',
          description_he: parsed?.description_he ?? '',
          description_en: parsed?.description_en ?? '',
          conditions_label: conditionsLabel(parsed?.conditions ?? null, empty),
          effective_from: from,
          effective_to: to,
          status,
          is_current: isCurrent,
        };
      })
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    const current = history.find((item) => item.is_current) ?? null;
    const fallbackLabel = String(row.label ?? row.value_key ?? '');
    const parsedCurrent = current
      ? parseTaxRatePayload(
          versions.find((ver) => String(ver.id ?? '') === current.version_id)?.value_payload_json,
        )
      : parseTaxRatePayload(row.current_active_value);
    const valueKey = String(row.value_key ?? '');
    const countryCode = String(row.country_code ?? '').toUpperCase();
    const currentId = current?.version_id ?? null;
    const draft = history.find((item) => item.status === 'draft');
    out.push({
      row_id: String(row.id ?? `${countryCode}:${valueKey}`),
      country_code: countryCode,
      country_name: countryCode === 'IL' ? (input.lang === 'he' ? 'ישראל' : 'Israel') : countryCode,
      tax_type: String(row.category ?? ''),
      value_key: valueKey,
      name_he: pickName(parsedCurrent, fallbackLabel, 'he'),
      name_en: pickName(parsedCurrent, fallbackLabel, 'en'),
      description_he: pickDescription(parsedCurrent, String(row.usage_hint ?? ''), 'he'),
      description_en: pickDescription(parsedCurrent, String(row.usage_hint ?? ''), 'en'),
      rate_label: current?.rate_label ?? empty,
      calculation_type: current?.calculation_type ?? String(row.value_type ?? empty),
      scope: String(row.module_scope ?? empty),
      conditions_label: current?.conditions_label ?? empty,
      effective_from: current?.effective_from ?? empty,
      effective_to: current?.effective_to ?? null,
      version_label: current ? `${current.effective_from} · ${current.status}` : empty,
      status: String(current?.status ?? row.status ?? empty),
      current_version_id: currentId,
      history,
      actions: [
        {
          action_key: 'schedule_tax_rate_change',
          enabled: true,
          button_label: input.copy.change_rate_from_date,
          disabled_reason: null,
          payload: {
            country_code: 'ISO 3166-1 alpha-2',
            value_key: 'string',
            effective_from: 'YYYY-MM-DD',
            rate: 'enter 18 for 18 percent (stored as 0.18); values over 100 are rejected',
            name_he: 'optional',
            name_en: 'optional',
            description_he: 'optional',
            description_en: 'optional',
            conditions: 'optional JSON object seller_context|applies_to|tax_status',
            owner_surface: 'taxes',
          },
          prefill: {
            country_code: countryCode,
            value_key: valueKey,
            owner_surface: 'taxes',
            effective_from: today,
            status: 'active',
          },
        },
        {
          action_key: 'create_legal_value_version',
          enabled: true,
          button_label: input.copy.new_future_version,
          disabled_reason: null,
          payload: {
            country_code: 'ISO 3166-1 alpha-2',
            value_key: 'string',
            effective_from: 'YYYY-MM-DD',
            effective_to: 'optional YYYY-MM-DD',
            rate: 'enter 18 for 18 percent (stored as 0.18); values over 100 are rejected',
            name_he: 'optional',
            name_en: 'optional',
            status: 'draft',
            owner_surface: 'taxes',
          },
          prefill: {
            country_code: countryCode,
            value_key: valueKey,
            owner_surface: 'taxes',
            status: 'draft',
          },
        },
        {
          action_key: 'activate_legal_value_version',
          enabled: Boolean(draft),
          button_label: input.copy.activate_version,
          disabled_reason: draft ? null : input.copy.no_draft_version,
          payload: {
            legal_value_version_id: 'uuid',
            owner_surface: 'taxes',
          },
          prefill: {
            legal_value_version_id: draft?.version_id ?? '',
            owner_surface: 'taxes',
          },
        },
        {
          action_key: 'update_legal_value_metadata',
          enabled: true,
          button_label: input.copy.edit_metadata,
          disabled_reason: null,
          payload: {
            country_code: 'ISO 3166-1 alpha-2',
            value_key: 'string',
            label: 'string',
            usage_hint: 'optional string',
            owner_note: 'optional string',
            owner_surface: 'taxes',
          },
          prefill: {
            country_code: countryCode,
            value_key: valueKey,
            owner_surface: 'taxes',
            label: fallbackLabel,
            category: String(row.category ?? ''),
            module_scope: String(row.module_scope ?? ''),
            usage_hint: String(row.usage_hint ?? ''),
          },
        },
      ],
    });
  }
  out.sort((a, b) => {
    const c = a.country_code.localeCompare(b.country_code);
    if (c !== 0) return c;
    const t = a.tax_type.localeCompare(b.tax_type);
    if (t !== 0) return t;
    return a.value_key.localeCompare(b.value_key);
  });
  return out;
}

export function ownerTaxCreateLegalValuePrefill(): Record<string, unknown> {
  return {
    country_code: 'IL',
    value_key: '',
    label: '',
    category: 'VAT',
    module_scope: 'nodexpro_platform_sales',
    value_type: 'percentage',
    status: 'active',
    owner_surface: 'taxes',
  };
}
