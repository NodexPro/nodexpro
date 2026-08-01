/**
 * Pure helpers for recurring-cycle issue issuer identity repair.
 */

export const HEBREW_RECURRING_ISSUER_MISMATCH =
  'לא ניתן להפיק את המסמך משום שזהות מנפיק המסמך אינה תואמת ללקוח המיוצג.';

/**
 * Repair draft issuer identity only when safely within the same org + represented client.
 * Reject when draft points at a different client.
 */
export function resolveDraftIssuerRepairPlan(params: {
  profileClientId: string;
  draftRepresentedClientId: string | null;
  draftIssuerBusinessId: string;
}):
  | { kind: 'ok'; represented_client_id: string; issuer_business_id: string }
  | { kind: 'repair'; represented_client_id: string; issuer_business_id: string }
  | { kind: 'reject' } {
  const expected = params.profileClientId;
  const draftRep = params.draftRepresentedClientId;
  const draftIssuer = params.draftIssuerBusinessId;

  if (draftRep != null && draftRep !== expected) {
    return { kind: 'reject' };
  }
  if (draftIssuer === expected && draftRep === expected) {
    return { kind: 'ok', represented_client_id: expected, issuer_business_id: expected };
  }
  if (draftRep === expected && draftIssuer !== expected) {
    return { kind: 'repair', represented_client_id: expected, issuer_business_id: expected };
  }
  if (draftRep == null && draftIssuer === expected) {
    return { kind: 'repair', represented_client_id: expected, issuer_business_id: expected };
  }
  return { kind: 'reject' };
}
