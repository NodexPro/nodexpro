/**
 * Two independent tab contexts sharing one Supabase JWT store.
 * These are isolation tests, not a full browser E2E.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearTabWorkspace,
  decideSessionWorkspaceApply,
  overlaySessionActiveOrganization,
  readTabWorkspace,
  simulateTwoTabWorkspaces,
  writeTabWorkspace,
} from '../src/lib/tab-workspace.pure.ts';
import {
  classifyAuthIdentityTransition,
  shouldDropAuthenticatedUi,
} from '../src/lib/auth-identity-transition.pure.ts';
import {
  classifyCommandResultApply,
  classifyWorkspaceApplyDecision,
} from '../src/lib/session-auth-failure.pure.ts';

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

test('two tab sessionStorages keep separate offices while sharing one JWT', () => {
  const sharedAuthStorage = new Map<string, string>([['sb-auth-token', 'jwt-user-1']]);
  const tabA = memory();
  const tabB = memory();
  writeTabWorkspace(tabA, 'u1', 'org-a');
  writeTabWorkspace(tabB, 'u1', 'org-b');
  const pair = simulateTwoTabWorkspaces({
    userId: 'u1',
    tabAOrganizationId: 'org-a',
    tabBOrganizationId: 'org-b',
  });
  assert.equal(readTabWorkspace(tabA)?.organizationId, pair.tabA.organizationId);
  assert.equal(readTabWorkspace(tabB)?.organizationId, pair.tabB.organizationId);
  assert.notEqual(readTabWorkspace(tabA)?.organizationId, readTabWorkspace(tabB)?.organizationId);
  assert.equal(sharedAuthStorage.get('sb-auth-token'), 'jwt-user-1');
  const sessionA = {
    activeOrganizationId: 'org-a',
    organizations: [{ id: 'org-a' }, { id: 'org-b' }],
    permissions: ['fees.read'],
  };
  const sessionB = {
    activeOrganizationId: 'org-b',
    organizations: [{ id: 'org-a' }, { id: 'org-b' }],
    permissions: ['settings.write'],
  };
  assert.equal(
    decideSessionWorkspaceApply({
      sessionActiveOrganizationId: sessionB.activeOrganizationId,
      workingOrganizationId: readTabWorkspace(tabA)?.organizationId,
      membershipOrgIds: ['org-a', 'org-b'],
    }),
    'mismatch',
  );
  const mixed = overlaySessionActiveOrganization(sessionB, 'org-a');
  assert.equal(mixed.activeOrganizationId, 'org-b');
  assert.deepEqual(mixed.permissions, ['settings.write']);
  assert.notEqual(sessionA.permissions[0], sessionB.permissions[0]);
});

test('late GET or command after office/user/logout is discarded, not painted on the new workspace', () => {
  assert.equal(classifyWorkspaceApplyDecision({ startedGeneration: 4, currentGeneration: 5 }), 'discard_stale');
  assert.equal(
    classifyCommandResultApply({
      startedGeneration: 8,
      currentGeneration: 8,
      commandUserId: 'u1',
      currentUserId: 'u1',
      commandOrganizationId: 'org-a',
      currentOrganizationId: 'org-a',
    }),
    'apply',
  );
  assert.equal(
    classifyCommandResultApply({
      startedGeneration: 8,
      currentGeneration: 8,
      commandUserId: 'u1',
      currentUserId: 'u1',
      commandOrganizationId: 'org-a',
      currentOrganizationId: 'org-b',
    }),
    'discard_stale',
  );
  assert.equal(
    classifyAuthIdentityTransition({
      event: 'SIGNED_IN',
      previousAuthUserId: 'u1',
      nextAuthUserId: 'u2',
    }),
    'user_switched',
  );
  assert.equal(shouldDropAuthenticatedUi('user_switched'), true);
  assert.equal(shouldDropAuthenticatedUi('signed_out'), true);
  const tabA = memory();
  writeTabWorkspace(tabA, 'u1', 'org-a');
  clearTabWorkspace(tabA);
  assert.equal(readTabWorkspace(tabA), null);
});

test('AuthContext and apiJson drop stale workspace payloads after identity or office change', () => {
  const auth = readFileSync(join(dir, '../src/contexts/AuthContext.tsx'), 'utf8');
  const client = readFileSync(join(dir, '../src/api/client.ts'), 'utf8');
  const orgContext = readFileSync(join(dir, '../src/api/org-context.ts'), 'utf8');
  const login = readFileSync(join(dir, '../src/pages/Login.tsx'), 'utf8');
  assert.match(auth, /isStaleRequestGeneration/);
  assert.match(auth, /isStaleWorkspaceError/);
  assert.match(auth, /dropAuthenticatedWorkspace/);
  assert.match(auth, /clearTabWorkspace/);
  assert.match(auth, /shouldApplyOfficeSwitchAggregate/);
  assert.match(auth, /drainOfficeSwitch/);
  assert.match(client, /StaleWorkspaceError/);
  assert.match(client, /getWorkspaceGeneration/);
  assert.match(orgContext, /workspaceGeneration \+= 1/);
  assert.match(orgContext, /bumpWorkspaceGeneration/);
  assert.match(login, /clearTabWorkspace/);
  assert.match(auth, /shouldInvalidateInFlightSession/);
  assert.match(login, /loginUiErrorAfterRefetch/);
});
