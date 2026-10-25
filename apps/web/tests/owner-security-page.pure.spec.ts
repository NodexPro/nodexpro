import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OWNER_SECURITY_COPY,
  OWNER_SECURITY_TABS,
  englishEventAction,
  resolveOwnerSecurityTab,
} from '../src/pages/owner-security-copy.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const hebrew = /[\u0590-\u05FF]/;

test('Platform Owner sidebar lists Security exactly once', () => {
  const shell = read('../src/pages/PlatformOwnerShell.tsx');
  const matches = [...shell.matchAll(/label: 'Security'/g)];
  assert.equal(matches.length, 1);
  assert.match(shell, /to: '\/platform-owner\/security'/);
  assert.match(shell, /label: 'Modules'/);
  assert.match(shell, /label: 'Legal Control'/);
  assert.equal(shell.includes('AccountSecurityPanel'), false);
  assert.equal(shell.includes('OwnerSecurityEventsPanel'), false);
});

test('Security page copy stays English and maps backend flags', () => {
  assert.deepEqual([...OWNER_SECURITY_TABS], ['mfa', 'alerts']);
  assert.equal(resolveOwnerSecurityTab(null), 'mfa');
  assert.equal(resolveOwnerSecurityTab('alerts'), 'alerts');
  assert.equal(OWNER_SECURITY_COPY.pageTitle, 'Security');
  assert.equal(OWNER_SECURITY_COPY.activate, 'Activate MFA Permanently');
  assert.equal(OWNER_SECURITY_COPY.active, 'MFA Permanently Active');
  assert.equal(OWNER_SECURITY_COPY.sendTestAlert, 'Send Test Alert');
  assert.equal(
    OWNER_SECURITY_COPY.alertsNotConfigured,
    'Security alerts are not configured for external delivery.',
  );
  assert.equal(englishEventAction('deliver_security_test_alert'), 'Test alert');
  for (const value of Object.values(OWNER_SECURITY_COPY)) {
    if (typeof value === 'string') assert.equal(hebrew.test(value), false, value);
  }
});

test('dedicated Security route owns MFA and Alerts', () => {
  const app = read('../src/App.tsx');
  const page = read('../src/pages/PlatformOwnerSecurityPage.tsx');
  assert.match(app, /path="security" element=\{<PlatformOwnerSecurityPage \/>\}/);
  assert.match(page, /OWNER\.securityEvents/);
  assert.match(page, /OWNER\.activatePlatformOwnerMfa/);
  assert.match(page, /OWNER\.deliverSecurityTestAlert/);
  assert.match(page, /OWNER\.verifyPlatformOwnerMfaRecovery/);
  assert.match(page, /activate_enabled/);
  assert.match(page, /alert_delivery === 'configured'/);
  assert.equal(page.includes('Threat Detection'), false);
  assert.equal(/\bOFF\b/.test(page), false);
  assert.equal(hebrew.test(page), false);
});
