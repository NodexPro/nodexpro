import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aal1RequestRequiresMfaChallenge,
  classifyMfaEnrollment,
  classifyMfaEnrollmentFromListed,
  decideMfaChallenge,
  loginChallengePayload,
  mfaPolicyRequirement,
  mfaSessionSnapshot,
  parseMfaFactorRecords,
  resolveLoginMfaFactor,
} from '../../src/shared/mfa-session-state.pure.js';
import { explicitOrgHeaderDecision } from '../../src/domains/auth/explicit-org-header.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('new user without MFA is not enrolled and does not receive a login challenge', () => {
  assert.equal(classifyMfaEnrollment([]), 'not_enrolled');
  assert.equal(classifyMfaEnrollmentFromListed({ data: { factors: [] } }), 'not_enrolled');
  assert.equal(
    classifyMfaEnrollmentFromListed({ data: { data: { factors: [{ status: 'verified', factor_type: 'totp', id: 'x' }] } } }),
    'enabled',
  );
  assert.deepEqual(
    decideMfaChallenge({ enrollment: 'not_enrolled', assurance: 'aal1' }),
    { challengeRequired: false, reason: null },
  );
  assert.deepEqual(
    decideMfaChallenge({ enrollment: 'not_enrolled', assurance: 'aal1', highRiskAal2Required: false }),
    { challengeRequired: false, reason: null },
  );
  const snapshot = mfaSessionSnapshot({
    enrollment: 'not_enrolled',
    challengeRequired: false,
    policyRequirement: 'optional',
  });
  assert.equal(snapshot.enrollment_state, 'not_enrolled');
  assert.equal(snapshot.challenge_required, false);
  assert.deepEqual(loginChallengePayload({ required: false, reason: null }), {
    required: false,
    command: null,
    reason: null,
  });
});

test('pending enrollment is not enabled and does not issue a session challenge', () => {
  assert.equal(
    classifyMfaEnrollment([{ factor_type: 'totp', status: 'unverified', id: 'pending-1' }]),
    'enrollment_pending',
  );
  assert.deepEqual(
    decideMfaChallenge({ enrollment: 'enrollment_pending', assurance: 'aal1' }),
    { challengeRequired: false, reason: null },
  );
  assert.equal(
    resolveLoginMfaFactor({ requestedFactorId: '', verifiedIds: [], pendingIds: ['pending-1'] }).mode,
    'none',
  );
  assert.equal(
    resolveLoginMfaFactor({ requestedFactorId: 'pending-1', verifiedIds: [], pendingIds: ['pending-1'] }).mode,
    'enrollment',
  );
});

test('enabled MFA requires a TOTP challenge before a full aal1 session', () => {
  assert.equal(
    classifyMfaEnrollmentFromListed({
      data: { factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] },
    }),
    'enabled',
  );
  assert.deepEqual(
    decideMfaChallenge({ enrollment: 'enabled', assurance: 'aal1' }),
    { challengeRequired: true, reason: 'mfa_enabled' },
  );
  assert.deepEqual(
    decideMfaChallenge({ enrollment: 'enabled', assurance: 'aal2' }),
    { challengeRequired: false, reason: null },
  );
  assert.deepEqual(
    loginChallengePayload({ required: true, reason: 'mfa_enabled' }),
    { required: true, command: 'verify_mfa', reason: 'mfa_enabled' },
  );
  assert.equal(
    resolveLoginMfaFactor({ requestedFactorId: '', verifiedIds: ['f1'], pendingIds: [] }).factorId,
    'f1',
  );
  assert.equal(
    resolveLoginMfaFactor({ requestedFactorId: '', verifiedIds: ['f1'], pendingIds: [] }).mode,
    'login_step_up',
  );
});

test('Platform Owner mandatory policy does not fake a TOTP challenge without an enabled factor', () => {
  assert.equal(mfaPolicyRequirement({ platformOwner: false, activationState: 'permanently_active' }), 'optional');
  assert.equal(mfaPolicyRequirement({ platformOwner: true, activationState: 'not_activated' }), 'optional');
  assert.equal(mfaPolicyRequirement({ platformOwner: true, activationState: 'permanently_active' }), 'mandatory');
  assert.equal(mfaPolicyRequirement({ platformOwner: true, activationState: 'unreadable' }), 'mandatory');
  assert.deepEqual(
    decideMfaChallenge({ enrollment: 'not_enrolled', assurance: 'aal1' }),
    { challengeRequired: false, reason: null },
  );
  assert.deepEqual(
    decideMfaChallenge({ enrollment: 'enabled', assurance: 'aal1' }),
    { challengeRequired: true, reason: 'mfa_enabled' },
  );
});

test('stale tenant header on identity bootstrap does not 403; tenant APIs still reject cross-tenant', () => {
  assert.equal(
    explicitOrgHeaderDecision({ headerPresent: true, membershipFound: false, identityBootstrap: true }),
    'resolve_stored',
  );
  assert.equal(
    explicitOrgHeaderDecision({ headerPresent: true, membershipFound: false }),
    'reject_not_member',
  );
  assert.equal(
    explicitOrgHeaderDecision({ headerPresent: true, membershipFound: true, identityBootstrap: true }),
    'use_membership',
  );
  const factors = parseMfaFactorRecords({ totp: [{ id: 'a', status: 'unverified', factor_type: 'totp' }] });
  assert.equal(classifyMfaEnrollment(factors), 'enrollment_pending');
  const auth = read('../../src/middleware/auth.ts');
  const routes = read('../../src/domains/auth/auth.routes.ts');
  const verify = read('../../src/domains/auth/privileged-mfa.service.ts');
  assert.match(auth, /identityBootstrap/);
  assert.match(auth, /isMfaChallengePending/);
  assert.match(auth, /aal1RequestRequiresMfaChallenge/);
  assert.equal(
    aal1RequestRequiresMfaChallenge({
      identityBootstrap: false,
      assurance: 'aal1',
      enrollment: 'not_enrolled',
      highRiskPending: false,
      mfaChallengePending: false,
    }),
    false,
  );
  assert.equal(
    aal1RequestRequiresMfaChallenge({
      identityBootstrap: false,
      assurance: 'aal1',
      enrollment: 'enrollment_pending',
      highRiskPending: false,
      mfaChallengePending: false,
    }),
    false,
  );
  assert.equal(
    aal1RequestRequiresMfaChallenge({
      identityBootstrap: false,
      assurance: 'aal1',
      enrollment: 'enabled',
      highRiskPending: false,
      mfaChallengePending: false,
    }),
    true,
  );
  assert.equal(
    aal1RequestRequiresMfaChallenge({
      identityBootstrap: true,
      assurance: 'aal1',
      enrollment: 'enabled',
      highRiskPending: false,
      mfaChallengePending: true,
    }),
    false,
  );
  assert.equal(
    aal1RequestRequiresMfaChallenge({
      identityBootstrap: false,
      assurance: 'aal2',
      enrollment: 'enabled',
      highRiskPending: true,
      mfaChallengePending: true,
    }),
    false,
  );
  assert.match(routes, /classifyMfaEnrollmentFromListed/);
  assert.match(routes, /markMfaChallengePending/);
  assert.match(verify, /resolveLoginMfaFactor/);
  assert.match(verify, /login_step_up/);
});
