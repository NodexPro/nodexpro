/**
 * Client Operations — manual Excel cell status (pure eligibility / presentation tokens).
 * Not statutory / Accounting Base / Work Engine workflow truth.
 */

export type ClientOperationsManualCellStatus = 'ready' | 'sent_for_approval' | 'completed';

export type ClientOperationsManualStatusPaintMode = ClientOperationsManualCellStatus | 'clear';

export const CLIENT_OPERATIONS_MANUAL_STATUS_PAINT_MODES: Array<{
  id: ClientOperationsManualStatusPaintMode;
  label_he: string;
  presentation_token: ClientOperationsManualStatusPaintMode;
}> = [
  { id: 'ready', label_he: 'מוכן', presentation_token: 'ready' },
  { id: 'sent_for_approval', label_he: 'נשלח לאישור', presentation_token: 'sent_for_approval' },
  { id: 'completed', label_he: 'הושלם', presentation_token: 'completed' },
  { id: 'clear', label_he: 'נקה', presentation_token: 'clear' },
];

/** Columns that may carry a manual paint status (backend-owned set). */
export const CLIENT_OPERATIONS_MANUAL_STATUS_PAINTABLE_COLUMN_KEYS = new Set<string>([
  'material_brought',
  'national_insurance_deductions',
  'income_tax_deductions',
  'annual_report',
  'capital_declaration',
]);

export function isClientOperationsManualStatusPaintableColumnKey(columnKey: string): boolean {
  const key = String(columnKey ?? '');
  if (CLIENT_OPERATIONS_MANUAL_STATUS_PAINTABLE_COLUMN_KEYS.has(key)) return true;
  // User Excel custom columns (including blank slots).
  if (key.startsWith('user_slot_')) return true;
  if (key.startsWith('custom_')) return true;
  return false;
}

export function parseClientOperationsManualCellStatus(
  value: unknown,
): ClientOperationsManualCellStatus | null {
  if (value === null || value === undefined || value === '') return null;
  if (value === 'ready' || value === 'sent_for_approval' || value === 'completed') return value;
  throw new Error('invalid_manual_status');
}

export function isValidClientOperationsManualCellStatus(
  value: unknown,
): value is ClientOperationsManualCellStatus {
  return value === 'ready' || value === 'sent_for_approval' || value === 'completed';
}

/**
 * Yellow/blue require ≤1 operational square; green always when paintable;
 * clear when a status exists.
 */
export function resolveAllowedManualStatuses(input: {
  columnKey: string;
  operationalSquareCount: number;
  currentStatus: ClientOperationsManualCellStatus | null;
  isCustomColumn: boolean;
}): ClientOperationsManualStatusPaintMode[] {
  if (!input.isCustomColumn && !isClientOperationsManualStatusPaintableColumnKey(input.columnKey)) {
    return [];
  }
  const squares = Math.max(0, Math.trunc(input.operationalSquareCount));
  const allowed: ClientOperationsManualStatusPaintMode[] = [];
  if (squares <= 1) {
    allowed.push('ready', 'sent_for_approval');
  }
  allowed.push('completed');
  if (input.currentStatus) allowed.push('clear');
  return allowed;
}

export function countMaterialOperationalSquares(input: {
  vatApplicable: boolean;
  incomeTaxAdvanceApplicable: boolean;
  payrollApplicable: boolean;
}): number {
  return (
    (input.vatApplicable ? 1 : 0) +
    (input.incomeTaxAdvanceApplicable ? 1 : 0) +
    (input.payrollApplicable ? 1 : 0)
  );
}

export function countNiDeductionsOperationalSquares(input: {
  applicable: boolean;
  form102Applicable: boolean;
  form100Applicable: boolean;
  form126Applicable: boolean;
}): number {
  if (!input.applicable) return 0;
  return (
    (input.form102Applicable ? 1 : 0) +
    (input.form100Applicable ? 1 : 0) +
    (input.form126Applicable ? 1 : 0)
  );
}

/** Merge selected period into available tabs so first-touch periods appear without reload. */
export function mergeSelectedPeriodIntoAvailablePeriods(input: {
  availablePeriods: string[];
  selectedPeriodKey: string;
}): string[] {
  const set = new Set(input.availablePeriods.filter(Boolean));
  if (input.selectedPeriodKey) set.add(input.selectedPeriodKey);
  return [...set].sort();
}
