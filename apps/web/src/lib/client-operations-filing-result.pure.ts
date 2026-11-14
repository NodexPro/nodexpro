export type FilingActionKind = 'report' | 'report_and_pay' | 'paid';

type FilingChrome = 'filed_unpaid' | 'filed_paid' | string;

type FilingAggregateRow = {
  client_id?: string;
  reporting?: {
    cells?: Record<
      string,
      {
        obligation_id?: string | null;
        filing_detail?: { chrome?: string | null } | null;
      } | null
    > | null;
  } | null;
  national_insurance_operations?: {
    handling_method?: string | null;
    period_key?: string | null;
  } | null;
};

export function canStartFilingAction(locked: boolean): boolean {
  return locked !== true;
}

/** Backend chrome is the only confirmation that the refreshed aggregate recorded the action. */
export function filingChromeConfirmsAction(
  action: FilingActionKind,
  chrome: FilingChrome | null | undefined,
): boolean {
  if (action === 'report') return chrome === 'filed_unpaid' || chrome === 'filed_paid';
  return chrome === 'filed_paid';
}

export function filingCellFromAggregateRow(
  row: FilingAggregateRow | null | undefined,
  columnKey: string,
  obligationId?: string | null,
): { filing_detail?: { chrome?: string | null } | null; obligation_id?: string | null } | null {
  const cells = row?.reporting?.cells;
  if (!cells) return null;
  const byColumn = cells[columnKey];
  if (byColumn) return byColumn;
  const wanted = String(obligationId ?? '').trim();
  if (!wanted) return null;
  return (
    Object.values(cells).find((cell) => String(cell?.obligation_id ?? '').trim() === wanted) ?? null
  );
}

export function filingAggregateConfirmsAction(input: {
  action: FilingActionKind;
  clientId: string;
  columnKey: string;
  obligationId?: string | null;
  aggregate: {
    rows?: ReadonlyArray<FilingAggregateRow> | null;
  } | null;
}): boolean {
  const row = input.aggregate?.rows?.find((item) => item.client_id === input.clientId);
  const chrome = filingCellFromAggregateRow(row, input.columnKey, input.obligationId)?.filing_detail
    ?.chrome;
  return filingChromeConfirmsAction(input.action, chrome);
}

export function selfEmployedNiShouldPersistSelection(input: {
  selectedMethod: string | null | undefined;
}): boolean {
  return (
    input.selectedMethod === 'standing_order' ||
    input.selectedMethod === 'client_pays' ||
    input.selectedMethod === 'manual_monthly'
  );
}

export function selfEmployedNiAggregateConfirmsMethod(input: {
  clientId: string;
  periodKey: string;
  method: string;
  aggregate: {
    rows?: ReadonlyArray<FilingAggregateRow> | null;
  } | null;
}): boolean {
  const row = input.aggregate?.rows?.find((item) => item.client_id === input.clientId);
  const ops = row?.national_insurance_operations;
  if (!ops) return false;
  if (String(ops.period_key ?? '').trim() !== String(input.periodKey ?? '').trim()) return false;
  return ops.handling_method === input.method;
}

/** Presentation class for a registry cell. Filed chrome comes only from the aggregate. */
export function filingCellPresentationClass(
  cell:
    | {
        tone?: string | null;
        filing_detail?: { chrome?: string | null } | null;
      }
    | null
    | undefined,
): string {
  const chrome = cell?.filing_detail?.chrome;
  if (chrome === 'filed_unpaid' || chrome === 'filed_paid') return `is-filing-chrome-${chrome}`;
  if (cell?.filing_detail) return '';
  if (cell?.tone) return `is-reporting-cell-${cell.tone}`;
  return '';
}
