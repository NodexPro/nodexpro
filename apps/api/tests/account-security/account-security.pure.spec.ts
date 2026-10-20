import test from 'node:test';
import assert from 'node:assert/strict';
import {
  additionalEmailAllowedActions,
  canReplaceAdditionalEmail,
  canRequestAdditionalEmail,
  resolveCanonicalLoginEmail,
  validateNewPassword,
} from '../../src/domains/account-security/account-security.pure.js';

test('canonical login maps verified secondary to primary without leaking when unmatched', () => {
  assert.equal(
    resolveCanonicalLoginEmail({
      identifier: 'alias@example.com',
      verifiedSecondary: { email: 'alias@example.com', primaryEmail: 'owner@example.com' },
    }),
    'owner@example.com',
  );
  assert.equal(
    resolveCanonicalLoginEmail({
      identifier: 'unknown@example.com',
      verifiedSecondary: { email: 'alias@example.com', primaryEmail: 'owner@example.com' },
    }),
    'unknown@example.com',
  );
});

test('additional email uniqueness and one-secondary limit', () => {
  const base = {
    primaryEmail: 'owner@example.com',
    requestedEmail: 'alias@example.com',
    emailsRegisteredToOtherAccounts: [] as string[],
  };
  assert.equal(canRequestAdditionalEmail({ ...base, existing: [] }).ok, true);
  assert.equal(
    canRequestAdditionalEmail({
      ...base,
      existing: [{ email: 'alias@example.com', status: 'pending_verification' }],
    }).ok,
    false,
  );
  assert.equal(
    canRequestAdditionalEmail({
      ...base,
      requestedEmail: 'taken@example.com',
      existing: [],
      emailsRegisteredToOtherAccounts: ['taken@example.com'],
    }).ok,
    false,
  );
  assert.equal(
    canReplaceAdditionalEmail({
      ...base,
      existing: [{ email: 'old@example.com', status: 'verified' }],
    }).ok,
    true,
  );
  assert.equal(
    canReplaceAdditionalEmail({
      ...base,
      existing: [
        { email: 'old@example.com', status: 'verified' },
        { email: 'new@example.com', status: 'pending_replacement' },
      ],
    }).ok,
    false,
  );
});

test('password validation rejects short secrets and allowed actions stay coherent', () => {
  assert.ok(validateNewPassword('short'));
  assert.equal(validateNewPassword('long-enough-password'), null);
  assert.deepEqual(additionalEmailAllowedActions([]), ['request_additional_login_email']);
  assert.ok(
    additionalEmailAllowedActions([{ email: 'a@b.c', status: 'verified' }]).includes('replace_additional_login_email'),
  );
});
