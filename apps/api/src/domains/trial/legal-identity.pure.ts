/**
 * Israeli Teudat Zehut (תעודת זהות) normalization and checksum.
 * Does not prove real-world identity. Presentation-free.
 */

export const ISRAELI_TZ_DIGIT_LENGTH = 9;

export function extractIsraeliTzDigits(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Digits only, left-padded to 9. Null when empty or longer than 9. */
export function normalizeIsraeliTzDigits(value: string): string | null {
  const digits = extractIsraeliTzDigits(value);
  if (!digits.length || digits.length > ISRAELI_TZ_DIGIT_LENGTH) return null;
  return digits.padStart(ISRAELI_TZ_DIGIT_LENGTH, '0');
}

/**
 * Israeli ID weighted checksum (positions 1-based odd=1, even=2; digits of products summed).
 * All-zero is rejected even though the arithmetic would pass.
 */
export function isValidIsraeliTeudatZehutChecksum(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  if (/^0+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    let n = Number(digits[i]) * ((i % 2) + 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

export type OwnerLegalIdentityNormalizeResult =
  | { ok: true; value: string }
  | { ok: false; code: 'digits' | 'checksum' | 'unsupported' };

export function normalizeOwnerLegalIdentity(
  countryCode: string,
  legalIdentityType: string,
  value: string,
): OwnerLegalIdentityNormalizeResult {
  if (legalIdentityType === 'tz' && countryCode.toLowerCase() === 'il') {
    const digits = normalizeIsraeliTzDigits(value);
    if (!digits) return { ok: false, code: 'digits' };
    if (!isValidIsraeliTeudatZehutChecksum(digits)) return { ok: false, code: 'checksum' };
    return { ok: true, value: digits };
  }
  return { ok: false, code: 'unsupported' };
}
