/**
 * Client Operations — annual report tax-year resolver + operational date cell builders.
 * Product rule: for operational workspace year Y, annual report tax_year = Y - 1.
 * Backend-owned; React must not compute this.
 */

import { businessMonthKey } from '../../shared/business-time.js';
import { parseOperationalPeriodKey } from './client-operations-operational-period.pure.js';

export type AnnualCapitalFilingSquareChrome = 'empty' | 'filed';

export type AnnualCapitalSubmissionFileKind = 'form_1301' | 'additional' | 'checklist';

export type AnnualCapitalLinkedFile = {
  file_asset_id: string;
  file_name: string | null;
  source_kind: AnnualCapitalSubmissionFileKind;
  source_kind_label_key: string;
  can_open: boolean;
  uploaded_on?: string | null;
  type_label?: string | null;
  actions?: { can_open: boolean; can_preview: boolean };
};

export type AnnualTaxYearOption = {
  tax_year: number;
  is_tab_year: boolean;
  already_filed: boolean;
  submitted_on: string | null;
};

export type AnnualReportFilingPresentation = {
  square_chrome: AnnualCapitalFilingSquareChrome;
  tab_tax_year: number;
  filed_for_tab_tax_year: boolean;
  tab_submitted_on: string | null;
  can_open_modal: boolean;
  other_year_confirm_required_code: 'ANNUAL_OTHER_TAX_YEAR_CONFIRM_REQUIRED';
  modal: {
    title_key: string;
    confirm_key: string;
    cancel_key: string;
    client_label_key: string;
    tax_year_label_key: string;
    filed_on_label_key: string;
    form_1301_label_key: string;
    additional_files_label_key: string;
    tax_year: number;
    tax_year_options: AnnualTaxYearOption[];
    submitted_on: string | null;
    files: AnnualCapitalLinkedFile[];
  };
};

export type CapitalDeclarationAllowedActions = {
  can_set_date: boolean;
  can_open_modal: boolean;
  can_file: boolean;
  can_open_new: boolean;
};

export type CapitalDeclarationAssignmentState = 'unassigned' | 'assigned' | 'filed' | 'not_applicable';

export type CapitalDeclarationFilingPresentation = {
  square_chrome: AnnualCapitalFilingSquareChrome;
  /** Backend-owned: square stays visible for every assignable client, including unassigned. */
  square_visible: boolean;
  instance_id: string | null;
  sequence_no: number | null;
  filed: boolean;
  submitted_on: string | null;
  operational_target_date: string | null;
  can_open_modal: boolean;
  modal: {
    title_key: string;
    confirm_key: string;
    cancel_key: string;
    client_label_key: string;
    due_date_label_key: string;
    filed_on_label_key: string;
    files_label_key: string;
    instance_id: string | null;
    sequence_no: number | null;
    operational_target_date: string | null;
    submitted_on: string | null;
    files: AnnualCapitalLinkedFile[];
  };
};

export type AnnualReportOperationalDateCell = {
  applicable: boolean;
  editable: boolean;
  tax_year: number | null;
  instance_id: string | null;
  operational_target_date: string | null;
  filing: AnnualReportFilingPresentation;
};

export type CapitalDeclarationOperationalDateCell = {
  applicable: boolean;
  editable: boolean;
  instance_id: string | null;
  tax_year: number | null;
  operational_target_date: string | null;
  sequence_no: number | null;
  instance_status: 'open' | 'completed' | null;
  /**
   * Backend-owned assignment: missing instance is unassigned, not N/A.
   * filed is a completed assigned instance. not_applicable is reserved for a
   * real legal rule — never a missing instance.
   */
  assignment_state: CapitalDeclarationAssignmentState;
  allowed_actions: CapitalDeclarationAllowedActions;
  /** Backend-owned: show compact + after a completed instance so another can be opened. */
  can_open: boolean;
  filing: CapitalDeclarationFilingPresentation;
};

export type AnnualYearFolder = {
  folder_key: string;
  tax_year: number;
  label: string;
  submission_id: string;
  submitted_on: string;
  filed: true;
  files: AnnualCapitalLinkedFile[];
};

export type CapitalRequirementFolder = {
  folder_key: string;
  instance_id: string;
  sequence_no: number;
  folder_label_key: string;
  status: 'open' | 'completed';
  operational_target_date: string | null;
  submitted_on: string | null;
  filed: boolean;
  files: AnnualCapitalLinkedFile[];
};

/** Format YYYY-MM-DD → DD/MM/YYYY without timezone shift (date-only). */
export function formatOperationalDateDisplayHe(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate).trim());
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, mo, d] = value.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Resolve annual-report tax year for a Client Operations operational period (YYYY-MM).
 * Rule: tax_year = operational year - 1.
 */
