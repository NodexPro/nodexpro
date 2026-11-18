/**
 * Annual report tab — filing-year board, working-year checklist membership, folder file merge.
 * Backend-owned; frontend must not compute filing vs readiness or invent tax-year membership.
 *
 * TEMPORARY_COUNTRY_PACK_PENDING: current tax year is the UTC calendar year until
 * Country Pack / Owner Legal Control owns the tax-year calendar. This is a clock, not a statutory due date.
 */

export const ANNUAL_FILING_YEAR_BOARD_SIZE = 3;
/** Presentation lookback for late filing — not a Country Pack statutory limit. */
export const ANNUAL_LATE_FILING_YEAR_LOOKBACK = 10;

export type AnnualFilingStatusCode = 'filed' | 'not_filed';

export type AnnualFilingYearBoardItem = {
  tax_year: number;
  is_current: boolean;
  is_working: boolean;
  filed: boolean;
  submitted_on: string | null;
  filing_status: {
    filed: boolean;
    code: AnnualFilingStatusCode;
    label_key: string;
    submitted_on: string | null;
  };
  can_select_working: boolean;
};

export type AnnualOlderTaxYearOption = {
  tax_year: number;
  filed: boolean;
  submitted_on: string | null;
  is_working: boolean;
  can_select: boolean;
};

export type AnnualLinkedFileMeta = {
  file_asset_id: string;
  file_name: string | null;
  mime_type?: string | null;
  uploaded_on?: string | null;
};

/** UTC calendar year — not Country Pack legal year. */
export function resolveCurrentAnnualTaxYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export function isProvenAnnualTaxYear(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1990 && value <= 2200;
}

export function resolveWorkingTaxYear(input: {
  profileWorkingTaxYear: number | null | undefined;
  currentTaxYear: number;
}): number {
  return isProvenAnnualTaxYear(input.profileWorkingTaxYear) ? input.profileWorkingTaxYear : input.currentTaxYear;
}

export function parseAnnualWorkingTaxYear(value: unknown): number | null {
  const year = Number(value);
  return isProvenAnnualTaxYear(year) ? year : null;
}

export function annualFilingSubmittedOnByYear(
  submissions: ReadonlyArray<{ tax_year: number; submitted_on: string | null }>,
): Map<number, string> {
  const filedOnByYear = new Map<number, string>();
  for (const row of submissions) {
    if (!Number.isInteger(row.tax_year) || !row.submitted_on) continue;
    const current = filedOnByYear.get(row.tax_year);
    if (!current || row.submitted_on > current) filedOnByYear.set(row.tax_year, row.submitted_on);
  }
  return filedOnByYear;
}

export function buildAnnualFilingYearItem(input: {
  tax_year: number;
  currentTaxYear: number;
  workingTaxYear: number;
  canEdit: boolean;
  submitted_on: string | null;
}): AnnualFilingYearBoardItem | null {
  if (!isProvenAnnualTaxYear(input.tax_year)) return null;
  const submitted_on = input.submitted_on;
  const filed = Boolean(submitted_on);
  return {
    tax_year: input.tax_year,
    is_current: input.tax_year === input.currentTaxYear,
    is_working: input.tax_year === input.workingTaxYear,
    filed,
    submitted_on,
    filing_status: {
      filed,
      code: filed ? 'filed' : 'not_filed',
      label_key: filed ? 'clientOperations.annual.filedStatus' : 'clientOperations.annual.notFiledStatus',
      submitted_on,
    },
    can_select_working: input.canEdit,
  };
}

