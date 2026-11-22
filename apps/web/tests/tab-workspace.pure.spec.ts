import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TAB_WORKSPACE_STORAGE_KEY,
  clearTabWorkspace,
  decideSessionWorkspaceApply,
  overlaySessionActiveOrganization,
  parseTabWorkspace,
  readTabWorkspace,
  resolveTabOrganizationId,
  resolveTabWorkingOrganization,
  writeTabWorkspace,
} from '../src/lib/tab-workspace.pure.ts';
import {
  classifyAuthIdentityTransition,
  isStaleRequestGeneration,
  nextRequestGeneration,
  shouldDropAuthenticatedUi,
  shouldInvalidateInFlightSession,
  shouldRefetchSessionAfterAuthEvent,
} from '../src/lib/auth-identity-transition.pure.ts';
import {
  classifySessionFetchFailure,
  destinationWhenOnboardingNotAllowed,
  isPrimaryOnboardingSession,
} from '../src/lib/onboarding-session.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const memory = () => {
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
};

test('tab workspace is bound to auth user id and survives only for that user', () => {
  const storage = memory();
  assert.equal(parseTabWorkspace('{"authUserId":"u1","organizationId":"org-a"}')?.organizationId, 'org-a');
  assert.equal(parseTabWorkspace('{"userId":"u1","organizationId":"org-a"}')?.userId, 'u1');
  assert.equal(parseTabWorkspace('nope'), null);
  writeTabWorkspace(storage, 'u1', 'org-a');
  assert.equal(readTabWorkspace(storage)?.organizationId, 'org-a');
  assert.equal(
    resolveTabWorkingOrganization({
      appUserId: 'u2',
      stored: readTabWorkspace(storage),
      membershipOrgIds: ['org-a'],
      serverActiveOrganizationId: 'org-b',
    }),
    null,
  );
  assert.equal(
    resolveTabOrganizationId({
      storedOrganizationId: 'org-a',
      organizations: [{ id: 'org-a' }, { id: 'org-b' }],
      serverActiveOrganizationId: 'org-b',
    }),
    'org-a',
  );
  assert.equal(
    resolveTabOrganizationId({
      storedOrganizationId: 'org-z',
      organizations: [{ id: 'org-a' }],
      serverActiveOrganizationId: 'org-a',
    }),
    'org-a',
  );
  clearTabWorkspace(storage);
  assert.equal(readTabWorkspace(storage), null);
  assert.equal(TAB_WORKSPACE_STORAGE_KEY, 'nx.tab.workspace.v1');
});

test('session overlay never transplants permissions from another office', () => {
  const me = {
    activeOrganizationId: 'org-b',
    organizations: [{ id: 'org-a' }, { id: 'org-b' }],
    permissions: ['org-b.only'],
    session_state: 'needs_org_selection' as const,
    redirect_to: '/select-org',
    default_route: '/dashboard',
  };
  const overlaid = overlaySessionActiveOrganization(me, 'org-a');
  assert.equal(overlaid.activeOrganizationId, 'org-b');
  assert.deepEqual(overlaid.permissions, ['org-b.only']);
  assert.equal(
    decideSessionWorkspaceApply({
      sessionActiveOrganizationId: 'org-b',
      workingOrganizationId: 'org-a',
      membershipOrgIds: ['org-a', 'org-b'],
    }),
    'mismatch',
  );
  assert.equal(
    decideSessionWorkspaceApply({
      sessionActiveOrganizationId: 'org-a',
      workingOrganizationId: 'org-a',
      membershipOrgIds: ['org-a', 'org-b'],
    }),
    'apply_session',
  );
  assert.equal(
    decideSessionWorkspaceApply({
      sessionActiveOrganizationId: 'org-b',
      workingOrganizationId: 'org-z',
      membershipOrgIds: ['org-a', 'org-b'],
    }),
    'apply_session',
  );
  assert.equal(
    decideSessionWorkspaceApply({
      sessionActiveOrganizationId: null,
      workingOrganizationId: 'org-a',
      membershipOrgIds: ['org-a'],
      sessionState: 'needs_onboarding',
    }),
    'apply_session',
  );
});

