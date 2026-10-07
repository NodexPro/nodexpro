import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { buildNotesCellDisplayHe, listOperationalNoteTypes, loadNotesAggregatesByClient } from './client-operations-notes.service.js';
import {
  computeNationalInsuranceDeductionsRegistryDisplayHe,
  getClientTaxSettings,
  syncVatPaturForOsekPaturBusinessType,
  type ClientTaxSettingsResponse,
} from './client-tax-settings.service.js';
import {
  buildTaxTabWorkspaceReadModel,
  type TaxTabWorkspaceResponse,
} from './client-tax-tab-read-model.service.js';
import { getClientBusinessProfileSection, type ClientBusinessProfileSectionResponse } from './client-business-profile.service.js';
import { getAccountingSettingsTabReadModel, type AccountingTabResponse } from './client-accounting-tab.service.js';
import {
  getFeesTabReadModel,
  type FeesPriceChartViewMode,
  type FeesTabResponse,
} from './client-fees-tab.service.js';
import { getPayrollTabReadModel, type PayrollTabResponse } from './client-payroll-tab.service.js';
import {
  getAnnualTabReadModel,
  type AnnualTabResponse,
} from './client-annual-report-tab.service.js';
import { getClientDocumentsTabReadModel, type ClientDocumentsTabResponse } from './client-documents-tab.service.js';
import {
  getClientHistoryTabReadModel,
  type ClientHistoryOpenSectionOptions,
  type ClientHistoryTabResponse,
} from './client-history-tab.service.js';
import {
  getClientObligationsTabReadModel,
  getClientTasksTabReadModel,
  recomputeClientObligationsAndTasks,
} from './client-obligations-tasks-core.service.js';
import { formatNationalInsuranceRegistryDisplayHe } from './national-insurance-registry.js';
import { computeVatDueRegistryDisplayHe, computeVatRegistryColumnDisplayHe } from './vat-divuach.js';
import {
  applyRegistryQueryToRows,
  buildCustomColumnsCapability,
  buildClientOperationsToolbarCapabilities,
  buildRegistryRowCells,
  CLIENT_OPERATIONS_REGISTRY_COLUMNS,
  formatIncomeTaxAdvanceRegistryFrequencyDisplayHe,
  formatPcnRegistryDisplay,
  type ClientOperationsRegistryColumn,
  type ClientOperationsToolbarCapability,
  type RegistryQueryInput,
} from './client-operations-registry-presentation.pure.js';
import {
  buildUserColumnsPeriodAggregateExtras,
  loadActiveCustomColumnsExtended,
  loadPeriodCustomColumnValues,
} from './client-operations-user-columns-periods.service.js';
import { mergeUserCustomCellsIntoRowPeriodAware } from './client-operations-user-columns-periods.pure.js';
import {
  buildManualStatusCapabilitiesForRow,
  countMaterialOperationalSquares,
  countNiDeductionsOperationalSquares,
  loadManualCellStatusesForPeriod,
  manualStatusPaintModesForAggregate,
} from './client-operations-cell-manual-status.service.js';
import { mergeSelectedPeriodIntoAvailablePeriods, isClientOperationsManualStatusPaintableColumnKey } from './client-operations-cell-manual-status.pure.js';
import {
  ensurePeriodApplicabilitySnapshots,
  listKnownOperationalPeriodKeys,
  loadPeriodApplicabilitySnapshots,
  loadPeriodMaterialFacts,
  loadPeriodMembershipClientIds,
  loadIncomeTaxDeductionsPeriodReported,
  loadPayrollPeriodSalaryDataReceived,
  resolveRegistryOperationalPeriodKey,
  type ClientPeriodSourceRow,
} from './client-operations-operational-period.service.js';
import {
  buildIncomeTaxDeductionsRegistryCell,
  buildMaterialCells,
  clientExistsInOperationalPeriod,
  mapOperationalPeriodKeyToPayrollPeriodKey,
  resolveDefaultOperationalPeriodKey,
  isIncomeTaxFrequencyApplicableForOperationalPeriod,
  resolveIncomeTaxAdvanceConfigured,
  resolveIncomeTaxAdvanceMaterialForPeriod,
  resolveIncomeTaxDeductionsApplicability,
  resolveIncomeTaxDeductionsConfigured,
  resolveMaterialBroughtForPeriod,
  resolveNationalInsuranceApplicability,
  resolveNationalInsuranceDeductionsApplicability,
  resolvePayrollApplicabilityFromDeductionsFiles,
  resolvePayrollApplicabilityFromFrozenSnapshot,
  resolvePayrollMaterialForPeriod,
  resolvePayrollObligationConfigured,
  resolveVatApplicabilityForOperationalPeriod,
  resolveVatObligationConfigured,
  shouldIncludeArchivedClientInOperationalPeriodRegistry,
  shouldEmitOperationalPeriodRegistryRow,
  type IncomeTaxDeductionsRegistryCell,
  type MaterialCells,
  type ObligationCheckboxCell,
} from './client-operations-operational-period.pure.js';
import {
  formatOperationalDateDisplayHe,
  resolveAnnualReportTaxYearForOperationalPeriod,
  type AnnualReportOperationalDateCell,
  type CapitalDeclarationOperationalDateCell,
} from './client-operations-annual-capital-operational.pure.js';
import {
  loadAnnualReportYearInstancesForClients,
  loadOpenCapitalDeclarationInstancesForClients,
  projectAnnualReportCells,
  projectCapitalDeclarationCells,
} from './client-operations-annual-capital-operational.service.js';
import {
  buildManualRowsPeriodSetupForAggregate,
  loadManualRowValuesBySlotColumnForRegistryAggregate,
} from './client-operations-manual-rows.service.js';
import { loadUserPeriodDataCopySourcePeriods } from './client-operations-user-period-data-copy.service.js';
import {
  buildClientOperationsRegistryMaterializationCacheKey,
  clientOperationsRegistryMaterializationCache,
} from './client-operations-registry-materialization-cache.js';
import type { BoundedTtlCacheSource } from '../../shared/bounded-ttl-cache.js';
import {
  materializeClientOperationsManualRows,
  type ClientOperationsManualRegistryRow,
} from './client-operations-manual-rows.pure.js';
import {
  buildClientOperationsRegistryFiltersContract,
  buildClientOperationsRegistryRowFilterFacets,
  isAnyClientOperationsBusinessFilterActive,
  normalizeClientOperationsRegistryBusinessFilterQuery,
  rowMatchesClientOperationsBusinessFilters,
  type ClientOperationsRegistryFiltersContract,
  type ClientOperationsRegistryRowFilterFacets,
} from './client-operations-registry-filters.pure.js';
import { logAggregatePayloadBreakdown } from '../../shared/aggregate-payload-metrics.js';
import {
  assertUserIsActiveHandlerEligible,
  listActiveHandlerEligibleMembers,
  loadMemberDisplayNamesByUserIds,
} from '../memberships/organization-membership-access.js';
import {
  assertCanAccessClientFromContext,
  canManageClientHandlerAssignment,
  filterAuthorizedClientIds,
  resolveOrganizationClientAccessScopeFromContext,
  type OrganizationClientAccessScope,
} from './organization-client-access.js';
import {
  resolveClientOperationsWorkspaceScopeFromContext,
  workspaceAggregateContract,
} from './client-operations-workspace.service.js';
import { invalidateClientOperationsRegistryMaterializationCache } from './client-operations-registry-materialization-cache.js';
import {
  buildNiDeductionsRegistryCellForClient,
  loadEarliestNiDeductionsApplicablePeriodKeysForClients,
  loadNiDeductions126CycleFactsForClients,
  loadNiDeductionsPeriodFlagsForClients,
  type NiDeductionsRegistryCell,
} from './client-operations-ni-deductions-registry.service.js';

export type ClientOperationsRegistryRow = {
  client_id: string;
  client_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  payroll_flag: boolean | null;
  material_brought_flag: boolean | null;
  period_applicability?: {
    vat_applicable: boolean;
    payroll_applicable: boolean;
    income_tax_advance_applicable: boolean;
    income_tax_deductions_applicable: boolean;
    national_insurance_applicable: boolean;
    national_insurance_deductions_applicable: boolean;
    row_visible: boolean;
  };
  material_brought_cell?: ObligationCheckboxCell;
  material_cells?: MaterialCells;
  annual_report_cell?: AnnualReportOperationalDateCell;
  capital_declaration_cell?: CapitalDeclarationOperationalDateCell;
  /** Backend-ready ב״ל ניכויים cell (102/100 monthly + 126 cycle). */
  national_insurance_deductions_cell?: NiDeductionsRegistryCell;
  /** Backend-ready מ״ה ניכויים cell (configured / due / disabled / completion). */
  income_tax_deductions_cell?: IncomeTaxDeductionsRegistryCell;
  /** Canonical vat_due_type === 'pcn' → "PCN"; otherwise empty string (not dash). */
  pcn_display?: string;
  vat_status: string | null;
  income_tax_advance_status: string | null;
  national_insurance_status: string | null;
  national_insurance_deductions_status: string | null;
  income_tax_deductions_status: string | null;
  assigned_handler_user_id: string | null;
  /** Server-built preview for הערות column (Hebrew). */
  notes_cell_text_he: string | null;
  operational_notes_count: number;
  vat_due_registry_display_he: string | null;
  /** Ready-to-render cell text by column key (excludes folder action). */
  cells: Record<string, string>;
  /** Backend-owned manual paint status per paintable column key. */
  manual_cell_statuses?: Record<
    string,
    {
      status: 'ready' | 'sent_for_approval' | 'completed' | null;
      presentation_token: 'ready' | 'sent_for_approval' | 'completed' | null;
      allowed_statuses: Array<'ready' | 'sent_for_approval' | 'completed' | 'clear'>;
      operational_square_count: number;
    }
  >;
  /** Backend-owned row filter facets (business matching). */
  filter_facets?: ClientOperationsRegistryRowFilterFacets;
};

