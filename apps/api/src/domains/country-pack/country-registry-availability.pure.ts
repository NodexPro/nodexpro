/**
 * User-facing country registry availability.
 * Canonical signals: countries.status + officially assigned ISO 3166-1 alpha-2.
 * Not a name-prefix filter. Not Country Pack enablement (Settings ≠ onboarding).
 */

export function normalizeCountryRegistryCode(input: unknown): string {
  return String(input ?? '').trim().toUpperCase();
}

export function isIso3166Alpha2CountryCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code);
}

/** ISO 3166-1 user-assigned: AA, QM–QZ, XA–XZ, ZZ. */
export function isIso3166UserAssignedAlpha2(code: string): boolean {
  if (!isIso3166Alpha2CountryCode(code)) return false;
  if (code === 'AA' || code === 'ZZ') return true;
  if (code[0] === 'Q' && code[1] >= 'M' && code[1] <= 'Z') return true;
  return code[0] === 'X';
}

/**
 * Officially assigned ISO 3166-1 alpha-2 (not user-assigned, not free-form).
 * This is the ISO assignment class, not a NodexPro Country Pack catalog.
 */
const OFFICIALLY_ASSIGNED_ISO_3166_ALPHA2 = new Set<string>([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
]);

export function isOfficiallyAssignedIso3166Alpha2(code: string): boolean {
  return OFFICIALLY_ASSIGNED_ISO_3166_ALPHA2.has(code);
}

export type RegistryCountryCandidate = {
  code: string;
  status: string;
};

export function isUserFacingRegistryCountry(input: RegistryCountryCandidate): boolean {
  const code = normalizeCountryRegistryCode(input.code);
  if (input.status !== 'active') return false;
  if (!isOfficiallyAssignedIso3166Alpha2(code)) return false;
  return true;
}

export function selectUserFacingRegistryCountries<T extends RegistryCountryCandidate>(
  rows: readonly T[],
): T[] {
  return rows
    .filter((row) => isUserFacingRegistryCountry(row))
    .slice()
    .sort((a, b) => {
      const ac = normalizeCountryRegistryCode(a.code);
      const bc = normalizeCountryRegistryCode(b.code);
      return ac.localeCompare(bc);
    });
}

/** Keep the organization's current country even if it is no longer user-facing. */
export function canAssignOrganizationCountry(input: {
  code: unknown;
  currentOrganizationCountryCode?: unknown;
}): boolean {
  const code = normalizeCountryRegistryCode(input.code);
  const current = normalizeCountryRegistryCode(input.currentOrganizationCountryCode);
  if (current && code === current) return true;
  return isOfficiallyAssignedIso3166Alpha2(code);
}
