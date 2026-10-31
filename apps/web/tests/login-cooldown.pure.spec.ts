import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loginChallengeFromResponse,
  loginCooldownMessage,
  loginFailureCode,
  loginSecurityText,
  loginUiLang,
  offerRecoveryFromFailure,
  readLoginStamp,
  remainingCooldownSeconds,
  retryAfterSecondsFromFailure,
} from '../src/lib/login-cooldown.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('login security messages follow English, Hebrew and Russian catalogs', () => {
  assert.equal(loginUiLang('he'), 'he');
  assert.equal(loginUiLang('ru'), 'ru');
  assert.equal(loginUiLang('en'), 'en');
  assert.match(loginCooldownMessage(180, 'en'), /Please wait 180 seconds/);
  assert.match(loginCooldownMessage(180, 'he'), /המתינו 180 שניות/);
  assert.match(loginCooldownMessage(180, 'ru'), /Подождите 180 сек/);
  assert.equal(loginSecurityText('en', 'invalidCredentials'), 'Invalid email or password');
  assert.equal(loginSecurityText('he', 'invalidCredentials'), 'אימייל או סיסמה שגויים');
  assert.equal(loginSecurityText('ru', 'invalidCredentials'), 'Неверный email или пароль');
  assert.match(loginSecurityText('he', 'mfaChallenge'), /קוד המאמת/);
  assert.match(loginSecurityText('ru', 'mfaChallenge'), /аутентификатора/);
  assert.equal(loginCooldownMessage(180, 'en').includes('Слишком'), false);
});

test('login cooldown uses backend Retry-After and keeps a stable browser stamp', () => {
  assert.equal(retryAfterSecondsFromFailure({ status: 400, retryAfter: 180 }), 0);
  assert.equal(retryAfterSecondsFromFailure({ status: 429, retryAfter: 180 }), 180);
  assert.equal(loginFailureCode({ code: 'INVALID_CREDENTIALS', status: 400 }), 'INVALID_CREDENTIALS');
  assert.equal(loginFailureCode({ code: 'TOO_MANY_REQUESTS', status: 429 }), 'TOO_MANY_REQUESTS');
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
  const routes = read('../../api/src/domains/auth/auth.routes.ts');
  assert.match(login, /retryAfterSecondsFromFailure/);
  assert.match(login, /loginCooldownMessage/);
  assert.match(login, /useI18n/);
  assert.match(login, /PublicAuthShell/);
  assert.match(read('../src/components/auth/PublicAuthShell.tsx'), /dir=\{dir\}/);
  assert.match(owner, /signInWithIdentifier/);
  assert.equal(owner.includes('signInWithPassword'), false);
  assert.equal(owner.includes('Enter the SMS code'), false);
  assert.match(signIn, /x-nodexpro-login-stamp/);
  assert.match(signIn, /AUTH\.login/);
  assert.match(login, /offerRecoveryFromFailure/);
  assert.match(login, /auth.recoveryPrompt/);
  assert.match(login, /challengeRequired/);
  assert.match(login, /verify_mfa/);
  assert.match(routes, /sharedLoginRateLimit/);
  assert.match(routes, /INVALID_CREDENTIALS/);
  assert.equal(routes.includes('Слишком много'), false);
  assert.equal(offerRecoveryFromFailure({ offerRecovery: true }), true);
  assert.equal(offerRecoveryFromFailure({ offerRecovery: false }), false);
  assert.equal(loginChallengeFromResponse({ required: true, command: 'verify_mfa' }).required, true);
});
