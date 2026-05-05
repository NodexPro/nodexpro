import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { buildNotesCellDisplayHe, loadNotesAggregatesByClient } from './client-operations-notes.service.js';
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
import { getAnnualTabReadModel, type AnnualTabResponse } from './client-annual-report-tab.service.js';
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

export type ClientOperationsRegistryRow = {
  client_id: string;
  client_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  payroll_flag: boolean | null;
  material_brought_flag: boolean | null;
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
};

export type ClientOperationsRegistryResponse = {
  rows: ClientOperationsRegistryRow[];
};

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

export async function listClientOperationsRegistry(ctx: RequestContext): Promise<ClientOperationsRegistryResponse> {
  const orgId = assertOrg(ctx);

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('display_name', { ascending: true });

  const safeClients = (clients ?? []) as Array<{ id: string; display_name: string | null; tax_id: string | null }>;
  if (safeClients.length === 0) {
    return { rows: [] };
  }

  const clientIds = safeClients.map((c) => c.id);
  const { data: profiles } = await supabaseAdmin
    .from('client_operational_profiles')
    .select(PROFILE_SELECT)
    .eq('organization_id', orgId)
    .in('client_id', clientIds);

  const profilesByClientId = new Map<string, Record<string, unknown>>();
  for (const p of (profiles ?? []) as unknown as Array<{ client_id: string }>) {
    profilesByClientId.set(p.client_id, p as Record<string, unknown>);
  }

  const notesByClient = await loadNotesAggregatesByClient(orgId, clientIds);

  const { data: taxSettingsRows } = await supabaseAdmin
    .from('client_tax_settings')
    .select(
      'client_id, vat_due_type, vat_frequency, vat_type, national_insurance_type, national_insurance_monthly_amount, income_tax_deductions_enabled, income_tax_deductions_file_number, income_tax_deductions_frequency'
    )
    .eq('organization_id', orgId)
    .in('client_id', clientIds);

  const taxByClient = new Map<
    string,
    {
      vat_due_type: string | null;
      vat_frequency: string | null;
      vat_type: string | null;
      national_insurance_type: string | null;
      national_insurance_monthly_amount: number | null;
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
    national_insurance_type: string | null;
    national_insurance_monthly_amount: number | null;
    income_tax_deductions_enabled: boolean | null;
    income_tax_deductions_file_number: string | null;
    income_tax_deductions_frequency: string | null;
  }>) {
    taxByClient.set(t.client_id, {
      vat_due_type: t.vat_due_type,
      vat_frequency: t.vat_frequency,
      vat_type: t.vat_type,
      national_insurance_type: t.national_insurance_type,
      national_insurance_monthly_amount: t.national_insurance_monthly_amount,
      income_tax_deductions_enabled: Boolean(t.income_tax_deductions_enabled),
      income_tax_deductions_file_number: t.income_tax_deductions_file_number,
      income_tax_deductions_frequency: t.income_tax_deductions_frequency,
    });
  }

  const rows: ClientOperationsRegistryRow[] = safeClients.map((c) => {
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
    return {
      client_id: c.id,
      client_name: c.display_name,
      tax_id: c.tax_id,
      business_type: bt,
      payroll_flag: (p?.payroll_flag as boolean | null) ?? null,
      material_brought_flag: (p?.material_brought_flag as boolean | null) ?? null,
      /** מע״מ: תדירות מע״מ ממיסים; עוסק פטור — פטור */
      vat_status: vatFromTax ?? (p?.vat_status as string | null) ?? null,
      income_tax_advance_status: (p?.income_tax_advance_status as string | null) ?? null,
      /** ביטוח לאומי: סכום חודשי ממיסים כשכן */
      national_insurance_status: niFromTax ?? (p?.national_insurance_status as string | null) ?? null,
      /** ביטוח לאומי ניכויים — מחושב ממיסים + סטטוס מס הכנסה ניכויים (לא → לא רלוונטי). */
      national_insurance_deductions_status:
        niDedFromTax ?? (p?.national_insurance_deductions_status as string | null) ?? null,
      income_tax_deductions_status: (p?.income_tax_deductions_status as string | null) ?? null,
      assigned_handler_user_id: (p?.assigned_handler_user_id as string | null) ?? null,
      notes_cell_text_he: noteAgg.cell_text_he,
      operational_notes_count: noteAgg.count,
      vat_due_registry_display_he,
    };
  });

  return { rows };
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

