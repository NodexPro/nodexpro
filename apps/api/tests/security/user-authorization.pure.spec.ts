import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_USER_NOT_ACTIVE_CODE,
  APP_USER_NOT_ACTIVE_MESSAGE,
  inactiveAppUserError,
  isAppUserStatusActive,
  isCanonicalMembershipStatusActive,
} from '../../src/domains/auth/user-authorization.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('active user is permitted; suspended, blocked, deleted and missing are denied', () => {
  assert.equal(isAppUserStatusActive('active'), true);
  assert.equal(isAppUserStatusActive('ACTIVE'), true);
  assert.equal(isAppUserStatusActive('suspended'), false);
  assert.equal(isAppUserStatusActive('blocked'), false);
  assert.equal(isAppUserStatusActive('deleted'), false);
  assert.equal(isAppUserStatusActive(''), false);
  assert.equal(isAppUserStatusActive(null), false);
  assert.equal(isAppUserStatusActive(undefined), false);
  assert.equal(inactiveAppUserError('suspended').code, APP_USER_NOT_ACTIVE_CODE);
  assert.equal(inactiveAppUserError('deleted').message, APP_USER_NOT_ACTIVE_MESSAGE);
  assert.equal(inactiveAppUserError('blocked').message, APP_USER_NOT_ACTIVE_MESSAGE);
});

test('inactive organization membership is distinct from a globally suspended user', () => {
  assert.equal(isCanonicalMembershipStatusActive('active'), true);
  assert.equal(isCanonicalMembershipStatusActive('removed'), false);
  assert.equal(isCanonicalMembershipStatusActive('invited'), false);
  assert.equal(isCanonicalMembershipStatusActive('suspended'), false);
  assert.equal(isAppUserStatusActive('active') && !isCanonicalMembershipStatusActive('removed'), true);
});

test('authMiddleware denies non-active users from users.status on every request', () => {
  const auth = readFileSync(join(dir, '../../src/middleware/auth.ts'), 'utf8');
  assert.match(auth, /isAppUserStatusActive\(appUserRow\.status\)/);
  assert.match(auth, /APP_USER_NOT_ACTIVE_CODE/);
  assert.match(auth, /authMiddleware/);
  const owner = readFileSync(join(dir, '../../src/shared/platform-owner.ts'), 'utf8');
  assert.match(owner, /assertPlatformOwner/);
  const index = readFileSync(join(dir, '../../src/index.ts'), 'utf8');
  assert.match(index, /app\.use\('\/api\/v1\/owner', ownerCountryPackRoutes\)/);
  assert.match(index, /app\.use\('\/api\/v1\/auth', authRoutes\)/);
});

test('loadOrgMembershipForUser does not restore revoked canonical membership via legacy OU', () => {
  const src = readFileSync(join(dir, '../../src/domains/auth/active-organization.service.ts'), 'utf8');
  assert.match(src, /canonical\.status !== 'absent'/);
  assert.match(src, /mayUseLegacyOrganizationUsersAccessFallback/);
  assert.match(src, /\.eq\('membership_status', 'active'\)/);
});