export function resolveAnnualReportTaxYearForOperationalPeriod(operationalPeriodKey: string): number {
  const parts = parseOperationalPeriodKey(operationalPeriodKey);
  if (!parts) {
    throw new Error(`Invalid operational_period_key: ${operationalPeriodKey}`);
  }
  return parts.year - 1;
}

/**
 * Convert a stored event/audit timestamp to an operational month (Asia/Jerusalem).
 * Never use `submitted_on` or `new Date()` at read time as a stand-in for history.
 */
export function operationalPeriodKeyFromEventTimestamp(
  value: string | Date | null | undefined,
): string | null {
  if (value == null || value === '') return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return businessMonthKey(instant);
}

export type AnnualCapitalPeriodCycle = {
  /** tax_year for annual, instance id for capital. */
  identity: string;
  instance_id: string | null;
  operational_target_date: string | null;
  /**
   * First month this cycle is visible. Null = assignment start is unknown;
   * do not invent an earlier month — the left edge stays open.
   */
  assigned_from_period_key: string | null;
  /**
   * Month the filing confirmation event was recorded. Null = not filed.
   * Green square is only this month, never `submitted_on`.
   */
  filed_period_key: string | null;
};

export type AnnualCapitalPeriodProjection = {
  kind: 'empty' | 'assigned' | 'filed';
  operational_target_date: string | null;
  identity: string | null;
  instance_id: string | null;
  /** Covering cycle already has a filing confirmation event. Historical months stay frozen. */
  cycle_closed: boolean;
  /** True when the visible cycle has no known assignment-start event. */
  legacy_unknown_assignment_start: boolean;
};

function cycleCoversOperationalPeriod(
  cycle: AnnualCapitalPeriodCycle,
  operationalPeriodKey: string,
): boolean {
  const hasDate = Boolean(cycle.operational_target_date);
  const filedPeriod = cycle.filed_period_key;
  if (!hasDate && !filedPeriod) return false;
  if (cycle.assigned_from_period_key && operationalPeriodKey < cycle.assigned_from_period_key) {
    return false;
  }
  if (filedPeriod && operationalPeriodKey > filedPeriod) return false;
  if (!hasDate && filedPeriod && operationalPeriodKey !== filedPeriod) return false;
  return true;
}

