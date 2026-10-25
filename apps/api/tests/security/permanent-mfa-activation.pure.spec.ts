import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  decidePermanentMfaActivation,
  decidePrivilegedMfaFromActivation,
  decideRecoveryEnrollment,
  decideRecoveryGrantIssue,
  decideRecoveryGrantStatus,
  isMissingRelationError,
  isRecoveryDrillReady,
  parseActivationRequestId,
  permanentMfaPanelView,
  resolveActivationWrite,
  resolvePrivilegedMfaActivationState,
} from '../../src/shared/privileged-mfa-activation.pure.js';
import { generateRecoveryGrantSecret, grantSecretMatches, hashGrantSecret } from '../../src/domains/auth/mfa-recovery.pure.js';
import { decidePrivilegedMfa } from '../../src/shared/privileged-mfa.pure.js';
import { mfaPolicyView } from '../../src/domains/auth/mfa-onboarding.pure.js';

const readyActivate = {
  platformOwner: true,
  alreadyActive: false,
  assurance: 'aal2' as const,
  totpVerified: true,
  recoveryStorageReady: true,
  unusedRecoveryCount: 7,
  recoveryDrillReady: true,
};

test('activation state distinguishes pre-203, not activated, active, and unreadable', () => {
  assert.equal(
    resolvePrivilegedMfaActivationState({
      schema: 'absent',
      enforcement: 'absent',
      receipt: 'absent',
      activationAudit: 'absent',
      previous: 'not_activated',
    }),
    'not_activated',
  );
  assert.equal(
    resolvePrivilegedMfaActivationState({
      schema: 'present',
      enforcement: 'not_activated',
      receipt: 'absent',
      activationAudit: 'absent',
      previous: 'not_activated',
    }),
    'not_activated',
  );
  assert.equal(
    resolvePrivilegedMfaActivationState({
      schema: 'present',
      enforcement: 'absent',
      receipt: 'absent',
      activationAudit: 'absent',
      previous: 'not_activated',
    }),
    'not_activated',
  );
  assert.equal(
    resolvePrivilegedMfaActivationState({
      schema: 'present',
      enforcement: 'permanently_active',
      receipt: 'present',
      activationAudit: 'present',
      previous: 'not_activated',
    }),
    'permanently_active',
  );
  assert.equal(
    resolvePrivilegedMfaActivationState({
      schema: 'present',
      enforcement: 'absent',
      receipt: 'present',
      activationAudit: 'absent',
      previous: 'not_activated',
    }),
    'permanently_active',
  );
  assert.equal(
    resolvePrivilegedMfaActivationState({
      schema: 'absent',
      enforcement: 'absent',
      receipt: 'absent',
      activationAudit: 'present',
      previous: 'not_activated',
    }),
    'permanently_active',
  );
  assert.equal(
    resolvePrivilegedMfaActivationState({
      schema: 'unreadable',
      enforcement: 'unreadable',
      receipt: 'unreadable',
      activationAudit: 'unreadable',
      previous: 'permanently_active',
    }),
    'permanently_active',
  );
  assert.equal(
    resolvePrivilegedMfaActivationState({
      schema: 'present',
      enforcement: 'unreadable',
      receipt: 'absent',
      activationAudit: 'absent',
      previous: 'not_activated',
    }),
    'unreadable',
  );
});

test('1 existing MFA tables do not activate enforcement', () => {
  const tablesReady = decidePrivilegedMfa({
    enforcementRequested: true,
    recoveryReady: true,
    trustedDevicesReady: true,
    trustedDevice: false,
    assurance: 'aal1',
    privileged: true,
    enrollmentRoute: false,
  });
  assert.deepEqual(tablesReady, { outcome: 'allow' });
  assert.deepEqual(
    decidePrivilegedMfaFromActivation({
      activationState: 'not_activated',
      assurance: 'aal1',
      privileged: true,
      enrollmentRoute: false,
    }),
    { outcome: 'allow' },
  );
  const policy = mfaPolicyView({
    platformOwner: true,
    activationState: 'not_activated',
    recoveryReady: true,
    trustedDevicesReady: true,
  });
  assert.equal(policy.enforcement_active, false);
  assert.equal(policy.enforcement, 'off');
});

test('2 activation is rejected before enrollment', () => {
  assert.deepEqual(decidePermanentMfaActivation({ ...readyActivate, totpVerified: false }), {
    outcome: 'reject',
    code: 'MFA_ENROLLMENT_REQUIRED',
  });
});

