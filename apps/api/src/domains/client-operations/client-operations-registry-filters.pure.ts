/**
 * Client Operations registry — backend-owned business filter facets + AND matching.
 *
 * VIEW/FILTER over existing CO aggregate truth — not a second domain model.
 * Filter changes are READ/query params (not write commands).
 *
 * `operational_reporting` (UI label דיווח) = operational manual-cell completion
 * for applicable reporting columns — NOT statutory filing confirmation.
 */

import type { MaterialCells } from './client-operations-operational-period.pure.js';

/** Hebrew profile values — same as client-operations-client-core / ALLOWED_BUSINESS_TYPES. */
const BUSINESS_TYPE_OSEK_PATUR = 'עוסק פטור';
const BUSINESS_TYPE_OSEK_MURSHE = 'עוסק מורשה';

function normalizeStoredBusinessTypeRaw(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/\u00a0/g, ' ').trim();
  return s || null;
}

/** Operational reporting columns that participate in the דיווח row filter. */
export const CLIENT_OPERATIONS_OPERATIONAL_REPORTING_FILTER_COLUMN_KEYS = [
  'vat',
  'income_tax_advance',
  'income_tax_deductions',
  'national_insurance',
  'national_insurance_deductions',
] as const;

export type ClientOperationsOperationalReportingFilterColumnKey =
  (typeof CLIENT_OPERATIONS_OPERATIONAL_REPORTING_FILTER_COLUMN_KEYS)[number];

export type ClientOperationsOperationalReportingFilterStatus =
  | 'reported'
  | 'not_reported'
  | 'not_applicable';

export type ClientOperationsMaterialFilterStatus =
  | 'received'
  | 'not_received'
  | 'not_applicable';

export type ClientOperationsPayrollFilterStatus = 'has_payroll' | 'no_payroll';

/** Named dropdown facets + לא הוגדר. */
export type ClientOperationsBusinessTypeFilterFacet =
  | 'osek_murshe'
  | 'osek_patur'
  | 'company'
  | 'undefined';

/**
 * Row-level business type for matching.
 * `other` = non-empty stored value that is not osek/company (e.g. אחר) —
 * must NOT match לא הוגדר (undefined) and must NOT match named types.
 */
export type ClientOperationsBusinessTypeRowFacet =
  | ClientOperationsBusinessTypeFilterFacet
  | 'other';

export type ClientOperationsReportingTypeFacet =
  | 'income_tax_advance_monthly'
  | 'income_tax_advance_bimonthly'
  | 'income_tax_advance_exempt'
  | 'vat_monthly'
  | 'vat_bimonthly'
  | 'income_tax_deductions_monthly'
  | 'income_tax_deductions_bimonthly'
  | 'income_tax_deductions_semiannual';

export type ClientOperationsRegistryRowFilterFacets = {
  /** Operational דיווח — manual_cell_statuses.completed on applicable reporting columns. */
  operational_reporting: ClientOperationsOperationalReportingFilterStatus;
  /** Exact participating column keys for this row (subset of canonical list). */
  operational_reporting_participating_columns: ClientOperationsOperationalReportingFilterColumnKey[];
  material: ClientOperationsMaterialFilterStatus;
  payroll: ClientOperationsPayrollFilterStatus;
  /** SET membership — a client may match multiple reporting-type options. */
  reporting_types: ClientOperationsReportingTypeFacet[];
  /** Matching facet (includes `other`). */
  business_type: ClientOperationsBusinessTypeRowFacet;
  /** null = לא משויך */
  handler_user_id: string | null;
};

export type ClientOperationsRegistryFilterId =
  | 'operational_reporting'
  | 'material'
  | 'payroll'
  | 'reporting_type'
  | 'business_type'
  | 'handler';

export type ClientOperationsRegistryFilterOption = {
  id: string;
  label_he: string;
  enabled: boolean;
};

