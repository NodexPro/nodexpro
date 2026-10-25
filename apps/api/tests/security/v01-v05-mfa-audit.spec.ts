import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePrivilegedMfa, isOfficePrivilegedRole, readAuthenticatorAssurance } from '../../src/shared/privileged-mfa.pure.js';
import { decideSecurityRecord, safeSecurityPayload, securityActionForStatus } from '../../src/shared/security-event.pure.js';
import { decideSecurityAlert } from '../../src/shared/security-alert.pure.js';

const readyGate = {
  activationState: 'permanently_active' as const,
  enforcementRequested: true,
  recoveryReady: true,
  trustedDevicesReady: true,
  trustedDevice: false,
  assurance: 'aal1' as const,
  privileged: true,
  enrollmentRoute: false,
};

test('platform-owner aal1 is denied only after permanent activation', () => {
  assert.equal(isOfficePrivilegedRole('owner'), false);
  assert.equal(isOfficePrivilegedRole('admin'), false);
  assert.equal(isOfficePrivilegedRole('staff'), false);
  assert.deepEqual(decidePrivilegedMfa({ ...readyGate, activationState: 'not_activated' }), { outcome: 'allow' });
  assert.deepEqual(decidePrivilegedMfa(readyGate), { outcome: 'deny', code: 'MFA_REQUIRED' });
  assert.deepEqual(decidePrivilegedMfa({ ...readyGate, assurance: 'aal2' }), { outcome: 'allow' });
  assert.deepEqual(decidePrivilegedMfa({ ...readyGate, trustedDevice: true }), { outcome: 'deny', code: 'MFA_REQUIRED' });
  assert.deepEqual(decidePrivilegedMfa({ ...readyGate, recoveryReady: false }), { outcome: 'deny', code: 'MFA_REQUIRED' });
  assert.deepEqual(decidePrivilegedMfa({ ...readyGate, privileged: false }), { outcome: 'allow' });
  assert.deepEqual(decidePrivilegedMfa({ ...readyGate, enrollmentRoute: true }), { outcome: 'allow' });
  assert.deepEqual(decidePrivilegedMfa({ ...readyGate, enforcementRequested: false }), { outcome: 'deny', code: 'MFA_REQUIRED' });
});

test('verified JWT aal2 is recognized and everything else stays aal1', () => {
  const payload = Buffer.from(JSON.stringify({ aal: 'aal2', role: 'authenticated' })).toString('base64url');
  assert.equal(readAuthenticatorAssurance(`h.${payload}.s`), 'aal2');
  assert.equal(readAuthenticatorAssurance('not-a-jwt'), 'aal1');
});

test('security payloads drop secrets and repeated attempts collapse', () => {
  const safe = safeSecurityPayload({
    http_status: 401,
    code: 'UNAUTHORIZED',
    email: 'person@example.test',
    storage_key: 'secret/path',
    note: 'Bearer eyJabc.def.ghi',
  });
  assert.deepEqual(safe, { http_status: 401, code: 'UNAUTHORIZED' });
  assert.equal(securityActionForStatus(401, 'USER_NOT_ACTIVE'), 'security.account_inactive');
  assert.equal(securityActionForStatus(401, 'MFA_REQUIRED'), 'security.privileged_mfa_failed');
  assert.equal(securityActionForStatus(403, 'FORBIDDEN'), 'security.forbidden');
  assert.equal(securityActionForStatus(400, 'BAD_REQUEST'), null);
  assert.equal(decideSecurityRecord(1, 'security.login_failed').record, true);
  assert.equal(decideSecurityRecord(3, 'security.login_failed').record, false);
  assert.equal(decideSecurityRecord(5, 'security.login_failed').action, 'security.suspicious_repeated');
});

test('alert delivery stays blocked until a destination is configured', () => {
  assert.deepEqual(decideSecurityAlert(null), { deliver: false, reason: 'destination_not_configured' });
  assert.deepEqual(decideSecurityAlert('  '), { deliver: false, reason: 'destination_not_configured' });
  assert.equal(decideSecurityAlert('https://alerts.example.test/hook').deliver, true);
});
