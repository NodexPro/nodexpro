import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyCommandResultApply,
  classifyUnauthorizedRetry,
  classifyWorkspaceApplyDecision,
  sessionAccessTokenNeedsRefresh,
  shouldClearLocalAuthSession,
} from '../src/lib/session-auth-failure.pure.ts';
import { classifySessionFetchFailure } from '../src/lib/onboarding-session-route.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

test('401 USER_NOT_ACTIVE and generic 401 clear leftover JWT; other errors do not', () => {
  assert.equal(shouldClearLocalAuthSession({ status: 401, code: 'USER_NOT_ACTIVE' }), true);
  assert.equal(shouldClearLocalAuthSession({ status: 401, code: 'LOGIN_CHALLENGE_REQUIRED' }), false);
  assert.equal(shouldClearLocalAuthSession({ status: 401, code: 'UNAUTHORIZED' }), true);
  assert.equal(shouldClearLocalAuthSession({ status: 401 }), true);
  assert.equal(shouldClearLocalAuthSession({ status: 403, code: 'FORBIDDEN' }), false);
  assert.equal(shouldClearLocalAuthSession({ status: 500 }), false);
  assert.equal(shouldClearLocalAuthSession(new Error('network')), false);
  assert.equal(shouldClearLocalAuthSession(null), false);
});

test('AuthContext signs out local Supabase session only on session-auth failure', () => {
  const src = readFileSync(join(dir, '../src/contexts/AuthContext.tsx'), 'utf8');
  assert.match(src, /classifySessionFetchFailure/);
  assert.match(src, /supabase\.auth\.signOut\(\)/);
  assert.match(src, /setBackendActiveOrganizationId\(null\)/);
  assert.match(src, /TOKEN_REFRESHED/);
  assert.match(src, /session_error/);
  assert.match(src, /isStaleWorkspaceError/);
});

test('401 during token refresh retries; confirmed expiry clears; MFA challenge is not logout', () => {
  assert.equal(sessionAccessTokenNeedsRefresh(100, 100_000, 15_000), true);
  assert.equal(sessionAccessTokenNeedsRefresh(200, 100_000, 15_000), false);
  assert.equal(sessionAccessTokenNeedsRefresh(null, 100_000), false);
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
      alreadyRetried: false,
      refreshReturnedSession: false,
      refreshFailedTransient: true,
    }),
    'transient_refresh',
  );
  assert.equal(
    classifyUnauthorizedRetry({
      status: 401,
      alreadyRetried: true,
      refreshReturnedSession: false,
    }),
    'clear_auth',
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
  assert.equal(
    classifyUnauthorizedRetry({
      status: 401,
      code: 'USER_NOT_ACTIVE',
      alreadyRetried: false,
      refreshReturnedSession: true,
    }),
    'clear_auth',
  );
  const transient = new Error('Token refresh failed');
  transient.name = 'TokenRefreshError';
  assert.equal(classifySessionFetchFailure(transient), 'session_error');
  assert.equal(classifySessionFetchFailure({ status: 401 }), 'clear_auth');
  const client = readFileSync(join(dir, '../src/api/client.ts'), 'utf8');
  assert.match(client, /classifyUnauthorizedRetry/);
  assert.match(client, /sessionAccessTokenNeedsRefresh/);
  assert.match(client, /TokenRefreshError/);
  assert.match(client, /decision === 'clear_auth'/);
  assert.match(client, /supabase\.auth\.signOut\(\)/);
});

test('stale GET or command results are not applied after user/org change', () => {
  assert.equal(classifyWorkspaceApplyDecision({ startedGeneration: 1, currentGeneration: 1 }), 'apply');
  assert.equal(classifyWorkspaceApplyDecision({ startedGeneration: 1, currentGeneration: 2 }), 'discard_stale');
  assert.equal(
    classifyCommandResultApply({
      startedGeneration: 3,
      currentGeneration: 3,
      commandUserId: 'u1',
      currentUserId: 'u1',
      commandOrganizationId: 'org-a',
      currentOrganizationId: 'org-a',
    }),
    'apply',
  );
  assert.equal(
    classifyCommandResultApply({
      startedGeneration: 3,
      currentGeneration: 3,
      commandUserId: 'u1',
      currentUserId: 'u2',
      commandOrganizationId: 'org-a',
      currentOrganizationId: 'org-a',
    }),
    'discard_stale',
  );
  assert.equal(
    classifyCommandResultApply({
      startedGeneration: 3,
      currentGeneration: 3,
      commandUserId: 'u1',
      currentUserId: 'u1',
      commandOrganizationId: 'org-a',
      currentOrganizationId: 'org-b',
    }),
    'discard_stale',
  );
  const stale = new Error('Workspace changed');
  stale.name = 'StaleWorkspaceError';
  assert.equal(classifySessionFetchFailure(stale), 'ignore');
});
