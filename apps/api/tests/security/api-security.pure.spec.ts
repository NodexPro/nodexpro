import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyApiRequest,
  ENUMERATION_SAFE_LOGIN_MESSAGE,
  ENUMERATION_SAFE_REGISTER_MESSAGE,
  officeSharedNatWouldLock,
  quotaForSecurityClass,
  requestExceedsClassSize,
} from '../../src/shared/api-security.pure.js';

test('classifies auth, mfa, upload and sensitive commands with fail-closed quotas', () => {
  assert.equal(classifyApiRequest('POST', '/api/v1/auth/login'), 'auth');
  assert.equal(classifyApiRequest('POST', '/api/v1/auth/commands/verify_mfa'), 'mfa');
  assert.equal(classifyApiRequest('POST', '/api/v1/organizations/x/documents'), 'upload');
  assert.equal(classifyApiRequest('POST', '/api/v1/organizations/x/commands/change_user_role'), 'sensitive_command');
  assert.equal(classifyApiRequest('GET', '/api/v1/health'), 'health');
  assert.equal(quotaForSecurityClass('auth').failClosed, true);
  assert.equal(quotaForSecurityClass('upload').maxBytes > 20 * 1024 * 1024, true);
  assert.equal(quotaForSecurityClass('standard').failClosed, false);
});

test('size guard and office NAT lockout stay conservative', () => {
  assert.equal(requestExceedsClassSize(100, 50), true);
  assert.equal(requestExceedsClassSize(null, 50), false);
  assert.equal(officeSharedNatWouldLock({ uniqueActorsInWindow: 8, sourceScope: 'source_ip' }), true);
  assert.equal(officeSharedNatWouldLock({ uniqueActorsInWindow: 8, sourceScope: 'user' }), false);
  assert.equal(ENUMERATION_SAFE_LOGIN_MESSAGE.includes('email'), true);
  assert.equal(ENUMERATION_SAFE_REGISTER_MESSAGE.includes('already'), false);
});
