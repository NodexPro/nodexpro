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
  adapter_status: PaymentAdapterStatus;
  supported_scenarios: PaymentScenario[];
  supported_countries: string[];
  environment_modes: Array<'test' | 'live'>;
  capabilities: PaymentProviderCapabilities;
  notes: string;
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

export function mapCatalogRow(row: {
  code: string;
  display_name: string;
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
}): PaymentProviderCatalogRow {
  const status = row.adapter_status === 'ready' ? 'ready' : 'catalog_only';
  return {
    code: row.code,
    display_name: row.display_name,
    adapter_status: status,
    supported_scenarios: (row.supported_scenarios ?? []).filter((item): item is PaymentScenario =>
      (PAYMENT_SCENARIOS as readonly string[]).includes(item),
    ),
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

const CATALOG_ONLY_NOTE = 'Listed only. No signed adapter.';

export const STATIC_PAYMENT_PROVIDER_CATALOG: PaymentProviderCatalogRow[] = [
  'tranzila',
  'cardcom',
  'grow',
  'payme',
  'sumit',
].map((code) =>
  mapCatalogRow({
    code,
    display_name: code === 'payme' ? 'PayMe' : code === 'sumit' ? 'SUMIT' : code.charAt(0).toUpperCase() + code.slice(1),
    adapter_status: 'catalog_only',
    supported_scenarios: [...PAYMENT_SCENARIOS],
    supported_countries: ['IL'],
    notes: CATALOG_ONLY_NOTE,
  }),
);
