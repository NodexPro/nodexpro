import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const auth = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/middleware/auth.ts'),
  'utf8',
);

test('auth getUser is live on every request — revoked sessions are not cached', () => {
  assert.match(auth, /supabaseAuth\.auth\.getUser\(token\)/);
  assert.doesNotMatch(auth, /getUserCache|AUTH_GET_USER_CACHE|rememberAuthUser|isFreshAuthGetUserCache/);
});
