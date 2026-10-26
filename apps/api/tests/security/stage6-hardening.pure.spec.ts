import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashesEqualHex,
  ownerRecoveryEmailAllowed,
  publicOwnerRecoveryRequest,
} from '../../src/domains/auth/owner-recovery.pure.js';
import { refreshSessionMatchesCaller } from '../../src/domains/auth/session-refresh.pure.js';
import { isFileAssetDownloadable } from '../../src/shared/document-malware-scan.pure.js';
import {
  allowedPasswordResetRedirect,
  publicPasswordResetResponse,
} from '../../src/domains/auth/password-reset.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('owner recovery does not disclose whether the email is the Platform Owner', () => {
  assert.equal(ownerRecoveryEmailAllowed('Owner@Office.com', 'owner@office.com'), true);
  assert.equal(ownerRecoveryEmailAllowed('staff@office.com', 'owner@office.com'), false);
  const existing = publicOwnerRecoveryRequest('11111111-1111-1111-1111-111111111111');
  const missing = publicOwnerRecoveryRequest('22222222-2222-2222-2222-222222222222');
  assert.deepEqual(Object.keys(existing), Object.keys(missing));
  assert.equal(existing.ok, true);
  const recovery = read('../../src/domains/auth/platform-owner-password-recovery.service.ts');
  const routes = read('../../src/routes/owner-password-recovery.routes.ts');
  assert.match(recovery, /ownerRecoveryEmailAllowed/);
  assert.match(recovery, /decoyId/);
  assert.equal(recovery.includes('OWNER_RECOVERY_EMAIL_NOT_ALLOWED'), false);
  assert.match(recovery, /hashesEqualHex/);
  assert.match(routes, /recovery_session_id/);
});

test('OTP hash compare is length-checked and rejects a mismatched digest', () => {
  const left = 'ab'.repeat(32);
  const right = 'cd'.repeat(32);
  assert.equal(hashesEqualHex(left, left), true);
  assert.equal(hashesEqualHex(left, right), false);
  assert.equal(hashesEqualHex(left, left.slice(0, 10)), false);
});

test('refresh_session rejects another user or a suspended caller', () => {
  assert.equal(refreshSessionMatchesCaller({
    refreshedAuthUserId: 'auth-a',
    callerAuthUserId: 'auth-a',
    callerStatus: 'active',
  }), true);
  assert.equal(refreshSessionMatchesCaller({
    refreshedAuthUserId: 'auth-victim',
    callerAuthUserId: 'auth-attacker',
    callerStatus: 'active',
  }), false);
  assert.equal(refreshSessionMatchesCaller({
    refreshedAuthUserId: 'auth-a',
    callerAuthUserId: 'auth-a',
    callerStatus: 'suspended',
  }), false);
  const service = read('../../src/domains/auth/privileged-mfa.service.ts');
  assert.match(service, /refreshSessionMatchesCaller/);
  assert.match(service, /ctx\.user\.authUserId/);
});

test('login cooldown store failure no longer skips the limiter', () => {
  const routes = read('../../src/domains/auth/auth.routes.ts');
  assert.equal(routes.includes('isFailedLoginCooldownActive(attemptInput).catch(() => false)'), false);
  assert.match(routes, /sendPublicLoginFailure/);
});

test('client-ops and income downloads refuse blocked files and persist scan_status', () => {
  assert.equal(isFileAssetDownloadable('blocked', false), false);
  assert.equal(isFileAssetDownloadable('quarantined', false), false);
  const documents = read('../../src/domains/client-operations/client-documents-tab.service.ts');
  const annual = read('../../src/domains/client-operations/client-annual-report-tab.service.ts');
  const fleet = read('../../src/domains/client-operations/client-vehicle-fleet.service.ts');
  const incomePdf = read('../../src/domains/income/income-document-pdf.service.ts');
  for (const source of [documents, annual, fleet, incomePdf]) {
    assert.match(source, /assertFileAssetDownloadable/);
    assert.match(source, /scan_status/);
  }
  assert.match(documents, /scan_status: guarded\.scanStatus/);
  assert.match(annual, /scan_status: guarded\.scanStatus/);
  assert.match(fleet, /scan_status: guarded\.scanStatus/);
});

test('legacy files stay downloadable without being marked clean, blocked files stay closed', () => {
  assert.equal(isFileAssetDownloadable('', false), true);
  assert.equal(isFileAssetDownloadable(null, false), true);
  assert.equal(isFileAssetDownloadable('not_configured', false), true);
  assert.equal(isFileAssetDownloadable('blocked', false), false);
  assert.equal(isFileAssetDownloadable('', true), false);
  const documents = read('../../src/domains/client-operations/client-documents-tab.service.ts');
  const annual = read('../../src/domains/client-operations/client-annual-report-tab.service.ts');
  const fleet = read('../../src/domains/client-operations/client-vehicle-fleet.service.ts');
  assert.equal(documents.includes("scan_status: 'clean'"), false);
  assert.equal(annual.includes("scan_status: 'clean'"), false);
  assert.equal(fleet.includes("scan_status: 'clean'"), false);
});

test('tenant password reset is backend-owned, enumeration-safe and origin-locked', () => {
  const existing = publicPasswordResetResponse();
  const missing = publicPasswordResetResponse();
  assert.deepEqual(existing, missing);
  assert.deepEqual(existing, { ok: true, requested: true });
  assert.equal(
    allowedPasswordResetRedirect({
      requested: 'https://evil.example/reset-password',
      allowedOrigins: ['https://www.nodexpro.com'],
    }),
    'https://www.nodexpro.com/reset-password',
  );
  assert.equal(
    allowedPasswordResetRedirect({
      requested: 'https://www.nodexpro.com/reset-password',
      allowedOrigins: ['https://www.nodexpro.com'],
    }),
    'https://www.nodexpro.com/reset-password',
  );
  const routes = read('../../src/domains/auth/auth.routes.ts');
  const service = read('../../src/domains/auth/auth.service.ts');
  const settings = read('../../../web/src/pages/Settings.tsx');
  assert.match(routes, /request_password_reset/);
  assert.match(service, /publicPasswordResetResponse/);
  assert.equal(settings.includes('resetPasswordForEmail'), false);
  assert.match(settings, /requestPasswordReset/);
});

test('accepted DocFlow invite is one-time and portal GETs ignore query tokens', () => {
  const commands = read('../../src/domains/docflow/docflow-commands.service.ts');
  const routes = read('../../src/routes/docflow.routes.ts');
  const payment = read('../../src/domains/income/income-document-payment.service.ts');
  assert.equal(commands.includes('already_accepted_reissue'), false);
  assert.equal(commands.includes('ALREADY_ACCEPTED_REISSUE_SESSION'), false);
  assert.match(commands, /invStatus !== 'pending'/);
  assert.match(commands, /portal_session_token_once: rawSessionToken/);
  assert.equal(routes.includes("req.query.portal_session_token"), false);
  assert.match(routes, /x-client-portal-session/);
  assert.equal(payment.includes('.update({ notes: detailsText })'), false);
});
