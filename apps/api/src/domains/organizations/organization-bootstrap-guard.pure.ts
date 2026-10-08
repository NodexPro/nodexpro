/**
 * Owner-office bootstrap guard.
 * A user with no active membership and a pending unexpired invitation must accept that
 * invitation instead of becoming Owner of a new organization.
 * Users with no such invitation keep the normal self-signup create-organization path.
 */

export const PENDING_ORGANIZATION_INVITATION = 'PENDING_ORGANIZATION_INVITATION';

export function shouldRefuseOrganizationBootstrap(input: {
  hasActiveMembership: boolean;
  hasPendingUnexpiredInvitation: boolean;
}): boolean {
  if (input.hasActiveMembership) return false;
  return input.hasPendingUnexpiredInvitation;
}