export type AnnualInstancePeriodIdentity = {
  id: string;
  tax_year: number;
  operational_target_date: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** First month the cycle is visible: earliest date revision, else instance created_at. */
export function earliestAnnualAssignedPeriodKey(input: {
  instance: { id?: string; created_at?: string | null } | null;
  revisions?: readonly AnnualDateRevision[];
}): string | null {
  const fromCreated = operationalPeriodKeyFromEventTimestamp(input.instance?.created_at);
  const instanceId = input.instance?.id;
  let earliestRevision: string | null = null;
  for (const row of input.revisions ?? []) {
    if (instanceId && row.instance_id !== instanceId) continue;
    if (!row.effective_period_key) continue;
    if (!earliestRevision || row.effective_period_key < earliestRevision) {
      earliestRevision = row.effective_period_key;
    }
  }
  if (fromCreated && earliestRevision) {
    return fromCreated < earliestRevision ? fromCreated : earliestRevision;
  }
  return earliestRevision ?? fromCreated;
}

/**
 * One covering annual instance for a monthly tab. Never mixes tax years into one cell:
 * outstanding open cycles win (oldest tax year first); otherwise the latest covering cycle.
 */
export function selectCoveringAnnualInstanceForPeriod(input: {
  operationalPeriodKey: string;
  tabTaxYear: number;
  instances: readonly AnnualInstancePeriodIdentity[];
  revisionsByInstanceId?: ReadonlyMap<string, readonly AnnualDateRevision[]>;
  filingConfirmedAtByTaxYear?: ReadonlyMap<number, string | null>;
}): AnnualInstancePeriodIdentity | null {
  const covering: Array<{
    instance: AnnualInstancePeriodIdentity;
    assignedFrom: string;
    open: boolean;
  }> = [];
  for (const instance of input.instances) {
    const revisions = input.revisionsByInstanceId?.get(instance.id) ?? [];
    const cycles = buildAnnualPeriodCycles({
      instance,
      revisions,
      filingConfirmedAt: input.filingConfirmedAtByTaxYear?.get(instance.tax_year) ?? null,
    });
    const projection = projectAnnualCapitalCycleOntoPeriod({
      operationalPeriodKey: input.operationalPeriodKey,
      cycles,
    });
    if (projection.kind === 'empty') continue;
    covering.push({
      instance,
      assignedFrom: cycles[0]?.assigned_from_period_key ?? '',
      open: projection.kind === 'assigned' && !projection.cycle_closed,
    });
  }
  if (!covering.length) return null;
  covering.sort((a, b) => {
    if (a.open !== b.open) return a.open ? -1 : 1;
    if (a.open && b.open && a.instance.tax_year !== b.instance.tax_year) {
      return a.instance.tax_year - b.instance.tax_year;
    }
    if (a.instance.tax_year === input.tabTaxYear && b.instance.tax_year !== input.tabTaxYear) return -1;
    if (b.instance.tax_year === input.tabTaxYear && a.instance.tax_year !== input.tabTaxYear) return 1;
    if (a.assignedFrom !== b.assignedFrom) return a.assignedFrom < b.assignedFrom ? 1 : -1;
    return b.instance.tax_year - a.instance.tax_year;
  });
  return covering[0]?.instance ?? null;
}

/** DATE_SET writes the covering open cycle; otherwise the tab tax year (new cycle). */
export function resolveAnnualDateCommandTaxYear(input: {
  tabTaxYear: number;
  coveringOpenInstance: { tax_year: number } | null;
}): number {
  if (input.coveringOpenInstance) return input.coveringOpenInstance.tax_year;
  return input.tabTaxYear;
}

/**
 * Registry month tabs are independent historical views.
 * Open cycle: date from assignment month forward until filing.
 * Filed: green only in the confirmation month; later months empty until a new cycle.
 */
export function projectAnnualCapitalCycleOntoPeriod(input: {
  operationalPeriodKey: string;
  cycles: readonly AnnualCapitalPeriodCycle[];
}): AnnualCapitalPeriodProjection {
  const period = input.operationalPeriodKey;
  const covering = input.cycles.filter((cycle) => cycleCoversOperationalPeriod(cycle, period));
  covering.sort((a, b) => {
    const aStart = a.assigned_from_period_key ?? '';
    const bStart = b.assigned_from_period_key ?? '';
    if (aStart !== bStart) return aStart < bStart ? 1 : -1;
    const aFiled = a.filed_period_key ?? '';
    const bFiled = b.filed_period_key ?? '';
    return aFiled < bFiled ? 1 : -1;
  });
  const cycle = covering[0];
  if (!cycle) {
    return {
      kind: 'empty',
      operational_target_date: null,
      identity: null,
      instance_id: null,
      cycle_closed: false,
      legacy_unknown_assignment_start: false,
    };
  }
  const filedHere = Boolean(cycle.filed_period_key && period === cycle.filed_period_key);
  return {
    kind: filedHere ? 'filed' : 'assigned',
    operational_target_date: cycle.operational_target_date,
    identity: cycle.identity,
    instance_id: cycle.instance_id,
    cycle_closed: Boolean(cycle.filed_period_key),
    legacy_unknown_assignment_start: cycle.assigned_from_period_key == null,
  };
}

export function buildAnnualPeriodCycles(input: {
  instance: {
    id: string;
    tax_year: number;
    operational_target_date: string | null;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  } | null;
  filingConfirmedAt?: string | null;
  revisions?: readonly AnnualDateRevision[];
}): AnnualCapitalPeriodCycle[] {
  if (!input.instance) return [];
  const assignedFrom = earliestAnnualAssignedPeriodKey({
    instance: input.instance,
    revisions: input.revisions,
  });
  const filedPeriod = operationalPeriodKeyFromEventTimestamp(input.filingConfirmedAt);
  const date = input.instance.operational_target_date;
  const identity = String(input.instance.tax_year);
  const cycles: AnnualCapitalPeriodCycle[] = [
    {
      identity,
      instance_id: input.instance.id,
      operational_target_date: date,
      assigned_from_period_key: assignedFrom,
      filed_period_key: filedPeriod,
    },
  ];
  const updatedPeriod = operationalPeriodKeyFromEventTimestamp(input.instance.updated_at);
  const reopened =
    filedPeriod != null &&
    input.instance.status === 'open' &&
    Boolean(date) &&
    updatedPeriod != null &&
    updatedPeriod > filedPeriod;
  if (reopened && updatedPeriod) {
    cycles.push({
      identity: `${identity}::next`,
      instance_id: input.instance.id,
      operational_target_date: date,
      assigned_from_period_key: updatedPeriod,
      filed_period_key: null,
    });
  }
  return cycles;
}

export type AnnualDateRevision = {
  instance_id: string;
  operational_target_date: string | null;
  /** Period in which this value became effective. */
  effective_period_key: string;
  recorded_at: string;
};

export function mergeAnnualDateRevisions(
  rows: readonly AnnualDateRevision[],
): AnnualDateRevision[] {
  const byKey = new Map<string, AnnualDateRevision>();
  for (const row of rows) {
    if (!row.instance_id || !row.effective_period_key) continue;
    const key = `${row.instance_id}\u001f${row.effective_period_key}`;
    const existing = byKey.get(key);
    if (!existing || row.recorded_at > existing.recorded_at) byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.recorded_at !== b.recorded_at) return a.recorded_at < b.recorded_at ? -1 : 1;
    return a.effective_period_key.localeCompare(b.effective_period_key);
  });
}

