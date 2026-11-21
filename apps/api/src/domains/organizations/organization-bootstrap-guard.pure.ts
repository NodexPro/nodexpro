/**
 * Owner-office bootstrap guard.
 * A user with an active membership must not create another office through primary onboarding.
 * A user with no active membership and a pending unexpired invitation must accept that
 * invitation instead of becoming Owner of a new organization.
 */

export const PENDING_ORGANIZATION_INVITATION = 'PENDING_ORGANIZATION_INVITATION';
export const ORGANIZATION_ALREADY_EXISTS = 'ORGANIZATION_ALREADY_EXISTS';

export type OrganizationBootstrapRefusal = 'already_member' | 'pending_invitation' | null;

export function organizationBootstrapRefusal(input: {
  hasActiveMembership: boolean;
  hasPendingUnexpiredInvitation: boolean;
}): OrganizationBootstrapRefusal {
  if (input.hasActiveMembership) return 'already_member';
  if (input.hasPendingUnexpiredInvitation) return 'pending_invitation';
  return null;
}

export function shouldRefuseOrganizationBootstrap(input: {
  hasActiveMembership: boolean;
  hasPendingUnexpiredInvitation: boolean;
}): boolean {
  return organizationBootstrapRefusal(input) != null;
}
