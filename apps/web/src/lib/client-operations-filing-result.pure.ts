export type FilingActionKind = 'report' | 'report_and_pay' | 'paid';

type FilingChrome = 'filed_unpaid' | 'filed_paid' | string;

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

export function filingAggregateConfirmsAction(input: {
  action: FilingActionKind;
  clientId: string;
  columnKey: string;
  aggregate: {
    rows?: ReadonlyArray<{
      client_id?: string;
      reporting?: {
        cells?: Record<
          string,
          { filing_detail?: { chrome?: string | null } | null } | null
        > | null;
      } | null;
    }> | null;
  } | null;
}): boolean {
  const row = input.aggregate?.rows?.find((item) => item.client_id === input.clientId);
  const chrome = row?.reporting?.cells?.[input.columnKey]?.filing_detail?.chrome;
  return filingChromeConfirmsAction(input.action, chrome);
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