export type ClientOperationsRegistryResponse = {
  title_he: string;
  period: {
    selected_period_key: string;
    default_period_key: string;
    available_periods: string[];
  };
  /**
   * Periods with meaningful user-entered custom-column / manual-row values.
   * Dedicated to `העתק מידע מחודש` — independent of sheet-tab `available_periods`.
   */
  user_period_data_copy_source_periods: string[];
  rows: ClientOperationsRegistryRow[];
  /** Exactly five backend-owned manual spreadsheet slots (after real clients; no Core client_id). */
  manual_rows: ClientOperationsManualRegistryRow[];
  columns: ClientOperationsRegistryColumn[];
  note_types: Array<{
    code: string;
    label_he: string;
    sort_order: number;
    allows_reminder: boolean;
  }>;
  toolbar_capabilities: ClientOperationsToolbarCapability[];
  custom_columns_capability: {
    max: number;
    current: number;
    can_create: boolean;
  };
  /** Period setup dialog truth — null when not needed or viewer. */
  user_column_period_setup?: {
    needed: boolean;
    operational_period_key: string;
    eligible_columns: Array<{ column_id: string; label: string; key: string; preselected: boolean }>;
  } | null;
  /**
   * Manual rows first-touch — null when viewer or already initialized.
   * Init is a named command (never a hidden aggregate GET write).
   */
  manual_rows_period_setup?: {
    needed: boolean;
    operational_period_key: string;
  } | null;
  /** CASE B legacy baseline requirement (editors only). */
  columns_needing_legacy_baseline?: Array<{
    column_id: string;
    label: string;
    key: string;
    available_baseline_periods: string[];
  }>;
  /** Excel paint-mode tools (backend labels/tokens; FE is render-only). */
  manual_status_paint_modes?: Array<{
    id: 'ready' | 'sent_for_approval' | 'completed' | 'clear';
    label_he: string;
    presentation_token: 'ready' | 'sent_for_approval' | 'completed' | 'clear';
  }>;
  /** Backend-owned filter bar contract (definitions + active + options). */
  filters?: ClientOperationsRegistryFiltersContract;
  /**
   * Stage 4 workspace projection metadata (viewer ≠ subject).
   * Frontend renders selector from allowed_scopes only — no role auth.
   */
  workspace?: {
    scope_kind: 'OFFICE' | 'MY' | 'STAFF';
    viewer_user_id: string;
    workspace_subject_user_id: string | null;
    access_scope_key: string;
    label_he: string;
    allowed_scopes: Array<{
      scope_kind: 'OFFICE' | 'MY' | 'STAFF';
      subject_user_id: string | null;
      label_he: string;
      role_code: string | null;
    }>;
    available_workspace_subjects: Array<{
      user_id: string;
      display_name: string;
      role_code: string;
    }>;
    selector_visible: boolean;
  };
  query: {
    q: string | null;
    sort_by: string | null;
    sort_dir: 'asc' | 'desc' | null;
    operational_period_key: string;
    filter_operational_reporting: string | null;
    filter_material: string | null;
    filter_payroll: string | null;
    filter_reporting_type: string | null;
    filter_business_type: string | null;
    filter_handler: string | null;
    workspace_scope: string | null;
    workspace_subject_user_id: string | null;
  };
  allowed_actions: string[];
};

export type { ClientOperationsRegistryColumn, ClientOperationsToolbarCapability, RegistryQueryInput };

export type ClientOperationsCaseResponse = {
  client: {
    id: string;
    client_name: string | null;
    tax_id: string | null;
    status: string | null;
    started_at: string | null;
    ended_at: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    notes: string | null;
  };
  primary_contact: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
  } | null;
  /** Confirmed/accepted users list (invited by email and joined) for מטפל בתיק dropdown. */
  handler_user_options: Array<{
    user_id: string;
    email: string;
    display_name: string;
  }>;
  profile: {
    business_type: string | null;
    payroll_flag: boolean | null;
    material_brought_flag: boolean | null;
    vat_status: string | null;
    income_tax_advance_status: string | null;
    national_insurance_status: string | null;
    national_insurance_deductions_status: string | null;
    income_tax_deductions_status: string | null;
    assigned_handler_user_id: string | null;
    assigned_handler_user_full_name: string | null;
    notes_summary: string | null;
    salary_data_received_flag: boolean | null;
    income_data_received_flag: boolean | null;
  };
  /** מיסים tab — backend-driven settings + UI hints for incomplete sections. */
  tax_settings: ClientTaxSettingsResponse;
  /** מיסים — workspace display aggregate (sections, rows, edit commands); same truth as `tax_settings`. */
  tax_tab: TaxTabWorkspaceResponse;
  /** הגדרות הנה״ח tab — פרופיל עסקי (backend-driven metadata + values) */
  accounting: ClientBusinessProfileSectionResponse;
  /** הגדרות הנה״ח — כרטיסיות סיכום (הכנסות / הוצאות / מסמכים / רכבים); null אם אין הרשאת צפייה בלשונית. */
  accounting_settings_tab: AccountingTabResponse | null;
  /** שכ״ט — מודל נתונים מלא שרת בלבד; null בלי הרשאת צפייה. */
  fees_tab: FeesTabResponse | null;
  /** שכר — מודל נתונים מלא שרת בלבד; null בלי הרשאת צפייה. */
  payroll_tab: PayrollTabResponse | null;
  /** דוח שנתי — אגרגט מלא; null בלי הרשאת צפייה. */
  annual_tab: AnnualTabResponse | null;
  /** הצהרת הון — אגרגט מלא (אותו read-model shape כמו דוח שנתי); null בלי הרשאת צפייה. */
  capital_declaration_tab: AnnualTabResponse | null;
  /** מסמכי לקוח — workspace תיקיות; null בלי הרשאת צפייה. */
  client_documents_tab: ClientDocumentsTabResponse | null;
  /** היסטוריה — read model מעל audit_log; null בלי הרשאת צפייה. */
  client_history_tab: ClientHistoryTabResponse | null;
  /** התחייבויות — read model backend-only; null בלי הרשאה. */
  client_obligations_tab: Awaited<ReturnType<typeof getClientObligationsTabReadModel>> | null;
  /** משימות — read model backend-only; null בלי הרשאה. */
  client_tasks_tab: Awaited<ReturnType<typeof getClientTasksTabReadModel>> | null;
};

const PROFILE_SELECT = [
  'client_id',
  'business_type',
  'payroll_flag',
  'material_brought_flag',
  'vat_status',
  'income_tax_advance_status',
  'national_insurance_status',
  'national_insurance_deductions_status',
  'income_tax_deductions_status',
  'assigned_handler_user_id',
  'notes_summary',
  'salary_data_received_flag',
  'income_data_received_flag',
].join(',');

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

function buildRegistryAllowedActions(ctx: RequestContext): string[] {
  const permissions = ctx.membership?.permissions ?? [];
  const actions: string[] = ['open_client_folder', 'open_notes'];
  if (permissions.includes('client_operations.view')) {
    actions.push('view_registry');
  }
  if (permissions.includes('client_operations.edit')) {
    actions.push('client_operations.edit');
  }
  return actions;
}

/** Registry columns = system columns + period-visible custom columns (same shape for empty and populated orgs). */
function buildRegistryColumnsForAggregate(input: {
  visibleCustomColumns: Array<{
    id: string;
    key: string;
    label: string;
    data_type: 'text' | 'number' | 'date' | 'boolean';
    auto_extend_to_future: boolean;
    auto_extend_from_period_key: string | null;
    legacy_baseline_period_key: string | null;
  }>;
  canEdit: boolean;
  visibilityByColumn: Map<string, string[]>;
  columnsNeedingLegacyBaseline: ClientOperationsRegistryResponse['columns_needing_legacy_baseline'];
}): ClientOperationsRegistryColumn[] {
  const needingLegacy = new Set((input.columnsNeedingLegacyBaseline ?? []).map((c) => c.column_id));
  return [
    ...CLIENT_OPERATIONS_REGISTRY_COLUMNS,
    ...input.visibleCustomColumns.map((column) => ({
      key: column.key,
      label: column.label,
      cell_kind: 'custom' as const,
      value_field: null,
      data_type: column.data_type,
      custom_column_id: column.id,
      default_width_px: 160,
      visible: true,
      system: false,
      editable: true,
      freeze_default: false,
      align: 'right' as const,
      settings_available: input.canEdit,
      auto_extend_to_future: column.auto_extend_to_future,
      auto_extend_from_period_key: column.auto_extend_from_period_key,
      visible_period_keys: input.visibilityByColumn.get(column.id) ?? [],
      legacy_baseline_required: needingLegacy.has(column.id),
      legacy_baseline_period_key: column.legacy_baseline_period_key,
    })),
  ];
}

/**
 * Canonical PRE-SEARCH state of the registry aggregate for one
 * (org, period, default period, editor capability, business filters) tuple.
 *
 * No `q` / sort applied here — `listClientOperationsRegistry` runs the EXISTING
 * `applyRegistryQueryToRows` + `materializeClientOperationsManualRows(searchQ)` on top of it
 * per request. This is what the short-TTL materialization cache stores (never a source of truth).
 */
export type ClientOperationsRegistryPreSearchMaterialization = {
  period: ClientOperationsRegistryResponse['period'];
  /** Org-scoped periods with meaningful user-entered custom/manual values (copy menu). */
  user_period_data_copy_source_periods: string[];
  /** Rows after tenant scoping, period membership and business-filter facets; before search/sort. */
  built_rows: ClientOperationsRegistryRow[];
  columns: ClientOperationsRegistryColumn[];
  note_types: ClientOperationsRegistryResponse['note_types'];
  filters: ClientOperationsRegistryFiltersContract;
  toolbar_capabilities: ClientOperationsRegistryResponse['toolbar_capabilities'];
  custom_columns_capability: ClientOperationsRegistryResponse['custom_columns_capability'];
  user_column_period_setup: ClientOperationsRegistryResponse['user_column_period_setup'];
  manual_rows_period_setup: ClientOperationsRegistryResponse['manual_rows_period_setup'];
  columns_needing_legacy_baseline: ClientOperationsRegistryResponse['columns_needing_legacy_baseline'];
  /** Pre-search manual-row values (`slot:columnKey` → text); null when a business filter hides manual rows. */
  manual_row_values_by_slot_column: Map<string, string> | null;
  stage_timings: Record<string, number>;
  materialized_at_ms: number;
};

export type ClientOperationsRegistryReadOptions = {
  /**
   * GET /registry only: reuse the pre-search materialization within its short TTL
   * (same org + period + filters + capability; `q` / sort are applied per request).
   * Commands / other read models never set this — they always rebuild fresh truth.
   */
  materializationCache?: boolean;
};

async function loadHandlerDisplayNamesByUserIds(
  _orgId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  // Attribution display for current/historical handlers — includes revoked users.
  return loadMemberDisplayNamesByUserIds(userIds);
}

/** Org handler options for the מטפל בתיק filter dropdown (stable user_id + display_name). */
async function loadOrgHandlerFilterOptions(
  orgId: string,
): Promise<Array<{ user_id: string; display_name: string }>> {
  const members = await listActiveHandlerEligibleMembers(orgId);
  return members.map((m) => ({ user_id: m.user_id, display_name: m.display_name }));
}

function registryQueryEcho(
  query: RegistryQueryInput,
  selectedPeriodKey: string,
): ClientOperationsRegistryResponse['query'] {
  const q = (query.q ?? '').trim() || null;
  const sort_by = query.sort_by?.trim() || null;
  const sort_dir = query.sort_dir === 'desc' || query.sort_dir === 'asc' ? query.sort_dir : null;
  const active = normalizeClientOperationsRegistryBusinessFilterQuery(query);
  return {
    q,
    sort_by,
    sort_dir,
    operational_period_key: selectedPeriodKey,
    filter_operational_reporting:
      active.operational_reporting === 'all' ? null : active.operational_reporting,
    filter_material: active.material === 'all' ? null : active.material,
    filter_payroll: active.payroll === 'all' ? null : active.payroll,
    filter_reporting_type: active.reporting_type === 'all' ? null : active.reporting_type,
    filter_business_type: active.business_type === 'all' ? null : active.business_type,
    filter_handler: active.handler === 'all' ? null : active.handler,
    workspace_scope: query.workspace_scope?.trim() || null,
    workspace_subject_user_id: query.workspace_subject_user_id?.trim() || null,
  };
}