test('account switch and sign-out drop UI; token refresh of the same user does not', () => {
  assert.equal(
    classifyAuthIdentityTransition({ event: 'SIGNED_IN', previousAuthUserId: 'a', nextAuthUserId: 'b' }),
    'user_switched',
  );
  assert.equal(
    classifyAuthIdentityTransition({ event: 'SIGNED_OUT', previousAuthUserId: 'a', nextAuthUserId: null }),
    'signed_out',
  );
  assert.equal(
    classifyAuthIdentityTransition({ event: 'TOKEN_REFRESHED', previousAuthUserId: 'a', nextAuthUserId: 'a' }),
    'token_refresh_same',
  );
  assert.equal(
    classifyAuthIdentityTransition({ event: 'TOKEN_REFRESHED', previousAuthUserId: 'a', nextAuthUserId: 'b' }),
    'token_refresh_mismatch',
  );
  assert.equal(
    classifyAuthIdentityTransition({ event: 'INITIAL_SESSION', previousAuthUserId: null, nextAuthUserId: 'a' }),
    'noop',
  );
  assert.equal(shouldDropAuthenticatedUi('user_switched'), true);
  assert.equal(shouldDropAuthenticatedUi('token_refresh_same'), false);
  assert.equal(shouldRefetchSessionAfterAuthEvent('user_switched'), true);
  assert.equal(shouldRefetchSessionAfterAuthEvent('token_refresh_same'), false);
  assert.equal(
    classifyAuthIdentityTransition({ event: 'SIGNED_IN', previousAuthUserId: null, nextAuthUserId: 'b' }),
    'signed_in',
  );
  assert.equal(isStaleRequestGeneration(2, nextRequestGeneration(1)), false);
  assert.equal(shouldInvalidateInFlightSession('signed_in'), true);
  assert.equal(shouldInvalidateInFlightSession('token_refresh_same'), false);
});

test('load errors are not onboarding; primary onboarding requires backend state', () => {
  assert.equal(isPrimaryOnboardingSession('needs_onboarding'), true);
  assert.equal(isPrimaryOnboardingSession('ready'), false);
  assert.equal(isPrimaryOnboardingSession(undefined), false);
  assert.equal(
    destinationWhenOnboardingNotAllowed({ sessionState: 'ready', redirectTo: '/dashboard' }),
    '/dashboard',
  );
  assert.equal(
    destinationWhenOnboardingNotAllowed({ sessionState: 'needs_org_selection', redirectTo: '' }),
    '/select-org',
  );
  assert.equal(classifySessionFetchFailure({ status: 403, code: 'FORBIDDEN' }), 'session_error');
  assert.equal(classifySessionFetchFailure({ status: 500 }), 'session_error');
  assert.equal(classifySessionFetchFailure(new Error('network')), 'session_error');
  assert.equal(classifySessionFetchFailure({ status: 401 }), 'clear_auth');
});

test('AuthContext restores tab office without a hidden select command and does not treat session errors as missing org', () => {
  const src = readFileSync(join(dir, '../src/contexts/AuthContext.tsx'), 'utf8');
  assert.match(src, /classifyAuthIdentityTransition/);
  assert.match(src, /session_error/);
  assert.match(src, /shouldDropAuthenticatedUi/);
  assert.match(src, /decideSessionWorkspaceApply/);
  assert.match(src, /membershipOrgIds/);
  assert.match(src, /readTabWorkspace/);
  assert.match(src, /TOKEN_REFRESHED/);
  assert.doesNotMatch(src, /shouldSelectStoredTabOrganization/);
  assert.doesNotMatch(src, /overlaySessionActiveOrganization/);
  const onboarding = readFileSync(join(dir, '../src/pages/CreateOrganization.tsx'), 'utf8');
  assert.match(onboarding, /isPrimaryOnboardingState/);
  assert.match(onboarding, /PublicAuthShell/);
  assert.doesNotMatch(onboarding, /United States/);
  assert.doesNotMatch(onboarding, /useState\('US'\)/);
  const requireAuth = readFileSync(join(dir, '../src/components/guards/RequireAuth.tsx'), 'utf8');
  assert.match(requireAuth, /session_error/);
  assert.match(requireAuth, /common\.sessionError/);
  const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8')) as { auth: Record<string, string> };
  const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8')) as { auth: Record<string, string> };
  for (const key of [
    'onboardingTitle',
    'organizationName',
    'country',
    'timezone',
    'selectCountry',
    'selectTimezone',
    'createOrganization',
    'creatingOrganization',
    'organizationNameRequired',
    'countryRequired',
    'timezoneRequired',
    'createOrganizationFailed',
    'organizationCreatedSessionFailed',
  ]) {
    assert.equal(typeof en.auth[key], 'string', `missing EN auth.${key}`);
    assert.equal(typeof he.auth[key], 'string', `missing HE auth.${key}`);
  }
  assert.match(he.auth.onboardingTitle, /ארגון/);
  assert.notEqual(he.auth.createOrganization, en.auth.createOrganization);
});
