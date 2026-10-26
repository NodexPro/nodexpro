import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldClearLocalAuthSession } from '../src/lib/session-auth-failure.pure.ts';

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
  assert.match(src, /shouldClearLocalAuthSession/);
  assert.match(src, /supabase\.auth\.signOut\(\)/);
  assert.match(src, /setBackendActiveOrganizationId\(null\)/);
  assert.match(src, /Token refresh should not force a \/auth\/session refetch/);
});
