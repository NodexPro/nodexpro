/**
 * Login outcomes after 7de0f70c: credentials vs onboarding vs office,
 * clean-browser B, two-tab A→B, language, MFA, token refresh, stale responses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canReuseInFlightSession,
  classifyAuthIdentityTransition,
  shouldApplyBootstrappedSession,
  shouldDropAuthenticatedUi,
  shouldInvalidateInFlightSession,
  shouldRefetchSessionAfterAuthEvent,
} from '../src/lib/auth-identity-transition.pure.ts';
import {
  classifyLoginSubmitFailure,
  classifyPostLoginNavigation,
  loginUiErrorAfterRefetch,
  sessionUserMatchesLoginIdentifier,
} from '../src/lib/login-session-outcome.pure.ts';
import { loginMfaFormVisible } from '../src/lib/login-mfa-challenge.pure.ts';
import { decideSessionLanguageApply } from '../src/lib/session-language-bootstrap.pure.ts';
import { decideSessionWorkspaceApply } from '../src/lib/tab-workspace.pure.ts';
import {
  classifyUnauthorizedRetry,
  classifyWorkspaceApplyDecision,
} from '../src/lib/session-auth-failure.pure.ts';
import { resolvePostLoginDestination } from '../src/lib/invite-return-path.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const onboardingMe = {
  session_state: 'needs_onboarding' as const,
  redirect_to: '/onboarding',
  user: { email: 'b@example.com' },
  organizations: [] as Array<{ id: string }>,
};

test('clean browser login B with needs_onboarding goes to onboarding, not a credential error', () => {
  assert.equal(
    classifyAuthIdentityTransition({ event: 'SIGNED_IN', previousAuthUserId: null, nextAuthUserId: 'user-b' }),
    'signed_in',
  );
  assert.equal(shouldDropAuthenticatedUi('signed_in'), false);
  assert.equal(shouldInvalidateInFlightSession('signed_in'), true);
  assert.equal(shouldApplyBootstrappedSession({ bootAuthUserId: null, currentAuthUserId: 'user-b' }), false);
  assert.equal(loginUiErrorAfterRefetch({ loginSucceeded: true, me: onboardingMe }), 'none');
  assert.equal(classifyPostLoginNavigation(onboardingMe), 'needs_onboarding');
  assert.equal(
    resolvePostLoginDestination({
      inviteReturnPath: null,
      sessionRedirect: onboardingMe.redirect_to,
      fallback: '/dashboard',
    }),
    '/onboarding',
  );
  assert.equal(
    decideSessionWorkspaceApply({
      sessionActiveOrganizationId: null,
      workingOrganizationId: null,
      membershipOrgIds: [],
      sessionState: 'needs_onboarding',
    }),
    'apply_session',
  );
});

test('login A in tab 1 then login B in tab 2 drops A and does not show a credential error for B', () => {
  assert.equal(
    classifyAuthIdentityTransition({ event: 'SIGNED_IN', previousAuthUserId: 'user-a', nextAuthUserId: 'user-b' }),
    'user_switched',
  );
  assert.equal(shouldDropAuthenticatedUi('user_switched'), true);
  assert.equal(shouldInvalidateInFlightSession('user_switched'), true);
  assert.equal(
    canReuseInFlightSession({
      inFlightGeneration: 5,
      currentGeneration: 5,
      inFlightAuthUserId: 'user-a',
      currentAuthUserId: 'user-b',
    }),
    false,
  );
  assert.equal(
    canReuseInFlightSession({
      inFlightGeneration: 6,
      currentGeneration: 6,
      inFlightAuthUserId: 'user-b',
      currentAuthUserId: 'user-b',
    }),
    true,
  );
  assert.equal(sessionUserMatchesLoginIdentifier({ user: { email: 'a@office.com' } }, 'b@example.com'), false);
  assert.equal(sessionUserMatchesLoginIdentifier(onboardingMe, 'b@example.com'), true);
  assert.equal(loginUiErrorAfterRefetch({ loginSucceeded: true, me: onboardingMe }), 'none');
  assert.equal(
    decideSessionWorkspaceApply({
      sessionActiveOrganizationId: null,
      workingOrganizationId: 'org-a',
      membershipOrgIds: [],
      sessionState: 'needs_onboarding',
    }),
    'apply_session',
  );
});

test('login 200 + needs_onboarding is not a credential error; empty orgs without session_state are not onboarding', () => {
  assert.equal(
    loginUiErrorAfterRefetch({ loginSucceeded: true, me: { session_state: 'needs_onboarding' } }),
    'none',
  );
  assert.equal(loginUiErrorAfterRefetch({ loginSucceeded: true, me: null }), 'load_account');
  assert.equal(classifyPostLoginNavigation({ sessionState: null, redirectTo: '/onboarding' }), 'missing');
  assert.equal(classifyPostLoginNavigation({ sessionState: 'ready', redirectTo: '/dashboard' }), 'ready');
  assert.equal(
    resolvePostLoginDestination({
      inviteReturnPath: null,
      sessionRedirect: '/dashboard',
      fallback: '/dashboard',
    }),
    '/dashboard',
  );
  const login = read('../src/pages/Login.tsx');
  assert.match(login, /loginUiErrorAfterRefetch/);
  assert.match(login, /loadAccountFailed/);
  assert.match(login, /auth\.signingIn/);
  assert.doesNotMatch(
    login,
    /if \(!me\) \{\s*setError\(loginSecurityText\(uiLang, 'invalidCredentials'\)\)/,
  );
});

test('invalid credentials stay a localized error and do not authorize', () => {
  assert.equal(
    classifyLoginSubmitFailure({ code: 'INVALID_CREDENTIALS', status: 400 }),
    'invalid_credentials',
  );
  assert.equal(loginUiErrorAfterRefetch({ loginSucceeded: false, me: null }), 'invalid_credentials');
  assert.equal(classifyPostLoginNavigation({ sessionState: undefined }), 'missing');
  const contract = new Error('No session after sign in');
  contract.name = 'LoginSessionContractError';
  assert.equal(classifyLoginSubmitFailure(contract), 'session_error');
  const login = read('../src/pages/Login.tsx');
  assert.match(login, /classifyLoginSubmitFailure/);
  assert.match(login, /kind === 'invalid_credentials'/);
  const signIn = read('../src/lib/sign-in-with-identifier.ts');
  assert.match(signIn, /LoginSessionContractError/);
});

test('HE public language stays HE on onboarding; EN stays EN across bootstrap and token refresh', () => {
  assert.equal(decideSessionLanguageApply({ storedPublicLang: 'he', sessionLang: 'en' }), 'he');
  assert.equal(
    decideSessionLanguageApply({ storedPublicLang: 'en', sessionLang: 'he', sessionPersisted: false }),
    'en',
  );
  assert.equal(
    decideSessionLanguageApply({ storedPublicLang: 'en', sessionLang: 'he', sessionPersisted: true }),
    'he',
  );
  assert.equal(decideSessionLanguageApply({ storedPublicLang: null, sessionLang: 'he' }), 'he');
  assert.equal(shouldInvalidateInFlightSession('token_refresh_same'), false);
  assert.equal(shouldRefetchSessionAfterAuthEvent('token_refresh_same'), false);
  const sync = read('../src/components/auth/SessionLanguageSync.tsx');
  assert.match(sync, /decideSessionLanguageApply/);
  assert.match(sync, /PUBLIC_LANG_STORAGE_KEY/);
  assert.match(sync, /sessionPersisted/);
  const login = read('../src/pages/Login.tsx');
  assert.match(login, /setUiLanguageCommand/);
  assert.match(login, /localization\?\.language\?\.persisted/);
  const register = read('../src/pages/Register.tsx');
  assert.match(register, /language_code: lang/);
});

test('token refresh, MFA and stale responses do not look like a failed password', () => {
  assert.equal(
    classifyAuthIdentityTransition({
      event: 'TOKEN_REFRESHED',
      previousAuthUserId: 'user-b',
      nextAuthUserId: 'user-b',
    }),
    'token_refresh_same',
  );
  assert.equal(shouldDropAuthenticatedUi('token_refresh_same'), false);
  assert.equal(loginMfaFormVisible({ loginChallengeRequired: true }), true);
  assert.equal(loginMfaFormVisible({ sessionState: 'needs_onboarding' }), false);
  assert.equal(classifyPostLoginNavigation({ sessionState: 'mfa_challenge' }), 'mfa');
  assert.equal(classifyLoginSubmitFailure({ code: 'LOGIN_CHALLENGE_REQUIRED', status: 401 }), 'mfa');
  const stale = new Error('Workspace changed');
  stale.name = 'StaleWorkspaceError';
  assert.equal(classifyLoginSubmitFailure(stale), 'session_error');
  assert.equal(classifyWorkspaceApplyDecision({ startedGeneration: 2, currentGeneration: 3 }), 'discard_stale');
  assert.equal(
    classifyUnauthorizedRetry({
      status: 401,
      alreadyRetried: false,
      refreshReturnedSession: true,
    }),
    'retry',
  );
  assert.equal(
    classifyUnauthorizedRetry({
      status: 401,
      code: 'LOGIN_CHALLENGE_REQUIRED',
      alreadyRetried: false,
      refreshReturnedSession: true,
    }),
    'propagate',
  );
  const auth = read('../src/contexts/AuthContext.tsx');
  assert.match(auth, /shouldInvalidateInFlightSession/);
  assert.match(auth, /canReuseInFlightSession/);
  assert.match(auth, /shouldApplyBootstrappedSession/);
  assert.match(auth, /bumpWorkspaceGeneration/);
  const client = read('../src/api/client.ts');
  assert.match(client, /discard_stale/);
});
