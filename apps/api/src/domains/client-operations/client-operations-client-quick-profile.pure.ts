/**
 * Client Operations — Client Quick Profile (read-only presentation builders).
 * Domain decisions live here / in the aggregate service — not in React.
 */

export const CLIENT_OPERATIONS_CLIENT_QUICK_PROFILE_AGGREGATE_KEY =
  'client_operations_client_quick_profile_aggregate' as const;

export const QUICK_PROFILE_EMPTY_DISPLAY = '—';

/** Canonical expense labels from הגדרות הנה״ח — הוצאות (same codes as accounting tab). */
export const QUICK_PROFILE_EXPENSE_TYPE_META: ReadonlyArray<{
  code: string;
  label_he: string;
  value_kind: 'amount' | 'percent';
}> = [
  { code: 'rent', label_he: 'שכירות', value_kind: 'amount' },
  { code: 'electricity', label_he: 'חשמל', value_kind: 'percent' },
  { code: 'water', label_he: 'מים', value_kind: 'percent' },
  { code: 'arnona', label_he: 'ארנונה', value_kind: 'percent' },
  { code: 'internet', label_he: 'אינטרנט', value_kind: 'percent' },
  { code: 'phone', label_he: 'טלפון', value_kind: 'amount' },
  { code: 'insurance', label_he: 'ביטוחים', value_kind: 'amount' },
  { code: 'software_subscriptions', label_he: 'תוכנות / מנויים', value_kind: 'amount' },
  { code: 'bank_fees', label_he: 'עמלות בנק', value_kind: 'amount' },
  { code: 'clearing_fees', label_he: 'עמלות סליקה', value_kind: 'amount' },
];

export type ClientQuickProfileRow = {
  key: string;
  label_he: string;
  display_value: string;
  visible: boolean;
  copy_enabled: boolean;
  copy_value: string | null;
};

export type ClientQuickProfileExpenseRow = {
  key: string;
  label_he: string;
  display_value: string;
  visible: boolean;
};

export type ClientOperationsClientQuickProfileAggregate = {
  aggregate_key: typeof CLIENT_OPERATIONS_CLIENT_QUICK_PROFILE_AGGREGATE_KEY;
  client_id: string;
  title: string;
  reporting_period_key: string | null;
  identity_rows: ClientQuickProfileRow[];
  accounting_rows: ClientQuickProfileRow[];
  reporting_rows: ClientQuickProfileRow[];
  recurring_expense_rows: ClientQuickProfileExpenseRow[];
  expense_section_title_he: string;
  expense_section_visible: boolean;
  allowed_actions: string[];
};

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

/**
 * Phone precedence matching Client Operations case UI:
 * primary contact phone, else clients.phone.
 */
export function resolveQuickProfilePhoneDisplay(input: {
  client_phone: string | null | undefined;
  primary_contact_phone: string | null | undefined;
}): string | null {
  return trimOrNull(input.primary_contact_phone) ?? trimOrNull(input.client_phone);
}

type YearMonth = { year: number; month: number };

function jerusalemYearMonth(now: Date, timeZone = 'Asia/Jerusalem'): YearMonth | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return null;
    }
    return { year, month };
  } catch {
    return null;
  }
}

