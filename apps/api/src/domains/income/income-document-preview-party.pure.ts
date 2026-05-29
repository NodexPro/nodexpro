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

export function publicDisplayName(value: string | null | undefined, fallback = '—'): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || isLikelyInternalIdentifier(s)) return fallback;
  return s;
}

export function publicDisplayNameOrNull(value: string | null | undefined): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || isLikelyInternalIdentifier(s)) return null;
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
    display_name: publicDisplayName(party.display_name, fallbackDisplayName),
    tax_id: publicOptionalField(party.tax_id),
    address: publicOptionalField(party.address),
    phone: publicOptionalField(party.phone),
    email: publicOptionalField(party.email),
  };
}
