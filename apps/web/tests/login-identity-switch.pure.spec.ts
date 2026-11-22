import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldApplySignedOutUi } from '../src/lib/auth-identity-transition.pure.ts';
import {
  loginSwitchSignOutIsLocal,
  loginSwitchUsesBackendLogout,
  shouldClearLocalSessionBeforePasswordLogin,
} from '../src/lib/login-identity-switch.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('password login clears the previous local session; MFA verify does not', () => {
  assert.equal(shouldClearLocalSessionBeforePasswordLogin({ challengeRequired: false }), true);
  assert.equal(shouldClearLocalSessionBeforePasswordLogin({ challengeRequired: true }), false);
  const login = read('../src/pages/Login.tsx');
  assert.match(login, /shouldClearLocalSessionBeforePasswordLogin/);
  assert.match(login, /signOut\(deviceSignOutOptions\(\)\)/);
  assert.match(login, /clearTabWorkspace/);
  assert.match(login, /setBackendActiveOrganizationId\(null\)/);
  assert.equal(loginSwitchUsesBackendLogout(login), false);
  assert.equal(loginSwitchSignOutIsLocal(login), true);
  assert.doesNotMatch(login, /AUTH\.logout/);
  const auth = read('../src/contexts/AuthContext.tsx');
  const drop = auth.slice(auth.indexOf('const dropAuthenticatedWorkspace'), auth.indexOf('const drainOfficeSwitch'));
  assert.match(drop, /setIdentityEpoch/);
  assert.match(drop, /clearTabWorkspace/);
  assert.match(drop, /setBackendActiveOrganizationId\(null\)/);
  assert.match(auth, /shouldApplySignedOutUi/);
  assert.match(auth, /const signOut = useCallback[\s\S]*AUTH\.logout/);
  const registry = read('../src/pages/ClientOperationsRegistry.tsx');
  assert.match(registry, /setRows\(\[\]\)/);
  assert.match(registry, /identityEpoch/);
});

test('late SIGNED_OUT does not log out a session that already belongs to B', () => {
  assert.equal(shouldApplySignedOutUi({ event: 'SIGNED_OUT', liveAuthUserId: null }), true);
  assert.equal(shouldApplySignedOutUi({ event: 'SIGNED_OUT', liveAuthUserId: 'user-b' }), false);
  assert.equal(shouldApplySignedOutUi({ event: 'SIGNED_IN', liveAuthUserId: 'user-b' }), true);
});