/**
 * Date visible on a monthly tab: last recorded value whose effective month is
 * on or before the selected period. Does not invent values for months before a
 * later undated change.
 */
export function resolveAnnualOperationalDateForPeriod(input: {
  operationalPeriodKey: string;
  instanceId: string | null;
  revisions: readonly AnnualDateRevision[];
  instance: {
    operational_target_date: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  } | null;
}): { operational_target_date: string | null; source: 'revision' | 'unchanged_instance' | 'unknown' } {
  const period = input.operationalPeriodKey;
  const instanceRevisions = input.revisions.filter((row) => row.instance_id === input.instanceId);
  const applicable = instanceRevisions.filter((row) => row.effective_period_key <= period);
  if (applicable.length) {
    applicable.sort((a, b) => {
      if (a.effective_period_key !== b.effective_period_key) {
        return a.effective_period_key < b.effective_period_key ? 1 : -1;
      }
      return a.recorded_at < b.recorded_at ? 1 : -1;
    });
    const latest = applicable[0];
    return { operational_target_date: latest?.operational_target_date ?? null, source: 'revision' };
  }
  if (instanceRevisions.length) {
    return { operational_target_date: null, source: 'unknown' };
  }
  if (!input.instance) return { operational_target_date: null, source: 'unknown' };
  return {
    operational_target_date: input.instance.operational_target_date,
    source: 'unchanged_instance',
  };
}

export function overlayAnnualProjectionDate(
  projection: AnnualCapitalPeriodProjection,
  resolved: { operational_target_date: string | null; source: 'revision' | 'unchanged_instance' | 'unknown' },
): AnnualCapitalPeriodProjection {
  if (projection.kind === 'empty') return projection;
  if (resolved.source === 'unknown' && projection.kind !== 'filed') {
    return {
      kind: 'empty',
      operational_target_date: null,
      identity: projection.identity,
      instance_id: projection.instance_id,
      cycle_closed: projection.cycle_closed,
      legacy_unknown_assignment_start: projection.legacy_unknown_assignment_start,
    };
  }
  return {
    ...projection,
    operational_target_date: resolved.operational_target_date,
  };
}

/**
 * Periodized annual cell for one client. Identity is the covering instance for this
 * operational month — not "the tab tax year row if it happens to exist".
 */
export function projectAnnualReportCellForOperationalPeriod(input: {
  operationalPeriodKey: string;
  tabTaxYear: number;
  instances: readonly AnnualInstancePeriodIdentity[];
  revisions?: readonly AnnualDateRevision[];
  submissions?: ReadonlyArray<{
    tax_year: number;
    submitted_on: string | null;
    created_at?: string | null;
  }>;
  filesForCoveringYear?: readonly AnnualCapitalLinkedFile[];
  canEdit: boolean;
}): AnnualReportOperationalDateCell {
  const submissions = input.submissions ?? [];
  const revisions = input.revisions ?? [];
  const revisionsByInstanceId = new Map<string, AnnualDateRevision[]>();
  for (const row of revisions) {
    const list = revisionsByInstanceId.get(row.instance_id) ?? [];
    list.push(row);
    revisionsByInstanceId.set(row.instance_id, list);
  }
  const filingConfirmedAtByTaxYear = new Map<number, string | null>();
  for (const row of submissions) {
    if (!Number.isInteger(row.tax_year)) continue;
    if (!filingConfirmedAtByTaxYear.has(row.tax_year)) {
      filingConfirmedAtByTaxYear.set(row.tax_year, row.created_at ?? null);
    }
  }
  const covering = selectCoveringAnnualInstanceForPeriod({
    operationalPeriodKey: input.operationalPeriodKey,
    tabTaxYear: input.tabTaxYear,
    instances: input.instances,
    revisionsByInstanceId,
    filingConfirmedAtByTaxYear,
  });
  const coveringRevisions = covering ? revisionsByInstanceId.get(covering.id) ?? [] : [];
  const resolvedDate = resolveAnnualOperationalDateForPeriod({
    operationalPeriodKey: input.operationalPeriodKey,
    instanceId: covering?.id ?? null,
    revisions: coveringRevisions,
    instance: covering,
  });
  const cellTaxYear = covering?.tax_year ?? input.tabTaxYear;
  const coveringSubmission = covering
    ? submissions.find((row) => row.tax_year === covering.tax_year) ?? null
    : submissions.find((row) => row.tax_year === input.tabTaxYear) ?? null;
  const base = buildAnnualReportCell({
    taxYear: cellTaxYear,
    instanceId: covering?.id ?? null,
    operationalTargetDate: resolvedDate.operational_target_date,
    canEdit: input.canEdit,
    submissions: submissions.map((row) => ({
      tax_year: row.tax_year,
      submitted_on: row.submitted_on,
    })),
    filesForTabYear: coveringSubmission ? input.filesForCoveringYear ?? [] : [],
  });
  const projection = overlayAnnualProjectionDate(
    projectAnnualCapitalCycleOntoPeriod({
      operationalPeriodKey: input.operationalPeriodKey,
      cycles: buildAnnualPeriodCycles({
        instance: covering
          ? { ...covering, operational_target_date: resolvedDate.operational_target_date }
          : null,
        revisions: coveringRevisions,
        filingConfirmedAt: coveringSubmission?.created_at ?? null,
      }),
    }),
    resolvedDate,
  );
  return applyAnnualPeriodProjection(base, projection, input.canEdit);
}

