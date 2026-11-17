/**
 * Client Operations — annual report tax-year resolver + operational date cell builders.
 * Product rule: for operational workspace year Y, annual report tax_year = Y - 1.
 * Backend-owned; React must not compute this.
 */

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

export type CapitalDeclarationFilingPresentation = {
  square_chrome: AnnualCapitalFilingSquareChrome;
  /** Backend-owned: filing square only for an assigned declaration instance. */
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
   * not_applicable is reserved for a real business rule (none today).
   */
  assignment_state: 'unassigned' | 'assigned' | 'not_applicable';
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
      already_filed: byYear.has(tax_year),
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

function emptyCapitalFiling(canEdit: boolean): CapitalDeclarationFilingPresentation {
  return {
    square_chrome: 'empty',
    square_visible: false,
    instance_id: null,
    sequence_no: null,
    filed: false,
    submitted_on: null,
    operational_target_date: null,
    can_open_modal: false,
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
    return {
      applicable: true,
      editable: input.canEdit,
      instance_id: null,
      tax_year: null,
      operational_target_date: null,
      sequence_no: null,
      instance_status: null,
      assignment_state: 'unassigned',
      can_open: false,
      filing: emptyCapitalFiling(input.canEdit),
    };
  }
  const isOpen = visible.status === 'open';
  return {
    applicable: true,
    editable: input.canEdit && isOpen,
    instance_id: visible.id,
    tax_year: visible.tax_year,
    operational_target_date: visible.operational_target_date,
    sequence_no: visible.sequence_no,
    instance_status: visible.status,
    assignment_state: 'assigned',
    can_open: input.canEdit && !isOpen,
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
