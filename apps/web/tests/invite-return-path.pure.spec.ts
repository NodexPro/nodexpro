/**
 * Invited-staff onboarding return path. Routing only — no membership truth.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INVITE_RETURN_STORAGE_KEY,
  captureInviteReturnPath,
  clearStoredInviteReturnPath,
  isDefinitiveInviteRejection,
  parseInviteReturnPath,
  readStoredInviteReturnPath,
  resolveOwnerOnboardingOverride,
  resolvePostLoginDestination,
  resolvePostRegisterDestination,
} from '../src/lib/invite-return-path.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

const staffInvite = '/invite/accept?token=stafftoken';
const adminInvite = '/invite/accept?token=admintoken';

test('self-signup without invitation stays on owner onboarding', () => {
  assert.equal(resolvePostRegisterDestination(null), '/onboarding');
  assert.equal(resolvePostRegisterDestination('/dashboard'), '/onboarding');
  assert.equal(resolveOwnerOnboardingOverride(null), null);
  assert.equal(
    resolvePostLoginDestination({
      inviteReturnPath: null,
      sessionRedirect: '/onboarding',
      fallback: '/dashboard',
    }),
    '/onboarding',
  );
});

test('invited staff and admin return to accept and never onboarding', () => {
  for (const invite of [staffInvite, adminInvite]) {
    assert.equal(resolvePostRegisterDestination(invite), invite);
    assert.equal(
      resolvePostLoginDestination({
        inviteReturnPath: invite,
        sessionRedirect: '/onboarding',
        fallback: '/dashboard',
      }),
      invite,
    );
    assert.equal(
      resolvePostLoginDestination({
        inviteReturnPath: invite,
        sessionRedirect: '/m/client-operations',
        fallback: '/dashboard',
      }),
      invite,
    );
    assert.equal(resolveOwnerOnboardingOverride(invite), invite);
  }
});

test('existing-account login prefers invite accept over session default route', () => {
  assert.equal(
    resolvePostLoginDestination({
      inviteReturnPath: staffInvite,
      sessionRedirect: '/dashboard',
      fallback: '/dashboard',
    }),
    staffInvite,
  );
});

test('refresh on login and register keeps the stored invite return path', () => {
  const loginStorage = memoryStorage();
  captureInviteReturnPath(loginStorage, staffInvite);
  assert.equal(readStoredInviteReturnPath(loginStorage), staffInvite);
  assert.equal(loginStorage.getItem(INVITE_RETURN_STORAGE_KEY), staffInvite);

  const registerStorage = memoryStorage();
  captureInviteReturnPath(registerStorage, adminInvite);
  assert.equal(readStoredInviteReturnPath(registerStorage), adminInvite);
  assert.equal(resolvePostRegisterDestination(readStoredInviteReturnPath(registerStorage)), adminInvite);
});

test('malicious and arbitrary redirects are not stored or treated as invite context', () => {
  const storage = memoryStorage();
  captureInviteReturnPath(storage, staffInvite);
  const rejected = [
    'https://evil.example/invite/accept?token=abc',
    '//evil.example/invite/accept?token=abc',
    'http://evil.example/invite/accept?token=abc',
    '/\\evil.example\\invite',
    '/dashboard',
    '/onboarding',
    '/invite/accept',
    '/invite/accept?token=',
    '/invite/accept?token=abc&next=/admin',
    '/invite/../admin?token=abc',
    '/%2F%2Fevil.example/invite/accept?token=abc',
  ];
  for (const candidate of rejected) {
    assert.equal(parseInviteReturnPath(candidate), null, candidate);
    assert.equal(captureInviteReturnPath(storage, candidate), staffInvite);
  }
  assert.equal(readStoredInviteReturnPath(storage), staffInvite);
  assert.equal(
    resolvePostLoginDestination({
      inviteReturnPath: '/settings',
      sessionRedirect: '/dashboard',
      fallback: '/settings',
    }),
    '/dashboard',
  );
});

test('successful accept and definitive rejection clear stored context; seat failure does not', () => {
  const storage = memoryStorage();
  captureInviteReturnPath(storage, staffInvite);
  clearStoredInviteReturnPath(storage);
  assert.equal(readStoredInviteReturnPath(storage), null);

  captureInviteReturnPath(storage, staffInvite);
  assert.equal(isDefinitiveInviteRejection({ message: 'Invalid invitation' }), true);
  assert.equal(isDefinitiveInviteRejection({ message: 'Invitation expired' }), true);
  assert.equal(isDefinitiveInviteRejection({ message: 'Invitation already used or revoked' }), true);
  if (isDefinitiveInviteRejection({ message: 'Invitation expired' })) clearStoredInviteReturnPath(storage);
  assert.equal(readStoredInviteReturnPath(storage), null);

  captureInviteReturnPath(storage, staffInvite);
  const seat = {
    message: 'No available staff seats for this organization',
    code: 'STAFF_SEAT_CAPACITY_EXCEEDED',
  };
  assert.equal(isDefinitiveInviteRejection(seat), false);
  assert.equal(isDefinitiveInviteRejection({ message: 'Invitation was sent to a different email address' }), false);
  assert.equal(resolveOwnerOnboardingOverride(readStoredInviteReturnPath(storage)), staffInvite);
  assert.notEqual(resolvePostRegisterDestination(readStoredInviteReturnPath(storage)), '/onboarding');
});

test('Login, Register, InviteAccept, and RequireOrg preserve invite routing without membership writes', () => {
  const login = read('../src/pages/Login.tsx');
  const register = read('../src/pages/Register.tsx');
  const accept = read('../src/pages/InviteAccept.tsx');
  const requireOrg = read('../src/components/guards/RequireOrg.tsx');
  const createOrg = read('../src/pages/CreateOrganization.tsx');
  const bundle = [login, register, accept, requireOrg, createOrg].join('\n');

  assert.match(login, /captureInviteReturnPath/);
  assert.match(login, /resolvePostLoginDestination/);
  assert.match(login, /register\?redirect=/);
  assert.match(register, /AUTH\.register/);
  assert.match(register, /resolvePostRegisterDestination/);
  assert.match(accept, /inviteAccept\(\)/);
  assert.match(accept, /clearStoredInviteReturnPath/);
  assert.match(accept, /isDefinitiveInviteRejection/);
  assert.match(accept, /refetchMe/);
  assert.match(requireOrg, /needs_onboarding/);
  assert.match(requireOrg, /readStoredInviteReturnPath/);
  assert.match(createOrg, /readStoredInviteReturnPath/);
  assert.doesNotMatch(bundle, /from\(['"]organization_memberships['"]\)/);
  assert.doesNotMatch(bundle, /from\(['"]organization_users['"]\)/);
  assert.doesNotMatch(register, /role_code/);
  assert.doesNotMatch(login, /role_code/);
});
