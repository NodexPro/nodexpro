/**
 * Invoice client-document populations — UI display preference only.
 * Does not classify membership; populations come from backend sections only.
 */

export type WorkEngineInvoicesPopulationsDisplayMode =
  | 'office'
  | 'both'
  | 'office_client_customers';

export const WORK_ENGINE_INVOICES_POPULATIONS_DISPLAY_DEFAULT: WorkEngineInvoicesPopulationsDisplayMode =
  'both';

/** Middle segmented-control label (not a backend section title). */
export const WORK_ENGINE_INVOICES_POPULATIONS_BOTH_LABEL = 'שניהם';

export function resolveWorkEngineInvoicesPopulationsVisibility(
  mode: WorkEngineInvoicesPopulationsDisplayMode,
): { showOfficeClients: boolean; showOfficeClientCustomers: boolean } {
  return {
    showOfficeClients: mode === 'office' || mode === 'both',
    showOfficeClientCustomers: mode === 'office_client_customers' || mode === 'both',
  };
}

/** Stable React key from backend row identity fields (no FE population inference). */
export function incomeClientDocumentManagementRowReactKey(row: {
  represented_client_id: string;
  income_customer_id?: string | null;
}): string {
  if (row.income_customer_id) {
    return `income_customer:${row.income_customer_id}`;
  }
  return `represented_client:${row.represented_client_id}`;
}