test('3 activation is rejected without fresh aal2', () => {
  assert.deepEqual(decidePermanentMfaActivation({ ...readyActivate, assurance: 'aal1' }), {
    outcome: 'reject',
    code: 'MFA_RECENT_AUTH_REQUIRED',
  });
});

test('4 activation is rejected without recovery readiness', () => {
  assert.deepEqual(decidePermanentMfaActivation({ ...readyActivate, unusedRecoveryCount: 0 }), {
    outcome: 'reject',
    code: 'MFA_RECOVERY_REQUIRED',
  });
  assert.deepEqual(decidePermanentMfaActivation({ ...readyActivate, recoveryStorageReady: false, unusedRecoveryCount: 0 }), {
    outcome: 'reject',
    code: 'MFA_RECOVERY_REQUIRED',
  });
  assert.deepEqual(decidePermanentMfaActivation({ ...readyActivate, recoveryDrillReady: false }), {
    outcome: 'reject',
    code: 'MFA_RECOVERY_DRILL_REQUIRED',
  });
  assert.equal(
    isRecoveryDrillReady({ latestIssuedAt: '2026-10-24T10:00:00.000Z', latestDrillAt: '2026-10-24T09:00:00.000Z', unusedRecoveryCount: 7 }),
    false,
  );
  assert.equal(
    isRecoveryDrillReady({ latestIssuedAt: '2026-10-24T10:00:00.000Z', latestDrillAt: '2026-10-24T11:00:00.000Z', unusedRecoveryCount: 7 }),
    true,
  );
});

test('5 successful activation is persisted as permanently active', () => {
  assert.deepEqual(decidePermanentMfaActivation(readyActivate), { outcome: 'activate' });
  assert.equal(
    resolveActivationWrite({ inserted: true, uniqueViolation: false, persistedState: 'permanently_active' }),
    'activated',
  );
  const panel = permanentMfaPanelView({
    activationState: 'permanently_active',
    totpVerified: true,
    assurance: 'aal2',
    unusedRecoveryCount: 7,
    recoveryDrillReady: true,
    activatedAt: '2026-10-25T06:00:00.000Z',
  });
  assert.equal(panel.enforcement, 'PERMANENTLY_ACTIVE');
  assert.equal(panel.activate_enabled, false);
  assert.equal(panel.active_label_he, 'MFA פעיל לצמיתות');
  assert.equal(panel.activated_at, '2026-10-25T06:00:00.000Z');
});

test('6 repeated activation is safe and idempotent', () => {
  assert.deepEqual(decidePermanentMfaActivation({ ...readyActivate, alreadyActive: true }), { outcome: 'already_active' });
  assert.equal(
    resolveActivationWrite({ inserted: false, uniqueViolation: true, persistedState: 'permanently_active' }),
    'already_active',
  );
});

test('7 concurrent activation requests cannot corrupt state', () => {
  assert.equal(
    resolveActivationWrite({ inserted: false, uniqueViolation: true, persistedState: 'permanently_active' }),
    'already_active',
  );
  assert.equal(
    resolveActivationWrite({ inserted: false, uniqueViolation: true, persistedState: 'not_activated' }),
    'failed',
  );
  assert.equal(parseActivationRequestId('not-a-uuid'), null);
  assert.ok(parseActivationRequestId('2c1c7d5a-3f4e-4b8a-9c1d-8e7f6a5b4c3d'));
});

test('8 password-only privileged access is rejected after activation', () => {
  assert.deepEqual(
    decidePrivilegedMfaFromActivation({
      activationState: 'permanently_active',
      assurance: 'aal1',
      privileged: true,
      enrollmentRoute: false,
    }),
    { outcome: 'deny', code: 'MFA_REQUIRED' },
  );
  assert.deepEqual(
    decidePrivilegedMfa({
      activationState: 'permanently_active',
      trustedDevice: true,
      recoveryReady: true,
      trustedDevicesReady: true,
      assurance: 'aal1',
      privileged: true,
      enrollmentRoute: false,
    }),
    { outcome: 'deny', code: 'MFA_REQUIRED' },
  );
});

