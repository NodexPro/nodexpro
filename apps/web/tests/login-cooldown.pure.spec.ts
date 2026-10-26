import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loginChallengeFromResponse,
  loginCooldownMessage,
  offerRecoveryFromFailure,
  readLoginStamp,
  remainingCooldownSeconds,
  retryAfterSecondsFromFailure,
} from '../src/lib/login-cooldown.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('login cooldown uses backend Retry-After and keeps a stable browser stamp', () => {
  assert.equal(retryAfterSecondsFromFailure({ status: 400, retryAfter: 180 }), 0);
  assert.equal(retryAfterSecondsFromFailure({ status: 429, retryAfter: 180 }), 180);
  assert.match(loginCooldownMessage(180), /Подождите 180 сек/);
  assert.match(loginCooldownMessage(180), /Please wait 180 seconds/);
  assert.equal(remainingCooldownSeconds(Date.now() + 2500, Date.now()), 3);
  const storage = new Map<string, string>();
  const first = readLoginStamp({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
  });
  const second = readLoginStamp({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
  });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{32}$/);
});

test('login pages render backend cooldown and do not sign in around the API', () => {
  const login = read('../src/pages/Login.tsx');
  const owner = read('../src/pages/PlatformOwnerLogin.tsx');
  const signIn = read('../src/lib/sign-in-with-identifier.ts');
  assert.match(login, /retryAfterSecondsFromFailure/);
  assert.match(login, /loginCooldownMessage/);
  assert.match(owner, /signInWithIdentifier/);
  assert.equal(owner.includes('signInWithPassword'), false);
  assert.equal(owner.includes('Enter the SMS code'), false);
  assert.match(signIn, /x-nodexpro-login-stamp/);
  assert.match(signIn, /AUTH\.login/);
  assert.match(login, /offerRecoveryFromFailure/);
  assert.match(login, /Forgot password/);
  assert.match(login, /challengeRequired/);
  assert.match(login, /verify_mfa/);
  assert.equal(offerRecoveryFromFailure({ offerRecovery: true }), true);
  assert.equal(offerRecoveryFromFailure({ offerRecovery: false }), false);
  assert.equal(loginChallengeFromResponse({ required: true, command: 'verify_mfa' }).required, true);
});