export type ClientOperationsRegistryFilterDefinition = {
  id: ClientOperationsRegistryFilterId;
  label_he: string;
  /** Layout hint for FE strip (backend-owned presentation). */
  width_hint: 'default' | 'wide' | 'handler';
  options: ClientOperationsRegistryFilterOption[];
};

export type ClientOperationsRegistryFiltersActive = {
  operational_reporting: string;
  material: string;
  payroll: string;
  reporting_type: string;
  business_type: string;
  handler: string;
};

export type ClientOperationsRegistryFiltersContract = {
  definitions: ClientOperationsRegistryFilterDefinition[];
  active: ClientOperationsRegistryFiltersActive;
  any_business_filter_active: boolean;
  clear_action: {
    id: 'clear_filters';
    label_he: 'נקה סינון';
    available: boolean;
  };
};

export type ClientOperationsRegistryBusinessFilterQuery = {
  filter_operational_reporting?: string | null;
  filter_material?: string | null;
  filter_payroll?: string | null;
  filter_reporting_type?: string | null;
  filter_business_type?: string | null;
  filter_handler?: string | null;
};

const ALL = 'all';

function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeActive(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === ALL) return ALL;
  return raw;
}

/** Profile `income_tax_advance_status === 'לא'` is explicit no/exemption (synced from tax UI selection `no`). */
export function isExplicitIncomeTaxAdvanceExemptProfileStatus(
  profileAdvanceStatus: string | null | undefined,
): boolean {
  return String(profileAdvanceStatus ?? '').replace(/\u00a0/g, ' ').trim() === 'לא';
}

export function resolveBusinessTypeRowFacet(
  businessType: string | null | undefined,
): ClientOperationsBusinessTypeRowFacet {
  const raw = normalizeStoredBusinessTypeRaw(businessType);
  if (!raw) return 'undefined';
  if (raw === BUSINESS_TYPE_OSEK_MURSHE) return 'osek_murshe';
  if (raw === BUSINESS_TYPE_OSEK_PATUR) return 'osek_patur';
  if (raw === 'חברה' || raw === 'תאגיד') return 'company';
  return 'other';
}

export function resolvePayrollFilterFacet(payrollApplicable: boolean): ClientOperationsPayrollFilterStatus {
  return payrollApplicable ? 'has_payroll' : 'no_payroll';
}

export function resolveMaterialFilterFacet(
  materialCells: MaterialCells | null | undefined,
): ClientOperationsMaterialFilterStatus {
  if (!materialCells) return 'not_applicable';
  const components = [materialCells.vat, materialCells.income_tax_advance, materialCells.payroll];
  const applicable = components.filter((c) => c?.applicable === true);
  if (applicable.length === 0) return 'not_applicable';
  const allReceived = applicable.every((c) => c.completed === true);
  return allReceived ? 'received' : 'not_received';
}

/**
 * Operational דיווח facet from manual_cell_statuses + period applicability.
 * Uses backend status tokens only — never CSS/color.
 */
export function resolveOperationalReportingFilterFacet(input: {
  period_applicability?: {
    vat_applicable?: boolean;
    income_tax_advance_applicable?: boolean;
    income_tax_deductions_applicable?: boolean;
    national_insurance_applicable?: boolean;
    national_insurance_deductions_applicable?: boolean;
  } | null;
  manual_cell_statuses?: Record<string, { status?: string | null } | undefined> | null;
}): {
  status: ClientOperationsOperationalReportingFilterStatus;
  participating_columns: ClientOperationsOperationalReportingFilterColumnKey[];
} {
  const app = input.period_applicability ?? {};
  const applicabilityByColumn: Record<ClientOperationsOperationalReportingFilterColumnKey, boolean> =
    {
      vat: app.vat_applicable === true,
      income_tax_advance: app.income_tax_advance_applicable === true,
      income_tax_deductions: app.income_tax_deductions_applicable === true,
      national_insurance: app.national_insurance_applicable === true,
      national_insurance_deductions: app.national_insurance_deductions_applicable === true,
    };

  const participating = CLIENT_OPERATIONS_OPERATIONAL_REPORTING_FILTER_COLUMN_KEYS.filter(
    (key) => applicabilityByColumn[key],
  );
  if (participating.length === 0) {
    return { status: 'not_applicable', participating_columns: [] };
  }

  const statuses = input.manual_cell_statuses ?? {};
  const allCompleted = participating.every((key) => statuses[key]?.status === 'completed');
  return {
    status: allCompleted ? 'reported' : 'not_reported',
    participating_columns: [...participating],
  };
}

