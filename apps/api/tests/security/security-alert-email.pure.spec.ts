import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SECURITY_ALERT_FROM_NAME,
  SECURITY_ALERT_SUBJECT,
  buildSecurityAlertEmail,
  withSecurityAlertSender,
} from '../../src/shared/security-alert-email.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('security alerts use NodexPro Security Alert branding, not DocFlow invite copy', () => {
  const email = buildSecurityAlertEmail({
    eventKind: 'security',
    severity: 'high',
    eventAction: 'security.login_failed',
    alertId: 'alert-1',
    eventTime: '2026-10-26T12:00:00.000Z',
    correlationId: 'corr-1',
    sourceIp: '79.176.10.20',
    country: 'Israel',
    city: 'Tel Aviv',
    maskedTarget: 'u***@office.com',
  });
  assert.equal(email.subject, 'NodexPro Security Alert');
  assert.equal(email.fromName, 'NodexPro Security Alert');
  assert.equal(SECURITY_ALERT_SUBJECT, 'NodexPro Security Alert');
  assert.equal(SECURITY_ALERT_FROM_NAME, 'NodexPro Security Alert');
  assert.match(email.html, /<h1[^>]*>NodexPro Security Alert<\/h1>/);
  assert.match(email.text, /NodexPro Security Alert/);
  assert.match(email.text, /Source IP: 79\.176\.10\.20/);
  assert.match(email.text, /Approximate location: Israel, Tel Aviv/);
  assert.equal(email.subject.includes('DocFlow'), false);
  assert.equal(email.html.includes('DocFlow'), false);
  assert.equal(email.text.includes('invite'), false);
  assert.equal(email.html.includes('כניסה ל-DocFlow'), false);
  assert.equal(email.html.includes('invite link'), false);
  const sender = withSecurityAlertSender({ fromName: 'DocFlow invite link', fromEmail: 'noreply@office.com' });
  assert.equal(sender.fromName, 'NodexPro Security Alert');
  assert.equal(sender.fromEmail, 'noreply@office.com');
});

test('unknown source stays Unknown and is not filled with a server location', () => {
  const email = buildSecurityAlertEmail({
    eventKind: 'test',
    severity: 'low',
    eventAction: 'security.test_alert',
    alertId: 'alert-2',
    eventTime: '2026-10-26T12:00:00.000Z',
    sourceIp: 'Unknown',
    country: 'Germany',
    city: 'Frankfurt am Main',
  });
  assert.equal(email.subject, 'NodexPro Security Alert');
  assert.match(email.text, /Source IP: Unknown/);
  assert.match(email.text, /Approximate location: Unknown/);
  assert.equal(email.text.includes('Frankfurt'), false);
  const unknownLocation = buildSecurityAlertEmail({
    eventKind: 'security',
    severity: 'high',
    eventAction: 'security.login_failed',
    alertId: 'alert-3',
    eventTime: '2026-10-26T12:00:00.000Z',
  });
  assert.match(unknownLocation.text, /Source IP: Unknown/);
  assert.match(unknownLocation.text, /Approximate location: Unknown/);
});

test('DocFlow invite delivery keeps its own subject and still uses the office sender name', () => {
  const delivery = read('../../src/shared/security-alert-delivery.service.ts');
  const invites = read('../../src/domains/docflow/docflow-commands.service.ts');
  assert.match(delivery, /withSecurityAlertSender/);
  assert.match(delivery, /buildSecurityAlertEmail/);
  assert.equal(delivery.includes('כניסה ל-DocFlow'), false);
  assert.equal(delivery.includes('DocFlow invite link'), false);
  assert.match(invites, /נפתח עבורך אזור תקשורת עם המשרד/);
  assert.match(invites, /כניסה ל-DocFlow/);
  assert.match(invites, /firmName = cfg\.fromName/);
  assert.match(invites, /createEmailDeliveryAdapter\(cfg\)/);
});
