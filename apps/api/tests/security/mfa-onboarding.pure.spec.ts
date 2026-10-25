import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePrivilegedMfa } from '../../src/shared/privileged-mfa.pure.js';
import {
  MFA_PROMPT_WARNING_VERSION,
  mfaOnboardingView,
  mfaPolicyView,
  mfaPromptCopy,
  mfaPromptVisibility,
  nextCommandsForMfaPrompt,
  parseMfaPromptDecision,
} from '../../src/domains/auth/mfa-onboarding.pure.js';
import { generateRecoveryCode, hashRecoveryCode, recoveryCodeMatches, recoveryConsumeDecision } from '../../src/domains/auth/mfa-recovery.pure.js';
import { clientDeviceFlagIsIgnored, deviceCredentialFromCookie, hashDeviceCredential, trustedDeviceState } from '../../src/domains/auth/mfa-trusted-device.pure.js';

const copy = mfaPromptCopy();

test('the first-login prompt is shown once, and a recorded decision or a verified factor hides it', () => {
  assert.equal(mfaPromptVisibility({ verifiedFactor: false, recordedWarningVersion: null }), true);
  assert.equal(mfaPromptVisibility({ verifiedFactor: false, recordedWarningVersion: MFA_PROMPT_WARNING_VERSION }), false);
  assert.equal(mfaPromptVisibility({ verifiedFactor: false, recordedWarningVersion: 'older-version' }), true);
  assert.equal(mfaPromptVisibility({ verifiedFactor: true, recordedWarningVersion: null }), false);
});

test('accept leads to enrollment and decline does not enable MFA or waive liability', () => {
  assert.deepEqual(nextCommandsForMfaPrompt('accept'), ['enroll_mfa']);
  assert.deepEqual(nextCommandsForMfaPrompt('decline'), []);
  assert.equal(parseMfaPromptDecision('accept'), 'accept');
  assert.equal(parseMfaPromptDecision('decline'), 'decline');
  assert.equal(parseMfaPromptDecision('waive'), null);
  assert.equal(copy.liability_waiver, false);
  assert.equal(copy.accept_label_he, 'הפעלת אימות דו־שלבי');
  assert.equal(copy.decline_label_he, 'לא עכשיו');
  assert.equal(copy.section_he, 'אבטחה');
});

test('a declined prompt does not change the platform-owner MFA decision', () => {
  const enforced = {
    activationState: 'permanently_active' as const,
    enforcementRequested: true,
    recoveryReady: true,
    trustedDevicesReady: true,
    trustedDevice: false,
    assurance: 'aal1' as const,
    privileged: true,
    enrollmentRoute: false,
  };
  const hidden = mfaPromptVisibility({ verifiedFactor: false, recordedWarningVersion: MFA_PROMPT_WARNING_VERSION });
  assert.equal(hidden, false);
  assert.deepEqual(decidePrivilegedMfa(enforced), { outcome: 'deny', code: 'MFA_REQUIRED' });
  assert.deepEqual(decidePrivilegedMfa({ ...enforced, privileged: false }), { outcome: 'allow' });
  assert.deepEqual(decidePrivilegedMfa({ ...enforced, activationState: 'not_activated', suspiciousSignIn: true, trustedDevice: true }), { outcome: 'deny', code: 'MFA_REQUIRED' });
  assert.deepEqual(decidePrivilegedMfa({ ...enforced, activationState: 'not_activated', suspiciousSignIn: true, privileged: false }), { outcome: 'allow' });
  assert.deepEqual(decidePrivilegedMfa({ ...enforced, suspiciousSignIn: true, assurance: 'aal2' }), { outcome: 'allow' });
  assert.deepEqual(decidePrivilegedMfa({ ...enforced, activationState: 'not_activated' }), { outcome: 'allow' });
  assert.deepEqual(decidePrivilegedMfa({ ...enforced, trustedDevice: true }), { outcome: 'deny', code: 'MFA_REQUIRED' });
});

test('office roles stay optional and a client device flag is ignored', () => {
  const office = mfaPolicyView({
    platformOwner: false,
    activationState: 'permanently_active',
    recoveryReady: true,
    trustedDevicesReady: true,
  });
  assert.equal(office.requirement, 'optional');
  assert.equal(office.decline_allowed, true);
  const owner = mfaPolicyView({
    platformOwner: true,
    activationState: 'not_activated',
    recoveryReady: false,
    trustedDevicesReady: false,
  });
  assert.equal(owner.requirement, 'optional');
  assert.equal(owner.enforcement_active, false);
  assert.equal(owner.decline_allowed, true);
  const readyOwner = mfaPolicyView({
    platformOwner: true,
    activationState: 'permanently_active',
    recoveryReady: true,
    trustedDevicesReady: true,
  });
  assert.equal(readyOwner.enforcement_active, true);
  assert.equal(readyOwner.decline_allowed, false);
  assert.equal(readyOwner.enforcement, 'enforce');
  assert.equal(owner.suspicious_sign_in_detection, 'failure_burst');
  assert.equal(clientDeviceFlagIsIgnored(true), true);
  assert.equal(deviceCredentialFromCookie('nx_mfa_device=true'), null);
  assert.equal(hashDeviceCredential('secret').includes('secret'), false);
  assert.equal(trustedDeviceState({ storageReady: false, expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: null, now: '2026-10-24T00:00:00.000Z' }), 'unavailable');
  assert.equal(trustedDeviceState({ storageReady: true, expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: '2026-10-24T00:00:00.000Z', now: '2026-10-24T00:00:00.000Z' }), 'recheck');
  assert.equal(trustedDeviceState({ storageReady: true, expiresAt: '2020-01-01T00:00:00.000Z', revokedAt: null, now: '2026-10-24T00:00:00.000Z' }), 'recheck');
});

test('recovery codes are hashed, single-use, and not stored in plaintext', () => {
  const code = generateRecoveryCode();
  const hashed = hashRecoveryCode(code);
  assert.equal(hashed.hash.includes(code.replace('-', '')), false);
  assert.equal(recoveryCodeMatches(code, hashed.salt, hashed.hash), true);
  assert.equal(recoveryCodeMatches('wrong-code', hashed.salt, hashed.hash), false);
  assert.equal(recoveryConsumeDecision(null), 'missing');
  assert.equal(recoveryConsumeDecision({ consumedAt: null }), 'ok');
  assert.equal(recoveryConsumeDecision({ consumedAt: '2026-10-24T00:00:00.000Z' }), 'used');
});

test('the screen uses the aggregate and ignores a caller-supplied role', () => {
  const view = mfaOnboardingView({
    prompt: {
      show: false,
      title_he: copy.title_he,
      body_he: copy.body_he,
      accept_label_he: copy.accept_label_he,
      decline_label_he: copy.decline_label_he,
    },
    account_security: {
      section_he: copy.section_he,
      status_he: copy.inactive_status_he,
      enroll_enabled: true,
      enroll_label_he: copy.enroll_label_he,
    },
  });
  assert.equal(view.showPrompt, false);
  assert.equal(view.showEnroll, true);
  assert.equal(view.section, 'אבטחה');
  assert.equal(view.status, 'אימות דו־שלבי לא פעיל');
});