export function buildAnnualFilingYearBoard(input: {
  currentTaxYear: number;
  workingTaxYear: number;
  canEdit: boolean;
  submissions: ReadonlyArray<{ tax_year: number; submitted_on: string | null }>;
}): AnnualFilingYearBoardItem[] {
  const filedOnByYear = annualFilingSubmittedOnByYear(input.submissions);
  const years: number[] = [];
  for (let offset = 0; offset < ANNUAL_FILING_YEAR_BOARD_SIZE; offset += 1) {
    years.push(input.currentTaxYear - offset);
  }
  return years.flatMap((tax_year) => {
    const item = buildAnnualFilingYearItem({
      tax_year,
      currentTaxYear: input.currentTaxYear,
      workingTaxYear: input.workingTaxYear,
      canEdit: input.canEdit,
      submitted_on: filedOnByYear.get(tax_year) ?? null,
    });
    return item ? [item] : [];
  });
}

export function buildAnnualOlderTaxYearOptions(input: {
  currentTaxYear: number;
  workingTaxYear: number;
  canEdit: boolean;
  boardYears: readonly number[];
  knownYears?: ReadonlyArray<{ tax_year: number; submitted_on?: string | null }>;
}): AnnualOlderTaxYearOption[] {
  const board = new Set(input.boardYears.filter((year) => isProvenAnnualTaxYear(year)));
  const filedOnByYear = annualFilingSubmittedOnByYear(
    (input.knownYears ?? []).map((row) => ({
      tax_year: row.tax_year,
      submitted_on: row.submitted_on ?? null,
    })),
  );
  const years = new Set<number>();
  const oldestBoardYear = input.currentTaxYear - ANNUAL_FILING_YEAR_BOARD_SIZE;
  const floor = Math.max(1990, oldestBoardYear - ANNUAL_LATE_FILING_YEAR_LOOKBACK + 1);
  for (let taxYear = oldestBoardYear; taxYear >= floor; taxYear -= 1) {
    if (isProvenAnnualTaxYear(taxYear) && !board.has(taxYear)) years.add(taxYear);
  }
  if (
    isProvenAnnualTaxYear(input.workingTaxYear) &&
    input.workingTaxYear <= input.currentTaxYear &&
    !board.has(input.workingTaxYear)
  ) {
    years.add(input.workingTaxYear);
  }
  for (const row of input.knownYears ?? []) {
    if (
      isProvenAnnualTaxYear(row.tax_year) &&
      row.tax_year <= input.currentTaxYear &&
      !board.has(row.tax_year)
    ) {
      years.add(row.tax_year);
    }
  }
  return [...years]
    .sort((a, b) => b - a)
    .map((tax_year) => {
      const submitted_on = filedOnByYear.get(tax_year) ?? null;
      return {
        tax_year,
        filed: Boolean(submitted_on),
        submitted_on,
        is_working: tax_year === input.workingTaxYear,
        can_select: input.canEdit,
      };
    });
}

export function annualTabViewTaxYears(input: {
  boardYears: readonly number[];
  olderYears?: readonly number[];
  workingTaxYear: number;
}): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const year of [...input.boardYears, input.workingTaxYear, ...(input.olderYears ?? [])]) {
    if (!isProvenAnnualTaxYear(year) || seen.has(year)) continue;
    seen.add(year);
    out.push(year);
  }
  return out;
}

export function workingDocumentRowsForTaxYear<T extends { tax_year?: number | null }>(
  rows: readonly T[],
  input: {
    yearColumnSupported: boolean;
    workingTaxYear: number;
    tabScope: 'annual_report' | 'capital_declaration';
  },
): T[] {
  if (!input.yearColumnSupported || input.tabScope !== 'annual_report') return [...rows];
  return rows.filter((row) => isProvenAnnualTaxYear(row.tax_year) && row.tax_year === input.workingTaxYear);
}

