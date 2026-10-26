import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  failedLoginCorrelationCounts,
  failedLoginStage,
  maskAttemptedIdentifier,
  shouldApplyFailedLoginCooldown,
  shouldCreateFailedLoginIncident,
  shouldNotifyOwnerForFailedLogin,
  shouldCreateDistributedLoginIncident,
  shouldOfferPasswordRecovery,
  shouldOfferPasswordRecoveryFromSource,
  shouldSkipPasswordVerification,
  failedLoginSourceCooldown,
  loginNetworkPrefix,
  publicLoginFailure,
} from '../../src/shared/failed-login-policy.pure.js';
import { decideHighRiskPasswordLogin, highRiskLoginChallenge, isHighRiskChallengePath } from '../../src/shared/login-risk.pure.js';
import { canDiscloseOfficeIncident, officeAlertDedupeKey, officeAlertRecipients } from '../../src/shared/office-login-alert.pure.js';
import { safeSecurityPayload } from '../../src/shared/security-event.pure.js';
import { displaySourceIp, resolvePublicClientIp } from '../../src/shared/trusted-proxy.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('attempts 1, 3, 7 and 10 match recovery, cooldown, Retry-After and one incident', () => {
  const counts = [1, 3, 7, 10].map((count) => ({
    stage: failedLoginStage(count),
    recovery: shouldOfferPasswordRecovery(count),
    cooldown: shouldApplyFailedLoginCooldown({
      countInWindow: count,
      loginSucceeded: false,
      isPlatformOwnerEmergency: false,
    }),
    incident: shouldCreateFailedLoginIncident(count),
    notify: shouldNotifyOwnerForFailedLogin(count),
  }));
  assert.deepEqual(counts[0], { stage: 'journal', recovery: false, cooldown: false, incident: false, notify: false });
  assert.deepEqual(counts[1], { stage: 'recovery', recovery: true, cooldown: false, incident: false, notify: false });
  assert.deepEqual(counts[2], { stage: 'cooldown', recovery: true, cooldown: true, incident: false, notify: false });
  assert.deepEqual(counts[3], { stage: 'incident', recovery: true, cooldown: true, incident: true, notify: true });
  assert.equal(shouldSkipPasswordVerification({ cooldownAlreadyActive: true, loginSucceeded: false }), true);
  const duringCooldown = [8, 9, 10].map((count) => failedLoginStage(count));
  assert.deepEqual(duringCooldown, ['cooldown', 'cooldown', 'incident']);
});

test('rotating proxy IPs, shared NAT, Unknown and spoofed headers stay trustworthy', () => {
  const stampCounts = Array.from({ length: 10 }, (_, index) => failedLoginCorrelationCounts({
    patternCount: 1,
    stampCount: index + 1,
    targetCount: index + 1,
  }));
  assert.equal(stampCounts[6]?.cooldownCount, 7);
  assert.equal(stampCounts[9]?.incidentCount, 10);
  const neighbor = failedLoginCorrelationCounts({ patternCount: 1, stampCount: 1, targetCount: 1 });
  assert.equal(shouldApplyFailedLoginCooldown({
    countInWindow: neighbor.cooldownCount,
    loginSucceeded: false,
    isPlatformOwnerEmergency: false,
  }), false);
  const first = resolvePublicClientIp({
    peerIp: '3.64.1.20',
    reqIp: '3.64.1.20',
    forwardedFor: '5.6.7.8, 3.64.1.20',
    vercelForwardedFor: '5.6.7.8',
    vercelId: 'fra1::abc',
  });
  const second = resolvePublicClientIp({
    peerIp: '3.127.9.40',
    reqIp: '3.127.9.40',
    forwardedFor: '9.9.9.9, 3.127.9.40',
    vercelForwardedFor: '5.6.7.8',
    vercelId: 'fra1::def',
  });
  assert.equal(first.ip, '5.6.7.8');
  assert.equal(second.ip, '5.6.7.8');
  assert.equal(
    resolvePublicClientIp({
      peerIp: '10.193.150.1',
      reqIp: '10.193.150.1',
      forwardedFor: '79.176.10.20, 3.64.1.20',
      vercelForwardedFor: '79.176.10.20',
      vercelId: 'fra1::xyz',
    }).ip,
    '79.176.10.20',
  );
  assert.equal(displaySourceIp(null), 'Unknown');
  assert.equal(
    resolvePublicClientIp({
      peerIp: '8.8.8.8',
      reqIp: '8.8.8.8',
      forwardedFor: '1.1.1.1',
      cfConnectingIp: '9.9.9.9',
    }).ip,
    '8.8.8.8',
  );
});

test('existing and nonexistent emails stay private and recovery stays available', () => {
  assert.equal(maskAttemptedIdentifier('office.user@example.com'), 'o***@example.com');
  assert.equal(maskAttemptedIdentifier('missing@example.com'), 'm***@example.com');
  const existing = publicLoginFailure({ cooldown: false, retryAfterSeconds: 0, offerRecovery: false });
  const missing = publicLoginFailure({ cooldown: false, retryAfterSeconds: 0, offerRecovery: false });
  assert.deepEqual(existing, missing);
  assert.equal(existing.code, 'INVALID_CREDENTIALS');
  assert.equal(shouldOfferPasswordRecoveryFromSource(10), true);
  assert.equal(shouldOfferPasswordRecoveryFromSource(2), false);
  const victimTargetOnly = failedLoginSourceCooldown({
    stampOrPatternCount: 1,
    verifiedIpCount: 1,
    unknownSourceCount: 0,
    loginSucceeded: false,
    isPlatformOwnerEmergency: false,
  });
  assert.equal(victimTargetOnly, false);
  const routes = read('../../src/domains/auth/auth.routes.ts');
  assert.match(routes, /INVALID_CREDENTIALS/);
  assert.match(routes, /publicLoginFailure/);
  assert.match(routes, /waitPublicLoginMinimum/);
  assert.equal(routes.includes('USER_NOT_ACTIVE'), false);
  assert.equal(routes.includes('Слишком много'), false);
  const forgot = read('../../../web/src/pages/ForgotPassword.tsx');
  assert.match(forgot, /If an account exists for that address/);
  assert.match(forgot, /requestPasswordReset/);
  assert.equal(forgot.includes('resetPasswordForEmail'), false);
});