export async function listClientOperationsRegistry(
  ctx: RequestContext,
  query: RegistryQueryInput = {},
  options?: ClientOperationsRegistryReadOptions,
): Promise<ClientOperationsRegistryResponse> {
  const aggregateStartMs = Date.now();

  // Tenant + RBAC + Stage 3 ACL + Stage 4 workspace BEFORE any cache lookup.
  const orgId = assertOrg(ctx);
  const { workspace, materializationAccess } = await resolveClientOperationsWorkspaceScopeFromContext(ctx, {
    workspace_scope: query.workspace_scope,
    workspace_subject_user_id: query.workspace_subject_user_id,
  });
  const selectedPeriodKey = resolveRegistryOperationalPeriodKey(query.operational_period_key);
  const defaultPeriodKey = resolveDefaultOperationalPeriodKey();
  const canEditRegistry =
    ctx.membership?.permissions?.includes('client_operations.edit') === true;
  const filterActive = normalizeClientOperationsRegistryBusinessFilterQuery(query);
  const anyBusinessFilter = isAnyClientOperationsBusinessFilterActive(filterActive);

  // PRE-SEARCH materialization: expensive; keyed by every dimension that changes base rows (never q/sort).
  // accessScopeKey = workspace projection (OFFICE / ASSIGNED:<subject>). canEditRegistry separates
  // viewer action capability so Owner editability cannot leak into Staff view-only caches.
  const buildMaterialization = () =>
    buildClientOperationsRegistryPreSearchMaterialization({
      orgId,
      accessScope: materializationAccess,
      selectedPeriodKey,
      defaultPeriodKey,
      canEditRegistry,
      filterActive,
      anyBusinessFilter,
    });
  let materialization: ClientOperationsRegistryPreSearchMaterialization;
  let materializationSource: 'bypass' | BoundedTtlCacheSource;
  if (options?.materializationCache === true) {
    const cacheKey = buildClientOperationsRegistryMaterializationCacheKey({
      organizationId: orgId,
      accessScopeKey: materializationAccess.access_scope_key,
      selectedPeriodKey,
      defaultPeriodKey,
      canEditRegistry,
      filters: filterActive,
    });
    const resolved = await clientOperationsRegistryMaterializationCache.getOrBuild(
      cacheKey,
      buildMaterialization,
    );
    materialization = resolved.value;
    materializationSource = resolved.source;
  } else {
    materialization = await buildMaterialization();
    materializationSource = 'bypass';
  }

  // Request-scoped search / sort on canonical pre-search rows — the EXISTING matching function.
  const searchMs = Date.now();
  const q = (query.q ?? '').trim() || null;
  const sort_by = query.sort_by?.trim() || null;
  const sort_dir = query.sort_dir === 'desc' || query.sort_dir === 'asc' ? query.sort_dir : null;
  // Business filters already applied via early facet matching; search/sort still apply.
  const rows = applyRegistryQueryToRows(materialization.built_rows, { q, sort_by, sort_dir });
  // Manual rows: same pipeline as buildManualRowsForRegistryAggregate — values loaded pre-search,
  // `materializeClientOperationsManualRows` applies searchQ per request.
  const manual_rows = anyBusinessFilter
    ? []
    : materializeClientOperationsManualRows({
        columnKeys: materialization.columns.map((c) => c.key),
        valuesBySlotColumn: materialization.manual_row_values_by_slot_column ?? new Map(),
        searchQ: q,
      });
  const searchAndSortMs = Date.now() - searchMs;

  const response: ClientOperationsRegistryResponse = {
    title_he: 'תפעול לקוחות',
    period: materialization.period,
    user_period_data_copy_source_periods: materialization.user_period_data_copy_source_periods,
    rows,
    manual_rows,
    columns: materialization.columns,
    note_types: materialization.note_types,
    toolbar_capabilities: materialization.toolbar_capabilities,
    custom_columns_capability: materialization.custom_columns_capability,
    user_column_period_setup: materialization.user_column_period_setup,
    manual_rows_period_setup: materialization.manual_rows_period_setup,
    columns_needing_legacy_baseline: materialization.columns_needing_legacy_baseline,
    manual_status_paint_modes: manualStatusPaintModesForAggregate(),
    filters: materialization.filters,
    workspace: workspaceAggregateContract(workspace),
    query: registryQueryEcho(
      {
        ...query,
        workspace_scope:
          workspace.scope_kind === 'OFFICE'
            ? 'office'
            : workspace.scope_kind === 'MY'
              ? 'my'
              : 'staff',
        workspace_subject_user_id: workspace.workspace_subject_user_id,
      },
      selectedPeriodKey,
    ),
    allowed_actions: buildRegistryAllowedActions(ctx),
  };
  const reusedMaterialization =
    materializationSource === 'hit' || materializationSource === 'coalesced';
  logAggregatePayloadBreakdown(
    'client_operations_registry_aggregate',
    response as unknown as Record<string, unknown>,
    {
      organization_id: orgId,
      duration_ms: Date.now() - aggregateStartMs,
      stage_timings: {
        ...(reusedMaterialization ? {} : materialization.stage_timings),
        materialization_cache_hit: reusedMaterialization ? 1 : 0,
        search_sort_manual_rows: searchAndSortMs,
      },
    },
  );
  return response;
}

/**
 * Expensive PRE-SEARCH aggregate build (tenant-scoped, period-resolved, business-filtered rows).
 * Pure read of business truth; never applies `q` / sort. Called directly by commands / other read
 * models, and through the short-TTL materialization cache by GET /registry.
 */