export function buildCapitalPeriodCycles(
  instances: ReadonlyArray<{
    id: string;
    operational_target_date: string | null;
    status?: string | null;
    opened_at?: string | null;
    completed_at?: string | null;
    filing_confirmed_at?: string | null;
  }>,
): AnnualCapitalPeriodCycle[] {
  return instances.map((row) => {
    const filedAt = row.completed_at ?? row.filing_confirmed_at ?? null;
    const filedPeriod =
      row.status === 'completed' || filedAt
        ? operationalPeriodKeyFromEventTimestamp(filedAt)
        : null;
    return {
      identity: row.id,
      instance_id: row.id,
      operational_target_date: row.operational_target_date,
      assigned_from_period_key: operationalPeriodKeyFromEventTimestamp(row.opened_at),
      filed_period_key: filedPeriod,
    };
  });
}

export const ANNUAL_CAPITAL_FILE_KIND_LABEL_KEY: Record<AnnualCapitalSubmissionFileKind, string> = {
  form_1301: 'clientOperations.registry.reporting.annualCapital.form1301',
  additional: 'clientOperations.registry.reporting.annualCapital.additionalFile',
  checklist: 'clientOperations.registry.reporting.annualCapital.checklistFile',
};

export function linkedFileKindLabelKey(kind: AnnualCapitalSubmissionFileKind): string {
  return ANNUAL_CAPITAL_FILE_KIND_LABEL_KEY[kind];
}

export function buildAnnualTaxYearOptions(input: {
  tabTaxYear: number;
  submissions: ReadonlyArray<{ tax_year: number; submitted_on: string | null }>;
}): AnnualTaxYearOption[] {
  const byYear = new Map<number, string | null>();
  for (const row of input.submissions) {
    if (!Number.isInteger(row.tax_year)) continue;
    const current = byYear.get(row.tax_year);
    const next = row.submitted_on;
    if (!current || (next && next > current)) byYear.set(row.tax_year, next ?? current ?? null);
    else if (!byYear.has(row.tax_year)) byYear.set(row.tax_year, next ?? null);
  }
  const years = new Set<number>([input.tabTaxYear - 1, input.tabTaxYear, input.tabTaxYear + 1, ...byYear.keys()]);
  return [...years]
    .filter((year) => Number.isInteger(year) && year >= 1990 && year <= 2200)
    .sort((a, b) => b - a)
    .map((tax_year) => ({
      tax_year,
      is_tab_year: tax_year === input.tabTaxYear,
      already_filed: Boolean(byYear.get(tax_year)),
      submitted_on: byYear.get(tax_year) ?? null,
    }));
}