test('rotating browsers and emails still hit IP and endpoint counters', () => {
  assert.equal(loginNetworkPrefix('5.6.7.8'), '5.6.7.0/24');
  assert.equal(loginNetworkPrefix('Unknown'), null);
  assert.equal(failedLoginSourceCooldown({
    stampOrPatternCount: 1,
    verifiedIpCount: 20,
    unknownSourceCount: 0,
    loginSucceeded: false,
    isPlatformOwnerEmergency: false,
  }), true);
  assert.equal(failedLoginSourceCooldown({
    stampOrPatternCount: 1,
    verifiedIpCount: 0,
    unknownSourceCount: 15,
    loginSucceeded: false,
    isPlatformOwnerEmergency: false,
  }), true);
  assert.equal(shouldCreateDistributedLoginIncident({
    verifiedIpCount: 12,
    networkCount: 12,
    unknownSourceCount: 0,
    endpointCount: 12,
    distinctTargets: 6,
    stampOrPatternCount: 7,
  }), true);
  assert.equal(shouldCreateDistributedLoginIncident({
    verifiedIpCount: 1,
    networkCount: 1,
    unknownSourceCount: 0,
    endpointCount: 1,
    distinctTargets: 1,
    stampOrPatternCount: 1,
  }), false);
  const first = `alert:login-distributed:ip-a`;
  const second = `alert:login-distributed:ip-a`;
  assert.equal(first, second);
  const officeNeighbor = failedLoginSourceCooldown({
    stampOrPatternCount: 1,
    verifiedIpCount: 4,
    unknownSourceCount: 0,
    loginSucceeded: false,
    isPlatformOwnerEmergency: false,
  });
  assert.equal(officeNeighbor, false);
});

test('valid password in a high-risk context requires existing MFA without forcing enrollment', () => {
  assert.equal(decideHighRiskPasswordLogin({ recentFailCount: 3, mfaEnrolled: true, assurance: 'aal1' }), 'allow');
  assert.equal(decideHighRiskPasswordLogin({ recentFailCount: 4, mfaEnrolled: true, assurance: 'aal1' }), 'require_aal2');
  assert.equal(decideHighRiskPasswordLogin({ recentFailCount: 4, mfaEnrolled: false, assurance: 'aal1' }), 'allow_and_alert');
  assert.equal(decideHighRiskPasswordLogin({ recentFailCount: 8, mfaEnrolled: true, assurance: 'aal2' }), 'allow_and_alert');
  assert.deepEqual(highRiskLoginChallenge('require_aal2'), {
    required: true,
    command: 'verify_mfa',
    reason: 'high_risk_context',
  });
  assert.equal(isHighRiskChallengePath('/api/v1/auth/commands/verify_mfa'), true);
  assert.equal(isHighRiskChallengePath('/api/v1/clients'), false);
  const routes = read('../../src/domains/auth/auth.routes.ts');
  assert.match(routes, /markHighRiskLoginPending/);
  assert.match(routes, /login_challenge/);
  assert.equal(routes.includes('enroll_mfa'), true);
});

test('office owner alerts stay tenant-isolated, deduplicated and email-only', () => {
  assert.equal(canDiscloseOfficeIncident({
    incidentOrganizationId: 'org-a',
    viewerOrganizationId: 'org-a',
  }), true);
  assert.equal(canDiscloseOfficeIncident({
    incidentOrganizationId: 'org-a',
    viewerOrganizationId: 'org-b',
  }), false);
  assert.deepEqual(officeAlertRecipients(['Owner@Office.com', 'owner@office.com', '']), ['owner@office.com']);
  assert.equal(
    officeAlertDedupeKey('org-a', 'actor-1'),
    officeAlertDedupeKey('org-a', 'actor-1'),
  );
  assert.notEqual(
    officeAlertDedupeKey('org-a', 'actor-1'),
    officeAlertDedupeKey('org-b', 'actor-1'),
  );
  const payload = safeSecurityPayload({
    masked_target: 'o***@office.com',
    email: 'owner@office.com',
    audience: 'office',
    organization_id: 'org-a',
    note: 'token eyJabc',
  });
  assert.equal(payload.masked_target, 'o***@office.com');
  assert.equal(payload.email, undefined);
  assert.equal(payload.audience, 'office');
  const delivery = read('../../src/shared/security-alert-delivery.service.ts');
  assert.match(delivery, /audience === 'office'/);
  assert.match(delivery, /OFFICE_DESTINATION_UNVERIFIED/);
  assert.match(delivery, /sms_channel/);
  assert.equal(delivery.includes('sendSms'), false);
  const journal = read('../../src/domains/owner-system-health/owner-security-events.service.ts');
  assert.match(journal, /hidden_at/);
  assert.equal(journal.includes('.delete('), false);
});
