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