export function buildAnnualReportFiling(input: {
  tabTaxYear: number;
  canEdit: boolean;
  submissions: ReadonlyArray<{ tax_year: number; submitted_on: string | null }>;
  filesForTabYear?: readonly AnnualCapitalLinkedFile[];
}): AnnualReportFilingPresentation {
  const options = buildAnnualTaxYearOptions({
    tabTaxYear: input.tabTaxYear,
    submissions: input.submissions,
  });
  const tabOption = options.find((row) => row.is_tab_year) ?? {
    tax_year: input.tabTaxYear,
    is_tab_year: true,
    already_filed: false,
    submitted_on: null,
  };
  const filed = Boolean(tabOption.already_filed);
  return {
    square_chrome: filed ? 'filed' : 'empty',
    tab_tax_year: input.tabTaxYear,
    filed_for_tab_tax_year: filed,
    tab_submitted_on: tabOption.submitted_on,
    can_open_modal: input.canEdit,
    other_year_confirm_required_code: 'ANNUAL_OTHER_TAX_YEAR_CONFIRM_REQUIRED',
    modal: {
      title_key: 'clientOperations.registry.reporting.annualCapital.annualTitle',
      confirm_key: 'clientOperations.registry.reporting.annualCapital.filedAction',
      cancel_key: 'clientOperations.registry.reporting.filing.cancel',
      client_label_key: 'clientOperations.registry.reporting.filing.client',
      tax_year_label_key: 'clientOperations.annual.taxYear',
      filed_on_label_key: 'clientOperations.registry.reporting.filing.filedOn',
      form_1301_label_key: 'clientOperations.registry.reporting.annualCapital.form1301',
      additional_files_label_key: 'clientOperations.registry.reporting.annualCapital.additionalFiles',
      tax_year: input.tabTaxYear,
      tax_year_options: options,
      submitted_on: tabOption.submitted_on,
      files: [...(input.filesForTabYear ?? [])],
    },
  };
}

export function buildAnnualReportCell(input: {
  taxYear: number;
  instanceId: string | null;
  operationalTargetDate: string | null;
  canEdit: boolean;
  submissions?: ReadonlyArray<{ tax_year: number; submitted_on: string | null }>;
  filesForTabYear?: readonly AnnualCapitalLinkedFile[];
}): AnnualReportOperationalDateCell {
  return {
    applicable: true,
    editable: input.canEdit,
    tax_year: input.taxYear,
    instance_id: input.instanceId,
    operational_target_date: input.operationalTargetDate,
    filing: buildAnnualReportFiling({
      tabTaxYear: input.taxYear,
      canEdit: input.canEdit,
      submissions: input.submissions ?? [],
      filesForTabYear: input.filesForTabYear,
    }),
  };
}

function capitalActions(input: {
  assignmentState: CapitalDeclarationAssignmentState;
  canEdit: boolean;
}): CapitalDeclarationAllowedActions {
  if (!input.canEdit || input.assignmentState === 'not_applicable') {
    return { can_set_date: false, can_open_modal: false, can_file: false, can_open_new: false };
  }
  if (input.assignmentState === 'filed') {
    return { can_set_date: false, can_open_modal: true, can_file: true, can_open_new: true };
  }
  return { can_set_date: true, can_open_modal: true, can_file: true, can_open_new: false };
}

function emptyCapitalFiling(canEdit: boolean): CapitalDeclarationFilingPresentation {
  return {
    square_chrome: 'empty',
    square_visible: true,
    instance_id: null,
    sequence_no: null,
    filed: false,
    submitted_on: null,
    operational_target_date: null,
    can_open_modal: canEdit,
    modal: {
      title_key: 'clientOperations.registry.reporting.annualCapital.capitalTitle',
      confirm_key: 'clientOperations.registry.reporting.annualCapital.filedAction',
      cancel_key: 'clientOperations.registry.reporting.filing.cancel',
      client_label_key: 'clientOperations.registry.reporting.filing.client',
      due_date_label_key: 'clientOperations.registry.reporting.annualCapital.dueDate',
      filed_on_label_key: 'clientOperations.registry.reporting.filing.filedOn',
      files_label_key: 'clientOperations.registry.reporting.annualCapital.additionalFiles',
      instance_id: null,
      sequence_no: null,
      operational_target_date: null,
      submitted_on: null,
      files: [],
    },
  };
}

export function buildCapitalDeclarationFiling(input: {
  instance: {
    id: string;
    sequence_no: number | null;
    operational_target_date: string | null;
    status: 'open' | 'completed';
  };
  canEdit: boolean;
  submittedOn: string | null;
  files?: readonly AnnualCapitalLinkedFile[];
}): CapitalDeclarationFilingPresentation {
  const filed = input.instance.status === 'completed';
  return {
    square_chrome: filed ? 'filed' : 'empty',
    square_visible: true,
    instance_id: input.instance.id,
    sequence_no: input.instance.sequence_no,
    filed,
    submitted_on: input.submittedOn,
    operational_target_date: input.instance.operational_target_date,
    can_open_modal: input.canEdit,
    modal: {
      title_key: 'clientOperations.registry.reporting.annualCapital.capitalTitle',
      confirm_key: 'clientOperations.registry.reporting.annualCapital.filedAction',
      cancel_key: 'clientOperations.registry.reporting.filing.cancel',
      client_label_key: 'clientOperations.registry.reporting.filing.client',
      due_date_label_key: 'clientOperations.registry.reporting.annualCapital.dueDate',
      filed_on_label_key: 'clientOperations.registry.reporting.filing.filedOn',
      files_label_key: 'clientOperations.registry.reporting.annualCapital.additionalFiles',
      instance_id: input.instance.id,
      sequence_no: input.instance.sequence_no,
      operational_target_date: input.instance.operational_target_date,
      submitted_on: input.submittedOn,
      files: [...(input.files ?? [])],
    },
  };
}

