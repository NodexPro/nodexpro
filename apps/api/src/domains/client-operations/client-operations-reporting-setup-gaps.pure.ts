/**
 * TEMPORARY_COUNTRY_PACK_PENDING
 *
 * Country Pack has no required-settings catalog for Client Operations tax/reporting
 * setup. This helper only flags fields the existing fail-closed registry already
 * needs before it can determine VAT reporting obligation, periodicity, or due day.
 * Optional choose-fields (advances, NI, payroll) are never treated as errors.
 */

export const REPORTING_SETUP_WARNING_SOURCE = 'TEMPORARY_COUNTRY_PACK_PENDING' as const;

export type ReportingSetupGapKey =
  | 'business_type'
  | 'vat_applicability'
  | 'vat_frequency'
  | 'vat_due_type';

export type ReportingBlockedFunctionKey =
  | 'reporting_obligation_scope'
  | 'vat_reporting_obligation'
  | 'vat_reporting_periodicity'
  | 'vat_reporting_due';

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
  title_key: string;
  explanation_key: string;
  count_key: string;
  open_settings_key: string;
  close_key: string;
  clients: ClientOperationsClientNeedingSetup[];
};

const GAP_LABEL_KEY: Record<ReportingSetupGapKey, string> = {
  business_type: 'clientOperations.fields.businessType',
  vat_applicability: 'clientOperations.taxes.fields.vat',
  vat_frequency: 'clientOperations.taxes.fields.vatFrequency',
  vat_due_type: 'clientOperations.taxes.fields.vatDueDay',
};

const BLOCKED_LABEL_KEY: Record<ReportingBlockedFunctionKey, string> = {
  reporting_obligation_scope: 'clientOperations.setupWarning.blocked.reportingScope',
  vat_reporting_obligation: 'clientOperations.setupWarning.blocked.vatObligation',
  vat_reporting_periodicity: 'clientOperations.setupWarning.blocked.vatPeriodicity',
  vat_reporting_due: 'clientOperations.setupWarning.blocked.vatDue',
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

export function clientReportingSetupGaps(input: {
  business_type: string | null | undefined;
  vat_type: string | null | undefined;
  vat_frequency: string | null | undefined;
  vat_due_type: string | null | undefined;
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
    if (blank(input.vat_due_type)) {
      missing.push('vat_due_type');
      blocked.push('vat_reporting_due');
    }
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

export function buildClientsNeedingSetupAggregate(
  clients: readonly ClientOperationsClientNeedingSetup[],
): ClientOperationsClientsNeedingSetup {
  const list = [...clients].sort((a, b) => a.display_name.localeCompare(b.display_name, 'he'));
  return {
    source: REPORTING_SETUP_WARNING_SOURCE,
    count: list.length,
    fingerprint: reportingSetupFingerprint(list),
    title_key: 'clientOperations.setupWarning.title',
    explanation_key: 'clientOperations.setupWarning.explanation',
    count_key: 'clientOperations.setupWarning.count',
    open_settings_key: 'clientOperations.setupWarning.openSettings',
    close_key: 'clientOperations.close',
    clients: list,
  };
}
