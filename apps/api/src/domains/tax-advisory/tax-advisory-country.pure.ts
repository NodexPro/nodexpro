import { badRequest, conflict } from '../../shared/errors.js';

export function normalizeIsoCountry(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * Legal engine country is organization Country Pack country.
 * clients.country_code is Core metadata, not tax residency.
 * NULL client country: allow (do not inherit).
 * Populated mismatch: BLOCK.
 */
export function assertClientCountryCompatibility(
  orgLegalCountry: string,
  clientCountryCode: string | null,
): void {
  const org = normalizeIsoCountry(orgLegalCountry);
  if (!org) {
    throw badRequest('Organization legal country is missing', 'ORG_LEGAL_COUNTRY_MISSING');
  }
  const client = normalizeIsoCountry(clientCountryCode);
  if (client == null) return;
  if (client !== org) {
    throw conflict(
      'Client country does not match organization legal country',
      'CLIENT_COUNTRY_MISMATCH',
    );
  }
}

export function requireOrgLegalCountry(countryCode: string | null | undefined): string {
  const org = normalizeIsoCountry(countryCode ?? null);
  if (!org) {
    throw badRequest('Organization legal country is missing', 'ORG_LEGAL_COUNTRY_MISSING');
  }
  return org;
}
