/**
 * TEMPORARY_COUNTRY_PACK_PENDING
 *
 * Country Pack has no required-settings catalog. This helper only flags fields the
 * existing fail-closed registry already needs before it can determine reporting
 * applicability or periodicity. Legal due day lives in Country Pack / Reporting
 * Calendar — not a client-setup gap. Fee agreements are commercial, not a legal gap.
 */

export const REPORTING_SETUP_WARNING_SOURCE = 'TEMPORARY_COUNTRY_PACK_PENDING' as const;

export type ReportingSetupGapKey =
  | 'business_type'
  | 'vat_applicability'
  | 'vat_frequency'
  | 'income_tax_advance_applicability'
  | 'income_tax_advance_frequency'
  | 'national_insurance_applicability';

export type ReportingBlockedFunctionKey =
  | 'reporting_obligation_scope'
  | 'vat_reporting_obligation'
  | 'vat_reporting_periodicity'
  | 'income_tax_advance_obligation'
  | 'income_tax_advance_periodicity'
  | 'national_insurance_obligation';

export type ClientReportingSetupGap = {
  missing: ReportingSetupGapKey[];
  blocked: ReportingBlockedFunctionKey[];
};

export type ClientOperationsClientNeedingSetup = {
  client_id: string;
  display_name: string;
  settings_href: string;
  missing_settings: Array<{ key: ReportingSetupGapKey; label_key: string }>;
  blocked_functions: Array<{ key: ReportingBlockedFunctionKey; label_key: string }>;
};

export type ClientOperationsClientsNeedingSetup = {
  source: typeof REPORTING_SETUP_WARNING_SOURCE;
  count: number;
  fingerprint: string;
  /**
   * Decimal string of organizations.clients_added_generation (Core INSERT counter).
   * Not derived from live client rows. Not a legal filing date. Not period-scoped.
   */
  clients_added_token: string;
  dismissed: boolean;
  visible: boolean;
  title_key: string;
  explanation_key: string;
  count_key: string;
  open_settings_key: string;
  close_key: string;
  dont_show_again_key: string;
  client_column_key: string;
  missing_column_key: string;
  clients: ClientOperationsClientNeedingSetup[];
};

const GAP_LABEL_KEY: Record<ReportingSetupGapKey, string> = {
  business_type: 'clientOperations.fields.businessType',
  vat_applicability: 'clientOperations.taxes.fields.vat',
  vat_frequency: 'clientOperations.taxes.fields.vatFrequency',
  income_tax_advance_applicability: 'clientOperations.taxes.cards.incomeTaxAdvances',
  income_tax_advance_frequency: 'clientOperations.taxes.fields.reportingFrequency',
  national_insurance_applicability: 'clientOperations.taxes.cards.nationalInsurance',
};

const BLOCKED_LABEL_KEY: Record<ReportingBlockedFunctionKey, string> = {
  reporting_obligation_scope: 'clientOperations.setupWarning.blocked.reportingScope',
  vat_reporting_obligation: 'clientOperations.setupWarning.blocked.vatObligation',
  vat_reporting_periodicity: 'clientOperations.setupWarning.blocked.vatPeriodicity',
  income_tax_advance_obligation: 'clientOperations.setupWarning.blocked.incomeTaxAdvanceObligation',
  income_tax_advance_periodicity: 'clientOperations.setupWarning.blocked.incomeTaxAdvancePeriodicity',
  national_insurance_obligation: 'clientOperations.setupWarning.blocked.nationalInsuranceObligation',
};

const APPLICABLE_VAT_TYPES = new Set(['yes', 'multiple', 'mixed']);
const EXPLICIT_NON_VAT_TYPES = new Set(['no', 'not_relevant']);

function blank(value: string | null | undefined): boolean {
  return String(value ?? '').trim() === '';
}

function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function vatFrequencyToken(value: string | null | undefined): string {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[־–—]/g, '-')
    .replace(/\s+/g, ' ');
  if (raw === 'monthly' || raw === 'חודשי') return 'monthly';
  if (
    raw === 'bi_monthly' ||
    raw === 'bimonthly' ||
    raw === 'bi-monthly' ||
    raw === 'דו חודשי' ||
    raw === 'דו-חודשי'
  ) {
    return 'bi_monthly';
  }
  return raw;
}

const ADVANCE_FREQUENCIES = new Set(['monthly', 'bi_monthly', 'semi_annual']);
const EXPLICIT_ADVANCE_NO = new Set(['לא', 'no']);
const EXPLICIT_NI_NONE = new Set(['not_applicable', 'no']);

