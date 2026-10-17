/**
 * Office expected-fee projection helpers.
 * VAT split reuses the Fees-tab formula (base = gross / (1+rate) for incl_vat)
 * but the rate itself is supplied by Country Pack — never hardcoded here.
 */

export const COUNTRY_PACK_STANDARD_VAT_KEY = 'il_standard_vat_rate';

export type DashboardFeeVatMode = 'before_vat' | 'incl_vat' | 'vat_exempt';

export type DashboardFeeLineInput = {
  client_id: string;
  agreement_id: string;
  is_active: boolean;
  charging_type: string;
  line_kind: string;
  catalog_code: string | null;
  price_ils: number | null;
  vat_mode: string | null;
  quantity: number | null;
  currency_code: string | null;
  exchange_rate_to_ils: number | null;
  payslip_count: number | null;
  unit_price_ils: number | null;
  line_total_ils: number | null;
};

export type DashboardFeeAgreementInput = {
  id?: string | null;
  client_id: string;
  agreement_status: string | null;
  agreement_start_date: string | null;
  agreement_end_date: string | null;
  discount_has: boolean;
  discount_type: string | null;
  discount_percent: number | null;
  discount_amount_ils: number | null;
};

export type DashboardFeeClientInput = {
  id: string;
  display_name: string | null;
  status: string | null;
  is_archived: boolean;
  created_at: string | null;
  ended_at: string | null;
};

export type DashboardFeeHistoryRow = {
  change_reason: string | null;
  service_line_id: string | null;
  old_price_ils: number | null;
  new_price_ils: number | null;
  effective_from: string | null;
  effective_to: string | null;
};

const INACTIVE_AGREEMENT = new Set(['stopped', 'expired']);

export function monthlyEquivalentBeforeVat(amountBeforeVat: number, chargingType: string): number {
  const n = Number(amountBeforeVat);
  if (!Number.isFinite(n) || n < 0) return 0;
  switch (String(chargingType ?? 'monthly')) {
    case 'monthly':
      return n;
    case 'bi_monthly':
      return n / 2;
    case 'quarterly':
      return n / 3;
    case 'yearly':
      return n / 12;
    case 'one_time':
      return 0;
    default:
      return n;
  }
}

export function normalizeDashboardFeeVatMode(v: unknown): DashboardFeeVatMode {
  const s = String(v ?? '').trim();
  if (s === 'incl_vat') return 'incl_vat';
  if (s === 'vat_exempt') return 'vat_exempt';
  return 'before_vat';
}

/**
 * Parse a Country Pack legal-value payload into a 0–1 VAT rate.
 * Does not apply a fallback statutory rate.
 */
export function parseCountryPackVatRate(payload: unknown): number | null {
  if (payload == null) return null;
  if (typeof payload === 'number' && Number.isFinite(payload)) {
    const n = payload > 1 ? payload / 100 : payload;
    return n >= 0 && n <= 1 ? n : null;
  }
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    const raw = o.rate ?? o.value ?? o.percent ?? o.percentage;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const n = raw > 1 ? raw / 100 : raw;
      return n >= 0 && n <= 1 ? n : null;
    }
    if (typeof raw === 'string' && raw.trim()) {
      const n = Number(raw.replace('%', '').trim());
      if (Number.isFinite(n)) {
        const r = n > 1 ? n / 100 : n;
        return r >= 0 && r <= 1 ? r : null;
      }
    }
  }
  return null;
}

export function splitDashboardFeeLineVat(
  inputAmount: number,
  mode: DashboardFeeVatMode,
  vatRate: number | null,
): { base: number; vat_rate_required: boolean } {
  if (!Number.isFinite(inputAmount) || inputAmount < 0) return { base: 0, vat_rate_required: false };
  if (mode === 'vat_exempt') return { base: inputAmount, vat_rate_required: false };
  if (mode === 'incl_vat') {
    if (vatRate == null || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) {
      return { base: 0, vat_rate_required: true };
    }
    return { base: inputAmount / (1 + vatRate), vat_rate_required: false };
  }
  return { base: inputAmount, vat_rate_required: false };
}

function quantityFromRow(q: unknown): number {
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function feeLineAmountIlsBeforeVatSplit(line: DashboardFeeLineInput): {
  amount: number;
  skipped_fx: boolean;
} {
  const lineKind = String(line.line_kind ?? '');
  const code = line.catalog_code != null ? String(line.catalog_code) : null;
  if (lineKind === 'built_in' && code === 'salary_by_payslips') {
    const total =
      line.line_total_ils != null && Number.isFinite(Number(line.line_total_ils))
        ? Number(line.line_total_ils)
        : Number(line.payslip_count ?? 0) * Number(line.unit_price_ils ?? 0);
    return { amount: total, skipped_fx: false };
  }
  const qty = quantityFromRow(line.quantity);
  const unit = Number(line.price_ils ?? 0);
  const cur = String(line.currency_code ?? 'ILS').trim().toUpperCase() || 'ILS';
  if (cur === 'ILS') return { amount: unit * qty, skipped_fx: false };
  const rate = line.exchange_rate_to_ils != null ? Number(line.exchange_rate_to_ils) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) return { amount: 0, skipped_fx: true };
  return { amount: unit * qty * rate, skipped_fx: false };
}

