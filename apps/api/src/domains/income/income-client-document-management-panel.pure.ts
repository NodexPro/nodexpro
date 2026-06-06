/**
 * Pure helpers for Income client document management panel grouping.
 */

/** Office client row key — represented client is source of truth; issuer_business_id fallback for legacy rows. */
export function resolveOfficeClientGroupKey(row: {
  represented_client_id: string | null;
  issuer_business_id: string;
  acting_mode: string;
}): string | null {
  if (row.represented_client_id) return row.represented_client_id;
  if (row.acting_mode === 'office_representative') return row.issuer_business_id;
  return null;
}
