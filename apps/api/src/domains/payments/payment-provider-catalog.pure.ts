export const PAYMENT_SCENARIOS = ['PLATFORM_BILLING', 'OFFICE_EXTERNAL', 'OFFICE_EMBEDDED'] as const;
export type PaymentScenario = (typeof PAYMENT_SCENARIOS)[number];

export const PAYMENT_ADAPTER_STATUSES = ['catalog_only', 'ready'] as const;
export type PaymentAdapterStatus = (typeof PAYMENT_ADAPTER_STATUSES)[number];

export type PaymentProviderCapabilities = {
  hosted_checkout: boolean;
  payment_links: boolean;
  recurring_billing: boolean;
  refunds: boolean;
  webhook_verification: boolean;
  merchant_onboarding: boolean;
  connected_accounts: boolean;
  split_payments: boolean;
  international_cards: boolean;
  three_d_secure: boolean;
  platform_fee: boolean;
};

export type PaymentProviderCatalogRow = {
  code: string;
  display_name: string;
  display_name_he: string;
  adapter_status: PaymentAdapterStatus;
  supported_scenarios: PaymentScenario[];
  supported_countries: string[];
  environment_modes: Array<'test' | 'live'>;
  capabilities: PaymentProviderCapabilities;
  notes: string;
  logo_url: string;
  description_en: string;
  description_he: string;
  show_in_billing: boolean;
  allow_new_connections: boolean;
  commission_percent: number | null;
  connection_fee_amount: number | null;
  monthly_fee_amount: number | null;
  fee_currency: string;
  payout_terms_en: string;
  payout_terms_he: string;
  terms_url: string;
};

const EMPTY_CAPABILITIES: PaymentProviderCapabilities = {
  hosted_checkout: false,
  payment_links: false,
  recurring_billing: false,
  refunds: false,
  webhook_verification: false,
  merchant_onboarding: false,
  connected_accounts: false,
  split_payments: false,
  international_cards: false,
  three_d_secure: false,
  platform_fee: false,
};

export function defaultPaymentCapabilities(): PaymentProviderCapabilities {
  return { ...EMPTY_CAPABILITIES };
}

export function isReadyPaymentAdapter(status: string | null | undefined): boolean {
  return String(status ?? '').trim() === 'ready';
}

export function checkoutAvailableForScenario(input: {
  adapterStatus: string | null | undefined;
  supportedScenarios: string[];
  scenario: PaymentScenario;
}): boolean {
  return isReadyPaymentAdapter(input.adapterStatus) && input.supportedScenarios.includes(input.scenario);
}

function asScenarios(raw: string[] | null | undefined): PaymentScenario[] {
  return (raw ?? []).filter((item): item is PaymentScenario => (PAYMENT_SCENARIOS as readonly string[]).includes(item));
}

function asMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function mapCatalogRow(row: {
  code: string;
  display_name: string;
  display_name_he?: string | null;
  adapter_status: string;
  supported_scenarios?: string[] | null;
  supported_countries?: string[] | null;
  environment_modes?: string[] | null;
  capability_hosted_checkout?: boolean;
  capability_payment_links?: boolean;
  capability_recurring_billing?: boolean;
  capability_refunds?: boolean;
  capability_webhook_verification?: boolean;
  capability_merchant_onboarding?: boolean;
  capability_connected_accounts?: boolean;
  capability_split_payments?: boolean;
  capability_international_cards?: boolean;
  capability_three_d_secure?: boolean;
  capability_platform_fee?: boolean;
  notes?: string | null;
  logo_url?: string | null;
  description_en?: string | null;
  description_he?: string | null;
  show_in_billing?: boolean | null;
  allow_new_connections?: boolean | null;
  commission_percent?: number | string | null;
  connection_fee_amount?: number | string | null;
  monthly_fee_amount?: number | string | null;
  fee_currency?: string | null;
  payout_terms_en?: string | null;
  payout_terms_he?: string | null;
  terms_url?: string | null;
}): PaymentProviderCatalogRow {
  const status = row.adapter_status === 'ready' ? 'ready' : 'catalog_only';
  return {
    code: row.code,
    display_name: row.display_name,
    display_name_he: String(row.display_name_he ?? ''),
    adapter_status: status,
    supported_scenarios: asScenarios(row.supported_scenarios),
    supported_countries: row.supported_countries ?? [],
    environment_modes: (row.environment_modes ?? ['test', 'live']).filter(
      (item): item is 'test' | 'live' => item === 'test' || item === 'live',
    ),
    capabilities: {
      hosted_checkout: row.capability_hosted_checkout === true,
      payment_links: row.capability_payment_links === true,
      recurring_billing: row.capability_recurring_billing === true,
      refunds: row.capability_refunds === true,
      webhook_verification: row.capability_webhook_verification === true,
      merchant_onboarding: row.capability_merchant_onboarding === true,
      connected_accounts: row.capability_connected_accounts === true,
      split_payments: row.capability_split_payments === true,
      international_cards: row.capability_international_cards === true,
      three_d_secure: row.capability_three_d_secure === true,
      platform_fee: row.capability_platform_fee === true,
    },
    notes: String(row.notes ?? ''),
    logo_url: String(row.logo_url ?? '').trim(),
    description_en: String(row.description_en ?? ''),
    description_he: String(row.description_he ?? ''),
    show_in_billing: row.show_in_billing !== false,
    allow_new_connections: row.allow_new_connections === true,
    commission_percent: asMoney(row.commission_percent),
    connection_fee_amount: asMoney(row.connection_fee_amount),
    monthly_fee_amount: asMoney(row.monthly_fee_amount),
    fee_currency: String(row.fee_currency ?? 'ILS').trim().toUpperCase() || 'ILS',
    payout_terms_en: String(row.payout_terms_en ?? ''),
    payout_terms_he: String(row.payout_terms_he ?? ''),
    terms_url: String(row.terms_url ?? '').trim(),
  };
}

