import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPasswordRecoveryLocation,
  passwordRecoveryCallbackError,
} from '../src/lib/password-recovery.ts';

test('detects implicit recovery hash and query type', () => {
  assert.equal(isPasswordRecoveryLocation('', '#access_token=abc&type=recovery'), true);
  assert.equal(isPasswordRecoveryLocation('?type=recovery', ''), true);
  assert.equal(isPasswordRecoveryLocation('?code=pkce', ''), false);
  assert.equal(isPasswordRecoveryLocation('', '#access_token=abc&type=signup'), false);
});

test('reads recovery callback errors from hash or query', () => {
  assert.equal(
    passwordRecoveryCallbackError('', '#error=access_denied&error_description=Redirect%20not%20allowed'),
    'Redirect not allowed',
  );
  assert.equal(passwordRecoveryCallbackError('?error=otp_expired', ''), 'otp_expired');
  assert.equal(passwordRecoveryCallbackError('', ''), null);
});