export function checklistFileIdsForFilingYear(
  rows: ReadonlyArray<{ tax_year?: number | null; file_asset_id: string | null }>,
  input: {
    yearColumnSupported: boolean;
    taxYear: number;
    tabScope: 'annual_report' | 'capital_declaration';
  },
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const id = String(row.file_asset_id ?? '').trim();
    if (!id || seen.has(id)) continue;
    if (
      input.yearColumnSupported &&
      input.tabScope === 'annual_report' &&
      !(isProvenAnnualTaxYear(row.tax_year) && row.tax_year === input.taxYear)
    ) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function provenYearScopedChecklistFiles<T extends { tax_year?: number | null; file_asset_id: string | null }>(
  rows: readonly T[],
  taxYear: number,
): T[] {
  if (!isProvenAnnualTaxYear(taxYear)) return [];
  return rows.filter((row) => row.tax_year === taxYear && Boolean(row.file_asset_id));
}

export function fileTypeLabelFromMeta(input: { file_name: string | null; mime_type?: string | null }): string | null {
  const name = String(input.file_name ?? '').trim();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).trim() : '';
  if (ext && /^[a-z0-9]{1,8}$/i.test(ext)) return ext.toUpperCase();
  const mime = String(input.mime_type ?? '').trim().toLowerCase();
  if (!mime) return null;
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return mime.slice('image/'.length).toUpperCase() || 'IMAGE';
  const subtype = mime.includes('/') ? mime.slice(mime.lastIndexOf('/') + 1) : mime;
  return subtype ? subtype.toUpperCase() : null;
}

export function isoDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const slice = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(slice) ? slice : null;
}

export function uniqueLinkedFileIds<T extends { file_asset_id: string }>(files: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const file of files) {
    if (seen.has(file.file_asset_id)) continue;
    seen.add(file.file_asset_id);
    out.push(file);
  }
  return out;
}

export type AnnualYearFilingTone = 'green' | 'yellow';

/** Backend-owned presentation flags for one tax year on the annual tab. Frontend must not infer these. */
export type AnnualYearPresentationFlags = {
  tax_year: number;
  filed: boolean;
  submitted_on: string | null;
  can_select: boolean;
  filing_tone: AnnualYearFilingTone;
  show_working_checklist: boolean;
  show_missing_as_active_problem: boolean;
  show_filed_confirmation: boolean;
  show_document_readiness: boolean;
  show_deadline: boolean;
  show_documents_year_heading: boolean;
  documents_year_heading_label_key: string;
  archive_folder_key: string | null;
  filed_confirmation_label_key: string;
  open_archive_label_key: string;
};

export type AnnualCatalogRowRef = {
  scope: 'annual_report' | 'capital_declaration';
  systemKey: string;
  taxYear: number | null;
};

export function buildAnnualCatalogRowId(input: AnnualCatalogRowRef): string {
  if (input.scope === 'annual_report' && isProvenAnnualTaxYear(input.taxYear)) {
    return `catalog:annual:${input.taxYear}:${input.systemKey}`;
  }
  return `catalog:capital:${input.systemKey}`;
}

export function parseAnnualCatalogRowId(rowId: string): AnnualCatalogRowRef | null {
  const value = String(rowId ?? '').trim();
  const annual = /^catalog:annual:(\d{4}):([a-z0-9_]+)$/i.exec(value);
  if (annual) {
    const taxYear = Number(annual[1]);
    if (!isProvenAnnualTaxYear(taxYear) || !annual[2]) return null;
    return { scope: 'annual_report', systemKey: annual[2], taxYear };
  }
  const capital = /^catalog:capital:([a-z0-9_]+)$/i.exec(value);
  if (!capital?.[1]) return null;
  return { scope: 'capital_declaration', systemKey: capital[1], taxYear: null };
}

export function mergeRequiredCatalogRows<T extends { system_key: string | null; source_type: string }>(input: {
  templates: ReadonlyArray<{ system_key: string }>;
  persisted: readonly T[];
  projectMissing: (systemKey: string) => T;
}): T[] {
  const byKey = new Map<string, T>();
  for (const row of input.persisted) {
    const key = String(row.system_key ?? '').trim();
    if (row.source_type === 'system' && key && !byKey.has(key)) byKey.set(key, row);
  }
  const systemRows = input.templates.map((template) => byKey.get(template.system_key) ?? input.projectMissing(template.system_key));
  const customRows = input.persisted.filter((row) => row.source_type === 'custom');
  return [...systemRows, ...customRows];
}

