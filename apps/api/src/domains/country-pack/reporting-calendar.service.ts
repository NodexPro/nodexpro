import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { buildOwnerModuleDetailAggregate } from '../owner-modules/owner-modules.service.js';
import { CLIENT_OPERATIONS_MODULE_CODE, OWNER_MODULE_DETAIL_AGGREGATE_KEY } from '../owner-modules/owner-modules.pure.js';
import { assertCountryExists } from './country.service.js';
import {
  REPORTING_CALENDAR_AGGREGATE_KEY,
  REPORTING_OBLIGATION_KEYS,
  REPORTING_OBLIGATION_LABELS_HE,
  type ReportingCalendarCellView,
  type ReportingCalendarEntryStatus,
  type ReportingObligationKey,
  buildEmptyCalendarCell,
  buildReportingCalendarPeriodRow,
  formatFilingDueDateDisplay,
  isNationalInsuranceObligationKey,
  isReportingObligationKey,
  isReportingPeriodKey,
  parseReportingPeriodKey,
  reportingPeriodKeysForYear,
  assessYearPublicationCompleteness,
  ownerReportingCalendarStatusPresentation,
} from './reporting-calendar.pure.js';

type CalendarEntryRow = {
  id: string;
  country_code: string;
  obligation_key: string;
  reporting_period_key: string;
  filing_due_date: string;
  explanation_code: string | null;
  owner_note: string | null;
  legal_basis_reference: string | null;
  status: ReportingCalendarEntryStatus;
  replaces_entry_id: string | null;
  country_pack_ruleset_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type OwnerModuleDetailRefresh = {
  ok: true;
  command: ReportingCalendarCommandType;
  refreshed: {
    aggregate_key: typeof OWNER_MODULE_DETAIL_AGGREGATE_KEY;
    aggregate: Record<string, unknown>;
  };
};

export type ReportingCalendarCommandType =
  | 'create_reporting_calendar_entry'
  | 'correct_reporting_calendar_entry'
  | 'activate_reporting_calendar_entry'
  | 'deactivate_reporting_calendar_entry'
  | 'save_reporting_calendar_period_dates'
  | 'publish_reporting_calendar_year';

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
  return value.trim();
}

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('Invalid string value');
  const v = value.trim();
  return v.length ? v : null;
}

function asCountryCode(value: unknown): string {
  const code = asString(value, 'country_code').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw badRequest('country_code must be a 2-letter country code');
  return code;
}

function asYear(value: unknown, fallback?: number): number {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw badRequest('year must be an integer between 2000 and 2100');
  return n;
}

