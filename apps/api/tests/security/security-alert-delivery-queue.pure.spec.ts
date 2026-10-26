import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { geoIpUnavailable, isPrivateOrReservedIp, resolveTrustedSourceIp } from '../../src/shared/request-source.pure.ts';
import { securityAlertSeverity } from '../../src/shared/security-alert-policy.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(dir, '../../../../supabase/migrations/204_security_alert_delivery_queue.sql'),
  'utf8',
);
const geoIpService = readFileSync(join(dir, '../../src/shared/geoip-dbip.service.ts'), 'utf8');
const alertDeliveryService = readFileSync(join(dir, '../../src/shared/security-alert-delivery.service.ts'), 'utf8');
const apiIndex = readFileSync(join(dir, '../../src/index.ts'), 'utf8');
const authRoutes = readFileSync(join(dir, '../../src/domains/auth/auth.routes.ts'), 'utf8');
const ownerRoutes = readFileSync(join(dir, '../../src/routes/owner-country-pack.routes.ts'), 'utf8');

test('migration 204 keeps security alert queue service-role only and retry-safe', () => {
  assert.match(migration, /create table if not exists public\.security_alert_deliveries/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.security_alert_deliveries from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.security_alert_deliveries to service_role/);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /dedupe_key text not null unique/);
  assert.match(migration, /claim_security_alert_delivery_by_id/);
});

test('trusted source IP resolver uses server-derived Express req.ip only', () => {
  assert.match(apiIndex, /app\.set\('trust proxy'/);
  assert.match(apiIndex, /isPrivateOrReservedIp\(ip\) \|\| isCloudflareIp\(ip\) \|\| isVercelIp\(ip\)/);
  assert.equal(resolveTrustedSourceIp({ reqIp: '::ffff:203.0.113.10' }), '203.0.113.10');
  assert.equal(resolveTrustedSourceIp({ reqIp: '2001:db8::1' }), '2001:db8::1');
  assert.equal(resolveTrustedSourceIp({ reqIp: 'not-an-ip' }), null);
  assert.equal(resolveTrustedSourceIp({ reqIp: null }), null);
  assert.doesNotMatch(geoIpService, /x-forwarded-for/i);
});

test('private, reserved, invalid, and unresolvable IPs return explicit Unknown GeoIP', async () => {
  assert.equal(isPrivateOrReservedIp('10.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.10'), true);
  assert.equal(isPrivateOrReservedIp('203.0.113.10'), true);
  assert.equal(isPrivateOrReservedIp('not-an-ip'), true);
  const geo = geoIpUnavailable('203.0.113.10');
  assert.equal(geo.source_ip, '203.0.113.10');
  assert.equal(geo.country, 'Unknown');
  assert.equal(geo.provider, 'none');
  assert.match(geo.accuracy_note, /DB-IP Lite GeoIP is unavailable/i);
  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role';
  process.env.DBIP_LITE_DATA_DIR = process.env.DBIP_LITE_DATA_DIR ?? join(dir, '.missing-dbip-lite');
  const { enrichGeoIp } = await import('../../src/shared/geoip-dbip.service.ts');
  const lookup = await enrichGeoIp('203.0.113.10');
  assert.equal(lookup.country, 'Unknown');
  assert.equal(lookup.provider, 'none');
});

test('DB-IP Lite provisioning uses official free monthly mmdb.gz with safe update guards', () => {
  assert.match(geoIpService, /download\.db-ip\.com\/free\/dbip-city-lite-\{month\}\.mmdb\.gz/);
  assert.match(geoIpService, /dbIpCandidateMonths/);
  assert.match(geoIpService, /createGunzip/);
  assert.match(geoIpService, /MAX_COMPRESSED_BYTES/);
  assert.match(geoIpService, /MAX_DATABASE_BYTES/);
  assert.match(geoIpService, /AbortController/);
  assert.match(geoIpService, /validateDb\(tempDb\)/);
  assert.match(geoIpService, /rename\(tempDb, targetPath\)/);
  assert.match(geoIpService, /updateInFlight/);
  assert.doesNotMatch(geoIpService, /licenseKey|MAXMIND|GeoLite2|maxmind/);
});

test('DB-IP Lite attribution and email location context are present without secrets', () => {
  assert.match(geoIpService, /IP geolocation data by DB-IP\.com/);
  assert.match(geoIpService, /CC BY 4\.0/);
  assert.match(alertDeliveryService, /Approximate location:/);
  assert.match(alertDeliveryService, /Source IP:/);
  assert.doesNotMatch(alertDeliveryService, /password|token|secret/i);
});

test('auth and owner security event paths pass trusted req.ip into backend-owned events', () => {
  assert.match(authRoutes, /sourceIp: req\.trustedClientIp/);
  assert.match(authRoutes, /x-nodexpro-login-stamp/);
  const failedLogin = readFileSync(join(dir, '../../src/shared/failed-login.service.ts'), 'utf8');
  const containment = readFileSync(join(dir, '../../src/shared/security-containment.service.ts'), 'utf8');
  assert.match(failedLogin, /incidentReady: true/);
  assert.match(failedLogin, /processSecurityAlertDeliveries/);
  assert.match(containment, /incidentReady/);
  assert.match(ownerRoutes, /sourceIp: req\.trustedClientIp/);
  assert.match(ownerRoutes, /action: 'security\.forbidden'/);
  assert.doesNotMatch(authRoutes, /headers\[['"]x-forwarded-for['"]\]/i);
  assert.doesNotMatch(ownerRoutes, /headers\[['"]x-forwarded-for['"]\]/i);
});

test('alert severity policy distinguishes high-risk security events', () => {
  assert.equal(securityAlertSeverity('security.platform_owner_mfa_activated'), 'critical');
  assert.equal(securityAlertSeverity('security.privileged_mfa_failed'), 'critical');
  assert.equal(securityAlertSeverity('security.suspicious_repeated'), 'high');
  assert.equal(securityAlertSeverity('security.mfa_recovery_consumed'), 'high');
  assert.equal(securityAlertSeverity('security.forbidden'), 'medium');
  assert.equal(securityAlertSeverity('security.test_alert'), 'low');
});
