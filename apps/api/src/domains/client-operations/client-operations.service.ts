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
  mergeCustomCellsIntoRow,
  type ClientOperationsRegistryColumn,
  type ClientOperationsToolbarCapability,
  type RegistryQueryInput,
} from './client-operations-registry-presentation.pure.js';
import {
  loadActiveClientOperationsRegistryCustomColumns,
  loadClientOperationsRegistryCustomColumnValues,
  type RegistryCustomColumnDefinition,
} from './client-operations-registry-custom-columns.service.js';
import {
  ensurePeriodApplicabilitySnapshots,
  listKnownOperationalPeriodKeys,
  loadPeriodApplicabilitySnapshots,
  loadPeriodMaterialFacts,
  loadPeriodMembershipClientIds,
  loadPayrollPeriodSalaryDataReceived,
  resolveRegistryOperationalPeriodKey,
  type ClientPeriodSourceRow,
} from './client-operations-operational-period.service.js';
import {
  buildMaterialCells,
  clientExistsInOperationalPeriod,
  mapOperationalPeriodKeyToPayrollPeriodKey,
  resolveDefaultOperationalPeriodKey,
  resolveIncomeTaxAdvanceMaterialForPeriod,
  resolveMaterialBroughtForPeriod,
  resolvePayrollMaterialForPeriod,
  shouldIncludeArchivedClientInOperationalPeriodRegistry,
  shouldEmitOperationalPeriodRegistryRow,
  type MaterialCells,
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
  material_brought_cell?: { applicable: boolean; completed: boolean | null; value: boolean | null };
  material_cells?: MaterialCells;
  annual_report_cell?: AnnualReportOperationalDateCell;
  capital_declaration_cell?: CapitalDeclarationOperationalDateCell;
  /** Backend-ready ב״ל ניכויים cell (102/100 monthly + 126 cycle). */
  national_insurance_deductions_cell?: NiDeductionsRegistryCell;
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
};