async function buildClientOperationsRegistryPreSearchMaterialization(input: {
  orgId: string;
  accessScope: OrganizationClientAccessScope;
  selectedPeriodKey: string;
  defaultPeriodKey: string;
  canEditRegistry: boolean;
  filterActive: ReturnType<typeof normalizeClientOperationsRegistryBusinessFilterQuery>;
  anyBusinessFilter: boolean;
}): Promise<ClientOperationsRegistryPreSearchMaterialization> {
  const {
    orgId,
    accessScope,
    selectedPeriodKey,
    defaultPeriodKey,
    canEditRegistry,
    filterActive,
    anyBusinessFilter,
  } = input;
  const stageTimings: Record<string, number> = {};
  const markStage = (name: string, startedMs: number) => {
    stageTimings[name] = Date.now() - startedMs;
  };

  // Pure read: user-slot / period-setup initialization is ONLY via named commands.
  const bootMs = Date.now();
  const [noteTypesResult, customColumnsExtended, availablePeriods, userPeriodDataCopySourcePeriods, handlerFilterOptions] =
    await Promise.all([
      listOperationalNoteTypes(),
      loadActiveCustomColumnsExtended(orgId),
      listKnownOperationalPeriodKeys(orgId),
      loadUserPeriodDataCopySourcePeriods(orgId),
      loadOrgHandlerFilterOptions(orgId),
    ]);
  markStage('boot_note_types_columns_periods_handlers', bootMs);
  const customColumns = customColumnsExtended;
  const noteTypes = noteTypesResult.types;
  const period = {
    selected_period_key: selectedPeriodKey,
    default_period_key: defaultPeriodKey,
    available_periods: availablePeriods,
  };
  // Static definitions are cheap; handler options already loaded once for this request.
  const filtersContract = buildClientOperationsRegistryFiltersContract({
    active: filterActive,
    handlerOptions: handlerFilterOptions,
  });
  // Reuse org handler options for row display names — no second membership round-trip.
  const handlerDisplayByUserId = new Map(
    handlerFilterOptions.map((h) => [h.user_id, h.display_name] as const),
  );

  type RegistryClientRow = {
    id: string;
    display_name: string | null;
    tax_id: string | null;
    created_at: string | null;
    is_archived: boolean;
  };

  const setupMs = Date.now();
  // Assigned-only scope: empty authorized set ⇒ empty client rows (no org-wide leak).
  const assignedOnlyIds =
    accessScope.kind === 'ASSIGNED_TO_SELF' ? (accessScope.authorized_client_ids ?? []) : null;
  if (assignedOnlyIds && assignedOnlyIds.length === 0) {
    const userColumnsPeriodExtras = await buildUserColumnsPeriodAggregateExtras({
      organizationId: orgId,
      columns: customColumnsExtended,
      selectedPeriodKey,
      availablePeriods,
      canEdit: canEditRegistry,
    });
    const visibleCustomColumns = userColumnsPeriodExtras.visibleColumns;
    const customColumnsCapability = buildCustomColumnsCapability({
      current: customColumns.length,
      canEdit: canEditRegistry,
    });
    const toolbarCapabilities = buildClientOperationsToolbarCapabilities({
      can_create_custom_column: customColumnsCapability.can_create,
      can_create_reason_he:
        customColumnsCapability.current >= customColumnsCapability.max
          ? 'הגעת למגבלת 10 עמודות מותאמות אישית'
          : null,
    });
    const columns = buildRegistryColumnsForAggregate({
      visibleCustomColumns,
      canEdit: canEditRegistry,
      visibilityByColumn: userColumnsPeriodExtras.visibilityByColumn,
      columnsNeedingLegacyBaseline: userColumnsPeriodExtras.columns_needing_legacy_baseline,
    });
    const manualRowsPeriodSetup = await buildManualRowsPeriodSetupForAggregate({
      organizationId: orgId,
      operationalPeriodKey: selectedPeriodKey,
      canEdit: canEditRegistry,
    });
    markStage('assigned_scope_empty', setupMs);
    return {
      period,
      user_period_data_copy_source_periods: userPeriodDataCopySourcePeriods,
      built_rows: [],
      columns,
      note_types: noteTypes,
      filters: filtersContract,
      toolbar_capabilities: toolbarCapabilities,
      custom_columns_capability: customColumnsCapability,
      user_column_period_setup: userColumnsPeriodExtras.user_column_period_setup,
      manual_rows_period_setup: manualRowsPeriodSetup,
      columns_needing_legacy_baseline: userColumnsPeriodExtras.columns_needing_legacy_baseline,
      manual_row_values_by_slot_column: anyBusinessFilter
        ? null
        : await loadManualRowValuesBySlotColumnForRegistryAggregate({
            organizationId: orgId,
            operationalPeriodKey: selectedPeriodKey,
          }),
      stage_timings: stageTimings,
      materialized_at_ms: Date.now(),
    };
  }

  let activeClientsQuery = supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id, created_at, is_archived')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('display_name', { ascending: true });
  if (assignedOnlyIds) {
    activeClientsQuery = activeClientsQuery.in('id', assignedOnlyIds);
  }

  const [
    userColumnsPeriodExtras,
    manualRowsPeriodSetup,
    activeClientsResult,
    manualRowValuesBySlotColumn,
  ] = await Promise.all([
    buildUserColumnsPeriodAggregateExtras({
      organizationId: orgId,
      columns: customColumnsExtended,
      selectedPeriodKey,
      availablePeriods,
      canEdit: canEditRegistry,
    }),
    buildManualRowsPeriodSetupForAggregate({
      organizationId: orgId,
      operationalPeriodKey: selectedPeriodKey,
      canEdit: canEditRegistry,
    }),
    activeClientsQuery,
    // Manual rows are organization-wide free-text slots (not client records). Keep for all scopes;
    // they cannot leak canonical client identity. Hidden under business filters as before.
    anyBusinessFilter
      ? Promise.resolve(null)
      : loadManualRowValuesBySlotColumnForRegistryAggregate({
          organizationId: orgId,
          operationalPeriodKey: selectedPeriodKey,
        }),
  ]);
  markStage('user_columns_manual_setup_clients', setupMs);
  const visibleCustomColumns = userColumnsPeriodExtras.visibleColumns;
  const { data: activeClients } = activeClientsResult;
  const customColumnsCapability = buildCustomColumnsCapability({
    current: customColumns.length,
    canEdit: canEditRegistry,
  });
  const toolbarCapabilities = buildClientOperationsToolbarCapabilities({
    can_create_custom_column: customColumnsCapability.can_create,
    can_create_reason_he:
      customColumnsCapability.current >= customColumnsCapability.max
        ? 'הגעת למגבלת 10 עמודות מותאמות אישית'
        : null,
  });
  const columns = buildRegistryColumnsForAggregate({
    visibleCustomColumns,
    canEdit: canEditRegistry,
    visibilityByColumn: userColumnsPeriodExtras.visibilityByColumn,
    columnsNeedingLegacyBaseline: userColumnsPeriodExtras.columns_needing_legacy_baseline,
  });
  const finishMaterialization = (
    builtRows: ClientOperationsRegistryRow[],
  ): ClientOperationsRegistryPreSearchMaterialization => ({
    period,
    user_period_data_copy_source_periods: userPeriodDataCopySourcePeriods,
    built_rows: builtRows,
    columns,
    note_types: noteTypes,
    filters: filtersContract,
    toolbar_capabilities: toolbarCapabilities,
    custom_columns_capability: customColumnsCapability,
    user_column_period_setup: userColumnsPeriodExtras.user_column_period_setup,
    manual_rows_period_setup: manualRowsPeriodSetup,
    columns_needing_legacy_baseline: userColumnsPeriodExtras.columns_needing_legacy_baseline,
    manual_row_values_by_slot_column: manualRowValuesBySlotColumn,
    stage_timings: stageTimings,
    materialized_at_ms: Date.now(),
  });

  const isCurrentOrDefaultPeriod = selectedPeriodKey === defaultPeriodKey;
  const activeSafe = (activeClients ?? []) as RegistryClientRow[];
  let safeClients: RegistryClientRow[] = activeSafe;

  if (!isCurrentOrDefaultPeriod) {
    // Historical period: keep live active clients, and re-include archived clients
    // that already have frozen membership (snapshot and/or material fact) for this period.
    const membershipIds = filterAuthorizedClientIds(
      accessScope,
      await loadPeriodMembershipClientIds({
        organizationId: orgId,
        operationalPeriodKey: selectedPeriodKey,
      }),
    );
    const activeIdSet = new Set(activeSafe.map((c) => c.id));
    const archivedMembershipIds = membershipIds.filter((id) => !activeIdSet.has(id));
    if (archivedMembershipIds.length) {
      const { data: membershipClients } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, tax_id, created_at, is_archived')
        .eq('organization_id', orgId)
        .in('id', archivedMembershipIds);
      const historicalExtras = ((membershipClients ?? []) as RegistryClientRow[]).filter((c) =>
        shouldIncludeArchivedClientInOperationalPeriodRegistry({
          is_current_or_default_period: false,
          is_archived: Boolean(c.is_archived),
          has_frozen_period_membership: true,
        }),
      );
      safeClients = [...activeSafe, ...historicalExtras].sort((a, b) =>
        String(a.display_name ?? '').localeCompare(String(b.display_name ?? ''), 'he'),
      );
    }
  }

  // Created-after-period protection (active + historical membership alike).
  safeClients = safeClients.filter((c) =>
    clientExistsInOperationalPeriod({
      client_created_at: c.created_at,
      operational_period_key: selectedPeriodKey,
    }),
  );

  if (safeClients.length === 0) {
    // Empty-client org still exposes five backend-owned manual slots (values may be empty),
    // unless a business filter is active (manual rows cannot match client business filters).
    return finishMaterialization([]);
  }

  const clientIds = safeClients.map((c) => c.id);
  const annualReportTaxYear = resolveAnnualReportTaxYearForOperationalPeriod(selectedPeriodKey);
  const payrollPeriodKey = mapOperationalPeriodKeyToPayrollPeriodKey(selectedPeriodKey);

  // Phase 1 — set-based inputs required to compute row filter facets (all clients).
  const phase1Ms = Date.now();
  const [
    { data: profiles },
    { data: taxSettingsRows },
    existingSnapshots,
    materialFacts,
    payrollSalaryByClient,
    manualStatusesByClientColumn,
  ] = await Promise.all([
    supabaseAdmin
      .from('client_operational_profiles')
      .select(PROFILE_SELECT)
      .eq('organization_id', orgId)
      .in('client_id', clientIds),
    supabaseAdmin
      .from('client_tax_settings')
      .select(
        'client_id, vat_due_type, vat_frequency, vat_type, income_tax_advance_enabled, income_tax_advance_frequency, national_insurance_type, national_insurance_monthly_amount, national_insurance_deductions_file_number, income_tax_deductions_enabled, income_tax_deductions_file_number, income_tax_deductions_frequency'
      )
      .eq('organization_id', orgId)
      .in('client_id', clientIds),
    loadPeriodApplicabilitySnapshots({
      organizationId: orgId,
      operationalPeriodKey: selectedPeriodKey,
      clientIds,
    }),
    loadPeriodMaterialFacts({
      organizationId: orgId,
      operationalPeriodKey: selectedPeriodKey,
      clientIds,
    }),
    loadPayrollPeriodSalaryDataReceived({
      organizationId: orgId,
      payrollPeriodKey,
      clientIds,
    }),
    loadManualCellStatusesForPeriod({
      organizationId: orgId,
      operationalPeriodKey: selectedPeriodKey,
      clientIds,
    }),
  ]);
  markStage('phase1_facet_inputs', phase1Ms);
  const customColumnKeys = new Set(visibleCustomColumns.map((c) => c.key));
  const paintableColumnKeys = [
    ...CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((c) => c.key).filter((key) =>
      isClientOperationsManualStatusPaintableColumnKey(key),
    ),
    ...visibleCustomColumns.map((c) => c.key),
  ];
  const profilesByClientId = new Map<string, Record<string, unknown>>();
  for (const p of (profiles ?? []) as unknown as Array<{ client_id: string }>) {
    profilesByClientId.set(p.client_id, p as Record<string, unknown>);
  }

  const taxByClient = new Map<
    string,
    {
      vat_due_type: string | null;
      vat_frequency: string | null;
      vat_type: string | null;
      income_tax_advance_enabled: boolean;
      income_tax_advance_frequency: string | null;
      national_insurance_type: string | null;
      national_insurance_monthly_amount: number | null;
      national_insurance_deductions_file_number: string | null;
      income_tax_deductions_enabled: boolean;
      income_tax_deductions_file_number: string | null;
      income_tax_deductions_frequency: string | null;
    }
  >();
  for (const t of (taxSettingsRows ?? []) as Array<{
    client_id: string;
    vat_due_type: string | null;
    vat_frequency: string | null;
    vat_type: string | null;
    income_tax_advance_enabled: boolean | null;
    income_tax_advance_frequency: string | null;
    national_insurance_type: string | null;
    national_insurance_monthly_amount: number | null;
    national_insurance_deductions_file_number: string | null;
    income_tax_deductions_enabled: boolean | null;
    income_tax_deductions_file_number: string | null;
    income_tax_deductions_frequency: string | null;
  }>) {
    taxByClient.set(t.client_id, {
      vat_due_type: t.vat_due_type,
      vat_frequency: t.vat_frequency,
      vat_type: t.vat_type,
      income_tax_advance_enabled: Boolean(t.income_tax_advance_enabled),
      income_tax_advance_frequency: t.income_tax_advance_frequency,
      national_insurance_type: t.national_insurance_type,
      national_insurance_monthly_amount: t.national_insurance_monthly_amount,
      national_insurance_deductions_file_number: t.national_insurance_deductions_file_number,
      income_tax_deductions_enabled: Boolean(t.income_tax_deductions_enabled),
      income_tax_deductions_file_number: t.income_tax_deductions_file_number,
      income_tax_deductions_frequency: t.income_tax_deductions_frequency,
    });
  }

  const periodSources: ClientPeriodSourceRow[] = safeClients
    // Never invent historical applicability for archived clients — membership only via frozen snapshot/material.
    .filter((client) => !client.is_archived)
    .map((client) => {
    const profile = profilesByClientId.get(client.id);
    const tax = taxByClient.get(client.id);
    return {
      client_id: client.id,
      client_created_at: client.created_at,
      inputs: {
        vat_type: tax?.vat_type ?? null,
        vat_frequency: tax?.vat_frequency ?? null,
        payroll_flag: (profile?.payroll_flag as boolean | null) ?? null,
        income_tax_advance_enabled: tax?.income_tax_advance_enabled ?? null,
        income_tax_advance_frequency: tax?.income_tax_advance_frequency ?? null,
        income_tax_deductions_enabled: tax?.income_tax_deductions_enabled ?? null,
        income_tax_deductions_file_number: tax?.income_tax_deductions_file_number ?? null,
        income_tax_deductions_frequency: tax?.income_tax_deductions_frequency ?? null,
        national_insurance_type: tax?.national_insurance_type ?? null,
        national_insurance_monthly_amount: tax?.national_insurance_monthly_amount ?? null,
        national_insurance_deductions_file_number:
          tax?.national_insurance_deductions_file_number ?? null,
      },
    };
  });
  const snapshotEnsureMs = Date.now();
  const snapshots = await ensurePeriodApplicabilitySnapshots({
    organizationId: orgId,
    operationalPeriodKey: selectedPeriodKey,
    sources: periodSources,
    existing: existingSnapshots,
  });
  markStage('period_snapshot_ensure', snapshotEnsureMs);
  period.available_periods = mergeSelectedPeriodIntoAvailablePeriods({
    availablePeriods: period.available_periods,
    selectedPeriodKey,
  });

  const isCurrentOpenPeriod = selectedPeriodKey === defaultPeriodKey;

  // Early membership + filter facets (before expensive presentation loads).
  // Registry membership != cell applicability — shouldEmitOperationalPeriodRegistryRow owns row visibility.
  const facetBuildMs = Date.now();
  type FacetSeed = {
    client: (typeof safeClients)[number];
    filter_facets: ClientOperationsRegistryRowFilterFacets;
    hasPayroll: boolean;
    vatApplicable: boolean;
    advanceDue: boolean;
    niConfigured: boolean;
    niDeductionsConfigured: boolean;
    incomeTaxDeductionsDue: boolean;
    incomeTaxDeductionsConfigured: boolean;
    materialBroughtCell: ReturnType<typeof resolveMaterialBroughtForPeriod>;
    incomeTaxAdvanceCell: ReturnType<typeof resolveIncomeTaxAdvanceMaterialForPeriod>;
    payrollCell: ReturnType<typeof resolvePayrollMaterialForPeriod>;
  };
  const facetSeeds: FacetSeed[] = [];
  for (const c of safeClients) {
    const snapshot = snapshots.get(c.id);
    const hasMaterialMembership = materialFacts.has(c.id);
    if (
      !shouldEmitOperationalPeriodRegistryRow({
        is_archived: Boolean(c.is_archived),
        has_applicability_snapshot: Boolean(snapshot),
        has_material_fact: hasMaterialMembership,
        snapshot_row_visible: snapshot?.row_visible ?? null,
      })
    ) {
      continue;
    }
    const p = profilesByClientId.get(c.id);
    const tax = taxByClient.get(c.id);
    // Current/open period: live tax is canonical (empty pre-setup snapshot must not shadow).
    // Historical periods: frozen snapshot inputs win.
    const vatTypeLiveOrFrozen = isCurrentOpenPeriod
      ? (tax?.vat_type ?? null)
      : (snapshot?.vat_type ?? tax?.vat_type ?? null);
    const vatFrequencyLiveOrFrozen = isCurrentOpenPeriod
      ? (tax?.vat_frequency ?? null)
      : (snapshot?.vat_frequency ?? tax?.vat_frequency ?? null);
    const vatConfigured = resolveVatObligationConfigured({
      vat_type: vatTypeLiveOrFrozen,
      vat_frequency: vatFrequencyLiveOrFrozen,
    });
    const vatDue = isCurrentOpenPeriod
      ? resolveVatApplicabilityForOperationalPeriod({
          vat_type: vatTypeLiveOrFrozen,
          vat_frequency: vatFrequencyLiveOrFrozen,
          operational_period_key: selectedPeriodKey,
        })
      : Boolean(snapshot?.vat_applicable);
    const vatApplicable = vatDue;
    const hasPayroll = isCurrentOpenPeriod
      ? resolvePayrollApplicabilityFromDeductionsFiles({
          income_tax_deductions_file_number: tax?.income_tax_deductions_file_number ?? null,
          national_insurance_deductions_file_number:
            tax?.national_insurance_deductions_file_number ?? null,
        })
      : resolvePayrollApplicabilityFromFrozenSnapshot({
          payroll_applicable: snapshot?.payroll_applicable,
          income_tax_deductions_enabled: snapshot?.income_tax_deductions_enabled,
          national_insurance_deductions_file_number:
            snapshot?.national_insurance_deductions_file_number,
        });
    const payrollConfigured = isCurrentOpenPeriod
      ? resolvePayrollObligationConfigured({
          income_tax_deductions_file_number: tax?.income_tax_deductions_file_number ?? null,
          national_insurance_deductions_file_number:
            tax?.national_insurance_deductions_file_number ?? null,
        })
      : hasPayroll || Boolean(snapshot?.payroll_applicable);
    const advanceEnabledLiveOrFrozen = isCurrentOpenPeriod
      ? (tax?.income_tax_advance_enabled ?? null)
      : (snapshot?.income_tax_advance_enabled ?? tax?.income_tax_advance_enabled ?? null);
    const advanceFrequencyLiveOrFrozen = isCurrentOpenPeriod
      ? (tax?.income_tax_advance_frequency ?? null)
      : (snapshot?.income_tax_advance_frequency ?? tax?.income_tax_advance_frequency ?? null);
    const advanceConfigured = resolveIncomeTaxAdvanceConfigured(advanceEnabledLiveOrFrozen);
    const advanceDue = isCurrentOpenPeriod
      ? advanceConfigured &&
        isIncomeTaxFrequencyApplicableForOperationalPeriod(
          advanceFrequencyLiveOrFrozen,
          selectedPeriodKey,
        )
      : Boolean(snapshot?.income_tax_advance_applicable);
    const niConfigured = isCurrentOpenPeriod
      ? resolveNationalInsuranceApplicability(tax?.national_insurance_type ?? null)
      : Boolean(snapshot?.national_insurance_applicable);
    const niDeductionsConfigured = isCurrentOpenPeriod
      ? resolveNationalInsuranceDeductionsApplicability(
          tax?.national_insurance_deductions_file_number ?? null,
        )
      : Boolean(snapshot?.national_insurance_deductions_applicable);
    const periodFact = materialFacts.get(c.id);
    const materialBroughtCell = resolveMaterialBroughtForPeriod({
      period_fact: periodFact?.material_brought,
      has_period_fact: materialFacts.has(c.id),
      legacy_profile_flag: (p?.material_brought_flag as boolean | null) ?? null,
      operational_period_key: selectedPeriodKey,
      default_period_key: defaultPeriodKey,
      vat_configured: vatConfigured,
      vat_due: vatDue,
    });
    const incomeTaxAdvanceCell = resolveIncomeTaxAdvanceMaterialForPeriod({
      period_fact: periodFact?.income_tax_advance_material_brought,
      has_period_fact: materialFacts.has(c.id),
      legacy_profile_flag: (p?.income_data_received_flag as boolean | null) ?? null,
      operational_period_key: selectedPeriodKey,
      default_period_key: defaultPeriodKey,
      advance_configured: advanceConfigured,
      advance_due: advanceDue,
    });
    const payrollCell = resolvePayrollMaterialForPeriod({
      payroll_configured: payrollConfigured,
      payroll_due: hasPayroll,
      salary_data_received: payrollSalaryByClient.get(c.id),
    });
    const incomeTaxDeductionsDue = isCurrentOpenPeriod
      ? resolveIncomeTaxDeductionsApplicability({
          file_number: tax?.income_tax_deductions_file_number ?? null,
          frequency: tax?.income_tax_deductions_frequency ?? null,
          operational_period_key: selectedPeriodKey,
        })
      : Boolean(snapshot?.income_tax_deductions_applicable);
    const incomeTaxDeductionsConfigured =
      incomeTaxDeductionsDue ||
      (isCurrentOpenPeriod
        ? resolveIncomeTaxDeductionsConfigured({
            file_number: tax?.income_tax_deductions_file_number ?? null,
            income_tax_deductions_enabled: tax?.income_tax_deductions_enabled ?? null,
            income_tax_deductions_frequency: tax?.income_tax_deductions_frequency ?? null,
          })
        : resolveIncomeTaxDeductionsConfigured({
            income_tax_deductions_enabled: snapshot?.income_tax_deductions_enabled ?? null,
            income_tax_deductions_frequency: snapshot?.income_tax_deductions_frequency ?? null,
          }));
    const material_cells = buildMaterialCells({
      vat: materialBroughtCell,
      income_tax_advance: incomeTaxAdvanceCell,
      payroll: payrollCell,
    });
    const period_applicability = {
      vat_applicable: vatApplicable,
      payroll_applicable: hasPayroll,
      income_tax_advance_applicable: advanceDue,
      income_tax_deductions_applicable: incomeTaxDeductionsDue,
      national_insurance_applicable: niConfigured,
      national_insurance_deductions_applicable: niDeductionsConfigured,
      row_visible: snapshot?.row_visible ?? true,
    };
    const manual_cell_statuses = buildManualStatusCapabilitiesForRow({
      clientId: c.id,
      columnKeys: paintableColumnKeys,
      customColumnKeys,
      statuses: manualStatusesByClientColumn,
      materialSquareCount: countMaterialOperationalSquares({
        vatApplicable: materialBroughtCell.configured,
        incomeTaxAdvanceApplicable: incomeTaxAdvanceCell.configured,
        payrollApplicable: payrollCell.configured,
      }),
      niDeductionsSquareCount: 0,
      incomeTaxDeductionsSquareCount: incomeTaxDeductionsConfigured ? 1 : 0,
    });
    const advanceEnabledForFacet = advanceEnabledLiveOrFrozen;
    const advanceFrequencyForFacet = advanceFrequencyLiveOrFrozen;
    const vatTypeForFacet = vatTypeLiveOrFrozen;
    const vatFrequencyForFacet = vatFrequencyLiveOrFrozen;
    const itdFrequencyForFacet = isCurrentOpenPeriod
      ? (tax?.income_tax_deductions_frequency ?? null)
      : (snapshot?.income_tax_deductions_frequency ?? tax?.income_tax_deductions_frequency ?? null);
    const filter_facets = buildClientOperationsRegistryRowFilterFacets({
      period_applicability,
      manual_cell_statuses,
      material_cells,
      payroll_applicable: hasPayroll,
      business_type: (p?.business_type as string | null) ?? null,
      assigned_handler_user_id: (p?.assigned_handler_user_id as string | null) ?? null,
      income_tax_advance_profile_status: (p?.income_tax_advance_status as string | null) ?? null,
      income_tax_advance_enabled: advanceEnabledForFacet,
      income_tax_advance_frequency: advanceFrequencyForFacet,
      vat_type: vatTypeForFacet,
      vat_frequency: vatFrequencyForFacet,
      income_tax_deductions_configured: incomeTaxDeductionsConfigured,
      income_tax_deductions_frequency: itdFrequencyForFacet,
    });
    if (anyBusinessFilter && !rowMatchesClientOperationsBusinessFilters(filter_facets, filterActive)) {
      continue;
    }
    facetSeeds.push({
      client: c,
      filter_facets,
      hasPayroll,
      vatApplicable,
      advanceDue,
      niConfigured,
      niDeductionsConfigured,
      incomeTaxDeductionsDue,
      incomeTaxDeductionsConfigured,
      materialBroughtCell,
      incomeTaxAdvanceCell,
      payrollCell,
    });
  }
  markStage('facet_build_and_early_filter', facetBuildMs);

  const matchingClientIds = facetSeeds.map((s) => s.client.id);
  const matchingIdSet = new Set(matchingClientIds);

  // Phase 2 — presentation-only set-based loads for matching clients (or all when unfiltered).
  const phase2Ms = Date.now();
  const [
    notesByClient,
    customValuesByClientAndColumn,
    incomeTaxDeductionsReportedByClient,
    annualReportInstancesByClient,
    openCapitalInstancesByClient,
    niDeductionsPeriodFlagsByClient,
    niDeductions126FactsByClient,
    earliestNiDeductionsApplicableByClient,
  ] = matchingClientIds.length
    ? await Promise.all([
        loadNotesAggregatesByClient(orgId, matchingClientIds),
        loadPeriodCustomColumnValues(
          orgId,
          selectedPeriodKey,
          matchingClientIds,
          visibleCustomColumns.map((c) => c.id),
        ),
        loadIncomeTaxDeductionsPeriodReported({
          organizationId: orgId,
          operationalPeriodKey: selectedPeriodKey,
          clientIds: matchingClientIds,
        }),
        loadAnnualReportYearInstancesForClients({
          organizationId: orgId,
          clientIds: matchingClientIds,
          taxYear: annualReportTaxYear,
        }),
        loadOpenCapitalDeclarationInstancesForClients({
          organizationId: orgId,
          clientIds: matchingClientIds,
        }),
        loadNiDeductionsPeriodFlagsForClients({
          organizationId: orgId,
          clientIds: matchingClientIds,
          operationalPeriodKey: selectedPeriodKey,
        }),
        loadNiDeductions126CycleFactsForClients({
          organizationId: orgId,
          clientIds: matchingClientIds,
        }),
        loadEarliestNiDeductionsApplicablePeriodKeysForClients({
          organizationId: orgId,
          clientIds: matchingClientIds,
        }),
      ])
    : [
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Map(),
      ];
  markStage('phase2_presentation_loads', phase2Ms);

  const annualReportCells = projectAnnualReportCells({
    clientIds: matchingClientIds,
    taxYear: annualReportTaxYear,
    instancesByClientId: annualReportInstancesByClient,
    canEdit: canEditRegistry,
  });
  const capitalDeclarationCells = projectCapitalDeclarationCells({
    clientIds: matchingClientIds,
    openByClientId: openCapitalInstancesByClient,
    canEdit: canEditRegistry,
  });

  const presentationMs = Date.now();
  const builtRows: ClientOperationsRegistryRow[] = facetSeeds.flatMap((seed) => {
    const c = seed.client;
    if (!matchingIdSet.has(c.id)) return [];
    const snapshot = snapshots.get(c.id);
    const p = profilesByClientId.get(c.id);
    const noteAgg = buildNotesCellDisplayHe(notesByClient.get(c.id) ?? []);
    const tax = taxByClient.get(c.id);
    const bt = (p?.business_type as string | null) ?? null;
    // Current/open: live tax for display labels. Historical: frozen snapshot inputs.
    const vatTypeForDisplay = isCurrentOpenPeriod
      ? (tax?.vat_type ?? null)
      : snapshot != null
        ? snapshot.vat_type
        : (tax?.vat_type ?? null);
    const vatFrequencyForDisplay = isCurrentOpenPeriod
      ? (tax?.vat_frequency ?? null)
      : snapshot != null
        ? snapshot.vat_frequency
        : (tax?.vat_frequency ?? null);
    const vat_due_registry_display_he = tax
      ? computeVatDueRegistryDisplayHe(tax.vat_due_type, tax.vat_frequency)
      : null;
    const vatFromTax = computeVatRegistryColumnDisplayHe(
      bt,
      vatTypeForDisplay,
      vatFrequencyForDisplay,
    );
    const niFromTax = tax
      ? formatNationalInsuranceRegistryDisplayHe(tax.national_insurance_type, tax.national_insurance_monthly_amount)
      : null;
    const incomeDedProfile = (p?.income_tax_deductions_status as string | null) ?? null;
    const niDedFromTax =
      tax != null
        ? computeNationalInsuranceDeductionsRegistryDisplayHe(
            {
              income_tax_deductions_enabled: tax.income_tax_deductions_enabled,
              income_tax_deductions_file_number: tax.income_tax_deductions_file_number,
              income_tax_deductions_frequency: tax.income_tax_deductions_frequency,
            },
            incomeDedProfile
          )
        : computeNationalInsuranceDeductionsRegistryDisplayHe(null, incomeDedProfile);
    const {
      hasPayroll,
      vatApplicable,
      advanceDue,
      niConfigured,
      niDeductionsConfigured,
      materialBroughtCell,
      incomeTaxAdvanceCell,
      payrollCell,
    } = seed;
    const material_brought_flag = materialBroughtCell.applicable ? materialBroughtCell.value : null;
    const payroll_flag: boolean | null = hasPayroll ? true : null;
    const annual_report_cell = annualReportCells.get(c.id) ?? {
      applicable: true,
      editable: canEditRegistry,
      tax_year: annualReportTaxYear,
      instance_id: null,
      operational_target_date: null,
    };
    const capital_declaration_cell = capitalDeclarationCells.get(c.id) ?? {
      applicable: false,
      editable: false,
      instance_id: null,
      tax_year: null,
      operational_target_date: null,
      can_open: canEditRegistry,
    };
    // NI deductions: configured (= file) is due every month when configured (no separate cadence).
    const national_insurance_deductions_cell = buildNiDeductionsRegistryCellForClient({
      configured: niDeductionsConfigured,
      due: niDeductionsConfigured,
      periodFlags: niDeductionsPeriodFlagsByClient.get(c.id),
      cycleFacts: niDeductions126FactsByClient.get(c.id),
      operationalPeriodKey: selectedPeriodKey,
      earliestApplicablePeriodKey: earliestNiDeductionsApplicableByClient.get(c.id) ?? null,
    });
    const income_tax_deductions_cell = buildIncomeTaxDeductionsRegistryCell({
      configured: seed.incomeTaxDeductionsConfigured,
      due: seed.incomeTaxDeductionsDue,
      completed: incomeTaxDeductionsReportedByClient.get(c.id) ?? false,
    });
    const pcn_display = formatPcnRegistryDisplay(tax?.vat_due_type ?? null);
    const vat_status = vatFromTax ?? (p?.vat_status as string | null) ?? null;
    const income_tax_advance_status = formatIncomeTaxAdvanceRegistryFrequencyDisplayHe({
      enabled: isCurrentOpenPeriod
        ? (tax?.income_tax_advance_enabled ?? null)
        : snapshot != null
          ? snapshot.income_tax_advance_enabled
          : (tax?.income_tax_advance_enabled ?? null),
      frequency: isCurrentOpenPeriod
        ? (tax?.income_tax_advance_frequency ?? null)
        : snapshot != null
          ? snapshot.income_tax_advance_frequency
          : (tax?.income_tax_advance_frequency ?? null),
    });
    const national_insurance_status = niFromTax ?? (p?.national_insurance_status as string | null) ?? null;
    const national_insurance_deductions_status =
      niDedFromTax ?? (p?.national_insurance_deductions_status as string | null) ?? null;
    const income_tax_deductions_status = (p?.income_tax_deductions_status as string | null) ?? null;
    const assigned_handler_user_id = (p?.assigned_handler_user_id as string | null) ?? null;
    const material_cells = buildMaterialCells({
      vat: materialBroughtCell,
      income_tax_advance: incomeTaxAdvanceCell,
      payroll: payrollCell,
    });
    const manual_cell_statuses = buildManualStatusCapabilitiesForRow({
      clientId: c.id,
      columnKeys: paintableColumnKeys,
      customColumnKeys,
      statuses: manualStatusesByClientColumn,
      materialSquareCount: countMaterialOperationalSquares({
        vatApplicable: materialBroughtCell.configured,
        incomeTaxAdvanceApplicable: incomeTaxAdvanceCell.configured,
        payrollApplicable: payrollCell.configured,
      }),
      niDeductionsSquareCount: countNiDeductionsOperationalSquares({
        applicable: Boolean(national_insurance_deductions_cell.configured),
        form102Applicable: Boolean(
          national_insurance_deductions_cell.items?.['102']?.configured ??
            national_insurance_deductions_cell.items?.['102']?.applicable,
        ),
        form100Applicable: Boolean(
          national_insurance_deductions_cell.items?.['100']?.configured ??
            national_insurance_deductions_cell.items?.['100']?.applicable,
        ),
        form126Applicable: Boolean(
          national_insurance_deductions_cell.items?.['126']?.configured ??
            national_insurance_deductions_cell.items?.['126']?.applicable,
        ),
      }),
      incomeTaxDeductionsSquareCount: income_tax_deductions_cell.configured ? 1 : 0,
    });
    const base = {
      client_id: c.id,
      client_name: c.display_name,
      tax_id: c.tax_id,
      business_type: bt,
      payroll_flag,
      material_brought_flag,
      period_applicability: {
        vat_applicable: vatApplicable,
        payroll_applicable: hasPayroll,
        income_tax_advance_applicable: advanceDue,
        income_tax_deductions_applicable: seed.incomeTaxDeductionsDue,
        national_insurance_applicable: niConfigured,
        national_insurance_deductions_applicable: niDeductionsConfigured,
        row_visible: snapshot?.row_visible ?? true,
      },
      material_brought_cell: materialBroughtCell,
      material_cells,
      annual_report_cell,
      capital_declaration_cell,
      national_insurance_deductions_cell,
      income_tax_deductions_cell,
      pcn_display,
      vat_status,
      income_tax_advance_status,
      national_insurance_status,
      national_insurance_deductions_status,
      income_tax_deductions_status,
      assigned_handler_user_id,
      notes_cell_text_he: noteAgg.cell_text_he,
      operational_notes_count: noteAgg.count,
      vat_due_registry_display_he,
    };
    return [mergeUserCustomCellsIntoRowPeriodAware({
      ...base,
      cells: buildRegistryRowCells({
        ...base,
        annual_report_display_he: formatOperationalDateDisplayHe(annual_report_cell.operational_target_date),
        capital_declaration_display_he: capital_declaration_cell.applicable
          ? formatOperationalDateDisplayHe(capital_declaration_cell.operational_target_date)
          : '—',
        assigned_handler_display_he: assigned_handler_user_id
          ? (handlerDisplayByUserId.get(assigned_handler_user_id) ?? null)
          : null,
      }),
      manual_cell_statuses,
      filter_facets: seed.filter_facets,
    }, visibleCustomColumns, customValuesByClientAndColumn)];
  });
  markStage('presentation_row_build', presentationMs);

  return finishMaterialization(builtRows);
}

