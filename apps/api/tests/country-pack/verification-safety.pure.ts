/** Shared DEV project that verification tests must never write countries into. */
export const PERMANENT_DEV_SUPABASE_REF = 'jgxezhjctrgfbmmkqqhn';

/** ISO 3166-1 user-assigned QM–QZ. Not real country assignments. */
export const VERIFICATION_RESERVED_COUNTRY_CODES = [
  'QZ',
  'QY',
  'QX',
  'QW',
  'QV',
  'QU',
  'QT',
  'QS',
  'QR',
  'QQ',
  'QN',
  'QM',
] as const;

export const PROTECTED_OWNER_COUNTRY_CODES = ['IL', 'US'] as const;

export function isPermanentDevSupabaseUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  const value = url.trim().toLowerCase();
  try {
    return new URL(value).hostname.includes(PERMANENT_DEV_SUPABASE_REF);
  } catch {
    return value.includes(PERMANENT_DEV_SUPABASE_REF);
  }
}

export function assertCountryPackVerificationAllowed(url: string | null | undefined): void {
  if (isPermanentDevSupabaseUrl(url)) {
    throw new Error(
      'TAX-646A: refuse destructive country-pack verification against permanent DEV (jgxezhjctrgfbmmkqqhn)',
    );
  }
}

export function nextVerificationCountryCode(unavailable: readonly string[]): string {
  const taken = new Set(unavailable.map((code) => code.trim().toUpperCase()));
  const next = VERIFICATION_RESERVED_COUNTRY_CODES.find((code) => !taken.has(code));
  if (!next) {
    throw new Error('TAX-646A: no reserved verification country codes left');
  }
  return next;
}

export function disposableVerificationCountryCodes(codes: readonly string[]): string[] {
  const protectedCodes = new Set<string>(PROTECTED_OWNER_COUNTRY_CODES);
  return codes.map((code) => code.trim().toUpperCase()).filter((code) => code && !protectedCodes.has(code));
}

export function shouldRunInFilter(ids: readonly unknown[]): boolean {
  return ids.length > 0;
}

export function formatCleanupError(
  label: string,
  error: { message?: string } | null | undefined,
): Error | null {
  if (!error) return null;
  return new Error(`${label}: ${error.message ?? 'unknown error'}`);
}