export type ClientOperationsRegistryResponse = {
  title_he: string;
  period: {
    selected_period_key: string;
    default_period_key: string;
    available_periods: string[];
  };
  rows: ClientOperationsRegistryRow[];
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
  query: {
    q: string | null;
    sort_by: string | null;
    sort_dir: 'asc' | 'desc' | null;
    operational_period_key: string;
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

function emptyRegistryResponse(
  ctx: RequestContext,
  query: RegistryQueryInput,
  noteTypes: ClientOperationsRegistryResponse['note_types'],
  customColumns: RegistryCustomColumnDefinition[],
  period: ClientOperationsRegistryResponse['period'],
): ClientOperationsRegistryResponse {
  const q = (query.q ?? '').trim() || null;
  const sort_by = query.sort_by?.trim() || null;
  const sort_dir = query.sort_dir === 'desc' || query.sort_dir === 'asc' ? query.sort_dir : null;
  const customColumnsCapability = buildCustomColumnsCapability({
    current: customColumns.length,
    canEdit: ctx.membership?.permissions?.includes('client_operations.edit') === true,
  });
  const columns: ClientOperationsRegistryColumn[] = [
    ...CLIENT_OPERATIONS_REGISTRY_COLUMNS,
    ...customColumns
      .filter((column) => column.visible)
      .map((column) => ({
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
      })),
  ];
  return {
    title_he: 'תפעול לקוחות',
    period,
    rows: [],
    columns,
    note_types: noteTypes,
    toolbar_capabilities: buildClientOperationsToolbarCapabilities({
      can_create_custom_column: customColumnsCapability.can_create,
      can_create_reason_he: customColumnsCapability.current >= customColumnsCapability.max ? 'הגעת למגבלת 10 עמודות מותאמות אישית' : null,
    }),
    custom_columns_capability: customColumnsCapability,
    query: { q, sort_by, sort_dir, operational_period_key: period.selected_period_key },
    allowed_actions: buildRegistryAllowedActions(ctx),
  };
}

async function loadHandlerDisplayNamesByUserIds(
  orgId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await supabaseAdmin
    .from('organization_users')
    .select('user_id, users!organization_users_user_id_fkey(full_name, email)')
    .eq('organization_id', orgId)
    .in('user_id', unique)
    .eq('membership_status', 'active')
    .not('invited_by', 'is', null);
  if (error) {
    throw new AppError(500, error.message ?? 'organization_users (handlers) query failed', 'SUPABASE_ERROR');
  }
  type HandlerUser = { full_name: string | null; email: string | null };
  type HandlerRow = { user_id: string; users: HandlerUser | HandlerUser[] | null };
  for (const row of (data ?? []) as unknown as HandlerRow[]) {
    const raw = row.users;
    const u = Array.isArray(raw) ? raw[0] : raw;
    if (!u || !row.user_id) continue;
    const display = u.full_name?.trim() ? u.full_name.trim() : (u.email ?? '');
    if (display) map.set(row.user_id, display);
  }
  return map;
}

export async function listClientOperationsRegistry(
  ctx: RequestContext,
  query: RegistryQueryInput = {},
): Promise<ClientOperationsRegistryResponse> {
  const orgId = assertOrg(ctx);
  const selectedPeriodKey = resolveRegistryOperationalPeriodKey(query.operational_period_key);
  const defaultPeriodKey = resolveDefaultOperationalPeriodKey();
  const [noteTypesResult, customColumns, availablePeriods] = await Promise.all([
    listOperationalNoteTypes(),
    loadActiveClientOperationsRegistryCustomColumns(orgId),
    listKnownOperationalPeriodKeys(orgId),
  ]);
  const noteTypes = noteTypesResult.types;
  const period = {
    selected_period_key: selectedPeriodKey,
    default_period_key: defaultPeriodKey,
    available_periods: availablePeriods,
  };

  const isCurrentOrDefaultPeriod = selectedPeriodKey === defaultPeriodKey;

  type RegistryClientRow = {
    id: string;
    display_name: string | null;
    tax_id: string | null;
    created_at: string | null;
    is_archived: boolean;
  };

  const { data: activeClients } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id, created_at, is_archived')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('display_name', { ascending: true });

  const activeSafe = (activeClients ?? []) as RegistryClientRow[];
  let safeClients: RegistryClientRow[] = activeSafe;

  if (!isCurrentOrDefaultPeriod) {
    // Historical period: keep live active clients, and re-include archived clients
    // that already have frozen membership (snapshot and/or material fact) for this period.
    const membershipIds = await loadPeriodMembershipClientIds({
      organizationId: orgId,
      operationalPeriodKey: selectedPeriodKey,
    });
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
    return emptyRegistryResponse(ctx, query, noteTypes, customColumns, period);
  }

  const clientIds = safeClients.map((c) => c.id);
  const annualReportTaxYear = resolveAnnualReportTaxYearForOperationalPeriod(selectedPeriodKey);
  const canEditRegistry = ctx.membership?.permissions?.includes('client_operations.edit') === true;
  const payrollPeriodKey = mapOperationalPeriodKeyToPayrollPeriodKey(selectedPeriodKey);

  const [
    { data: profiles },
    notesByClient,
    customValuesByClientAndColumn,
    { data: taxSettingsRows },
    existingSnapshots,
    materialFacts,
    payrollSalaryByClient,
    annualReportInstancesByClient,
    openCapitalInstancesByClient,
    niDeductionsPeriodFlagsByClient,
    niDeductions126FactsByClient,
    earliestNiDeductionsApplicableByClient,
  ] = await Promise.all([
    supabaseAdmin
      .from('client_operational_profiles')
      .select(PROFILE_SELECT)
      .eq('organization_id', orgId)
      .in('client_id', clientIds),
    loadNotesAggregatesByClient(orgId, clientIds),
    loadClientOperationsRegistryCustomColumnValues(orgId, clientIds),
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
    loadAnnualReportYearInstancesForClients({
      organizationId: orgId,
      clientIds,
      taxYear: annualReportTaxYear,
    }),
    loadOpenCapitalDeclarationInstancesForClients({
      organizationId: orgId,
      clientIds,
    }),
    loadNiDeductionsPeriodFlagsForClients({
      organizationId: orgId,
      clientIds,
      operationalPeriodKey: selectedPeriodKey,
    }),
    loadNiDeductions126CycleFactsForClients({
      organizationId: orgId,
      clientIds,
    }),
    loadEarliestNiDeductionsApplicablePeriodKeysForClients({
      organizationId: orgId,
      clientIds,
    }),
  ]);

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

  const annualReportCells = projectAnnualReportCells({
    clientIds,
    taxYear: annualReportTaxYear,
    instancesByClientId: annualReportInstancesByClient,
    canEdit: canEditRegistry,
  });
  const capitalDeclarationCells = projectCapitalDeclarationCells({
    clientIds,
    openByClientId: openCapitalInstancesByClient,
    canEdit: canEditRegistry,
  });
  const periodSources: ClientPeriodSourceRow[] = safeClients
    // Never invent historical applicability for archived clients from today's settings.
    // Archived historical membership must already carry a frozen snapshot (and/or fact).
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
  const snapshots = await ensurePeriodApplicabilitySnapshots({
    organizationId: orgId,
    operationalPeriodKey: selectedPeriodKey,
    sources: periodSources,
    existing: existingSnapshots,
  });

  const handlerIds = [
    ...new Set(
      [...profilesByClientId.values()]
        .map((p) => (p?.assigned_handler_user_id as string | null) ?? null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const handlerDisplayByUserId = await loadHandlerDisplayNamesByUserIds(orgId, handlerIds);

  const builtRows: ClientOperationsRegistryRow[] = safeClients.flatMap((c) => {
    const snapshot = snapshots.get(c.id);
    const hasMaterialMembership = materialFacts.has(c.id);
    // Registry membership != cell applicability.
    // row_visible=false means no modeled work stream applies — cells are N/A —
    // but the client row remains in the monthly registry when membership gates pass.
    if (
      !shouldEmitOperationalPeriodRegistryRow({
        is_archived: Boolean(c.is_archived),
        has_applicability_snapshot: Boolean(snapshot),
        has_material_fact: hasMaterialMembership,
        snapshot_row_visible: snapshot?.row_visible ?? null,
      })
    ) {
      return [];
    }
    const vatApplicable = snapshot?.vat_applicable ?? true;
    const p = profilesByClientId.get(c.id);
    const noteAgg = buildNotesCellDisplayHe(notesByClient.get(c.id) ?? []);
    const tax = taxByClient.get(c.id);
    const vat_due_registry_display_he = tax
      ? computeVatDueRegistryDisplayHe(tax.vat_due_type, tax.vat_frequency)
      : null;
    const bt = (p?.business_type as string | null) ?? null;
    const vatFromTax = tax
      ? computeVatRegistryColumnDisplayHe(bt, tax.vat_type, tax.vat_frequency)
      : computeVatRegistryColumnDisplayHe(bt, null, null);
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
    const payroll_flag = (p?.payroll_flag as boolean | null) ?? null;
    const periodFact = materialFacts.get(c.id);
    const materialBroughtCell = resolveMaterialBroughtForPeriod({
      period_fact: periodFact?.material_brought,
      has_period_fact: materialFacts.has(c.id),
      legacy_profile_flag: (p?.material_brought_flag as boolean | null) ?? null,
      operational_period_key: selectedPeriodKey,
      default_period_key: defaultPeriodKey,
      vat_applicable: vatApplicable,
    });
    const incomeTaxAdvanceCell = resolveIncomeTaxAdvanceMaterialForPeriod({
      period_fact: periodFact?.income_tax_advance_material_brought,
      has_period_fact: materialFacts.has(c.id),
      legacy_profile_flag: (p?.income_data_received_flag as boolean | null) ?? null,
      operational_period_key: selectedPeriodKey,
      default_period_key: defaultPeriodKey,
      income_tax_advance_applicable: snapshot?.income_tax_advance_applicable ?? false,
    });
    const payrollCell = resolvePayrollMaterialForPeriod({
      payroll_applicable: snapshot?.payroll_applicable ?? false,
      salary_data_received: payrollSalaryByClient.get(c.id),
    });
    const material_brought_flag = materialBroughtCell.applicable ? materialBroughtCell.value : null;
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
    const national_insurance_deductions_applicable =
      snapshot?.national_insurance_deductions_applicable ?? false;
    const national_insurance_deductions_cell = buildNiDeductionsRegistryCellForClient({
      applicable: national_insurance_deductions_applicable,
      periodFlags: niDeductionsPeriodFlagsByClient.get(c.id),
      cycleFacts: niDeductions126FactsByClient.get(c.id),
      operationalPeriodKey: selectedPeriodKey,
      earliestApplicablePeriodKey: earliestNiDeductionsApplicableByClient.get(c.id) ?? null,
    });
    const vat_status = vatFromTax ?? (p?.vat_status as string | null) ?? null;
    // מה״כ registry display = frozen period frequency (not profile כן/לא).
    const income_tax_advance_status = formatIncomeTaxAdvanceRegistryFrequencyDisplayHe({
      enabled:
        snapshot != null
          ? snapshot.income_tax_advance_enabled
          : (tax?.income_tax_advance_enabled ?? null),
      frequency:
        snapshot != null
          ? snapshot.income_tax_advance_frequency
          : (tax?.income_tax_advance_frequency ?? null),
    });
    const national_insurance_status = niFromTax ?? (p?.national_insurance_status as string | null) ?? null;
    const national_insurance_deductions_status =
      niDedFromTax ?? (p?.national_insurance_deductions_status as string | null) ?? null;
    const income_tax_deductions_status = (p?.income_tax_deductions_status as string | null) ?? null;
    const assigned_handler_user_id = (p?.assigned_handler_user_id as string | null) ?? null;
    const base = {
      client_id: c.id,
      client_name: c.display_name,
      tax_id: c.tax_id,
      business_type: bt,
      payroll_flag,
      material_brought_flag,
      period_applicability: {
        vat_applicable: vatApplicable,
        payroll_applicable: snapshot?.payroll_applicable ?? false,
        income_tax_advance_applicable: snapshot?.income_tax_advance_applicable ?? false,
        income_tax_deductions_applicable: snapshot?.income_tax_deductions_applicable ?? false,
        national_insurance_applicable: snapshot?.national_insurance_applicable ?? false,
        national_insurance_deductions_applicable,
        row_visible: snapshot?.row_visible ?? true,
      },
      material_brought_cell: materialBroughtCell,
      material_cells: buildMaterialCells({
        vat: materialBroughtCell,
        income_tax_advance: incomeTaxAdvanceCell,
        payroll: payrollCell,
      }),
      annual_report_cell,
      capital_declaration_cell,
      national_insurance_deductions_cell,
      /** מע״מ: תדירות מע״מ ממיסים; עוסק פטור — פטור */
      vat_status,
      income_tax_advance_status,
      /** ביטוח לאומי: סכום חודשי ממיסים כשכן */
      national_insurance_status,
      /** ביטוח לאומי ניכויים — מחושב ממיסים + סטטוס מס הכנסה ניכויים (לא → לא רלוונטי). */
      national_insurance_deductions_status,
      income_tax_deductions_status,
      assigned_handler_user_id,
      notes_cell_text_he: noteAgg.cell_text_he,
      operational_notes_count: noteAgg.count,
      vat_due_registry_display_he,
    };
    return [mergeCustomCellsIntoRow({
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
    }, customColumns, customValuesByClientAndColumn)];
  });

  const q = (query.q ?? '').trim() || null;
  const sort_by = query.sort_by?.trim() || null;
  const sort_dir = query.sort_dir === 'desc' || query.sort_dir === 'asc' ? query.sort_dir : null;
  const rows = applyRegistryQueryToRows(builtRows, { q, sort_by, sort_dir });

  const customColumnsCapability = buildCustomColumnsCapability({
    current: customColumns.length,
    canEdit: ctx.membership?.permissions?.includes('client_operations.edit') === true,
  });
  const columns: ClientOperationsRegistryColumn[] = [
    ...CLIENT_OPERATIONS_REGISTRY_COLUMNS,
    ...customColumns
      .filter((column) => column.visible)
      .map((column) => ({
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
      })),
  ];
  return {
    title_he: 'תפעול לקוחות',
    period,
    rows,
    columns,
    note_types: noteTypes,
    toolbar_capabilities: buildClientOperationsToolbarCapabilities({
      can_create_custom_column: customColumnsCapability.can_create,
      can_create_reason_he: customColumnsCapability.current >= customColumnsCapability.max ? 'הגעת למגבלת 10 עמודות מותאמות אישית' : null,
    }),
    custom_columns_capability: customColumnsCapability,
    query: { q, sort_by, sort_dir, operational_period_key: selectedPeriodKey },
    allowed_actions: buildRegistryAllowedActions(ctx),
  };
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

  const handlerMemQuery = handlerId
    ? supabaseAdmin
        .from('organization_users')
        .select('user_id, users!organization_users_user_id_fkey(full_name, email)')
        .eq('organization_id', orgId)
        .eq('user_id', handlerId)
        .eq('membership_status', 'active')
        .not('invited_by', 'is', null)
        .maybeSingle()
    : Promise.resolve({ data: null as { users?: unknown } | null });

  const handlerListQuery = supabaseAdmin
    .from('organization_users')
    .select('user_id, users!organization_users_user_id_fkey(id, email, full_name)')
    .eq('organization_id', orgId)
    .eq('membership_status', 'active')
    .not('invited_by', 'is', null);

  const [handlerMemRes, handlerOrgRes] = await Promise.all([handlerMemQuery, handlerListQuery]);

  const handlerMem = handlerMemRes.data;
  const handlerUserRaw = (handlerMem as { users?: unknown } | null)?.users;
  const handlerUser = Array.isArray(handlerUserRaw)
    ? (handlerUserRaw[0] as { full_name: string | null; email: string | null } | undefined)
    : (handlerUserRaw as { full_name: string | null; email: string | null } | null);
  if (handlerUser) {
    const fullName = handlerUser.full_name ?? null;
    const email = handlerUser.email ?? null;
    assignedHandlerFullName = fullName?.trim() ? fullName : email;
  }

  const { data: handlerOrgRows, error: handlerOptsErr } = handlerOrgRes;

  if (handlerOptsErr) {
    throw new AppError(500, handlerOptsErr.message ?? 'organization_users (handlers) query failed', 'SUPABASE_ERROR');
  }

  type HandlerOptUser = { id: string; email: string | null; full_name: string | null };
  type HandlerOptRow = { user_id: string; users: HandlerOptUser | HandlerOptUser[] | null };
  const handler_user_options: Array<{ user_id: string; email: string; display_name: string }> = (
    (handlerOrgRows ?? []) as unknown as HandlerOptRow[]
  )
    .map((r) => {
      const uRaw = r.users;
      const u = Array.isArray(uRaw) ? uRaw[0] : uRaw;
      if (!u || !r.user_id) return null;
      const email = u.email ?? '';
      const display_name = u.full_name?.trim() ? u.full_name.trim() : email;
      return { user_id: r.user_id, email, display_name };
    })
    .filter((x): x is { user_id: string; email: string; display_name: string } => x != null && Boolean(x.user_id && x.email))
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'he'));

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
 */
export async function updateClientOperationsClientProfile(
  ctx: RequestContext,
  clientId: string,
  body: UpdateClientOperationsClientProfileRequest
): Promise<ClientOperationsCaseResponse> {
  const orgId = assertOrg(ctx);

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

  // Assigned handler validation (must be an active invited member of the same org).
  const assigned_handler_user_id =
    body.assigned_handler_user_id !== undefined
      ? body.assigned_handler_user_id
        ? String(body.assigned_handler_user_id)
        : null
      : (existingProfile?.assigned_handler_user_id ?? null);
  if (assigned_handler_user_id) {
    const { data: ou } = await supabaseAdmin
      .from('organization_users')
      .select('id, invited_by')
      .eq('organization_id', orgId)
      .eq('user_id', assigned_handler_user_id)
      .eq('membership_status', 'active')
      .not('invited_by', 'is', null)
      .maybeSingle();
    if (!ou) throw forbidden('Assigned accountant must be a confirmed invited member of this organization');
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