/** אופציות קריאה לאגרגט תיק — לא משנות נתונים ב-DB */
export type ClientOperationsCaseReadOptions = {
  feesPriceChartView?: FeesPriceChartViewMode;
  /**
   * After `executeClientDocumentsTabCommand`, default folders were already ensured — skip a duplicate DB round-trip
   * inside `getClientDocumentsTabReadModel` when rebuilding the full case.
   */
  skipEnsureClientDocumentFolders?: boolean;
  /** Non-persistent detail state for history tab (set only via `history/commands`). */
  historyOpenSection?: ClientHistoryOpenSectionOptions | null;
};

export async function getClientOperationsCase(
  ctx: RequestContext,
  clientId: string,
  options?: ClientOperationsCaseReadOptions
): Promise<ClientOperationsCaseResponse> {
  const orgId = assertOrg(ctx);
  await assertCanAccessClientFromContext(ctx, clientId);

  const [{ data: client, error: clientErr }, { data: primaryContact }, { data: profile }] = await Promise.all([
    supabaseAdmin
      .from('clients')
      .select('id, display_name, tax_id, status, email, phone, address, city, notes, created_at, ended_at')
      .eq('organization_id', orgId)
      .eq('id', clientId)
      .single(),
    supabaseAdmin
      .from('client_contacts')
      .select('full_name, email, phone, title')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .eq('is_primary', true)
      .maybeSingle(),
    supabaseAdmin.from('client_operational_profiles').select(PROFILE_SELECT).eq('organization_id', orgId).eq('client_id', clientId).maybeSingle(),
  ]);

  if (clientErr) {
    if (clientErr.code === 'PGRST116' || !client) throw forbidden('Client not found');
    const errMsg = 'message' in clientErr ? String((clientErr as { message?: string }).message ?? '') : '';
    throw new AppError(500, errMsg || 'clients query failed', 'SUPABASE_ERROR');
  }
  if (!client) throw forbidden('Client not found');

  let assignedHandlerFullName: string | null = null;
  const handlerId = (profile as { assigned_handler_user_id?: string | null } | null)?.assigned_handler_user_id ?? null;

  const [handlerDisplayMap, handlerEligible] = await Promise.all([
    handlerId ? loadMemberDisplayNamesByUserIds([handlerId]) : Promise.resolve(new Map<string, string>()),
    listActiveHandlerEligibleMembers(orgId),
  ]);
  if (handlerId) {
    assignedHandlerFullName = handlerDisplayMap.get(handlerId) ?? null;
  }

  const handler_user_options: Array<{ user_id: string; email: string; display_name: string }> = handlerEligible.map(
    (m) => ({
      user_id: m.user_id,
      email: m.email,
      display_name: m.display_name,
    }),
  );
  const chartView: FeesPriceChartViewMode = options?.feesPriceChartView ?? 'last_15';
  const historyOpen = options?.historyOpenSection ?? null;
  await recomputeClientObligationsAndTasks(ctx, clientId, new Date());
  const [
    tax_settings,
    accounting,
    accounting_settings_tab,
    fees_tab,
    payroll_tab,
    annual_tab,
    capital_declaration_tab,
    client_documents_tab,
    client_history_tab,
    client_obligations_tab,
    client_tasks_tab,
  ] =
    await Promise.all([
      getClientTaxSettings(ctx, clientId),
      getClientBusinessProfileSection(ctx, clientId),
      getAccountingSettingsTabReadModel(ctx, clientId),
      getFeesTabReadModel(ctx, clientId, chartView),
      getPayrollTabReadModel(ctx, clientId),
      getAnnualTabReadModel(ctx, clientId),
      getAnnualTabReadModel(ctx, clientId, 'capital_declaration'),
      getClientDocumentsTabReadModel(ctx, clientId, {
        skipEnsureDefaultFolders: options?.skipEnsureClientDocumentFolders === true,
      }),
      getClientHistoryTabReadModel(ctx, clientId, historyOpen),
      getClientObligationsTabReadModel(ctx, clientId),
      getClientTasksTabReadModel(ctx, clientId),
    ]);

  return {
    client: {
      id: client.id,
      client_name: client.display_name,
      tax_id: client.tax_id,
      status: client.status ?? null,
      started_at: client.created_at ?? null,
      ended_at: client.ended_at ?? null,
      email: client.email ?? null,
      phone: client.phone ?? null,
      address: (client as any).address ?? null,
      city: (client as any).city ?? null,
      notes: (client as any).notes ?? null,
    },
    primary_contact: primaryContact
      ? {
          full_name: primaryContact.full_name ?? null,
          email: primaryContact.email ?? null,
          phone: primaryContact.phone ?? null,
          title: primaryContact.title ?? null,
        }
      : null,
    handler_user_options,
    profile: (() => {
      const p = profile as {
        business_type?: string | null;
        payroll_flag?: boolean | null;
        material_brought_flag?: boolean | null;
        vat_status?: string | null;
        income_tax_advance_status?: string | null;
        national_insurance_status?: string | null;
        national_insurance_deductions_status?: string | null;
        income_tax_deductions_status?: string | null;
        assigned_handler_user_id?: string | null;
        notes_summary?: string | null;
        salary_data_received_flag?: boolean | null;
        income_data_received_flag?: boolean | null;
      } | null;
      return {
        business_type: p?.business_type ?? null,
        payroll_flag: p?.payroll_flag ?? null,
        material_brought_flag: p?.material_brought_flag ?? null,
        vat_status: p?.vat_status ?? null,
        income_tax_advance_status: p?.income_tax_advance_status ?? null,
        national_insurance_status: p?.national_insurance_status ?? null,
        national_insurance_deductions_status: p?.national_insurance_deductions_status ?? null,
        income_tax_deductions_status: p?.income_tax_deductions_status ?? null,
        assigned_handler_user_id: p?.assigned_handler_user_id ?? null,
        assigned_handler_user_full_name: assignedHandlerFullName,
        notes_summary: p?.notes_summary ?? null,
        salary_data_received_flag: p?.salary_data_received_flag ?? null,
        income_data_received_flag: p?.income_data_received_flag ?? null,
      };
    })(),
    tax_settings,
    tax_tab: buildTaxTabWorkspaceReadModel(tax_settings),
    accounting,
    accounting_settings_tab,
    fees_tab,
    payroll_tab,
    annual_tab,
    capital_declaration_tab,
    client_documents_tab,
    client_history_tab,
    client_obligations_tab,
    client_tasks_tab,
  };
}

