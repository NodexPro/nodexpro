/** Public-facing party fields for income document preview/PDF/email — no internal ids. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IncomePreviewPublicParty = {
  display_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

export function isLikelyInternalIdentifier(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (UUID_RE.test(s)) return true;
  if (/^INC[-_]/i.test(s)) return true;
  if (/^CUST[-_]/i.test(s)) return true;
  if (/^DRAFT[-_]/i.test(s)) return true;
  if (/^[0-9a-f]{24}$/i.test(s)) return true;
  return false;
}

/** Short alphanumeric codes (e.g. NYC) used as internal client shortcuts — not public business names. */
export function isLikelyInternalShortCode(value: string): boolean {
  const s = value.trim();
  if (!s || s.length > 8) return false;
  if (/[\u0590-\u05FF]/.test(s) || /\s/.test(s)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s)) return false;
  if (s.length <= 6 && /^[A-Z0-9_-]+$/.test(s)) return true;
  if (s.length <= 4) return true;
  return false;
}

export function hasPublicBusinessSignals(party: IncomePreviewPublicParty): boolean {
  if (party.tax_id?.trim()) return true;
  if (party.address?.trim()) return true;
  if (party.phone?.trim()) return true;
  if (party.email?.trim()) return true;
  const name = party.display_name.trim();
  if (name.length >= 10) return true;
  if (/[\u0590-\u05FF]/.test(name)) return true;
  if (/\s/.test(name)) return true;
  return false;
}

function resolvePublicDisplayName(party: IncomePreviewPublicParty, fallbackDisplayName: string): string {
  const raw = party.display_name.trim();
  if (!raw || isLikelyInternalIdentifier(raw)) return fallbackDisplayName;
  if (isLikelyInternalShortCode(raw) && !hasPublicBusinessSignals(party)) return fallbackDisplayName;
  return raw;
}

export function publicDisplayName(value: string | null | undefined, fallback = '—'): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || isLikelyInternalIdentifier(s)) return fallback;
  return s;
}

export function publicDisplayNameOrNull(value: string | null | undefined): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || isLikelyInternalIdentifier(s) || isLikelyInternalShortCode(s)) return null;
  return s;
}

function publicOptionalField(value: string | null | undefined): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || isLikelyInternalIdentifier(s)) return null;
  return s;
}

export function toPublicPreviewParty(
  party: IncomePreviewPublicParty,
  fallbackDisplayName = '—',
): IncomePreviewPublicParty {
  return {
    display_name: resolvePublicDisplayName(party, fallbackDisplayName),
    tax_id: publicOptionalField(party.tax_id),
    address: publicOptionalField(party.address),
    phone: publicOptionalField(party.phone),
    email: publicOptionalField(party.email),
  };
}