export function resolveReportingTypeFacets(input: {
  /** Explicit profile exemption — ONLY `'לא'`; never infer from enabled!==true / display «—». */
  income_tax_advance_profile_status: string | null | undefined;
  income_tax_advance_enabled: boolean | null | undefined;
  income_tax_advance_frequency: string | null | undefined;
  vat_type: string | null | undefined;
  vat_frequency: string | null | undefined;
  income_tax_deductions_configured: boolean;
  income_tax_deductions_frequency: string | null | undefined;
}): ClientOperationsReportingTypeFacet[] {
  const facets: ClientOperationsReportingTypeFacet[] = [];

  if (isExplicitIncomeTaxAdvanceExemptProfileStatus(input.income_tax_advance_profile_status)) {
    facets.push('income_tax_advance_exempt');
  } else if (input.income_tax_advance_enabled === true) {
    const freq = norm(input.income_tax_advance_frequency);
    if (freq === 'monthly') facets.push('income_tax_advance_monthly');
    else if (freq === 'bi_monthly') facets.push('income_tax_advance_bimonthly');
  }

  const vatType = norm(input.vat_type);
  const vatFreq = norm(input.vat_frequency);
  if (
    vatType !== 'patur' &&
    vatType !== 'no' &&
    vatType !== 'not_relevant' &&
    vatFreq !== 'not_relevant'
  ) {
    if (vatFreq === 'monthly') facets.push('vat_monthly');
    else if (vatFreq === 'bi_monthly') facets.push('vat_bimonthly');
  }

  if (input.income_tax_deductions_configured) {
    const dFreq = norm(input.income_tax_deductions_frequency);
    if (dFreq === 'monthly') facets.push('income_tax_deductions_monthly');
    else if (dFreq === 'bi_monthly') facets.push('income_tax_deductions_bimonthly');
    else if (dFreq === 'semi_annual') facets.push('income_tax_deductions_semiannual');
  }

  return facets;
}

export function buildClientOperationsRegistryRowFilterFacets(input: {
  period_applicability?: {
    vat_applicable?: boolean;
    payroll_applicable?: boolean;
    income_tax_advance_applicable?: boolean;
    income_tax_deductions_applicable?: boolean;
    national_insurance_applicable?: boolean;
    national_insurance_deductions_applicable?: boolean;
  } | null;
  manual_cell_statuses?: Record<string, { status?: string | null } | undefined> | null;
  material_cells?: MaterialCells | null;
  payroll_applicable: boolean;
  business_type: string | null | undefined;
  assigned_handler_user_id: string | null | undefined;
  income_tax_advance_profile_status: string | null | undefined;
  income_tax_advance_enabled: boolean | null | undefined;
  income_tax_advance_frequency: string | null | undefined;
  vat_type: string | null | undefined;
  vat_frequency: string | null | undefined;
  income_tax_deductions_configured: boolean;
  income_tax_deductions_frequency: string | null | undefined;
}): ClientOperationsRegistryRowFilterFacets {
  const reporting = resolveOperationalReportingFilterFacet({
    period_applicability: input.period_applicability,
    manual_cell_statuses: input.manual_cell_statuses,
  });
  return {
    operational_reporting: reporting.status,
    operational_reporting_participating_columns: reporting.participating_columns,
    material: resolveMaterialFilterFacet(input.material_cells),
    payroll: resolvePayrollFilterFacet(input.payroll_applicable),
    reporting_types: resolveReportingTypeFacets({
      income_tax_advance_profile_status: input.income_tax_advance_profile_status,
      income_tax_advance_enabled: input.income_tax_advance_enabled,
      income_tax_advance_frequency: input.income_tax_advance_frequency,
      vat_type: input.vat_type,
      vat_frequency: input.vat_frequency,
      income_tax_deductions_configured: input.income_tax_deductions_configured,
      income_tax_deductions_frequency: input.income_tax_deductions_frequency,
    }),
    business_type: resolveBusinessTypeRowFacet(input.business_type),
    handler_user_id: input.assigned_handler_user_id?.trim()
      ? String(input.assigned_handler_user_id).trim()
      : null,
  };
}

