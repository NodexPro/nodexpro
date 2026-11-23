import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  confirmationEmailAddress,
  fillRegisteredEmail,
  isEmailNotConfirmedCode,
  signupNeedsEmailConfirmation,
} from '../src/lib/register-email-confirmation.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('confirmation modal is shown only after a successful signup without a session', () => {
  assert.equal(signupNeedsEmailConfirmation({ registerSucceeded: true, session: null }), true);
  assert.equal(signupNeedsEmailConfirmation({ registerSucceeded: true, session: { access_token: 'x' } }), false);
  assert.equal(signupNeedsEmailConfirmation({ registerSucceeded: false, session: null }), false);
  assert.equal(confirmationEmailAddress('  a@b.com ', 'A@B.COM'), 'A@B.COM');
  assert.equal(confirmationEmailAddress('a@b.com', null), 'a@b.com');
  assert.equal(fillRegisteredEmail('sent to {email}', 'a@b.com'), 'sent to a@b.com');
  assert.equal(isEmailNotConfirmedCode('EMAIL_NOT_CONFIRMED'), true);
});

test('Register does not show a sent-mail modal on API failure and does not leak raw Supabase errors', () => {
  const register = read('../src/pages/Register.tsx');
  const he = JSON.parse(read('../src/i18n/he.json')) as { auth: Record<string, string> };
  const en = JSON.parse(read('../src/i18n/en.json')) as { auth: Record<string, string> };
  assert.match(register, /signupNeedsEmailConfirmation/);
  assert.match(register, /GlassModal/);
  assert.match(register, /nx-register-confirm-email/);
  assert.match(register, /to=\{loginTo\}/);
  assert.match(register, /t\('auth.registerFailed'\)/);
  assert.match(register, /language_code: lang/);
  assert.match(register, /fillRegisteredEmail/);
  assert.doesNotMatch(register, /setError\((err|signInError)\.message/);
  assert.match(register, /t\('auth.registerFailed'\)/);
  assert.match(he.auth.confirmEmailBody, /שלחנו מייל לכתובת \{email\}/);
  assert.match(he.auth.confirmEmailBody, /כניסה/);
  assert.match(en.auth.confirmEmailBody, /We sent an email to \{email\}/);
  assert.match(en.auth.goToSignIn, /sign in/i);
  assert.match(he.auth.confirmEmailTitle, /אישור/);
});