/** Empty checklist is missing documents, never 100% ready / filed-looking green. */
export function annualReadinessFromCounts(input: { total: number; completed: number }): {
  completion_percent: number;
  all_complete: boolean;
} {
  const total = Math.max(0, input.total);
  const completed = Math.max(0, input.completed);
  if (total <= 0) return { completion_percent: 0, all_complete: false };
  return {
    completion_percent: Math.round((completed / total) * 100),
    all_complete: completed >= total,
  };
}

/**
 * Internal office warning for capital collection. Not a Country Pack / statutory deadline.
 * Control start is the assigned operational_target_date from the registry calendar.
 */
export const CAPITAL_OFFICE_COLLECTION_WARNING_DAYS = 30;

export function calendarDaysDiffUtcYmd(fromYmd: string, toYmd: string): number {
  const from = String(fromYmd ?? '').slice(0, 10);
  const to = String(toYmd ?? '').slice(0, 10);
  const a = new Date(`${from}T12:00:00.000Z`).getTime();
  const b = new Date(`${to}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export type CapitalDocumentReceiptMark = 'none' | 'cyan_check';

/** Capital row truth: התקבל only after existing received confirmation, never from attach alone. */
export function computeCapitalDocumentRowPresentation(
  received: boolean,
  fileAssetId: string | null,
  controlActive = true,
): {
  status: 'missing' | 'checked_only' | 'attached_only' | 'completed';
  status_label_he: string;
  status_label_key: string;
  row_style: 'neutral' | 'warning' | 'success' | 'missing';
  receipt_mark: CapitalDocumentReceiptMark;
  receipt_hint_key: string | null;
  show_missing_badge: boolean;
} {
  const hasFile = Boolean(fileAssetId);
  if (received) {
    return {
      status: hasFile ? 'completed' : 'checked_only',
      status_label_he: 'התקבל',
      status_label_key: 'clientOperations.annual.received',
      row_style: 'success',
      receipt_mark: 'cyan_check',
      receipt_hint_key: null,
      show_missing_badge: false,
    };
  }
  if (hasFile) {
    return {
      status: 'attached_only',
      status_label_he: 'לא סומן כהתקבל',
      status_label_key: 'clientOperations.annual.fileAttachedNotMarked',
      row_style: 'neutral',
      receipt_mark: 'none',
      receipt_hint_key: 'clientOperations.annual.fileAttachedNotMarked',
      show_missing_badge: false,
    };
  }
  if (!controlActive) {
    return {
      status: 'missing',
      status_label_he: '',
      status_label_key: '',
      row_style: 'neutral',
      receipt_mark: 'none',
      receipt_hint_key: null,
      show_missing_badge: false,
    };
  }
  return {
    status: 'missing',
    status_label_he: 'חסר',
    status_label_key: 'clientOperations.annual.missing',
    row_style: 'missing',
    receipt_mark: 'none',
    receipt_hint_key: null,
    show_missing_badge: true,
  };
}

export function applyCapitalDocumentControlPresentation<
  T extends {
    received: boolean;
    file?: { file_asset_id: string | null } | null;
    status: string;
    status_label_he: string;
    status_label_key?: string;
    row_style: 'neutral' | 'warning' | 'success' | 'missing';
    receipt_mark?: CapitalDocumentReceiptMark;
  },
>(rows: readonly T[], controlActive: boolean): T[] {
  return rows.map((row) => {
    const pres = computeCapitalDocumentRowPresentation(Boolean(row.received), row.file?.file_asset_id ?? null, controlActive);
    return {
      ...row,
      status: pres.status,
      status_label_he: pres.status_label_he,
      status_label_key: pres.status_label_key,
      row_style: pres.row_style,
      receipt_mark: pres.receipt_mark,
      receipt_hint_key: pres.receipt_hint_key,
      show_missing_badge: pres.show_missing_badge,
    };
  });
}

/** UTC YYYY-MM clock for the existing capital date command audit field — not a statutory period. */
export function currentUtcOperationalPeriodKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function buildCapitalHistoryEntries<
  T extends { filed: boolean; sequence_no: number; submitted_on: string | null },
>(folders: readonly T[]): T[] {
  return [...folders].filter((folder) => folder.filed).sort((a, b) => a.sequence_no - b.sequence_no);
}

export type CapitalWorkingControlPhase = 'unassigned' | 'assigned_open' | 'filed_idle';

export function buildCapitalWorkingControlState(input: {
  assignedDueDate: string | null;
  todayYmd: string;
  rows: ReadonlyArray<{ status: string; document_name_he: string; required?: boolean }>;
  lastFiledSubmittedOn: string | null;
}): {
  phase: CapitalWorkingControlPhase;
  status: {
    code: 'unassigned' | 'collect_docs' | 'approaching' | 'overdue' | 'ready' | 'filed_idle';
    label_he: string;
    label_key: string;
    color: 'green' | 'yellow' | 'red' | 'neutral';
  };
  missing_documents: string[];
  completion_percent: number;
  deadline_info: {
    due_date: string;
    days_left: number;
    is_overdue: boolean;
    label_he: string;
    label_key?: string;
  };
  risk_indicator: { label_he: string; label_key: string };
  visibility: {
    show_documents: boolean;
    show_submissions: boolean;
    show_notes: boolean;
    show_deadline: boolean;
    show_document_readiness: boolean;
    show_missing_as_active_problem: boolean;
    show_filed_confirmation: boolean;
    show_working_status: boolean;
    show_legacy_capital_folders: boolean;
  };
  filing_status: {
    filed: boolean;
    code: 'filed' | 'not_filed';
    label_key: string;
    submitted_on: string | null;
  };
  assigned_due_date: string | null;
  actual_submitted_on: string | null;
  filed_confirmation: {
    label_key: string;
    submitted_on: string | null;
    archive_folder_key: string | null;
    open_archive_label_key: string;
  } | null;
} {
  const assignedDueDate = String(input.assignedDueDate ?? '').trim().slice(0, 10) || null;
  const today = String(input.todayYmd ?? '').trim().slice(0, 10);
  const lastFiled = String(input.lastFiledSubmittedOn ?? '').trim().slice(0, 10) || null;
  const source = input.rows.filter((row) => row.required !== false);
  const checklist = source.length ? source : input.rows;
  const missingRows = checklist.filter((row) => row.status !== 'completed');
  const readiness = annualReadinessFromCounts({
    total: checklist.length,
    completed: checklist.filter((row) => row.status === 'completed').length,
  });
  const idleVisibility = {
    show_documents: true,
    show_submissions: true,
    show_notes: true,
    show_deadline: false,
    show_document_readiness: false,
    show_missing_as_active_problem: false,
    show_filed_confirmation: false,
    show_working_status: false,
    show_legacy_capital_folders: false,
  };
  const emptyDeadline = { due_date: '', days_left: 0, is_overdue: false, label_he: '' };
  const idleRisk = { label_he: '', label_key: 'clientOperations.annual.riskNone' };

  if (!assignedDueDate) {
    const filedIdle = Boolean(lastFiled);
    return {
      phase: filedIdle ? 'filed_idle' : 'unassigned',
      status: filedIdle
        ? {
            code: 'filed_idle',
            label_he: 'שודר',
            label_key: 'clientOperations.annual.capitalFiledIdle',
            color: 'neutral',
          }
        : {
            code: 'unassigned',
            label_he: '',
            label_key: 'clientOperations.annual.capitalUnassigned',
            color: 'neutral',
          },
      missing_documents: [],
      completion_percent: 0,
      deadline_info: emptyDeadline,
      risk_indicator: idleRisk,
      visibility: idleVisibility,
      filing_status: {
        filed: filedIdle,
        code: filedIdle ? 'filed' : 'not_filed',
        label_key: filedIdle ? 'clientOperations.annual.filedStatus' : 'clientOperations.annual.notFiledStatus',
        submitted_on: filedIdle ? lastFiled : null,
      },
      assigned_due_date: null,
      actual_submitted_on: filedIdle ? lastFiled : null,
      filed_confirmation: filedIdle
        ? {
            label_key: 'clientOperations.annual.capitalFiledConfirmation',
            submitted_on: lastFiled,
            archive_folder_key: null,
            open_archive_label_key: 'clientOperations.annual.openYearArchive',
          }
        : null,
    };
  }

  const days_left = calendarDaysDiffUtcYmd(today, assignedDueDate);
  const is_overdue = Boolean(today) && today > assignedDueDate;
  const has_missing = !readiness.all_complete;
  const status = is_overdue
    ? {
        code: 'overdue' as const,
        label_he: 'באיחור',
        label_key: 'clientOperations.annual.overdue',
        color: 'red' as const,
      }
    : !has_missing
      ? {
          code: 'ready' as const,
          label_he: 'מוכן להגשה',
          label_key: 'clientOperations.annual.readyToSubmit',
          color: 'neutral' as const,
        }
      : days_left <= CAPITAL_OFFICE_COLLECTION_WARNING_DAYS
        ? {
            code: 'approaching' as const,
            label_he: 'הגשה מתקרבת — חסרים מסמכים',
            label_key: 'clientOperations.annual.filingApproachingMissing',
            color: 'red' as const,
          }
        : {
            code: 'collect_docs' as const,
            label_he: 'נדרש איסוף מסמכים',
            label_key: 'clientOperations.annual.collectDocuments',
            color: 'yellow' as const,
          };

  return {
    phase: 'assigned_open',
    status,
    missing_documents: missingRows.map((row) => row.document_name_he),
    completion_percent: readiness.completion_percent,
    deadline_info: {
      due_date: assignedDueDate,
      days_left,
      is_overdue,
      label_he: is_overdue ? 'באיחור' : `נותרו ${days_left} ימים להגשה`,
      label_key: is_overdue ? 'clientOperations.annual.late' : 'clientOperations.annual.daysLeftToFile',
    },
    risk_indicator: idleRisk,
    visibility: {
      show_documents: true,
      show_submissions: true,
      show_notes: true,
      show_deadline: true,
      show_document_readiness: false,
      show_missing_as_active_problem: has_missing,
      show_filed_confirmation: false,
      show_working_status: true,
      show_legacy_capital_folders: false,
    },
    filing_status: {
      filed: false,
      code: 'not_filed',
      label_key: 'clientOperations.annual.notFiledStatus',
      submitted_on: null,
    },
    assigned_due_date: assignedDueDate,
    actual_submitted_on: null,
    filed_confirmation: null,
  };
}

export function buildAnnualYearPresentationFlags(input: {
  tax_year: number;
  filed: boolean;
  submitted_on: string | null;
  canEdit: boolean;
}): AnnualYearPresentationFlags | null {
  if (!isProvenAnnualTaxYear(input.tax_year)) return null;
  const filed = input.filed === true;
  return {
    tax_year: input.tax_year,
    filed,
    submitted_on: filed ? input.submitted_on : null,
    can_select: input.canEdit,
    filing_tone: filed ? 'green' : 'yellow',
    show_working_checklist: !filed,
    show_missing_as_active_problem: !filed,
    show_filed_confirmation: filed,
    show_document_readiness: !filed,
    show_deadline: !filed,
    show_documents_year_heading: !filed,
    documents_year_heading_label_key: 'clientOperations.annual.documentsForTaxYear',
    archive_folder_key: filed ? String(input.tax_year) : null,
    filed_confirmation_label_key: 'clientOperations.annual.filedConfirmation',
    open_archive_label_key: 'clientOperations.annual.openYearArchive',
  };
}