export function normalizeClientOperationsRegistryBusinessFilterQuery(
  query: ClientOperationsRegistryBusinessFilterQuery | null | undefined,
): ClientOperationsRegistryFiltersActive {
  return {
    operational_reporting: normalizeActive(query?.filter_operational_reporting),
    material: normalizeActive(query?.filter_material),
    payroll: normalizeActive(query?.filter_payroll),
    reporting_type: normalizeActive(query?.filter_reporting_type),
    business_type: normalizeActive(query?.filter_business_type),
    handler: normalizeActive(query?.filter_handler),
  };
}

export function isAnyClientOperationsBusinessFilterActive(
  active: ClientOperationsRegistryFiltersActive,
): boolean {
  return (
    active.operational_reporting !== ALL ||
    active.material !== ALL ||
    active.payroll !== ALL ||
    active.reporting_type !== ALL ||
    active.business_type !== ALL ||
    active.handler !== ALL
  );
}

function rowMatchesBusinessType(
  rowFacet: ClientOperationsBusinessTypeRowFacet,
  selected: string,
): boolean {
  if (selected === ALL) return true;
  if (selected === 'undefined') return rowFacet === 'undefined';
  return rowFacet === selected;
}

export function rowMatchesClientOperationsBusinessFilters(
  facets: ClientOperationsRegistryRowFilterFacets,
  active: ClientOperationsRegistryFiltersActive,
): boolean {
  if (active.operational_reporting !== ALL) {
    if (facets.operational_reporting !== active.operational_reporting) return false;
  }
  if (active.material !== ALL) {
    if (facets.material !== active.material) return false;
  }
  if (active.payroll !== ALL) {
    if (facets.payroll !== active.payroll) return false;
  }
  if (active.reporting_type !== ALL) {
    if (!facets.reporting_types.includes(active.reporting_type as ClientOperationsReportingTypeFacet)) {
      return false;
    }
  }
  if (active.business_type !== ALL) {
    if (!rowMatchesBusinessType(facets.business_type, active.business_type)) return false;
  }
  if (active.handler !== ALL) {
    if (active.handler === 'unassigned') {
      if (facets.handler_user_id != null) return false;
    } else if (facets.handler_user_id !== active.handler) {
      return false;
    }
  }
  return true;
}

export function applyClientOperationsRegistryBusinessFilters<
  T extends { filter_facets?: ClientOperationsRegistryRowFilterFacets | null },
>(rows: T[], active: ClientOperationsRegistryFiltersActive): T[] {
  if (!isAnyClientOperationsBusinessFilterActive(active)) return rows;
  return rows.filter((row) => {
    const facets = row.filter_facets;
    if (!facets) return false;
    return rowMatchesClientOperationsBusinessFilters(facets, active);
  });
}

