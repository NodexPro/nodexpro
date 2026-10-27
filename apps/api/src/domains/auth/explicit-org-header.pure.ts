export type ExplicitOrgHeaderDecision = 'use_membership' | 'reject_not_member' | 'resolve_stored';

/** Explicit X-Organization-Id must match membership. Do not fall back to another tenant. */
export function explicitOrgHeaderDecision(input: {
  headerPresent: boolean;
  membershipFound: boolean;
}): ExplicitOrgHeaderDecision {
  if (!input.headerPresent) return 'resolve_stored';
  return input.membershipFound ? 'use_membership' : 'reject_not_member';
}
