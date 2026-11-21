import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginMfaFormVisible, shouldAttachOrganizationHeader } from '../src/lib/login-mfa-challenge.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('ordinary new user without MFA does not see the authenticator form', () => {
  assert.equal(loginMfaFormVisible({}), false);
  assert.equal(loginMfaFormVisible({ loginChallengeRequired: false, sessionState: 'ready' }), false);
  assert.equal(loginMfaFormVisible({ loginChallengeRequired: false, sessionState: 'needs_onboarding' }), false);
  assert.equal(loginMfaFormVisible({ sessionState: null }), false);
  assert.equal(shouldAttachOrganizationHeader('/auth/session'), false);
  assert.equal(shouldAttachOrganizationHeader('/auth/me'), false);
});

test('enabled MFA shows the code form only after backend challenge truth', () => {
  assert.equal(loginMfaFormVisible({ loginChallengeRequired: true }), true);
  assert.equal(loginMfaFormVisible({ sessionState: 'mfa_challenge' }), true);
  assert.equal(loginMfaFormVisible({ sessionChallengeRequired: true }), true);
  assert.equal(loginMfaFormVisible({ loginChallengeRequired: false, sessionState: 'ready', sessionChallengeRequired: false }), false);
});

test('pending enrollment and missing session are not treated as an MFA challenge', () => {
  assert.equal(loginMfaFormVisible({ loginChallengeRequired: false, sessionState: 'ready', sessionChallengeRequired: false }), false);
  const login = read('../src/pages/Login.tsx');
  const owner = read('../src/pages/PlatformOwnerLogin.tsx');
  const client = read('../src/api/client.ts');
  assert.match(login, /loginMfaFormVisible/);
  assert.equal(login.includes('if (!me || me.session_state === \'mfa_challenge\')'), false);
  assert.match(login, /access_token/);
  assert.match(owner, /loginMfaFormVisible/);
  assert.match(client, /shouldAttachOrganizationHeader/);
});

test('Platform Owner MFA form follows the same backend challenge flag', () => {
  assert.equal(loginMfaFormVisible({ sessionState: 'platform_owner' }), false);
  assert.equal(loginMfaFormVisible({ sessionState: 'mfa_challenge', sessionChallengeRequired: true }), true);
  assert.equal(shouldAttachOrganizationHeader('/auth/commands/verify_mfa'), false);
  assert.equal(shouldAttachOrganizationHeader('/owner/session'), false);
  assert.equal(shouldAttachOrganizationHeader('/clients'), true);
});