const REPORTING_TYPE_OPTIONS: ClientOperationsRegistryFilterOption[] = [
  { id: ALL, label_he: 'הכל', enabled: true },
  { id: 'income_tax_advance_monthly', label_he: 'מ"ה חודשי', enabled: true },
  { id: 'income_tax_advance_bimonthly', label_he: 'מ"ה דו-חודשי', enabled: true },
  {
    id: 'income_tax_advance_exempt',
    label_he: 'פטור ממקדמות מ"ה',
    // Canonical: client_operational_profiles.income_tax_advance_status === 'לא'
    // (synced from income_tax_advance_ui_selection = 'no'). Never from display «—».
    enabled: true,
  },
  { id: 'vat_monthly', label_he: 'מע"מ חודשי', enabled: true },
  { id: 'vat_bimonthly', label_he: 'מע"מ דו-חודשי', enabled: true },
  { id: 'income_tax_deductions_monthly', label_he: 'מ"ה ניכויים חודשי', enabled: true },
  { id: 'income_tax_deductions_bimonthly', label_he: 'מ"ה ניכויים דו-חודשי', enabled: true },
  { id: 'income_tax_deductions_semiannual', label_he: 'מ"ה ניכויים חצי-שנתי', enabled: true },
];

export function buildClientOperationsRegistryFiltersContract(input: {
  active: ClientOperationsRegistryFiltersActive;
  handlerOptions: Array<{ user_id: string; display_name: string }>;
}): ClientOperationsRegistryFiltersContract {
  const anyActive = isAnyClientOperationsBusinessFilterActive(input.active);
  const handlerOptions: ClientOperationsRegistryFilterOption[] = [
    { id: ALL, label_he: 'הכל', enabled: true },
    { id: 'unassigned', label_he: 'לא משויך', enabled: true },
    ...input.handlerOptions.map((h) => ({
      id: h.user_id,
      label_he: h.display_name,
      enabled: true,
    })),
  ];

  const definitions: ClientOperationsRegistryFilterDefinition[] = [
    {
      id: 'operational_reporting',
      label_he: 'דיווח',
      width_hint: 'default',
      options: [
        { id: ALL, label_he: 'הכל', enabled: true },
        { id: 'reported', label_he: 'דווח', enabled: true },
        { id: 'not_reported', label_he: 'לא דווח', enabled: true },
      ],
    },
    {
      id: 'material',
      label_he: 'חומר',
      width_hint: 'default',
      options: [
        { id: ALL, label_he: 'הכל', enabled: true },
        { id: 'received', label_he: 'התקבל', enabled: true },
        { id: 'not_received', label_he: 'לא התקבל', enabled: true },
      ],
    },
    {
      id: 'payroll',
      label_he: 'שכר',
      width_hint: 'default',
      options: [
        { id: ALL, label_he: 'הכל', enabled: true },
        { id: 'has_payroll', label_he: 'יש שכר', enabled: true },
        { id: 'no_payroll', label_he: 'אין שכר', enabled: true },
      ],
    },
    {
      id: 'reporting_type',
      label_he: 'סוג דיווח',
      width_hint: 'wide',
      options: REPORTING_TYPE_OPTIONS,
    },
    {
      id: 'business_type',
      label_he: 'סוג עסק',
      width_hint: 'default',
      options: [
        { id: ALL, label_he: 'הכל', enabled: true },
        { id: 'osek_murshe', label_he: 'עוסק מורשה', enabled: true },
        { id: 'osek_patur', label_he: 'עוסק פטור', enabled: true },
        { id: 'company', label_he: 'חברה', enabled: true },
        { id: 'undefined', label_he: 'לא הוגדר', enabled: true },
      ],
    },
    {
      id: 'handler',
      label_he: 'מטפל בתיק',
      width_hint: 'handler',
      options: handlerOptions,
    },
  ];

  return {
    definitions,
    active: input.active,
    any_business_filter_active: anyActive,
    clear_action: {
      id: 'clear_filters',
      label_he: 'נקה סינון',
      available: anyActive,
    },
  };
}

/** Map filter definition id → query param key. */
export const CLIENT_OPERATIONS_FILTER_QUERY_PARAM_BY_ID: Record<
  ClientOperationsRegistryFilterId,
  keyof ClientOperationsRegistryBusinessFilterQuery
> = {
  operational_reporting: 'filter_operational_reporting',
  material: 'filter_material',
  payroll: 'filter_payroll',
  reporting_type: 'filter_reporting_type',
  business_type: 'filter_business_type',
  handler: 'filter_handler',
};
