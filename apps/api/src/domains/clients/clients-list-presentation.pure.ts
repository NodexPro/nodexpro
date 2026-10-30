/**
 * Core /clients list presentation — ready-to-render labels from stored profile values.
 * Does not infer type from tax_id, display_name, or client_type.
 */

export const CORE_CLIENTS_BUSINESS_TYPE_UNSET_DISPLAY_HE = 'לא הוגדר';

/** Display the saved operational-profile business type, or לא הוגדר when unset. */
export function formatCoreClientsListBusinessTypeDisplayHe(
  raw: string | null | undefined
): string {
  const value = String(raw ?? '')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!value || value === '—' || value === '-') return CORE_CLIENTS_BUSINESS_TYPE_UNSET_DISPLAY_HE;
  return value;
}
