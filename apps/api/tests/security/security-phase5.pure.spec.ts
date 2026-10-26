import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  containmentActionIsAutomatic,
  decideAutomaticContainment,
  isContainmentExemptPath,
  isSecurityContainmentEnabled,
  ruleForSecurityAction,
  shouldCreateIncident,
  shouldEnforceRecordedContainment,
} from '../../src/shared/security-phase5.pure.js';
import { isPrivateOrReservedIp, resolveTrustedSourceIp } from '../../src/shared/request-source.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('failed login waits for threshold and never auto-locks a victim user or office IP', () => {
  const rule = ruleForSecurityAction('security.login_failed');
  assert.ok(rule);
  assert.equal(rule.event_type, 'repeated_failed_login_attempts');
  assert.equal(shouldCreateIncident(9, rule), false);
  assert.equal(shouldCreateIncident(10, rule), true);
  assert.equal(rule.containment_action, 'owner_review');
  assert.equal(rule.containment_scope, null);
  assert.equal(containmentActionIsAutomatic(rule.containment_action), false);
  const decision = decideAutomaticContainment({
    enabled: true,
    action: rule.containment_action,
    scope: rule.containment_scope,
    sourceIp: '203.0.113.10',
    actorUserId: 'victim-user',
    isPlatformOwnerActor: false,
    isPrivateOrReservedSource: false,
  });
  assert.equal(decision.apply, false);
  assert.equal(decision.reason, 'owner_review_only');
});

test('credential stuffing and login failures never lock the victim or office IP', () => {
  const stuffing = ruleForSecurityAction('security.credential_stuffing');
  assert.ok(stuffing);
  assert.equal(shouldCreateIncident(24, stuffing), false);
  assert.equal(shouldCreateIncident(25, stuffing), true);
  assert.equal(stuffing.containment_action, 'owner_review');
  assert.equal(containmentActionIsAutomatic(stuffing.containment_action), false);
});

test('confirmed compromised session restricts only the attacker user', () => {
  const rule = ruleForSecurityAction('security.session_compromised');
  assert.ok(rule);
  assert.equal(rule.containment_scope, 'user');
  assert.equal(
    decideAutomaticContainment({
      enabled: true,
      action: rule.containment_action,
      scope: rule.containment_scope,
      sourceIp: '8.8.8.8',
      actorUserId: 'attacker',
      isPlatformOwnerActor: false,
      isPrivateOrReservedSource: false,
    }).apply,
    true,
  );
});

test('unauthorized bursts escalate to owner review instead of office-wide IP lockout', () => {
  const rule = ruleForSecurityAction('security.unauthorized');
  assert.ok(rule);
  assert.equal(rule.containment_action, 'owner_review');
  assert.equal(containmentActionIsAutomatic(rule.containment_action), false);
});

test('privileged MFA and alert delivery failures require owner review, not automatic lockout', () => {
  for (const action of ['security.privileged_mfa_failed', 'security.alert_delivery_failed']) {
    const rule = ruleForSecurityAction(action);
    assert.ok(rule);
    assert.equal(rule.confidence, 'confirmed');
    assert.equal(rule.containment_action, 'owner_review');
    assert.equal(containmentActionIsAutomatic(rule.containment_action), false);
  }
});

test('forbidden-user restriction applies only to the authenticated attacker, never Owner or missing actor', () => {
  const rule = ruleForSecurityAction('security.forbidden');
  assert.ok(rule);
  assert.equal(rule.containment_scope, 'user');
  assert.equal(
    decideAutomaticContainment({
      enabled: true,
      action: rule.containment_action,
      scope: rule.containment_scope,
      sourceIp: '203.0.113.10',
      actorUserId: 'attacker',
      isPlatformOwnerActor: false,
      isPrivateOrReservedSource: false,
    }).apply,
    true,
  );
  assert.equal(
    decideAutomaticContainment({
      enabled: true,
      action: rule.containment_action,
      scope: rule.containment_scope,
      sourceIp: '203.0.113.10',
      actorUserId: 'owner',
      isPlatformOwnerActor: true,
      isPrivateOrReservedSource: false,
    }).reason,
    'platform_owner_protected',
  );
  assert.equal(
    decideAutomaticContainment({
      enabled: true,
      action: rule.containment_action,
      scope: rule.containment_scope,
      sourceIp: '203.0.113.10',
      actorUserId: null,
      isPlatformOwnerActor: false,
      isPrivateOrReservedSource: false,
    }).reason,
    'missing_actor',
  );
});