test('9 no API or UI command can deactivate enforcement', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..', '..');
  const sources = [
    readFileSync(join(root, 'apps/api/src/domains/auth/platform-owner-mfa-activation.service.ts'), 'utf8'),
    readFileSync(join(root, 'apps/api/src/routes/owner-country-pack.routes.ts'), 'utf8'),
    readFileSync(join(root, 'apps/web/src/pages/OwnerSecurityEventsPanel.tsx'), 'utf8'),
    readFileSync(join(root, 'apps/web/src/api/endpoints.ts'), 'utf8'),
  ].join('\n');
  assert.equal(sources.includes('deactivate_platform_owner_mfa'), false);
  assert.equal(sources.includes('disable_platform_owner_mfa'), false);
  const panel = permanentMfaPanelView({
    activationState: 'permanently_active',
    totpVerified: true,
    assurance: 'aal2',
    unusedRecoveryCount: 7,
    recoveryDrillReady: true,
    activatedAt: '2026-10-25T06:00:00.000Z',
  });
  assert.equal('deactivate_command' in panel, false);
  assert.equal(panel.activate_enabled, false);
});

test('10 recovery restores access without disabling MFA', () => {
  assert.deepEqual(
    decidePrivilegedMfaFromActivation({
      activationState: 'permanently_active',
      assurance: 'aal2',
      privileged: true,
      enrollmentRoute: false,
    }),
    { outcome: 'allow' },
  );
  assert.deepEqual(
    decidePrivilegedMfaFromActivation({
      activationState: 'permanently_active',
      assurance: 'aal1',
      privileged: true,
      enrollmentRoute: true,
    }),
    { outcome: 'allow' },
  );
  assert.equal(decideRecoveryGrantIssue({ permanentlyActive: true, platformOwner: true }), 'issue');
  assert.equal(decideRecoveryGrantIssue({ permanentlyActive: true, platformOwner: false }), 'skip');
  assert.equal(
    decideRecoveryEnrollment({
      permanentlyActive: true,
      platformOwner: true,
      assurance: 'aal1',
      grant: 'missing',
    }),
    'reject',
  );
  assert.equal(
    decideRecoveryEnrollment({
      permanentlyActive: true,
      platformOwner: true,
      assurance: 'aal1',
      grant: 'valid',
    }),
    'allow',
  );
  assert.equal(
    decideRecoveryEnrollment({
      permanentlyActive: true,
      platformOwner: true,
      assurance: 'aal2',
      grant: 'missing',
    }),
    'allow',
  );
  assert.equal(
    decideRecoveryGrantStatus({ consumedAt: null, expiresAt: '2026-10-25T07:00:00.000Z', now: '2026-10-25T07:01:00.000Z' }),
    'expired',
  );
  const secret = generateRecoveryGrantSecret();
  const hashed = hashGrantSecret(secret);
  assert.equal(hashed.hash.includes(secret), false);
  assert.equal(grantSecretMatches(secret, hashed.salt, hashed.hash), true);
  assert.equal(grantSecretMatches('other', hashed.salt, hashed.hash), false);
});

test('11 ordinary users remain unaffected', () => {
  assert.deepEqual(
    decidePrivilegedMfaFromActivation({
      activationState: 'permanently_active',
      assurance: 'aal1',
      privileged: false,
      enrollmentRoute: false,
    }),
    { outcome: 'allow' },
  );
  const office = mfaPolicyView({
    platformOwner: false,
    activationState: 'permanently_active',
    recoveryReady: true,
    trustedDevicesReady: true,
  });
  assert.equal(office.requirement, 'optional');
  assert.equal(office.enforcement_active, false);
  assert.equal(office.decline_allowed, true);
});

test('12 enforcement fails closed after activation when dependencies are unavailable', () => {
  assert.deepEqual(
    decidePrivilegedMfaFromActivation({
      activationState: 'unreadable',
      assurance: 'aal1',
      privileged: true,
      enrollmentRoute: false,
    }),
    { outcome: 'deny', code: 'MFA_REQUIRED' },
  );
  assert.equal(isMissingRelationError({ code: '42P01', message: 'relation does not exist' }), true);
  assert.equal(isMissingRelationError({ code: '57014', message: 'timeout' }), false);
  const panel = permanentMfaPanelView({
    activationState: 'unreadable',
    totpVerified: true,
    assurance: 'aal2',
    unusedRecoveryCount: 7,
    recoveryDrillReady: true,
    activatedAt: null,
  });
  assert.equal(panel.activate_enabled, false);
  assert.equal(panel.enforcement, 'UNREADABLE');
});