function asDate(value: unknown, field: string): string {
  const v = asString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${field} must be YYYY-MM-DD`);
  return v;
}

function asObligationKey(value: unknown): ReportingObligationKey {
  const key = asString(value, 'obligation_key');
  if (isNationalInsuranceObligationKey(key)) {
    throw badRequest('National Insurance is not part of the Tax Authority reporting calendar');
  }
  if (!isReportingObligationKey(key)) throw badRequest('Invalid obligation_key');
  return key;
}

function asPeriodKey(value: unknown): string {
  const key = asString(value, 'reporting_period_key');
  if (!isReportingPeriodKey(key)) throw badRequest('reporting_period_key must be YYYY-MM');
  return key;
}

function ownerModuleDetailContextFromPayload(payload: Record<string, unknown>): {
  country_code: string;
  year: number;
  commercial_controls_context?: Partial<{
    page: number;
    page_size: number;
    search: string | null;
    module_key: string | null;
    entitlement_status: string | null;
    activation_status: string | null;
  }>;
} {
  const country_code = asCountryCode(payload.country_code ?? 'IL');
  const year = asYear(payload.year, new Date().getUTCFullYear());
  const rawCommercial = payload.commercial_controls_context;
  const commercial =
    rawCommercial && typeof rawCommercial === 'object' && !Array.isArray(rawCommercial)
      ? (rawCommercial as Record<string, unknown>)
      : null;
  return {
    country_code,
    year,
    commercial_controls_context: commercial
      ? {
          page: Number(commercial.page ?? 1) || 1,
          page_size: Number(commercial.page_size ?? 20) || 20,
          search: typeof commercial.search === 'string' ? commercial.search : null,
          module_key: typeof commercial.module_key === 'string' ? commercial.module_key : null,
          entitlement_status: typeof commercial.entitlement_status === 'string' ? commercial.entitlement_status : null,
          activation_status: typeof commercial.activation_status === 'string' ? commercial.activation_status : null,
        }
      : undefined,
  };
}

async function refreshedOwnerModuleDetail(
  ctx: RequestContext,
  command: ReportingCalendarCommandType,
  payload: Record<string, unknown>
): Promise<OwnerModuleDetailRefresh> {
  const detail = ownerModuleDetailContextFromPayload(payload);
  return {
    ok: true,
    command,
    refreshed: {
      aggregate_key: OWNER_MODULE_DETAIL_AGGREGATE_KEY,
      aggregate: await buildOwnerModuleDetailAggregate(ctx, CLIENT_OPERATIONS_MODULE_CODE, detail.commercial_controls_context, {
        country_code: detail.country_code,
        year: detail.year,
      }),
    },
  };
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityId: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    moduleCode: CLIENT_OPERATIONS_MODULE_CODE,
    entityType: 'country_reporting_calendar_entry',
    entityId,
    action,
    payload,
  });
}

function toCell(row: CalendarEntryRow): ReportingCalendarCellView {
  const obligationKey = row.obligation_key as ReportingObligationKey;
  return {
    obligation_key: obligationKey,
    label: REPORTING_OBLIGATION_LABELS_HE[obligationKey],
    entry_id: row.id,
    filing_due_date: String(row.filing_due_date).slice(0, 10),
    filing_due_date_display: formatFilingDueDateDisplay(String(row.filing_due_date)),
    status: row.status,
    explanation_code: row.explanation_code,
    replaces_entry_id: row.replaces_entry_id,
    is_runtime_legal_truth: row.status === 'active',
  };
}

function chooseVisibleEntry(rows: CalendarEntryRow[]): CalendarEntryRow | null {
  return (
    rows.find((r) => r.status === 'draft') ??
    rows.find((r) => r.status === 'active') ??
    rows.find((r) => r.status === 'disabled') ??
    rows[0] ??
    null
  );
}

export async function buildCountryReportingCalendarAggregate(input: {
  country_code?: string | null;
  year?: number | string | null;
}): Promise<Record<string, unknown>> {
  const countryCode = asCountryCode(input.country_code ?? 'IL');
  const requestedYear = asYear(input.year, new Date().getUTCFullYear());

  const { data, error } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .select(
      'id, country_code, obligation_key, reporting_period_key, filing_due_date, explanation_code, owner_note, legal_basis_reference, status, replaces_entry_id, country_pack_ruleset_id, created_at, updated_at'
    )
    .eq('country_code', countryCode)
    .order('reporting_period_key', { ascending: true })
    .order('obligation_key', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const allRows = (data ?? []) as CalendarEntryRow[];
  const availableYears = [...new Set(allRows.map((r) => parseReportingPeriodKey(r.reporting_period_key)?.year).filter((y): y is number => Number.isInteger(y)))];
  const utcYear = new Date().getUTCFullYear();
  const yearFloor = Math.min(utcYear - 1, requestedYear, ...(availableYears.length ? availableYears : [utcYear]));
  const yearCeil = Math.max(utcYear + 3, requestedYear, ...(availableYears.length ? availableYears : [utcYear]));
  for (let y = yearFloor; y <= yearCeil; y += 1) {
    if (!availableYears.includes(y)) availableYears.push(y);
  }
  availableYears.sort((a, b) => a - b);

  const yearPrefix = `${requestedYear}-`;
  const yearRows = allRows.filter((r) => r.reporting_period_key.startsWith(yearPrefix));
  const byPeriodAndObligation = new Map<string, CalendarEntryRow[]>();
  for (const row of yearRows) {
    if (!isReportingObligationKey(row.obligation_key) || !isReportingPeriodKey(row.reporting_period_key)) continue;
    const key = `${row.reporting_period_key}:${row.obligation_key}`;
    byPeriodAndObligation.set(key, [...(byPeriodAndObligation.get(key) ?? []), row]);
  }

  const rows = reportingPeriodKeysForYear(requestedYear).map((periodKey) => {
    const cells: Partial<Record<ReportingObligationKey, ReportingCalendarCellView>> = {};
    for (const obligationKey of REPORTING_OBLIGATION_KEYS) {
      const visible = chooseVisibleEntry(byPeriodAndObligation.get(`${periodKey}:${obligationKey}`) ?? []);
      cells[obligationKey] = visible ? toCell(visible) : buildEmptyCalendarCell(obligationKey);
    }
    return buildReportingCalendarPeriodRow({ reporting_period_key: periodKey, cells });
  });

  const visibleCells = rows.flatMap((row) => REPORTING_OBLIGATION_KEYS.map((key) => row.cells[key]));
  const configuredCount = visibleCells.filter((cell) => cell.status !== 'missing').length;
  const activeCount = visibleCells.filter((cell) => cell.status === 'active').length;
  const draftCount = visibleCells.filter((cell) => cell.status === 'draft').length;
  const missingCount = visibleCells.filter((cell) => cell.status === 'missing').length;
  const disabledCount = visibleCells.filter((cell) => cell.status === 'disabled').length;
  const statusPresentation = ownerReportingCalendarStatusPresentation({
    active_count: activeCount,
    draft_count: draftCount,
    missing_count: missingCount,
    configured_count: configuredCount,
  });

  return {
    aggregate_key: REPORTING_CALENDAR_AGGREGATE_KEY,
    tab_key: 'reporting_calendar',
    configured: configuredCount > 0,
    unavailable_reason: null,
    legal_owner: 'country_pack_owner_legal_control',
    country_code: countryCode,
    year: requestedYear,
    available_years: availableYears,
    status: statusPresentation.status,
    status_label: statusPresentation.status_label,
    obligation_columns: REPORTING_OBLIGATION_KEYS.map((key) => ({
      obligation_key: key,
      label: REPORTING_OBLIGATION_LABELS_HE[key],
    })),
    rows,
    summary: {
      configured_count: configuredCount,
      active_count: activeCount,
      draft_count: draftCount,
      missing_count: missingCount,
      disabled_count: disabledCount,
      total_cells: visibleCells.length,
    },
    actions: [
      {
        action_key: 'save_reporting_calendar_period_dates',
        enabled: true,
        note: 'Saves draft dates for one reporting period. Runtime truth changes only after publish/activate.',
      },
      {
        action_key: 'publish_reporting_calendar_year',
        enabled: draftCount > 0,
        note: 'Promotes draft dates for the selected country/year to active legal truth.',
      },
    ],
  };
}

async function findEntryById(entryId: string): Promise<CalendarEntryRow> {
  const { data, error } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .select('*')
    .eq('id', entryId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Reporting calendar entry not found');
  return data as CalendarEntryRow;
}

async function findActiveForCell(
  countryCode: string,
  obligationKey: ReportingObligationKey,
  periodKey: string
): Promise<CalendarEntryRow | null> {
  const { data, error } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .select('*')
    .eq('country_code', countryCode)
    .eq('obligation_key', obligationKey)
    .eq('reporting_period_key', periodKey)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return (data as CalendarEntryRow | null) ?? null;
}

async function handleCreateEntry(ctx: RequestContext, payload: Record<string, unknown>): Promise<OwnerModuleDetailRefresh> {
  const countryCode = asCountryCode(payload.country_code);
  await assertCountryExists(countryCode);
  const obligationKey = asObligationKey(payload.obligation_key);
  const periodKey = asPeriodKey(payload.reporting_period_key);
  const filingDueDate = asDate(payload.filing_due_date, 'filing_due_date');
  const status = (asOptionalString(payload.status) ?? 'draft') as ReportingCalendarEntryStatus;
  if (!['draft', 'active'].includes(status)) throw badRequest('status must be draft or active');
  if (status === 'active' && (await findActiveForCell(countryCode, obligationKey, periodKey))) {
    throw conflict('Active reporting calendar entry already exists for this country/obligation/period');
  }
  const { data, error } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .insert({
      country_code: countryCode,
      obligation_key: obligationKey,
      reporting_period_key: periodKey,
      filing_due_date: filingDueDate,
      explanation_code: asOptionalString(payload.explanation_code),
      legal_basis_reference: asOptionalString(payload.legal_basis_reference),
      owner_note: asOptionalString(payload.owner_note),
      status,
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.REPORTING_CALENDAR_ENTRY_CREATED, String(data.id), {
    country_code: countryCode,
    obligation_key: obligationKey,
    reporting_period_key: periodKey,
    filing_due_date: filingDueDate,
    status,
  });
  return refreshedOwnerModuleDetail(ctx, 'create_reporting_calendar_entry', { ...payload, country_code: countryCode, year: parseReportingPeriodKey(periodKey)?.year });
}

async function handleCorrectEntry(ctx: RequestContext, payload: Record<string, unknown>): Promise<OwnerModuleDetailRefresh> {
  const entryId = asString(payload.entry_id, 'entry_id');
  const previous = await findEntryById(entryId);
  if (previous.status !== 'active') throw badRequest('Only active reporting calendar entries can be corrected');
  const filingDueDate = asDate(payload.filing_due_date, 'filing_due_date');
  const { error: depErr } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .update({ status: 'deprecated', updated_at: new Date().toISOString() })
    .eq('id', entryId);
  if (depErr) throw depErr;
  const { data: created, error: insErr } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .insert({
      country_code: previous.country_code,
      obligation_key: previous.obligation_key,
      reporting_period_key: previous.reporting_period_key,
      filing_due_date: filingDueDate,
      explanation_code: asOptionalString(payload.explanation_code) ?? previous.explanation_code,
      legal_basis_reference: asOptionalString(payload.legal_basis_reference) ?? previous.legal_basis_reference,
      owner_note: asOptionalString(payload.owner_note) ?? previous.owner_note,
      status: 'active',
      replaces_entry_id: previous.id,
      country_pack_ruleset_id: previous.country_pack_ruleset_id,
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  await audit(ctx, AUDIT_ACTIONS.REPORTING_CALENDAR_ENTRY_CORRECTED, String(created.id), {
    country_code: previous.country_code,
    obligation_key: previous.obligation_key,
    reporting_period_key: previous.reporting_period_key,
    previous_entry_id: previous.id,
    filing_due_date: filingDueDate,
  });
  return refreshedOwnerModuleDetail(ctx, 'correct_reporting_calendar_entry', {
    ...payload,
    country_code: previous.country_code,
    year: parseReportingPeriodKey(previous.reporting_period_key)?.year,
  });
}

async function handleActivateEntry(ctx: RequestContext, payload: Record<string, unknown>): Promise<OwnerModuleDetailRefresh> {
  const entryId = asString(payload.entry_id, 'entry_id');
  const row = await findEntryById(entryId);
  if (row.status === 'active') {
    return refreshedOwnerModuleDetail(ctx, 'activate_reporting_calendar_entry', {
      ...payload,
      country_code: row.country_code,
      year: parseReportingPeriodKey(row.reporting_period_key)?.year,
    });
  }
  if (row.status === 'deprecated') throw badRequest('Deprecated entries cannot be activated');
  const existingActive = await findActiveForCell(row.country_code, row.obligation_key as ReportingObligationKey, row.reporting_period_key);
  if (existingActive && existingActive.id !== row.id) {
    const { error: depErr } = await supabaseAdmin
      .from('country_reporting_calendar_entries')
      .update({ status: 'deprecated', updated_at: new Date().toISOString() })
      .eq('id', existingActive.id);
    if (depErr) throw depErr;
  }
  const { error } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .update({ status: 'active', replaces_entry_id: existingActive?.id ?? row.replaces_entry_id, updated_at: new Date().toISOString() })
    .eq('id', entryId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.REPORTING_CALENDAR_ENTRY_ACTIVATED, entryId, {
    country_code: row.country_code,
    obligation_key: row.obligation_key,
    reporting_period_key: row.reporting_period_key,
    deprecated_entry_id: existingActive?.id ?? null,
  });
  return refreshedOwnerModuleDetail(ctx, 'activate_reporting_calendar_entry', {
    ...payload,
    country_code: row.country_code,
    year: parseReportingPeriodKey(row.reporting_period_key)?.year,
  });
}

async function handleDeactivateEntry(ctx: RequestContext, payload: Record<string, unknown>): Promise<OwnerModuleDetailRefresh> {
  const entryId = asString(payload.entry_id, 'entry_id');
  const row = await findEntryById(entryId);
  if (row.status === 'deprecated') throw badRequest('Deprecated entries cannot be deactivated');
  const { error } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .update({ status: 'disabled', updated_at: new Date().toISOString() })
    .eq('id', entryId);
  if (error) throw error;
  await audit(ctx, AUDIT_ACTIONS.REPORTING_CALENDAR_ENTRY_DEACTIVATED, entryId, {
    country_code: row.country_code,
    obligation_key: row.obligation_key,
    reporting_period_key: row.reporting_period_key,
    previous_status: row.status,
  });
  return refreshedOwnerModuleDetail(ctx, 'deactivate_reporting_calendar_entry', {
    ...payload,
    country_code: row.country_code,
    year: parseReportingPeriodKey(row.reporting_period_key)?.year,
  });
}

async function handleSavePeriodDates(ctx: RequestContext, payload: Record<string, unknown>): Promise<OwnerModuleDetailRefresh> {
  const countryCode = asCountryCode(payload.country_code);
  await assertCountryExists(countryCode);
  const periodKey = asPeriodKey(payload.reporting_period_key);
  const parsed = parseReportingPeriodKey(periodKey);
  if (!parsed) throw badRequest('reporting_period_key must be YYYY-MM');
  const rawDates = payload.dates;
  if (!rawDates || typeof rawDates !== 'object' || Array.isArray(rawDates)) throw badRequest('dates must be an object');
  const dates = rawDates as Record<string, unknown>;
  const changed: string[] = [];

  for (const obligationKey of REPORTING_OBLIGATION_KEYS) {
    if (dates[obligationKey] === undefined || dates[obligationKey] === null || dates[obligationKey] === '') continue;
    const filingDueDate = asDate(dates[obligationKey], `dates.${obligationKey}`);
    const { data: drafts, error: draftErr } = await supabaseAdmin
      .from('country_reporting_calendar_entries')
      .select('*')
      .eq('country_code', countryCode)
      .eq('obligation_key', obligationKey)
      .eq('reporting_period_key', periodKey)
      .eq('status', 'draft')
      .limit(1);
    if (draftErr) throw draftErr;
    const draft = (drafts?.[0] as CalendarEntryRow | undefined) ?? null;
    if (draft) {
      const { error: updErr } = await supabaseAdmin
        .from('country_reporting_calendar_entries')
        .update({ filing_due_date: filingDueDate, updated_at: new Date().toISOString() })
        .eq('id', draft.id);
      if (updErr) throw updErr;
      changed.push(obligationKey);
      continue;
    }

    const active = await findActiveForCell(countryCode, obligationKey, periodKey);
    const { error: insErr } = await supabaseAdmin.from('country_reporting_calendar_entries').insert({
      country_code: countryCode,
      obligation_key: obligationKey,
      reporting_period_key: periodKey,
      filing_due_date: filingDueDate,
      explanation_code: active?.explanation_code ?? null,
      legal_basis_reference: active?.legal_basis_reference ?? null,
      owner_note: active?.owner_note ?? null,
      status: 'draft',
      replaces_entry_id: active?.id ?? null,
      country_pack_ruleset_id: active?.country_pack_ruleset_id ?? null,
      created_by: ctx.user.id,
    });
    if (insErr) throw insErr;
    changed.push(obligationKey);
  }

  await audit(ctx, AUDIT_ACTIONS.REPORTING_CALENDAR_PERIOD_DATES_UPDATED, null, {
    country_code: countryCode,
    reporting_period_key: periodKey,
    obligation_keys: changed,
  });
  return refreshedOwnerModuleDetail(ctx, 'save_reporting_calendar_period_dates', {
    ...payload,
    country_code: countryCode,
    year: parsed.year,
  });
}

async function handlePublishYear(ctx: RequestContext, payload: Record<string, unknown>): Promise<OwnerModuleDetailRefresh> {
  const countryCode = asCountryCode(payload.country_code);
  await assertCountryExists(countryCode);
  const year = asYear(payload.year, new Date().getUTCFullYear());
  const periodKeys = reportingPeriodKeysForYear(year);
  const { data, error } = await supabaseAdmin
    .from('country_reporting_calendar_entries')
    .select('*')
    .eq('country_code', countryCode)
    .in('reporting_period_key', periodKeys)
    .in('status', ['draft', 'active']);
  if (error) throw error;
  const rows = (data ?? []) as CalendarEntryRow[];

  const cells = periodKeys.flatMap((periodKey) =>
    REPORTING_OBLIGATION_KEYS.map((obligationKey) => {
      const draft = rows.find(
        (r) => r.status === 'draft' && r.obligation_key === obligationKey && r.reporting_period_key === periodKey
      );
      const active = rows.find(
        (r) => r.status === 'active' && r.obligation_key === obligationKey && r.reporting_period_key === periodKey
      );
      const effective = draft ?? active;
      return {
        reporting_period_key: periodKey,
        obligation_key: obligationKey,
        draft_id: draft?.id ?? null,
        active_id: active?.id ?? null,
        effective_filing_due_date: effective ? String(effective.filing_due_date).slice(0, 10) : null,
      };
    })
  );

  const assessment = assessYearPublicationCompleteness(year, cells);
  if (!assessment.complete) {
    throw badRequest(
      `Cannot publish incomplete reporting calendar year ${year}: expected ${assessment.expected_count} dated cells, found ${assessment.present_count}` +
        (assessment.missing.length ? `; missing=${assessment.missing.map((m) => `${m.reporting_period_key}:${m.obligation_key}`).join(',')}` : '') +
        (assessment.invalid_dates.length
          ? `; invalid_dates=${assessment.invalid_dates.map((m) => `${m.reporting_period_key}:${m.obligation_key}`).join(',')}`
          : '')
    );
  }

  if (!assessment.draft_ids_to_activate.length) {
    return refreshedOwnerModuleDetail(ctx, 'publish_reporting_calendar_year', { ...payload, country_code: countryCode, year });
  }

  // Prefer DB-atomic publish when migration RPC is available; fall back only after completeness passed.
  const { error: rpcError } = await supabaseAdmin.rpc('publish_country_reporting_calendar_year', {
    p_country_code: countryCode,
    p_year: year,
  });

  if (rpcError) {
    if (!/function .*publish_country_reporting_calendar_year/i.test(rpcError.message ?? '')) {
      throw rpcError;
    }
    for (const activeId of assessment.active_ids_to_deprecate) {
      const { error: depErr } = await supabaseAdmin
        .from('country_reporting_calendar_entries')
        .update({ status: 'deprecated', updated_at: new Date().toISOString() })
        .eq('id', activeId);
      if (depErr) throw depErr;
    }
    for (const draftId of assessment.draft_ids_to_activate) {
      const draft = rows.find((r) => r.id === draftId);
      const activeId =
        assessment.active_ids_to_deprecate.find((id) => {
          const active = rows.find((r) => r.id === id);
          return (
            active &&
            draft &&
            active.obligation_key === draft.obligation_key &&
            active.reporting_period_key === draft.reporting_period_key
          );
        }) ?? null;
      const { error: actErr } = await supabaseAdmin
        .from('country_reporting_calendar_entries')
        .update({
          status: 'active',
          replaces_entry_id: activeId ?? draft?.replaces_entry_id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', draftId);
      if (actErr) throw actErr;
    }
  }

  await audit(ctx, AUDIT_ACTIONS.REPORTING_CALENDAR_YEAR_PUBLISHED, null, {
    country_code: countryCode,
    year,
    published_count: assessment.draft_ids_to_activate.length,
    expected_count: assessment.expected_count,
  });
  return refreshedOwnerModuleDetail(ctx, 'publish_reporting_calendar_year', { ...payload, country_code: countryCode, year });
}

export async function executeReportingCalendarCommand(
  ctx: RequestContext,
  command: ReportingCalendarCommandType,
  payload: Record<string, unknown>
): Promise<OwnerModuleDetailRefresh> {
  assertPlatformOwner(ctx);
  switch (command) {
    case 'create_reporting_calendar_entry':
      return handleCreateEntry(ctx, payload);
    case 'correct_reporting_calendar_entry':
      return handleCorrectEntry(ctx, payload);
    case 'activate_reporting_calendar_entry':
      return handleActivateEntry(ctx, payload);
    case 'deactivate_reporting_calendar_entry':
      return handleDeactivateEntry(ctx, payload);
    case 'save_reporting_calendar_period_dates':
      return handleSavePeriodDates(ctx, payload);
    case 'publish_reporting_calendar_year':
      return handlePublishYear(ctx, payload);
    default:
      throw badRequest(`Unsupported reporting calendar command: ${String(command)}`);
  }
}