function shiftYearMonth(ym: YearMonth, deltaMonths: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + deltaMonths;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

function formatYearMonth(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`;
}

function parseYearMonthKey(key: string): YearMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Baseline operational period = prior calendar month in Asia/Jerusalem.
 * Used for monthly VAT / advances (matches Client Operations previous-month semantics).
 * Fail closed (null) if the wall-clock cannot be interpreted.
 */
export function resolveOperationalReportingPeriodKey(
  now: Date = new Date(),
  timeZone = 'Asia/Jerusalem'
): string | null {
  const cur = jerusalemYearMonth(now, timeZone);
  if (!cur) return null;
  return formatYearMonth(shiftYearMonth(cur, -1));
}

/**
 * VAT operational reporting_period_key for Country Pack calendar (YYYY-MM).
 *
 * Aligns with Client Operations vatReportingPeriodMonthly / vatReportingPeriodBiMonthly:
 * - monthly → prior calendar month
 * - bi_monthly → start month (odd) of the most recently completed two-month pair
 *   (pair ends on an even month; Country Pack stores the odd start month as period key)
 * - not_relevant / unknown → null
 *
 * This is the CURRENT RELEVANT completed reporting period for the client — not merely
 * "prior month", which would mark even months as vat_period_not_applicable_for_frequency
 * and hide a real bi-monthly due date.
 */
export function resolveVatOperationalReportingPeriodKey(input: {
  vat_frequency: string | null | undefined;
  now?: Date;
  timeZone?: string;
}): string | null {
  const frequency = String(input.vat_frequency ?? '')
    .trim()
    .toLowerCase();
  if (!frequency || frequency === 'not_relevant') return null;

  const priorKey = resolveOperationalReportingPeriodKey(input.now, input.timeZone);
  if (!priorKey) return null;
  if (frequency === 'monthly') return priorKey;

  if (frequency === 'bi_monthly') {
    const prior = parseYearMonthKey(priorKey);
    if (!prior) return null;
    // Completed pair end = previous calendar month if even; else step back one.
    const end = prior.month % 2 === 0 ? prior : shiftYearMonth(prior, -1);
    const start = shiftYearMonth(end, -1); // odd month — Country Pack bi_monthly key
    return formatYearMonth(start);
  }

  return null;
}

/**
 * Income-tax deductions operational period for Country Pack YYYY-MM lookup.
 * Reuses Client Operations resolveIncomeTaxDeductionsRequirement applicability:
 * - monthly → prior month
 * - bi_monthly / semi_annual → only in CO filing months; calendar key = period end month
 * - otherwise not applicable (omit row)
 *
 * Does not invent due dates — only selects the calendar period key.
 */
export function resolveIncomeTaxDeductionsOperationalReportingPeriodKey(input: {
  frequency: string | null | undefined;
  now?: Date;
  timeZone?: string;
}): { applicable: boolean; reporting_period_key: string | null } {
  const frequency = String(input.frequency ?? '')
    .trim()
    .toLowerCase();
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? 'Asia/Jerusalem';
  const cur = jerusalemYearMonth(now, timeZone);
  if (!cur) return { applicable: false, reporting_period_key: null };

  if (!frequency || frequency === 'monthly') {
    return {
      applicable: true,
      reporting_period_key: resolveOperationalReportingPeriodKey(now, timeZone),
    };
  }

  if (frequency === 'bi_monthly') {
    const reportingMonths = new Set([1, 3, 5, 7, 9, 11]);
    if (!reportingMonths.has(cur.month)) {
      return { applicable: false, reporting_period_key: null };
    }
    // Same pair end-month as CO (m2): in January → Dec previous year; else previous month.
    const end =
      cur.month === 1
        ? { year: cur.year - 1, month: 12 }
        : shiftYearMonth(cur, -1);
    return { applicable: true, reporting_period_key: formatYearMonth(end) };
  }

  if (frequency === 'semi_annual') {
    if (cur.month !== 1 && cur.month !== 7) {
      return { applicable: false, reporting_period_key: null };
    }
    // CO pair end: July→June same year; January→December previous year.
    const end =
      cur.month === 7
        ? { year: cur.year, month: 6 }
        : { year: cur.year - 1, month: 12 };
    return { applicable: true, reporting_period_key: formatYearMonth(end) };
  }

  return { applicable: false, reporting_period_key: null };
}

export function buildQuickProfileIdentityRow(input: {
  key: string;
  label_he: string;
  raw: string | null | undefined;
  copyable: boolean;
}): ClientQuickProfileRow {
  const raw = trimOrNull(input.raw);
  return {
    key: input.key,
    label_he: input.label_he,
    display_value: raw ?? QUICK_PROFILE_EMPTY_DISPLAY,
    visible: true,
    copy_enabled: Boolean(input.copyable && raw),
    copy_value: input.copyable && raw ? raw : null,
  };
}

export function buildQuickProfileInfoRow(input: {
  key: string;
  label_he: string;
  display_value: string | null | undefined;
  visible: boolean;
}): ClientQuickProfileRow {
  const display = trimOrNull(input.display_value) ?? QUICK_PROFILE_EMPTY_DISPLAY;
  return {
    key: input.key,
    label_he: input.label_he,
    display_value: display,
    visible: input.visible,
    copy_enabled: false,
    copy_value: null,
  };
}

/**
 * Selected recurring expenses only.
 * Amount-kind: label only (no ₪ financial amount in this popup).
 * Percent-kind: label + configured percent when present.
 */
export function buildQuickProfileRecurringExpenseRows(
  items: ReadonlyArray<{
    expense_type_code: string;
    business_percent: number | null;
    monthly_amount_ils: number | null;
  }>
): ClientQuickProfileExpenseRow[] {
  const metaByCode = new Map(QUICK_PROFILE_EXPENSE_TYPE_META.map((m) => [m.code, m]));
  const rows: ClientQuickProfileExpenseRow[] = [];
  for (const item of items) {
    const meta = metaByCode.get(item.expense_type_code);
    if (!meta) continue;
    if (meta.value_kind === 'percent') {
      if (item.business_percent == null || !Number.isFinite(Number(item.business_percent))) {
        rows.push({
          key: `expense_${meta.code}`,
          label_he: meta.label_he,
          display_value: '',
          visible: true,
        });
      } else {
        rows.push({
          key: `expense_${meta.code}`,
          label_he: meta.label_he,
          display_value: `${Number(item.business_percent)}%`,
          visible: true,
        });
      }
      continue;
    }
    // amount-kind: selected ⇒ show label only (configuration presence, not money)
    rows.push({
      key: `expense_${meta.code}`,
      label_he: meta.label_he,
      display_value: '',
      visible: true,
    });
  }
  return rows;
}

/**
 * רכב rows — only when vehicles are configured and a business-use percent exists.
 * Percent is backend-supplied; never invented here.
 */
export function buildQuickProfileVehicleExpenseRows(input: {
  has_vehicles: boolean;
  vehicles: ReadonlyArray<{
    vehicle_status: string | null | undefined;
    business_use_percent: number | null | undefined;
    license_plate?: string | null;
  }>;
}): ClientQuickProfileExpenseRow[] {
  if (!input.has_vehicles) return [];
  const active = input.vehicles.filter((v) => {
    const status = String(v.vehicle_status ?? 'active').trim().toLowerCase();
    return status === 'active' || status === '';
  });
  const withPercent = active.filter(
    (v) => v.business_use_percent != null && Number.isFinite(Number(v.business_use_percent))
  );
  if (withPercent.length === 0) return [];
  if (withPercent.length === 1) {
    return [
      {
        key: 'vehicle',
        label_he: 'רכב',
        display_value: `${Number(withPercent[0]!.business_use_percent)}%`,
        visible: true,
      },
    ];
  }
  return withPercent.map((v, idx) => {
    const plate = trimOrNull(v.license_plate);
    return {
      key: `vehicle_${idx}`,
      label_he: plate ? `רכב — ${plate}` : `רכב ${idx + 1}`,
      display_value: `${Number(v.business_use_percent)}%`,
      visible: true,
    };
  });
}