test('source-IP automatic containment is refused for public, private, NAT and Owner cases', () => {
  const base = {
    enabled: true,
    action: 'temporary_source_block' as const,
    scope: 'source_ip' as const,
    actorUserId: null,
    isPlatformOwnerActor: false,
  };
  assert.equal(
    decideAutomaticContainment({ ...base, sourceIp: '8.8.8.8', isPrivateOrReservedSource: false }).reason,
    'source_ip_auto_containment_disabled',
  );
  assert.equal(
    decideAutomaticContainment({ ...base, sourceIp: '10.0.0.8', isPrivateOrReservedSource: true }).reason,
    'private_or_reserved_source',
  );
  assert.equal(isPrivateOrReservedIp('10.0.0.8'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.20'), true);
  assert.equal(isPrivateOrReservedIp('100.64.1.2'), true);
});

test('kill switch defaults to disabled and only exact true enables enforcement', () => {
  assert.equal(isSecurityContainmentEnabled(undefined), false);
  assert.equal(isSecurityContainmentEnabled(null), false);
  assert.equal(isSecurityContainmentEnabled(''), false);
  assert.equal(isSecurityContainmentEnabled('false'), false);
  assert.equal(isSecurityContainmentEnabled('FALSE'), false);
  assert.equal(isSecurityContainmentEnabled('1'), false);
  assert.equal(isSecurityContainmentEnabled('yes'), false);
  assert.equal(isSecurityContainmentEnabled('TRUE'), true);
  assert.equal(isSecurityContainmentEnabled('true'), true);
  assert.equal(
    decideAutomaticContainment({
      enabled: false,
      action: 'restrict_user_sensitive_commands',
      scope: 'user',
      sourceIp: '8.8.8.8',
      actorUserId: 'attacker',
      isPlatformOwnerActor: false,
      isPrivateOrReservedSource: false,
    }).reason,
    'kill_switch_disabled',
  );
});

test('recorded containment is not enforced when the kill switch is off, path is exempt, or actor is Owner', () => {
  assert.equal(isContainmentExemptPath('/api/v1/health'), true);
  assert.equal(isContainmentExemptPath('/api/v1/owner/commands/release_security_containment'), true);
  assert.equal(isContainmentExemptPath('/api/v1/owner/internal/security-alert-deliveries/process'), true);
  assert.equal(isContainmentExemptPath('/api/v1/income/commands'), false);
  assert.equal(
    shouldEnforceRecordedContainment({
      enabled: false,
      path: '/api/v1/income/commands',
      scope: 'user',
      isPlatformOwnerActor: false,
      isPrivateOrReservedSource: false,
    }),
    false,
  );
  assert.equal(
    shouldEnforceRecordedContainment({
      enabled: true,
      path: '/api/v1/income/commands',
      scope: 'user',
      isPlatformOwnerActor: true,
      isPrivateOrReservedSource: false,
    }),
    false,
  );
  assert.equal(
    shouldEnforceRecordedContainment({
      enabled: true,
      path: '/api/v1/income/commands',
      scope: 'source_ip',
      isPlatformOwnerActor: false,
      isPrivateOrReservedSource: false,
    }),
    false,
  );
  assert.equal(
    shouldEnforceRecordedContainment({
      enabled: true,
      path: '/api/v1/income/commands',
      scope: 'user',
      isPlatformOwnerActor: false,
      isPrivateOrReservedSource: false,
    }),
    true,
  );
});

test('trusted source resolver ignores spoofable header values by only accepting req.ip input', () => {
  assert.equal(resolveTrustedSourceIp({ reqIp: '::ffff:203.0.113.8' }), '203.0.113.8');
  assert.equal(resolveTrustedSourceIp({ reqIp: 'not-an-ip' }), null);
});

test('migration 205 is additive, service-role only, concurrency-safe and compatible with 204', () => {
  const sql = read('../../../../supabase/migrations/205_security_phase5_incidents_containment.sql');
  const sql204 = read('../../../../supabase/migrations/204_security_alert_delivery_queue.sql');
  assert.match(sql, /create table if not exists public\.security_detection_buckets/);
  assert.match(sql, /create table if not exists public\.security_incidents/);
  assert.match(sql, /create table if not exists public\.security_containment_rules/);
  assert.match(sql, /on conflict \(bucket_key\) do update/);
  assert.match(sql, /forc[e]? row level security/i);
  assert.match(sql, /revoke all on table public\.security_incidents from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update on table public\.security_containment_rules to service_role/);
  assert.match(sql, /invalid detection bucket key/);
  assert.match(sql, /security_containment_expires_after_start/);
  assert.doesNotMatch(sql, /drop table/i);
  assert.doesNotMatch(sql, /alter table public\.security_alert_deliveries/i);
  assert.doesNotMatch(sql, /delete from/i);
  assert.match(sql204, /create table if not exists public\.security_alert_deliveries/);
});

test('security alert queue workflow uses repository secret and protected backend endpoint', () => {
  const workflow = read('../../../../.github/workflows/security-alert-delivery-queue.yml');
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(workflow, /secrets\.SECURITY_ALERT_CRON_SECRET/);
  assert.match(workflow, /\/api\/v1\/owner\/internal\/security-alert-deliveries\/process/);
  assert.match(workflow, /X-Internal-Cron-Secret/);
  assert.doesNotMatch(workflow, /INTERNAL_CRON_SECRET: \$/);
});

test('containment kill switch is documented for Render and defaults off in config', () => {
  const config = read('../../src/config.ts');
  const render = read('../../RENDER_ENV.md');
  const containment = read('../../src/shared/security-containment.service.ts');
  assert.match(config, /SECURITY_CONTAINMENT_ENABLED/);
  assert.match(config, /=== 'true'/);
  assert.match(render, /SECURITY_CONTAINMENT_ENABLED=false/);
  assert.match(render, /SECURITY_CONTAINMENT_ENABLED=true/);
  assert.match(containment, /readSecurityContainmentEnabled/);
  assert.match(containment, /Source-IP rules are never enforced/);
});