export function pickVisibleCapitalInstance(input: {
  openInstance: {
    id: string;
    tax_year: number | null;
    operational_target_date: string | null;
    sequence_no?: number | null;
    status?: 'open' | 'completed';
  } | null;
  datedCompletedInstance: {
    id: string;
    tax_year: number | null;
    operational_target_date: string | null;
    sequence_no?: number | null;
    status?: 'open' | 'completed';
  } | null;
}): {
  id: string;
  tax_year: number | null;
  operational_target_date: string | null;
  sequence_no: number | null;
  status: 'open' | 'completed';
} | null {
  if (input.openInstance) {
    return {
      id: input.openInstance.id,
      tax_year: input.openInstance.tax_year,
      operational_target_date: input.openInstance.operational_target_date,
      sequence_no: input.openInstance.sequence_no ?? null,
      status: 'open',
    };
  }
  if (input.datedCompletedInstance) {
    return {
      id: input.datedCompletedInstance.id,
      tax_year: input.datedCompletedInstance.tax_year,
      operational_target_date: input.datedCompletedInstance.operational_target_date,
      sequence_no: input.datedCompletedInstance.sequence_no ?? null,
      status: 'completed',
    };
  }
  return null;
}

export function buildCapitalDeclarationCell(input: {
  openInstance: {
    id: string;
    tax_year: number | null;
    operational_target_date: string | null;
    sequence_no?: number | null;
  } | null;
  datedCompletedInstance?: {
    id: string;
    tax_year: number | null;
    operational_target_date: string | null;
    sequence_no?: number | null;
  } | null;
  canEdit: boolean;
  submittedOn?: string | null;
  files?: readonly AnnualCapitalLinkedFile[];
}): CapitalDeclarationOperationalDateCell {
  const visible = pickVisibleCapitalInstance({
    openInstance: input.openInstance,
    datedCompletedInstance: input.datedCompletedInstance ?? null,
  });
  if (!visible) {
    const allowed_actions = capitalActions({ assignmentState: 'unassigned', canEdit: input.canEdit });
    return {
      applicable: true,
      editable: allowed_actions.can_set_date,
      instance_id: null,
      tax_year: null,
      operational_target_date: null,
      sequence_no: null,
      instance_status: null,
      assignment_state: 'unassigned',
      allowed_actions,
      can_open: allowed_actions.can_open_new,
      filing: emptyCapitalFiling(input.canEdit),
    };
  }
  const isOpen = visible.status === 'open';
  const assignment_state: CapitalDeclarationAssignmentState = isOpen ? 'assigned' : 'filed';
  const allowed_actions = capitalActions({ assignmentState: assignment_state, canEdit: input.canEdit });
  return {
    applicable: true,
    editable: allowed_actions.can_set_date,
    instance_id: visible.id,
    tax_year: visible.tax_year,
    operational_target_date: visible.operational_target_date,
    sequence_no: visible.sequence_no,
    instance_status: visible.status,
    assignment_state,
    allowed_actions,
    can_open: allowed_actions.can_open_new,
    filing: buildCapitalDeclarationFiling({
      instance: {
        id: visible.id,
        sequence_no: visible.sequence_no,
        operational_target_date: visible.operational_target_date,
        status: visible.status,
      },
      canEdit: input.canEdit,
      submittedOn: input.submittedOn ?? null,
      files: input.files,
    }),
  };
}

export function nextCapitalDeclarationSequenceNo(existing: readonly number[]): number {
  const max = existing.reduce((acc, value) => (value > acc ? value : acc), 0);
  return max + 1;
}