export function clientReportingSetupGaps(input: {
  business_type: string | null | undefined;
  vat_type: string | null | undefined;
  vat_frequency: string | null | undefined;
  vat_due_type: string | null | undefined;
  income_tax_advance_enabled?: boolean | null | undefined;
  income_tax_advance_frequency?: string | null | undefined;
  income_tax_advance_profile_status?: string | null | undefined;
  national_insurance_type?: string | null | undefined;
}): ClientReportingSetupGap {
  const missing: ReportingSetupGapKey[] = [];
  const blocked: ReportingBlockedFunctionKey[] = [];
  if (blank(input.business_type)) {
    missing.push('business_type');
    blocked.push('reporting_obligation_scope');
  }

  const vatType = norm(input.vat_type);
  const frequency = vatFrequencyToken(input.vat_frequency);
  if (blank(input.vat_type) || (!APPLICABLE_VAT_TYPES.has(vatType) && vatType !== 'patur' && !EXPLICIT_NON_VAT_TYPES.has(vatType))) {
    missing.push('vat_applicability');
    blocked.push('vat_reporting_obligation');
  } else if (APPLICABLE_VAT_TYPES.has(vatType)) {
    if (frequency !== 'monthly' && frequency !== 'bi_monthly') {
      missing.push('vat_frequency');
      blocked.push('vat_reporting_periodicity');
    }
    void input.vat_due_type;
  }

  const advanceEnabled = input.income_tax_advance_enabled === true;
  const advanceStatus = String(input.income_tax_advance_profile_status ?? '').trim();
  const advanceNo = EXPLICIT_ADVANCE_NO.has(advanceStatus) || EXPLICIT_ADVANCE_NO.has(norm(advanceStatus));
  if (advanceEnabled) {
    const advanceFrequency = vatFrequencyToken(input.income_tax_advance_frequency);
    if (!ADVANCE_FREQUENCIES.has(advanceFrequency)) {
      missing.push('income_tax_advance_frequency');
      blocked.push('income_tax_advance_periodicity');
    }
  } else if (!advanceNo) {
    missing.push('income_tax_advance_applicability');
    blocked.push('income_tax_advance_obligation');
  }

  const niType = norm(input.national_insurance_type);
  if (niType !== 'yes' && !EXPLICIT_NI_NONE.has(niType)) {
    missing.push('national_insurance_applicability');
    blocked.push('national_insurance_obligation');
  }

  return { missing, blocked };
}

export function buildClientNeedingSetup(input: {
  client_id: string;
  display_name: string | null | undefined;
  gap: ClientReportingSetupGap;
}): ClientOperationsClientNeedingSetup {
  const clientId = String(input.client_id ?? '').trim();
  return {
    client_id: clientId,
    display_name: String(input.display_name ?? '').trim() || '—',
    settings_href: `/m/client-operations/clients/${encodeURIComponent(clientId)}?tab=taxes`,
    missing_settings: input.gap.missing.map((key) => ({ key, label_key: GAP_LABEL_KEY[key] })),
    blocked_functions: input.gap.blocked.map((key) => ({ key, label_key: BLOCKED_LABEL_KEY[key] })),
  };
}

export function reportingSetupFingerprint(
  clients: ReadonlyArray<{ client_id: string; missing_settings: ReadonlyArray<{ key: string }> }>,
): string {
  return clients
    .map((client) => `${client.client_id}:${client.missing_settings.map((item) => item.key).sort().join(',')}`)
    .sort()
    .join('|');
}

/** Decimal string of the Core org clients-added generation. Empty when missing/invalid. */
export function formatClientsAddedGeneration(generation: unknown): string {
  if (generation == null || generation === '') return '';
  const raw =
    typeof generation === 'bigint'
      ? generation.toString()
      : typeof generation === 'number'
        ? Number.isFinite(generation)
          ? String(Math.trunc(generation))
          : ''
        : String(generation).trim();
  if (!/^\d+$/.test(raw)) return '';
  return raw;
}

/** True when a stored dismiss marker still covers the current clients-added generation. */
export function setupWarningIsDismissed(
  currentToken: string | null | undefined,
  dismissedToken: string | null | undefined,
): boolean {
  const dismissed = formatClientsAddedGeneration(dismissedToken);
  if (!dismissed) return false;
  const current = formatClientsAddedGeneration(currentToken);
  if (!current) return false;
  return BigInt(current) <= BigInt(dismissed);
}

export function setupWarningVisible(input: {
  count: number;
  clientsAddedToken: string;
  dismissedClientsAddedToken: string | null | undefined;
}): boolean {
  if (!Number.isFinite(input.count) || input.count <= 0) return false;
  return !setupWarningIsDismissed(input.clientsAddedToken, input.dismissedClientsAddedToken);
}

export function buildClientsNeedingSetupAggregate(
  clients: readonly ClientOperationsClientNeedingSetup[],
  addedToken = '',
  dismissedToken = '',
): ClientOperationsClientsNeedingSetup {
  const list = [...clients].sort((a, b) => a.display_name.localeCompare(b.display_name, 'he'));
  const clients_added_token = formatClientsAddedGeneration(addedToken);
  const dismissed = setupWarningIsDismissed(clients_added_token, dismissedToken);
  return {
    source: REPORTING_SETUP_WARNING_SOURCE,
    count: list.length,
    fingerprint: reportingSetupFingerprint(list),
    clients_added_token,
    dismissed,
    visible: list.length > 0 && !dismissed,
    title_key: 'clientOperations.setupWarning.title',
    explanation_key: 'clientOperations.setupWarning.explanation',
    count_key: 'clientOperations.setupWarning.count',
    open_settings_key: 'clientOperations.setupWarning.openSettings',
    close_key: 'clientOperations.close',
    dont_show_again_key: 'clientOperations.setupWarning.dontShowUntilNewClient',
    client_column_key: 'clientOperations.setupWarning.clientColumn',
    missing_column_key: 'clientOperations.setupWarning.missingColumn',
    clients: list,
  };
}
