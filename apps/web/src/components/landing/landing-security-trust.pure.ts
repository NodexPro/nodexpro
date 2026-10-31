/**
 * Public Security & Trust section — presentation copy only.
 *
 * Website Studio is not implemented yet. This typed block id is the future
 * registry key (`security_trust`) for Owner-editable EN/HE content, visibility
 * and order. Do not invent a second CMS here.
 *
 * Claims stay conservative: no certifications, encryption guarantees, or
 * compliance badges. Copy must map to existing RBAC, tenant isolation, audit,
 * and ongoing security work — not to unpublished architecture details.
 */
export const LANDING_SECURITY_TRUST_BLOCK_TYPE = 'security_trust' as const;

export const LANDING_SECURITY_TRUST_CARD_KEYS = [
  'access',
  'protection',
  'accountability',
  'ongoing',
] as const;

export type LandingSecurityTrustCardKey = (typeof LANDING_SECURITY_TRUST_CARD_KEYS)[number];

export function landingSecurityTrustCopyIsConservative(value: string): boolean {
  return !/(ISO\s*27001|SOC\s*2|HIPAA|GDPR certified|encrypted at rest|zero[- ]trust certified|penetration-test certified)/i.test(
    value,
  );
}