export function buildAnnualYearFolders(input: {
  submissions: ReadonlyArray<{
    submission_id: string;
    tax_year: number;
    submitted_on: string;
    files: readonly AnnualCapitalLinkedFile[];
  }>;
}): AnnualYearFolder[] {
  const byYear = new Map<number, AnnualYearFolder>();
  for (const row of input.submissions) {
    if (!row.submitted_on) continue;
    const existing = byYear.get(row.tax_year);
    if (existing) {
      const seen = new Set(existing.files.map((file) => file.file_asset_id));
      for (const file of row.files) {
        if (seen.has(file.file_asset_id)) continue;
        existing.files.push(file);
        seen.add(file.file_asset_id);
      }
      if (row.submitted_on > existing.submitted_on) {
        existing.submitted_on = row.submitted_on;
        existing.submission_id = row.submission_id;
      }
      continue;
    }
    byYear.set(row.tax_year, {
      folder_key: String(row.tax_year),
      tax_year: row.tax_year,
      label: String(row.tax_year),
      submission_id: row.submission_id,
      submitted_on: row.submitted_on,
      filed: true,
      files: [...row.files],
    });
  }
  return [...byYear.values()].sort((a, b) => b.tax_year - a.tax_year);
}

export function buildCapitalRequirementFolders(input: {
  instances: ReadonlyArray<{
    id: string;
    sequence_no: number;
    status: 'open' | 'completed' | string;
    operational_target_date: string | null;
    submitted_on: string | null;
    files: readonly AnnualCapitalLinkedFile[];
  }>;
}): CapitalRequirementFolder[] {
  return [...input.instances]
    .filter((row) => row.status === 'open' || row.status === 'completed')
    .sort((a, b) => a.sequence_no - b.sequence_no || a.id.localeCompare(b.id))
    .map((row) => ({
      folder_key: row.id,
      instance_id: row.id,
      sequence_no: row.sequence_no,
      folder_label_key: 'clientOperations.annual.capitalFolder',
      status: row.status === 'completed' ? 'completed' : 'open',
      operational_target_date: row.operational_target_date,
      submitted_on: row.submitted_on,
      filed: row.status === 'completed',
      files: [...row.files],
    }));
}

export function annualFilingUsesTabTaxYear(input: {
  taxYear: number;
  tabTaxYear: number;
  confirmOtherTaxYear: boolean;
}): { ok: true } | { ok: false; code: 'ANNUAL_OTHER_TAX_YEAR_CONFIRM_REQUIRED' } {
  if (input.taxYear === input.tabTaxYear) return { ok: true };
  if (input.confirmOtherTaxYear) return { ok: true };
  return { ok: false, code: 'ANNUAL_OTHER_TAX_YEAR_CONFIRM_REQUIRED' };
}

export function applyAnnualPeriodProjection(
  cell: AnnualReportOperationalDateCell,
  projection: AnnualCapitalPeriodProjection,
  canEdit: boolean,
): AnnualReportOperationalDateCell {
  if (projection.kind === 'empty') {
    return {
      ...cell,
      editable: canEdit,
      instance_id: projection.instance_id ?? cell.instance_id,
      operational_target_date: null,
      filing: {
        ...cell.filing,
        square_chrome: 'empty',
        filed_for_tab_tax_year: false,
      },
    };
  }
  const frozen = projection.cycle_closed;
  return {
    ...cell,
    editable: canEdit && !frozen,
    instance_id: projection.instance_id ?? cell.instance_id,
    operational_target_date: projection.operational_target_date,
    filing: {
      ...cell.filing,
      square_chrome: projection.kind === 'filed' ? 'filed' : 'empty',
      filed_for_tab_tax_year: projection.kind === 'filed',
    },
  };
}

export function applyCapitalPeriodProjection(
  cell: CapitalDeclarationOperationalDateCell,
  projection: AnnualCapitalPeriodProjection,
  canEdit: boolean,
): CapitalDeclarationOperationalDateCell {
  if (projection.kind === 'empty') {
    const allowed_actions = capitalActions({ assignmentState: 'unassigned', canEdit });
    return {
      ...cell,
      editable: allowed_actions.can_set_date,
      instance_id: null,
      operational_target_date: null,
      sequence_no: null,
      instance_status: null,
      assignment_state: 'unassigned',
      allowed_actions,
      can_open: allowed_actions.can_open_new,
      filing: emptyCapitalFiling(canEdit),
    };
  }
  const assignment_state: CapitalDeclarationAssignmentState =
    projection.kind === 'filed' ? 'filed' : 'assigned';
  const allowed_actions = capitalActions({ assignmentState: assignment_state, canEdit });
  return {
    ...cell,
    editable: allowed_actions.can_set_date,
    instance_id: projection.instance_id,
    operational_target_date: projection.operational_target_date,
    instance_status: projection.kind === 'filed' ? 'completed' : 'open',
    assignment_state,
    allowed_actions,
    can_open: allowed_actions.can_open_new,
    filing: {
      ...cell.filing,
      square_chrome: projection.kind === 'filed' ? 'filed' : 'empty',
      filed: projection.kind === 'filed',
      instance_id: projection.instance_id,
      operational_target_date: projection.operational_target_date,
    },
  };
}