export function datesOverlapInclusive(
  periodStart: string,
  periodEnd: string,
  start: string | null,
  end: string | null,
): boolean {
  if (start && start > periodEnd) return false;
  if (end && end < periodStart) return false;
  return true;
}

export function agreementInForceForPeriod(
  agreement: DashboardFeeAgreementInput | null,
  periodStart: string,
  periodEnd: string,
  allowUndatedHistorical: boolean,
): boolean {
  if (!agreement) return false;
  const st = String(agreement.agreement_status ?? '').trim();
  if (INACTIVE_AGREEMENT.has(st)) return false;
  const start = agreement.agreement_start_date ? String(agreement.agreement_start_date).slice(0, 10) : null;
  const end = agreement.agreement_end_date ? String(agreement.agreement_end_date).slice(0, 10) : null;
  if (!start && !end && !allowUndatedHistorical) return false;
  return datesOverlapInclusive(periodStart, periodEnd, start, end);
}

export function clientServicingInPeriod(
  client: DashboardFeeClientInput,
  periodStart: string,
  periodEnd: string,
): boolean {
  if (client.is_archived) return false;
  if (String(client.status ?? '') === 'inactive') return false;
  const ended = client.ended_at ? String(client.ended_at).slice(0, 10) : null;
  if (ended && ended < periodStart) return false;
  const created = client.created_at ? String(client.created_at).slice(0, 10) : null;
  if (created && created > periodEnd) return false;
  return true;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function discountFactor(sumBase: number, agreement: DashboardFeeAgreementInput | null): number {
  if (!agreement || !agreement.discount_has || sumBase <= 0) return 1;
  let discountAmt = 0;
  if (agreement.discount_type === 'percent' && agreement.discount_percent != null) {
    discountAmt = (sumBase * Number(agreement.discount_percent)) / 100;
  } else if (agreement.discount_type === 'amount' && agreement.discount_amount_ils != null) {
    discountAmt = Math.min(Number(agreement.discount_amount_ils), sumBase);
  }
  return Math.max(0, sumBase - discountAmt) / sumBase;
}

/**
 * Current configuration may be used only for a period that includes today.
 * Past months cannot use today's service-line prices.
 */
export function feeScheduleBasisForPeriod(periodIncludesToday: boolean): 'current_configuration' | 'historical_unavailable' {
  return periodIncludesToday ? 'current_configuration' : 'historical_unavailable';
}

/**
 * `client_fee_price_history` is an audit/chart log, not a reconstructable monthly schedule.
 * totals_change stores un-normalized agreement totals (including one-time).
 * Line rows store price_ils without charging_type, vat_mode, quantity, currency, or closed effective_to.
 */
export function canReconstructMonthlyExpectedFromFeeHistory(
  _rows: DashboardFeeHistoryRow[],
): { reconstructable: false; missing: string[] } {
  return {
    reconstructable: false,
    missing: [
      'charging_type',
      'vat_mode',
      'quantity',
      'currency_code',
      'exchange_rate_to_ils',
      'line_is_active',
      'monthly_equivalent',
      'discount_snapshot',
      'closed_effective_to',
      'pre_first_change_baseline',
    ],
  };
}

export const FEE_BREAKDOWN_CATEGORIES = [
  'positive_recurring',
  'configured_zero',
  'no_agreement',
  'no_recurring_service',
  'one_time_only',
  'needs_attention',
  'unsupported_vat_fx',
  'not_in_scope',
] as const;

export type FeeBreakdownCategory = (typeof FEE_BREAKDOWN_CATEGORIES)[number];

export type ClientFeeLineContribution = {
  charging_type: string;
  amount_before_vat: number;
  monthly_before_vat: number;
  vat_mode: DashboardFeeVatMode;
};

export type ClientExpectedFeeResult = {
  client_id: string;
  display_name: string;
  monthly_before_vat: number;
  monthly_before_discount: number;
  discount_has: boolean;
  discount_type: string | null;
  discount_percent: number | null;
  discount_amount_ils: number | null;
  discount_applied_monthly: number;
  missing_recurring: boolean;
  configured_zero: boolean;
  skipped_fx: boolean;
  established: boolean;
  vat_rate_required: boolean;
  included_in_complete_total: boolean;
  blocks_complete_total: boolean;
  category: FeeBreakdownCategory;
  agreement_status: string | null;
  billing_frequencies: string[];
  lines: ClientFeeLineContribution[];
};

function emptyClientResult(
  client: DashboardFeeClientInput,
  partial: Partial<ClientExpectedFeeResult>,
): ClientExpectedFeeResult {
  return {
    client_id: client.id,
    display_name: String(client.display_name ?? '').trim() || '—',
    monthly_before_vat: 0,
    monthly_before_discount: 0,
    discount_has: false,
    discount_type: null,
    discount_percent: null,
    discount_amount_ils: null,
    discount_applied_monthly: 0,
    missing_recurring: true,
    configured_zero: false,
    skipped_fx: false,
    established: false,
    vat_rate_required: false,
    included_in_complete_total: false,
    blocks_complete_total: false,
    category: 'no_agreement',
    agreement_status: null,
    billing_frequencies: [],
    lines: [],
    ...partial,
  };
}

export function resolveInForceAgreement(
  agreements: DashboardFeeAgreementInput[] | DashboardFeeAgreementInput | null | undefined,
  periodStart: string,
  periodEnd: string,
  allowUndatedHistorical: boolean,
): { agreement: DashboardFeeAgreementInput | null; duplicate_in_force: boolean } {
  const list = Array.isArray(agreements) ? agreements : agreements ? [agreements] : [];
  const inForce = list.filter((a) => agreementInForceForPeriod(a, periodStart, periodEnd, allowUndatedHistorical));
  if (inForce.length > 1) return { agreement: inForce[0] ?? null, duplicate_in_force: true };
  if (inForce.length === 1) return { agreement: inForce[0] ?? null, duplicate_in_force: false };
  return { agreement: list[0] ?? null, duplicate_in_force: false };
}

export function projectClientExpectedFee(params: {
  client: DashboardFeeClientInput;
  agreement: DashboardFeeAgreementInput | DashboardFeeAgreementInput[] | null;
  lines: DashboardFeeLineInput[];
  periodStart: string;
  periodEnd: string;
  allowUndatedHistorical: boolean;
  vatRate: number | null;
}): ClientExpectedFeeResult {
  if (!clientServicingInPeriod(params.client, params.periodStart, params.periodEnd)) {
    return emptyClientResult(params.client, {
      missing_recurring: false,
      category: 'not_in_scope',
      established: true,
    });
  }

  const resolved = resolveInForceAgreement(
    params.agreement,
    params.periodStart,
    params.periodEnd,
    params.allowUndatedHistorical,
  );
  if (resolved.duplicate_in_force) {
    return emptyClientResult(params.client, {
      category: 'needs_attention',
      established: true,
      agreement_status: resolved.agreement?.agreement_status ?? null,
      missing_recurring: false,
      blocks_complete_total: true,
    });
  }

  const agreement = resolved.agreement;
  const inForce = agreementInForceForPeriod(
    agreement,
    params.periodStart,
    params.periodEnd,
    params.allowUndatedHistorical,
  );
  if (!agreement) {
    return emptyClientResult(params.client, {
      category: 'no_agreement',
      missing_recurring: true,
      established: true,
    });
  }
  if (!inForce) {
    return emptyClientResult(params.client, {
      category: 'needs_attention',
      missing_recurring: true,
      established: false,
      agreement_status: agreement.agreement_status,
    });
  }

  const scopedLines = params.lines.filter((line) => {
    if (agreement?.id) return line.agreement_id === agreement.id;
    return line.client_id === params.client.id;
  });

  let skipped_fx = false;
  let vat_rate_required = false;
  let recurringBase = 0;
  let recurringMonthly = 0;
  let hasRecurring = false;
  let hasOneTime = false;
  const contributions: ClientFeeLineContribution[] = [];
  const frequencies: string[] = [];

  for (const line of scopedLines) {
    if (!line.is_active) continue;
    const charging = String(line.charging_type ?? 'monthly');
    if (charging === 'one_time') {
      hasOneTime = true;
      continue;
    }
    hasRecurring = true;
    frequencies.push(charging);
    const mode: DashboardFeeVatMode =
      line.line_kind === 'custom' ? 'before_vat' : normalizeDashboardFeeVatMode(line.vat_mode);
    const raw = feeLineAmountIlsBeforeVatSplit(line);
    if (raw.skipped_fx) {
      skipped_fx = true;
      continue;
    }
    const split = splitDashboardFeeLineVat(raw.amount, mode, params.vatRate);
    if (split.vat_rate_required) {
      vat_rate_required = true;
      continue;
    }
    const monthly = monthlyEquivalentBeforeVat(split.base, charging);
    recurringBase += split.base;
    recurringMonthly += monthly;
    contributions.push({
      charging_type: charging,
      amount_before_vat: roundMoney(split.base),
      monthly_before_vat: roundMoney(monthly),
      vat_mode: mode,
    });
  }

  if (!hasRecurring) {
    return emptyClientResult(params.client, {
      category: hasOneTime ? 'one_time_only' : 'no_recurring_service',
      missing_recurring: true,
      established: true,
      skipped_fx,
      agreement_status: agreement.agreement_status,
    });
  }
  if (vat_rate_required || skipped_fx) {
    return emptyClientResult(params.client, {
      category: 'unsupported_vat_fx',
      missing_recurring: false,
      established: true,
      skipped_fx,
      vat_rate_required,
      blocks_complete_total: true,
      agreement_status: agreement.agreement_status,
      billing_frequencies: [...new Set(frequencies)],
      lines: contributions,
    });
  }

  const monthlyBeforeDiscount = roundMoney(recurringMonthly);
  const afterDiscount = roundMoney(recurringMonthly * discountFactor(recurringBase, agreement));
  return emptyClientResult(params.client, {
    monthly_before_vat: afterDiscount,
    monthly_before_discount: monthlyBeforeDiscount,
    discount_has: Boolean(agreement.discount_has),
    discount_type: agreement.discount_type,
    discount_percent: agreement.discount_percent,
    discount_amount_ils: agreement.discount_amount_ils,
    discount_applied_monthly: roundMoney(monthlyBeforeDiscount - afterDiscount),
    missing_recurring: false,
    configured_zero: afterDiscount === 0,
    skipped_fx: false,
    established: true,
    vat_rate_required: false,
    included_in_complete_total: true,
    category: afterDiscount === 0 ? 'configured_zero' : 'positive_recurring',
    agreement_status: agreement.agreement_status,
    billing_frequencies: [...new Set(frequencies)],
    lines: contributions,
  });
}

export function projectOfficeExpectedFees(params: {
  clients: DashboardFeeClientInput[];
  agreementsByClient: Map<string, DashboardFeeAgreementInput | DashboardFeeAgreementInput[]>;
  linesByClient: Map<string, DashboardFeeLineInput[]>;
  periodStart: string;
  periodEnd: string;
  allowUndatedHistorical: boolean;
  vatRate: number | null;
}): {
  total_monthly_before_vat: number;
  total_before_discount: number;
  discount_total: number;
  currency: 'ILS';
  skipped_fx_clients: number;
  missing: Array<{ client_id: string; display_name: string; category: FeeBreakdownCategory }>;
  configured_count: number;
  zero_configured_count: number;
  vat_rate_blocked: boolean;
  completeness: 'complete' | 'incomplete' | 'unavailable';
  client_results: ClientExpectedFeeResult[];
} {
  const client_results: ClientExpectedFeeResult[] = [];
  const missing: Array<{ client_id: string; display_name: string; category: FeeBreakdownCategory }> = [];
  let total = 0;
  let totalBeforeDiscount = 0;
  let skipped_fx_clients = 0;
  let configured_count = 0;
  let zero_configured_count = 0;
  let vat_rate_blocked = false;
  let incomplete = false;
  for (const client of params.clients) {
    const result = projectClientExpectedFee({
      client,
      agreement: params.agreementsByClient.get(client.id) ?? null,
      lines: params.linesByClient.get(client.id) ?? [],
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      allowUndatedHistorical: params.allowUndatedHistorical,
      vatRate: params.vatRate,
    });
    client_results.push(result);
    if (result.category === 'not_in_scope') continue;
    if (result.vat_rate_required) {
      vat_rate_blocked = true;
      incomplete = true;
      configured_count += 1;
      continue;
    }
    if (result.skipped_fx || result.category === 'unsupported_vat_fx') {
      skipped_fx_clients += 1;
      incomplete = true;
      configured_count += 1;
      continue;
    }
    if (result.blocks_complete_total) {
      incomplete = true;
    }
    if (result.missing_recurring) {
      missing.push({
        client_id: result.client_id,
        display_name: result.display_name,
        category: result.category,
      });
      continue;
    }
    configured_count += 1;
    if (result.configured_zero) zero_configured_count += 1;
    if (result.included_in_complete_total) {
      total += result.monthly_before_vat;
      totalBeforeDiscount += result.monthly_before_discount;
    }
  }
  const completeness: 'complete' | 'incomplete' | 'unavailable' = vat_rate_blocked
    ? 'unavailable'
    : incomplete
      ? 'incomplete'
      : 'complete';
  return {
    total_monthly_before_vat: completeness === 'complete' ? roundMoney(total) : 0,
    total_before_discount: completeness === 'complete' ? roundMoney(totalBeforeDiscount) : 0,
    discount_total: completeness === 'complete' ? roundMoney(totalBeforeDiscount - total) : 0,
    currency: 'ILS',
    skipped_fx_clients,
    missing,
    configured_count,
    zero_configured_count,
    vat_rate_blocked,
    completeness,
    client_results,
  };
}
