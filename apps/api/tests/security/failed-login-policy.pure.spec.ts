import test from 'node:test';
import assert from 'node:assert/strict';
import {
  failedLoginCorrelationCounts,
  failedLoginCooldownIsContainment,
  failedLoginDetectionReason,
  failedLoginGroupKey,
  failedLoginStage,
  groupSecurityJournalRows,
  maskAttemptedIdentifier,
  normalizeLoginStamp,
  shouldApplyFailedLoginCooldown,
  shouldCreateFailedLoginIncident,
  shouldNotifyOwnerForFailedLogin,
  shouldOfferPasswordRecovery,
  shouldSkipPasswordVerification,
} from '../../src/shared/failed-login-policy.pure.js';

test('failed login stages stay journal-only until 10 and never lock a victim', () => {
  assert.equal(failedLoginStage(1), 'journal');
  assert.equal(failedLoginStage(2), 'journal');
  assert.equal(failedLoginStage(3), 'recovery');
  assert.equal(failedLoginStage(4), 'suspicious');
  assert.equal(failedLoginStage(5), 'suspicious');
  assert.equal(failedLoginStage(6), 'suspicious');
  assert.equal(failedLoginStage(7), 'cooldown');
  assert.equal(failedLoginStage(9), 'cooldown');
  assert.equal(failedLoginStage(10), 'incident');
  assert.equal(shouldOfferPasswordRecovery(2), false);
  assert.equal(shouldOfferPasswordRecovery(3), true);
  assert.equal(shouldSkipPasswordVerification({ cooldownAlreadyActive: true, loginSucceeded: false }), true);
  assert.equal(shouldSkipPasswordVerification({ cooldownAlreadyActive: true, loginSucceeded: true }), false);
  assert.equal(shouldCreateFailedLoginIncident(9), false);
  assert.equal(shouldNotifyOwnerForFailedLogin(9), false);
  assert.equal(shouldNotifyOwnerForFailedLogin(10), true);
  assert.equal(failedLoginCooldownIsContainment(), false);
  assert.equal(
    shouldApplyFailedLoginCooldown({ countInWindow: 7, loginSucceeded: true, isPlatformOwnerEmergency: false }),
    false,
  );
  assert.equal(
    shouldApplyFailedLoginCooldown({ countInWindow: 7, loginSucceeded: false, isPlatformOwnerEmergency: true }),
    false,
  );
  assert.equal(
    shouldApplyFailedLoginCooldown({ countInWindow: 7, loginSucceeded: false, isPlatformOwnerEmergency: false }),
    true,
  );
});

test('switching emails does not change the incident threshold and identifiers stay masked', () => {
  assert.equal(maskAttemptedIdentifier('office.user@example.com'), 'o***@example.com');
  assert.match(failedLoginDetectionReason('incident', 4), /multiple identities/);
  const grouped = groupSecurityJournalRows(
    [
      {
        id: '1',
        created_at: '2026-10-26T10:00:00.000Z',
        action: 'security.login_failed',
        severity: 'low',
        display_ip: '1.2.3.4',
        country: 'Israel',
        city: 'Tel Aviv',
        attempted_identifier: 'a***@office.com',
        attempted_identifier_hash: 'h1',
        attempt_count: 2,
        detection_reason: 'journal',
        incident_id: null,
        cooldown_status: 'none',
        containment_action: 'none',
        alert_status: 'not_required',
        group_key: 'login:1.2.3.4:h1',
      },
      {
        id: '2',
        created_at: '2026-10-26T10:01:00.000Z',
        action: 'security.login_failed',
        severity: 'high',
        display_ip: '1.2.3.4',
        country: 'Israel',
        city: 'Tel Aviv',
        attempted_identifier: 'a***@office.com',
        attempted_identifier_hash: 'h1',
        attempt_count: 7,
        detection_reason: 'cooldown',
        incident_id: null,
        cooldown_status: 'active',
        containment_action: 'none',
        alert_status: 'not_required',
        group_key: 'login:1.2.3.4:h1',
      },
    ],
    1,
    20,
  );
  assert.equal(grouped.total_groups, 1);
  assert.equal(grouped.groups[0]?.attempt_count, 7);
  assert.equal(grouped.groups[0]?.history.length, 2);
});

test('11 rotating proxy IPs still cooldown at 7 and incident at 10 without locking a shared office', () => {
  const stamp = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal(normalizeLoginStamp(stamp), stamp);
  const attempts = Array.from({ length: 11 }, (_, index) => {
    const patternCount = 1;
    const stampCount = index + 1;
    const targetCount = index + 1;
    return failedLoginCorrelationCounts({ patternCount, stampCount, targetCount });
  });
  assert.equal(attempts[2]?.detectionCount, 3);
  assert.equal(failedLoginStage(attempts[2]!.detectionCount), 'recovery');
  assert.equal(attempts[3]?.detectionCount, 4);
  assert.equal(failedLoginStage(attempts[3]!.detectionCount), 'suspicious');
  assert.equal(failedLoginStage(attempts[4]!.detectionCount), 'suspicious');
  assert.equal(shouldApplyFailedLoginCooldown({
    countInWindow: attempts[6]!.cooldownCount,
    loginSucceeded: false,
    isPlatformOwnerEmergency: false,
  }), true);
  assert.equal(shouldCreateFailedLoginIncident(attempts[9]!.incidentCount), true);
  assert.equal(shouldNotifyOwnerForFailedLogin(attempts[9]!.incidentCount), true);
  assert.equal(shouldApplyFailedLoginCooldown({
    countInWindow: attempts[10]!.cooldownCount,
    loginSucceeded: true,
    isPlatformOwnerEmergency: false,
  }), false);
  const officeNeighbor = failedLoginCorrelationCounts({ patternCount: 1, stampCount: 1, targetCount: 1 });
  assert.equal(shouldApplyFailedLoginCooldown({
    countInWindow: officeNeighbor.cooldownCount,
    loginSucceeded: false,
    isPlatformOwnerEmergency: false,
  }), false);
  assert.equal(
    failedLoginGroupKey({ displayIp: '3.64.1.20', attemptedIdentifierHash: 'h1', stampHash: 'stamp1' }),
    failedLoginGroupKey({ displayIp: '3.127.9.40', attemptedIdentifierHash: 'h1', stampHash: 'stamp1' }),
  );
});