type UpdateClientOperationsClientProfileRequest = {
  client_name: string;
  government_id: string;
  business_type: string;
  status: string;
  contact_person?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  assigned_handler_user_id?: string | null;
  ended_at?: string | null; // expects YYYY-MM-DD or null
};

const ALLOWED_BUSINESS_TYPES = new Set(['עוסק פטור', 'עוסק מורשה', 'חברה', 'תאגיד', 'אחר']);
const ALLOWED_CLIENT_STATUSES = new Set(['active', 'inactive', 'pending']);

function normalizeOptionalString(v: unknown): string | null {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

function parseAddressCombined(addressText: string): { street: string | null; city: string | null } {
  const trimmed = addressText.trim();
  if (!trimmed) return { street: null, city: null };

  // UI uses ` · ` between address and city.
  const partsByMiddleDot = trimmed.split(' · ').map((p) => p.trim()).filter(Boolean);
  if (partsByMiddleDot.length >= 2) {
    const city = partsByMiddleDot[partsByMiddleDot.length - 1] ?? null;
    const street = partsByMiddleDot.slice(0, -1).join(' · ') || null;
    return { street, city };
  }

  // Fallback: split on middle dot with optional spaces.
  const partsByDot = trimmed.split(/\s*·\s*/g).map((p) => p.trim()).filter(Boolean);
  if (partsByDot.length >= 2) {
    const city = partsByDot[partsByDot.length - 1] ?? null;
    const street = partsByDot.slice(0, -1).join(' · ') || null;
    return { street, city };
  }

  return { street: trimmed, city: null };
}

function parseEndedAtDate(dateValue: unknown): string | null {
  if (dateValue === undefined) return null;
  if (dateValue === null) return null;
  if (typeof dateValue !== 'string') return null;
  const s = dateValue.trim();
  if (!s) return null;
  const iso = new Date(`${s}T00:00:00.000Z`).toISOString();
  return iso;
}

/**
 * Save only the "פרטי לקוח" first-tab fields (clients + client_operational_profiles + primary client contact).
 * Backend owns all validations and uniqueness rules.
 * Security: assigned_handler_user_id is NOT writable here for Staff — use assign_client_handler.
 */
export async function updateClientOperationsClientProfile(
  ctx: RequestContext,
  clientId: string,
  body: UpdateClientOperationsClientProfileRequest
): Promise<ClientOperationsCaseResponse> {
  const orgId = assertOrg(ctx);
  await assertCanAccessClientFromContext(ctx, clientId);

  const clientName = String(body.client_name ?? '').trim();
  const taxId = String(body.government_id ?? '').trim();
  const businessType = String(body.business_type ?? '').trim();
  const status = String(body.status ?? '').trim();

  if (!clientName) throw badRequest('שם לקוח is required');
  if (!taxId) throw badRequest('ת.ז / ח.פ is required');
  if (!businessType) throw badRequest('סוג עסק is required');
  if (!ALLOWED_BUSINESS_TYPES.has(businessType)) throw badRequest('Invalid business type');
  if (!status || !ALLOWED_CLIENT_STATUSES.has(status)) throw badRequest('Invalid client status');

  const { data: existingClient } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id, status, email, phone, address, city, created_at, ended_at')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();

  if (!existingClient) throw forbidden('Client not found');

  const { data: existingProfile } = await supabaseAdmin
    .from('client_operational_profiles')
    .select('assigned_handler_user_id, business_type')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();

  // Enforce uniqueness of tax_id (government_id) within org.
  if (taxId !== existingClient.tax_id) {
    const { data: dup } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('organization_id', orgId)
      .eq('tax_id', taxId)
      .maybeSingle();
    if (dup) throw conflict('A client with this tax ID (HP) already exists');
  }

  const phone = body.phone !== undefined ? normalizeOptionalString(body.phone) : existingClient.phone ?? null;
  const email = body.email !== undefined ? normalizeOptionalString(body.email) : existingClient.email ?? null;

  const newPhone = phone?.trim() ?? null;
  const newEmail = email?.trim() ?? null;
  if (!newPhone && !newEmail) {
    throw badRequest('Client must have at least one contact method: phone or email.');
  }

  const endedAt = body.ended_at !== undefined ? parseEndedAtDate(body.ended_at) : (existingClient.ended_at ?? null);

  // Privilege escalation guard: Staff/Viewer cannot change responsible handler via update_profile.
  const previousHandler = (existingProfile?.assigned_handler_user_id as string | null) ?? null;
  let assigned_handler_user_id = previousHandler;
  if (body.assigned_handler_user_id !== undefined) {
    const requested = body.assigned_handler_user_id ? String(body.assigned_handler_user_id) : null;
    if (requested !== previousHandler) {
      if (!canManageClientHandlerAssignment(ctx.membership?.roleCode)) {
        throw forbidden(
          'Only Owner or Admin may change assigned handler',
          'CLIENT_HANDLER_ASSIGNMENT_FORBIDDEN',
        );
      }
      if (requested) await assertUserIsActiveHandlerEligible(orgId, requested);
      const { assertNoIncompatibleActiveTodosForHandlerChange } = await import(
        './client-operations-todo.service.js'
      );
      await assertNoIncompatibleActiveTodosForHandlerChange({
        organizationId: orgId,
        clientId,
        afterHandlerUserId: requested,
      });
      assigned_handler_user_id = requested;
    }
  }

  const addressCombined = body.address !== undefined ? body.address : null;
  const combined =
    addressCombined !== undefined && addressCombined !== null
      ? String(addressCombined)
      : [existingClient.address, existingClient.city].filter(Boolean).join(' · ');
  const parsedAddress = parseAddressCombined(combined || '');

  // 1) Update clients table fields.
  const { data: updatedClient, error: updateClientError } = await supabaseAdmin
    .from('clients')
    .update({
      updated_at: new Date().toISOString(),
      display_name: clientName,
      tax_id: taxId,
      status,
      email: newEmail,
      phone: newPhone,
      address: parsedAddress.street,
      city: parsedAddress.city,
      ended_at: endedAt,
    })
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .select()
    .maybeSingle();

  if (updateClientError || !updatedClient) {
    throw new AppError(
      500,
      updateClientError?.message ?? 'Failed to update client profile',
      'CLIENT_PROFILE_UPDATE_FAILED'
    );
  }

  // 2) Update module profile: business type + assigned handler.
  await supabaseAdmin.from('client_operational_profiles').upsert(
    {
      organization_id: orgId,
      client_id: clientId,
      business_type: businessType,
      assigned_handler_user_id: assigned_handler_user_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,client_id' }
  );

  await syncVatPaturForOsekPaturBusinessType(ctx, clientId, businessType);

  // 3) Update primary contact full_name (and optionally phone/email for display consistency).
  const { data: primaryContact } = await supabaseAdmin
    .from('client_contacts')
    .select('id, full_name')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('is_primary', true)
    .maybeSingle();

  if (body.contact_person !== undefined) {
    const contactFullName = normalizeOptionalString(body.contact_person);
    // Allow profile save when contact name is blank; keep existing primary contact name unchanged.
    if (contactFullName) {
      if (primaryContact) {
        await supabaseAdmin
          .from('client_contacts')
          .update({
            full_name: contactFullName,
            email: newEmail,
            phone: newPhone,
            updated_at: new Date().toISOString(),
          })
          .eq('id', primaryContact.id)
          .eq('organization_id', orgId);
      } else {
        await supabaseAdmin.from('client_contacts').insert({
          organization_id: orgId,
          client_id: clientId,
          full_name: contactFullName,
          email: newEmail,
          phone: newPhone,
          title: null,
          is_primary: true,
          status: 'active',
          created_by: ctx.user.id,
        });
      }
    }
  }

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (String(existingClient.display_name ?? '').trim() !== clientName) {
    changes.display_name = { before: existingClient.display_name, after: clientName };
  }
  if (String(existingClient.tax_id ?? '').trim() !== taxId) {
    changes.tax_id = { before: existingClient.tax_id, after: taxId };
  }
  if (String(existingClient.status ?? '').trim() !== status) {
    changes.status = { before: existingClient.status, after: status };
  }
  if ((existingClient.email ?? null) !== newEmail) changes.email = { before: existingClient.email, after: newEmail };
  if ((existingClient.phone ?? null) !== newPhone) changes.phone = { before: existingClient.phone, after: newPhone };
  if ((existingClient.ended_at ?? null) !== endedAt) changes.ended_at = { before: existingClient.ended_at, after: endedAt };
  if ((existingClient.address ?? null) !== parsedAddress.street || (existingClient.city ?? null) !== parsedAddress.city) {
    changes.address = { before: { street: existingClient.address, city: existingClient.city }, after: parsedAddress };
  }
  const prevBt = (existingProfile as { business_type?: string | null } | null)?.business_type ?? null;
  if (prevBt !== businessType) changes.business_type = { before: prevBt, after: businessType };
  if ((existingProfile?.assigned_handler_user_id ?? null) !== assigned_handler_user_id) {
    changes.assigned_handler_user_id = {
      before: existingProfile?.assigned_handler_user_id ?? null,
      after: assigned_handler_user_id,
    };
  }
  if (body.contact_person !== undefined) {
    const contactFullName = normalizeOptionalString(body.contact_person);
    const prevName = primaryContact?.full_name ?? null;
    if (contactFullName !== prevName) {
      changes.primary_contact_full_name = { before: prevName, after: contactFullName };
    }
  }

  if (Object.keys(changes).length > 0) {
    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      moduleCode: 'client-operations',
      entityType: 'client_operations_workspace_profile',
      entityId: clientId,
      action: AUDIT_ACTIONS.CLIENT_OPERATIONS_WORKSPACE_PROFILE_UPDATED,
      payload: { client_id: clientId, changes },
    });
  }

  return getClientOperationsCase(ctx, clientId);
}

