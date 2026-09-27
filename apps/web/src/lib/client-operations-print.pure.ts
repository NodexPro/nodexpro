/**
 * Print-column selection from registry row truth (not DOM scraping).
 */

export type ClientOperationsPrintColumn = {
  key: string;
  label: string;
  cell_kind: 'folder' | 'text' | 'notes' | 'custom' | 'checkbox' | 'operational_date' | string;
};

export type ClientOperationsPrintRow = {
  client_id: string;
  client_name?: string | null;
  cells?: Record<string, string | null | undefined>;
  pcn_display?: string | null;
  notes_cell_text_he?: string | null;
  operational_notes_count?: number | null;
  material_brought_flag?: boolean | null;
  material_brought_cell?: { applicable?: boolean; value?: boolean | null; completed?: boolean | null } | null;
  material_cells?: Record<
    string,
    { applicable?: boolean; value?: boolean | null; completed?: boolean | null } | null | undefined
  >;
  national_insurance_deductions_cell?: {
    applicable?: boolean;
    items?: Record<string, { applicable?: boolean; completed?: boolean | null } | undefined>;
  } | null;
  income_tax_deductions_cell?: {
    applicable?: boolean;
    completed?: boolean | null;
    value?: boolean | null;
  } | null;
  annual_report_cell?: { operational_target_date?: string | null } | null;
  capital_declaration_cell?: { operational_target_date?: string | null } | null;
  manual_cell_statuses?: Record<
    string,
    { status?: 'ready' | 'sent_for_approval' | 'completed' | null } | undefined
  >;
};

const EMPTY_DISPLAY = new Set(['', '—', '–', '-', '־', '\u00a0', '\u200b']);

export function isMeaningfulPrintableCellValue(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = String(raw).trim();
  if (!trimmed) return false;
  if (EMPTY_DISPLAY.has(trimmed)) return false;
  return true;
}

function hasTruthyOperationalCheckbox(
  cell: { applicable?: boolean; value?: boolean | null; completed?: boolean | null } | null | undefined,
  fallbackFlag?: boolean | null,
): boolean {
  if (cell && cell.applicable === false) return false;
  if (cell?.value === true || cell?.completed === true) return true;
  return fallbackFlag === true;
}

export function isMeaningfulPrintableRegistryCell(
  row: ClientOperationsPrintRow,
  column: ClientOperationsPrintColumn,
): boolean {
  if (column.key === 'folder' || column.cell_kind === 'folder') return false;
  if (column.key === 'client_name') {
    return isMeaningfulPrintableCellValue(row.client_name ?? row.cells?.client_name);
  }

  const manual = row.manual_cell_statuses?.[column.key]?.status;
  if (manual === 'ready' || manual === 'sent_for_approval' || manual === 'completed') return true;

  if (column.key === 'pcn') {
    return isMeaningfulPrintableCellValue(row.cells?.pcn ?? row.pcn_display);
  }

  if (column.cell_kind === 'notes' || column.key === 'notes') {
    if ((row.operational_notes_count ?? 0) > 0) return true;
    return isMeaningfulPrintableCellValue(row.notes_cell_text_he ?? row.cells?.notes);
  }

  if (column.cell_kind === 'custom') {
    return isMeaningfulPrintableCellValue(row.cells?.[column.key]);
  }

  if (column.cell_kind === 'operational_date') {
    if (column.key === 'annual_report') {
      return isMeaningfulPrintableCellValue(row.annual_report_cell?.operational_target_date);
    }
    if (column.key === 'capital_declaration') {
      return isMeaningfulPrintableCellValue(row.capital_declaration_cell?.operational_target_date);
    }
    return isMeaningfulPrintableCellValue(row.cells?.[column.key]);
  }

  if (column.key === 'material_brought') {
    const streams = ['vat', 'income_tax_advance', 'payroll'] as const;
    for (const key of streams) {
      if (hasTruthyOperationalCheckbox(row.material_cells?.[key], key === 'vat' ? row.material_brought_flag : null)) {
        return true;
      }
    }
    return hasTruthyOperationalCheckbox(row.material_brought_cell, row.material_brought_flag);
  }

  if (column.key === 'national_insurance_deductions') {
    const items = row.national_insurance_deductions_cell?.items ?? {};
    return Object.values(items).some((item) => item?.applicable !== false && item?.completed === true);
  }

  if (column.key === 'income_tax_deductions') {
    const cell = row.income_tax_deductions_cell;
    if (cell?.applicable === false) return false;
    return cell?.completed === true || cell?.value === true;
  }

  if (column.cell_kind === 'checkbox') {
    const cellValue = row.cells?.[column.key];
    if (cellValue === 'true' || cellValue === '1' || cellValue === '✓') return true;
    return false;
  }

  return isMeaningfulPrintableCellValue(row.cells?.[column.key]);
}

export function selectPrintableColumnKeys(input: {
  columns: ClientOperationsPrintColumn[];
  rows: ClientOperationsPrintRow[];
}): string[] {
  const out: string[] = [];
  for (const column of input.columns) {
    if (column.key === 'folder' || column.cell_kind === 'folder') continue;
    if (column.key === 'client_name') {
      out.push(column.key);
      continue;
    }
    const anyMeaningful = input.rows.some((row) => isMeaningfulPrintableRegistryCell(row, column));
    if (anyMeaningful) out.push(column.key);
  }
  return out;
}

export function formatClientOperationsPeriodHeading(periodKey: string | null | undefined): string {
  const key = String(periodKey ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) return key || 'תקופה';
  const year = key.slice(2, 4);
  const month = key.slice(5);
  return `${month}.${year}`;
}
