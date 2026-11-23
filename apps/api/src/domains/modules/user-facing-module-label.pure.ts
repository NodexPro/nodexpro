/**
 * User-facing module labels for office tables (Users & Roles, assignability).
 * Catalog DB name may still be the internal "Client Operations"; screens must not show that.
 */

export type UserFacingModuleLocale = 'en' | 'he';

export function userFacingModuleDisplayName(
  code: string,
  locale: UserFacingModuleLocale | string | null | undefined,
  fallback: string,
): string {
  const key = String(code ?? '').trim().toLowerCase();
  if (key === 'client-operations' || key === 'client_operations') {
    return locale === 'he' ? 'ניהול לקוחות' : 'Client Management';
  }
  const name = String(fallback ?? '').trim();
  return name || key || 'Module';
}