async function upsertAssignedHandler(params: {
  organizationId: string;
  clientId: string;
  assignedHandlerUserId: string | null;
}): Promise<{ before: string | null; after: string | null }> {
  const { data: existing } = await supabaseAdmin
    .from('client_operational_profiles')
    .select('assigned_handler_user_id, business_type')
    .eq('organization_id', params.organizationId)
    .eq('client_id', params.clientId)
    .maybeSingle();
  const before = (existing as { assigned_handler_user_id?: string | null } | null)?.assigned_handler_user_id ?? null;
  const after = params.assignedHandlerUserId;
  if (before === after) return { before, after };

  const now = new Date().toISOString();
  if (existing) {
    const { error } = await supabaseAdmin
      .from('client_operational_profiles')
      .update({ assigned_handler_user_id: after, updated_at: now })
      .eq('organization_id', params.organizationId)
      .eq('client_id', params.clientId);
    if (error) throw new AppError(500, error.message || 'Failed to update handler', 'SUPABASE_ERROR');
  } else {
    const { error } = await supabaseAdmin.from('client_operational_profiles').insert({
      organization_id: params.organizationId,
      client_id: params.clientId,
      assigned_handler_user_id: after,
      business_type: null,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new AppError(500, error.message || 'Failed to create profile for handler', 'SUPABASE_ERROR');
  }
  return { before, after };
}

/**
 * Named security-sensitive command: assign / reassign / unassign responsible handler.
 * Owner/Admin only. Immediately changes Staff access scope.
 */
export async function assignClientHandler(
  ctx: RequestContext,
  params: { client_id: string; assigned_handler_user_id: string | null },
): Promise<ClientOperationsCaseResponse> {
  const orgId = assertOrg(ctx);
  if (!canManageClientHandlerAssignment(ctx.membership?.roleCode)) {
    throw forbidden('Only Owner or Admin may assign client handlers', 'CLIENT_HANDLER_ASSIGNMENT_FORBIDDEN');
  }
  const clientId = String(params.client_id ?? '').trim();
  if (!clientId) throw badRequest('client_id required');

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (!client) throw forbidden('Client not found');

  const handlerId =
    params.assigned_handler_user_id == null || String(params.assigned_handler_user_id).trim() === ''
      ? null
      : String(params.assigned_handler_user_id).trim();
  if (handlerId) await assertUserIsActiveHandlerEligible(orgId, handlerId);

  // Peek current handler to know if change is needed; block before write when ToDos conflict.
  const { data: existingProfile } = await supabaseAdmin
    .from('client_operational_profiles')
    .select('assigned_handler_user_id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();
  const before =
    (existingProfile as { assigned_handler_user_id?: string | null } | null)?.assigned_handler_user_id ??
    null;
  if (before !== handlerId) {
    const { assertNoIncompatibleActiveTodosForHandlerChange } = await import(
      './client-operations-todo.service.js'
    );
    await assertNoIncompatibleActiveTodosForHandlerChange({
      organizationId: orgId,
      clientId,
      afterHandlerUserId: handlerId,
    });
  }

  const { before: beforeWritten, after } = await upsertAssignedHandler({
    organizationId: orgId,
    clientId,
    assignedHandlerUserId: handlerId,
  });

  if (beforeWritten !== after) {
    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      moduleCode: 'client-operations',
      entityType: 'client_operational_profile',
      entityId: clientId,
      action: AUDIT_ACTIONS.CLIENT_OPERATIONS_CLIENT_HANDLER_ASSIGNED,
      payload: {
        client_id: clientId,
        before_handler_user_id: beforeWritten,
        after_handler_user_id: after,
      },
    });
  }

  invalidateClientOperationsRegistryMaterializationCache(orgId);
  return getClientOperationsCase(ctx, clientId);
}

/**
 * Named Owner/Admin bulk assignment. Validates all clients, applies handler, one audit event.
 */
export async function bulkAssignClientHandler(
  ctx: RequestContext,
  params: { client_ids: string[]; assigned_handler_user_id: string | null },
): Promise<{
  organization_id: string;
  assigned_handler_user_id: string | null;
  updated_client_ids: string[];
  unchanged_client_ids: string[];
}> {
  const orgId = assertOrg(ctx);
  if (!canManageClientHandlerAssignment(ctx.membership?.roleCode)) {
    throw forbidden('Only Owner or Admin may assign client handlers', 'CLIENT_HANDLER_ASSIGNMENT_FORBIDDEN');
  }

  const rawIds = Array.isArray(params.client_ids) ? params.client_ids : [];
  const clientIds = [...new Set(rawIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (!clientIds.length) throw badRequest('client_ids required');
  if (clientIds.length > 500) throw badRequest('client_ids exceeds maximum of 500');

  const handlerId =
    params.assigned_handler_user_id == null || String(params.assigned_handler_user_id).trim() === ''
      ? null
      : String(params.assigned_handler_user_id).trim();
  if (handlerId) await assertUserIsActiveHandlerEligible(orgId, handlerId);

  const { data: owned } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', clientIds);
  const ownedIds = new Set((owned ?? []).map((r) => String((r as { id: string }).id)));
  if (ownedIds.size !== clientIds.length) {
    throw forbidden('One or more clients were not found in this organization');
  }

  const { assertNoIncompatibleActiveTodosForHandlerChange } = await import(
    './client-operations-todo.service.js'
  );
  for (const clientId of clientIds) {
    await assertNoIncompatibleActiveTodosForHandlerChange({
      organizationId: orgId,
      clientId,
      afterHandlerUserId: handlerId,
    });
  }

  const updated: string[] = [];
  const unchanged: string[] = [];
  const details: Array<{ client_id: string; before: string | null; after: string | null }> = [];

  for (const clientId of clientIds) {
    const { before, after } = await upsertAssignedHandler({
      organizationId: orgId,
      clientId,
      assignedHandlerUserId: handlerId,
    });
    details.push({ client_id: clientId, before, after });
    if (before === after) unchanged.push(clientId);
    else updated.push(clientId);
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operational_profile',
    entityId: orgId,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_CLIENT_HANDLER_BULK_ASSIGNED,
    payload: {
      assigned_handler_user_id: handlerId,
      updated_client_ids: updated,
      unchanged_client_ids: unchanged,
      changes: details.filter((d) => d.before !== d.after),
    },
  });

  invalidateClientOperationsRegistryMaterializationCache(orgId);
  return {
    organization_id: orgId,
    assigned_handler_user_id: handlerId,
    updated_client_ids: updated,
    unchanged_client_ids: unchanged,
  };
}