export function publicProviderView(row: PaymentProviderCatalogRow): PaymentProviderCatalogRow & {
  connectable: boolean;
  secrets_present: false;
} {
  return {
    ...row,
    connectable: row.adapter_status === 'ready',
    secrets_present: false,
  };
}

export function officeSeesProvider(
  row: PaymentProviderCatalogRow,
  connectedProviderCode: string | null | undefined,
): boolean {
  if (connectedProviderCode && connectedProviderCode === row.code) return true;
  return row.show_in_billing === true;
}

export function officeCanStartNewConnection(row: PaymentProviderCatalogRow): boolean {
  return row.show_in_billing === true && row.allow_new_connections === true && row.adapter_status === 'ready';
}

export function officeCanCollectSecrets(row: PaymentProviderCatalogRow): boolean {
  return row.adapter_status === 'ready';
}

export function hidingProviderKeepsExistingConnection(): true {
  return true;
}

export function localizedProviderName(row: PaymentProviderCatalogRow, lang: 'en' | 'he'): string {
  if (lang === 'he' && row.display_name_he.trim()) return row.display_name_he;
  return row.display_name;
}

export function localizedProviderDescription(row: PaymentProviderCatalogRow, lang: 'en' | 'he'): string {
  return lang === 'he' ? row.description_he : row.description_en;
}

export function localizedPayoutTerms(row: PaymentProviderCatalogRow, lang: 'en' | 'he'): string {
  return lang === 'he' ? row.payout_terms_he : row.payout_terms_en;
}

export function officeCredentialFields(row: PaymentProviderCatalogRow, scenario: PaymentScenario): Array<{
  key: string;
  secret: boolean;
}> {
  if (!officeCanCollectSecrets(row)) return [];
  if (scenario === 'OFFICE_EXTERNAL') {
    return [
      { key: 'merchant_id', secret: false },
      { key: 'api_key', secret: true },
    ];
  }
  return [];
}

export function parseProviderCode(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return /^[a-z][a-z0-9_]{1,31}$/.test(value) ? value : null;
}

export function parseUpsertPaymentProviderPayload(payload: Record<string, unknown>): {
  code: string;
  display_name: string;
  display_name_he: string;
  supported_scenarios: PaymentScenario[];
  logo_url: string;
  description_en: string;
  description_he: string;
  show_in_billing: boolean;
  allow_new_connections: boolean;
  commission_percent: number | null;
  connection_fee_amount: number | null;
  monthly_fee_amount: number | null;
  fee_currency: string;
  payout_terms_en: string;
  payout_terms_he: string;
  terms_url: string;
} | { error: string } {
  const code = parseProviderCode(payload.code);
  if (!code) return { error: 'INVALID_PROVIDER_CODE' };
  const display_name = String(payload.display_name ?? '').trim();
  if (!display_name) return { error: 'DISPLAY_NAME_REQUIRED' };
  const scenarios = asScenarios(Array.isArray(payload.supported_scenarios) ? payload.supported_scenarios.map(String) : []);
  if (!scenarios.length) return { error: 'SCENARIOS_REQUIRED' };
  const logo_url = String(payload.logo_url ?? '').trim();
  if (logo_url && !/^https?:\/\//i.test(logo_url)) return { error: 'INVALID_LOGO_URL' };
  const terms_url = String(payload.terms_url ?? '').trim();
  if (terms_url && !/^https?:\/\//i.test(terms_url)) return { error: 'INVALID_TERMS_URL' };
  const commission = asMoney(payload.commission_percent);
  if (commission != null && commission > 100) return { error: 'INVALID_COMMISSION' };
  return {
    code,
    display_name,
    display_name_he: String(payload.display_name_he ?? '').trim(),
    supported_scenarios: scenarios,
    logo_url,
    description_en: String(payload.description_en ?? ''),
    description_he: String(payload.description_he ?? ''),
    show_in_billing: payload.show_in_billing !== false,
    allow_new_connections: payload.allow_new_connections === true,
    commission_percent: commission,
    connection_fee_amount: asMoney(payload.connection_fee_amount),
    monthly_fee_amount: asMoney(payload.monthly_fee_amount),
    fee_currency: String(payload.fee_currency ?? 'ILS').trim().toUpperCase() || 'ILS',
    payout_terms_en: String(payload.payout_terms_en ?? ''),
    payout_terms_he: String(payload.payout_terms_he ?? ''),
    terms_url,
  };
}

const CATALOG_ONLY_NOTE = 'Listed only. No signed adapter.';

const STATIC_CODES = ['tranzila', 'cardcom', 'grow', 'payme', 'sumit', 'hyp', 'max'] as const;

export const STATIC_PAYMENT_PROVIDER_CATALOG: PaymentProviderCatalogRow[] = STATIC_CODES.map((code) =>
  mapCatalogRow({
    code,
    display_name: code === 'payme' ? 'PayMe' : code === 'sumit' ? 'SUMIT' : code === 'hyp' ? 'HYP' : code === 'max' ? 'MAX' : code.charAt(0).toUpperCase() + code.slice(1),
    display_name_he: code === 'payme' ? 'PayMe' : code === 'sumit' ? 'SUMIT' : code === 'hyp' ? 'HYP' : code === 'max' ? 'MAX' : code.charAt(0).toUpperCase() + code.slice(1),
    adapter_status: 'catalog_only',
    supported_scenarios: [...PAYMENT_SCENARIOS],
    supported_countries: ['IL'],
    notes: CATALOG_ONLY_NOTE,
    show_in_billing: true,
    allow_new_connections: false,
  }),
);
