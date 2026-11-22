import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authStateChangeCallbackAwaitsAuthLock,
  shouldApplySignedOutUi,
  shouldInvalidateInFlightSession,
  canReuseInFlightSession,
  classifyAuthIdentityTransition,
  shouldDropAuthenticatedUi,
} from '../src/lib/auth-identity-transition.pure.ts';
import { loginMfaFormVisible } from '../src/lib/login-mfa-challenge.pure.ts';
import { loginUiErrorAfterRefetch } from '../src/lib/login-session-outcome.pure.ts';
import {
  beginLocalPasswordSwitch,
  endLocalPasswordSwitch,
  localPasswordSwitchInstalledUserId,
  loginSwitchSignOutIsLocal,
  loginSwitchUsesBackendLogout,
  noteLocalPasswordSwitchIdentity,
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
  assert.match(login, /beginLocalPasswordSwitch/);
  assert.match(login, /finally[\s\S]*setLoading\(false\)/);
  assert.equal(loginSwitchUsesBackendLogout(login), false);
  assert.equal(loginSwitchSignOutIsLocal(login), true);
  assert.doesNotMatch(login, /AUTH\.logout/);
  const auth = read('../src/contexts/AuthContext.tsx');
  const drop = auth.slice(auth.indexOf('const dropAuthenticatedWorkspace'), auth.indexOf('const drainOfficeSwitch'));
  assert.match(drop, /setIdentityEpoch/);
  assert.match(drop, /clearTabWorkspace/);
  assert.match(drop, /setBackendActiveOrganizationId\(null\)/);
  assert.match(auth, /shouldApplySignedOutUi/);
  assert.match(auth, /noteLocalPasswordSwitchIdentity/);
  assert.match(auth, /const signOut = useCallback[\s\S]*AUTH\.logout/);
  assert.equal(authStateChangeCallbackAwaitsAuthLock(auth), false);
  const registry = read('../src/pages/ClientOperationsRegistry.tsx');
  assert.match(registry, /setRows\(\[\]\)/);
  assert.match(registry, /identityEpoch/);
});

test('ordinary login is not cancelled by SIGNED_OUT from local switch', () => {
  endLocalPasswordSwitch();
  beginLocalPasswordSwitch();
  assert.equal(
    shouldApplySignedOutUi({
      event: 'SIGNED_OUT',
      liveAuthUserId: null,
      switchInstalledUserId: localPasswordSwitchInstalledUserId(),
    }),
    true,
  );
  noteLocalPasswordSwitchIdentity('user-a');
  assert.equal(
    shouldApplySignedOutUi({
      event: 'SIGNED_OUT',
      liveAuthUserId: null,
      switchInstalledUserId: localPasswordSwitchInstalledUserId(),
    }),
    false,
  );
  assert.equal(shouldInvalidateInFlightSession('signed_in'), false);
  assert.equal(
    canReuseInFlightSession({
      inFlightGeneration: 4,
      currentGeneration: 4,
      inFlightAuthUserId: 'user-a',
      currentAuthUserId: 'user-a',
    }),
    true,
  );
  endLocalPasswordSwitch();
});

test('A→B local switch drops A and keeps B after setSession', () => {
  endLocalPasswordSwitch();
  assert.equal(
    classifyAuthIdentityTransition({
      event: 'SIGNED_IN',
      previousAuthUserId: 'user-a',
      nextAuthUserId: 'user-b',
    }),
    'user_switched',
  );
  assert.equal(shouldDropAuthenticatedUi('user_switched'), true);
  assert.equal(shouldInvalidateInFlightSession('user_switched'), true);
  beginLocalPasswordSwitch();
  assert.equal(
    shouldApplySignedOutUi({
      event: 'SIGNED_OUT',
      liveAuthUserId: null,
      switchInstalledUserId: null,
    }),
    true,
  );
  noteLocalPasswordSwitchIdentity('user-b');
  assert.equal(
    shouldApplySignedOutUi({
      event: 'SIGNED_OUT',
      liveAuthUserId: null,
      switchInstalledUserId: localPasswordSwitchInstalledUserId(),
    }),
    false,
  );
  assert.equal(shouldApplySignedOutUi({ event: 'SIGNED_OUT', liveAuthUserId: 'user-b' }), false);
  const login = read('../src/pages/Login.tsx');
  assert.equal(loginSwitchUsesBackendLogout(login), false);
  endLocalPasswordSwitch();
});

test('slow session 200 still finishes login loading and does not look like credentials', () => {
  assert.equal(loginUiErrorAfterRefetch({ loginSucceeded: true, me: { session_state: 'ready' } }), 'none');
  assert.equal(loginUiErrorAfterRefetch({ loginSucceeded: true, me: null }), 'load_account');
  const login = read('../src/pages/Login.tsx');
  assert.match(login, /finally[\s\S]*setLoading\(false\)/);
  assert.match(login, /loginUiErrorAfterRefetch/);
  assert.doesNotMatch(login, /invalidCredentials[\s\S]{0,80}!me/);
});

test('parallel tabs A→B do not reuse A session fetch for B', () => {
  assert.equal(
    canReuseInFlightSession({
      inFlightGeneration: 5,
      currentGeneration: 5,
      inFlightAuthUserId: 'user-a',
      currentAuthUserId: 'user-b',
    }),
    false,
  );
  assert.equal(shouldInvalidateInFlightSession('user_switched'), true);
  assert.equal(shouldInvalidateInFlightSession('token_refresh_same'), false);
});

test('MFA verify does not local-signOut and is not a credential error', () => {
  assert.equal(shouldClearLocalSessionBeforePasswordLogin({ challengeRequired: true }), false);
  assert.equal(loginMfaFormVisible({ loginChallengeRequired: true }), true);
  const login = read('../src/pages/Login.tsx');
  assert.match(login, /challengeRequired[\s\S]*verify_mfa/);
  assert.match(login, /applyVerifiedMfaSession/);
});

test('late SIGNED_OUT does not log out a session that already belongs to B', () => {
  assert.equal(shouldApplySignedOutUi({ event: 'SIGNED_OUT', liveAuthUserId: null }), true);
  assert.equal(shouldApplySignedOutUi({ event: 'SIGNED_OUT', liveAuthUserId: 'user-b' }), false);
  assert.equal(shouldApplySignedOutUi({ event: 'SIGNED_IN', liveAuthUserId: 'user-b' }), true);
});
