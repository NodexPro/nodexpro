/**
 * Organization bootstrap must not turn a pending invitation into a new Owner office
 * and must not duplicate an existing active membership through primary onboarding.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORGANIZATION_ALREADY_EXISTS,
  PENDING_ORGANIZATION_INVITATION,
  organizationBootstrapRefusal,
  shouldRefuseOrganizationBootstrap,
} from '../../src/domains/organizations/organization-bootstrap-guard.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('ordinary self-signup with no pending invitation may create an organization', () => {
  assert.equal(
    shouldRefuseOrganizationBootstrap({ hasActiveMembership: false, hasPendingUnexpiredInvitation: false }),
    false,
  );
  assert.equal(
    organizationBootstrapRefusal({ hasActiveMembership: false, hasPendingUnexpiredInvitation: false }),
    null,
  );
});

test('existing active membership cannot use primary onboarding to create another office', () => {
  assert.equal(
    organizationBootstrapRefusal({ hasActiveMembership: true, hasPendingUnexpiredInvitation: false }),
    'already_member',
  );
  assert.equal(
    organizationBootstrapRefusal({ hasActiveMembership: true, hasPendingUnexpiredInvitation: true }),
    'already_member',
  );
  assert.equal(ORGANIZATION_ALREADY_EXISTS, 'ORGANIZATION_ALREADY_EXISTS');
});

test('new user with a valid pending invitation cannot bootstrap an Owner organization', () => {
  assert.equal(
    shouldRefuseOrganizationBootstrap({ hasActiveMembership: false, hasPendingUnexpiredInvitation: true }),
    true,
  );
  assert.equal(
    organizationBootstrapRefusal({ hasActiveMembership: false, hasPendingUnexpiredInvitation: true }),
    'pending_invitation',
  );
  assert.equal(PENDING_ORGANIZATION_INVITATION, 'PENDING_ORGANIZATION_INVITATION');
});

test('createOrganization refuses existing membership and pending invite before insert', () => {
  const service = read('../../src/domains/organizations/organizations.service.ts');
  const guardAt = service.indexOf('organizationBootstrapRefusal');
  const insertAt = service.indexOf(".from('organizations')");
  assert.ok(guardAt > 0);
  assert.ok(insertAt > guardAt);
  assert.match(service, /PENDING_ORGANIZATION_INVITATION/);
  assert.match(service, /ORGANIZATION_ALREADY_EXISTS/);
  assert.match(service, /eq\('status', 'pending'\)/);
  assert.match(service, /\.gt\('expires_at'/);
  assert.match(service, /eq\('status', 'active'\)/);
  assert.match(service, /conflict\(/);
  assert.match(service, /role_code: 'owner'/);
  assert.doesNotMatch(service, /throw new Error\('A pending organization invitation/);
});

test('acceptInviteRbac still owns email, expiry, reuse, seats, and canonical membership', () => {
  const accept = read('../../src/domains/memberships/memberships-rbac.service.ts');
  assert.match(accept, /Invitation was sent to a different email address/);
  assert.match(accept, /Invitation expired/);
  assert.match(accept, /Invitation already used or revoked/);
  assert.match(accept, /Invalid invitation/);
  assert.match(accept, /activateMembershipWithStaffSeatGuard/);
  assert.match(accept, /syncLegacyOrganizationUserFromCanonical/);
  assert.match(accept, /roleCode: invRow\.role_code/);
  assert.match(accept, /status !== 'pending'/);
  const seat = read('../../src/domains/modules/staff-seat-entitlement.service.ts');
  assert.match(seat, /STAFF_SEAT_CAPACITY_EXCEEDED/);
  assert.match(seat, /No available staff seats for this organization/);
});
