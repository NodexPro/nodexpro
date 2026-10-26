import test from 'node:test';
import assert from 'node:assert/strict';
import {
  failedLoginCooldownIsContainment,
  failedLoginDetectionReason,
  failedLoginStage,
  groupSecurityJournalRows,
  maskAttemptedIdentifier,
  shouldApplyFailedLoginCooldown,
  shouldCreateFailedLoginIncident,
  shouldNotifyOwnerForFailedLogin,
} from '../../src/shared/failed-login-policy.pure.js';

test('failed login stages stay journal-only until 10 and never lock a victim', () => {
  assert.equal(failedLoginStage(1), 'journal');
  assert.equal(failedLoginStage(4), 'journal');
  assert.equal(failedLoginStage(5), 'suspicious');
  assert.equal(failedLoginStage(6), 'suspicious');
  assert.equal(failedLoginStage(7), 'cooldown');
  assert.equal(failedLoginStage(9), 'cooldown');
  assert.equal(failedLoginStage(10), 'incident');
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
