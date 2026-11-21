export type ExplicitOrgHeaderDecision = 'use_membership' | 'reject_not_member' | 'resolve_stored';

/**
 * Explicit X-Organization-Id must match membership on tenant APIs.
 * Identity bootstrap (/auth/session, /auth/me, MFA verify) ignores a stale tenant header
 * instead of 403 — it must not fall back into that tenant.
 */
export function explicitOrgHeaderDecision(input: {
  headerPresent: boolean;
  membershipFound: boolean;
  identityBootstrap?: boolean;
}): ExplicitOrgHeaderDecision {
  if (!input.headerPresent) return 'resolve_stored';
  if (input.membershipFound) return 'use_membership';
  if (input.identityBootstrap) return 'resolve_stored';
  return 'reject_not_member';
}
