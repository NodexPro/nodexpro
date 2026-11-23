import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authConfirmPublicState,
  destinationAfterAuthConfirm,
  isRecoveryAuthConfirmType,
  loginShowsEmailConfirmed,
  parseAuthConfirmLocation,
  recoveryHandoffHref,
  stripAuthSensitiveUrl,
} from '../src/lib/auth-confirm.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('auth confirm parser never exposes tokens in the public state', () => {
  const parsed = parseAuthConfirmLocation(
    '?token_hash=secret-hash&type=signup&code=pkce-code&error_code=',
    '#access_token=secret-token&type=signup',
  );
  assert.equal(parsed.type, 'signup');
  assert.equal(parsed.tokenHash, 'secret-hash');
  assert.equal(parsed.code, 'pkce-code');
  const publicState = authConfirmPublicState(parsed);
  assert.deepEqual(publicState, { hasTokenHash: true, hasCode: true, hasError: false, type: 'signup' });
  assert.equal(JSON.stringify(publicState).includes('secret'), false);
  assert.equal(loginShowsEmailConfirmed('?confirmed=1'), true);
  assert.equal(loginShowsEmailConfirmed('?confirmed=0'), false);
  assert.equal(destinationAfterAuthConfirm('signup'), '/login?confirmed=1');
  assert.equal(destinationAfterAuthConfirm('recovery'), '/reset-password');
  assert.equal(isRecoveryAuthConfirmType('recovery'), true);
  assert.equal(
    stripAuthSensitiveUrl('https://www.nodexpro.com/auth/confirm?token_hash=secret-hash&type=signup#access_token=x'),
    'https://www.nodexpro.com/auth/confirm',
  );
  assert.equal(
    recoveryHandoffHref('?code=pkce-code', '#type=recovery'),
    '/reset-password?code=pkce-code#type=recovery',
  );
});

test('Auth confirm page and login banner keep HE/EN registration modal and do not log tokens', () => {
  const confirmPage = read('../src/pages/AuthConfirm.tsx');
  const login = read('../src/pages/Login.tsx');
  const app = read('../src/App.tsx');
  const register = read('../src/pages/Register.tsx');
  const en = JSON.parse(read('../src/i18n/en.json')) as { auth: Record<string, string> };
  const he = JSON.parse(read('../src/i18n/he.json')) as { auth: Record<string, string> };
  assert.match(app, /path="\/auth\/confirm"/);
  assert.match(app, /path="\/auth\/callback"/);
  assert.match(login, /loginShowsEmailConfirmed/);
  assert.match(login, /auth\.emailConfirmed/);
  assert.match(register, /nx-register-confirm-email/);
  assert.match(register, /language_code: lang/);
  assert.doesNotMatch(confirmPage, /console\.(log|info|debug|warn)/);
  assert.match(confirmPage, /authConfirmPublicState/);
  assert.match(confirmPage, /recoveryHandoffHref/);
  assert.match(confirmPage, /verifyOtp/);
  assert.match(en.auth.emailConfirmed, /Email confirmed/i);
  assert.match(he.auth.emailConfirmed, /אושר/);
  assert.match(he.auth.confirmEmailBody, /שלחנו מייל לכתובת \{email\}/);
});
