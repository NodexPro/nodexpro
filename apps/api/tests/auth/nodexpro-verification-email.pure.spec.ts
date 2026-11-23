import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NODEXPRO_AUTH_REDIRECT_ALLOWLIST,
  NODEXPRO_GOTRUE_CONFIRMATION_URL,
  NODEXPRO_GOTRUE_EMAIL_KINDS,
  NODEXPRO_SUPABASE_AUTH_EMAIL_DASHBOARD_STEPS,
  NODEXPRO_VERIFICATION_FROM_DISPLAY,
  NODEXPRO_VERIFICATION_SUBJECT,
  NODEXPRO_VERIFICATION_TOKEN_TTL_HOURS,
  dashboardTemplateUsesOnlyConfirmationUrl,
  isAllowedNodexProAuthRedirect,
  nodexproGoTrueDashboardHtml,
  nodexproGoTrueDashboardText,
  nodexproGoTrueEmailSubject,
  nodexproSignupEmailRedirectTo,
  nodexproVerificationConfirmUrl,
  nodexproVerificationEmailHtml,
  nodexproVerificationEmailText,
} from '../../src/domains/auth/nodexpro-verification-email.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const authServiceSrc = readFileSync(join(dir, '../../src/domains/auth/auth.service.ts'), 'utf8');

test('NodexPro verification email is English, branded, and does not embed secrets', () => {
  const url = nodexproVerificationConfirmUrl('https://www.nodexpro.com', 'abc.def');
  assert.equal(url, 'https://www.nodexpro.com/auth/confirm?token_hash=abc.def&type=signup');
  const html = nodexproVerificationEmailHtml({ confirmUrl: url });
  const text = nodexproVerificationEmailText({ confirmUrl: url });
  assert.match(NODEXPRO_VERIFICATION_SUBJECT, /NodexPro/);
  assert.match(NODEXPRO_VERIFICATION_FROM_DISPLAY, /^NodexPro <noreply@nodexpro.com>$/);
  assert.match(html, /Confirm Email/);
  assert.match(html, /NodexPro/);
  assert.match(html, /#061428/);
  assert.match(html, /#268cff/);
  assert.doesNotMatch(html, /[\u0590-\u05FF]/);
  assert.match(text, /Confirm your email/);
  assert.equal(NODEXPRO_VERIFICATION_TOKEN_TTL_HOURS, 24);
  assert.ok(NODEXPRO_AUTH_REDIRECT_ALLOWLIST.includes('https://www.nodexpro.com/login'));
  assert.ok(NODEXPRO_AUTH_REDIRECT_ALLOWLIST.includes('https://www.nodexpro.com/auth/confirm'));
  assert.ok(NODEXPRO_AUTH_REDIRECT_ALLOWLIST.includes('https://www.nodexpro.com/reset-password'));
  assert.ok(NODEXPRO_SUPABASE_AUTH_EMAIL_DASHBOARD_STEPS.length >= 6);
  const steps = NODEXPRO_SUPABASE_AUTH_EMAIL_DASHBOARD_STEPS.join('\n');
  assert.match(steps, /smtp\.resend\.com/);
  assert.match(steps, /NodexPro <noreply@nodexpro.com>/);
  assert.doesNotMatch(steps, /https:\/\/www\.nodexpro\.com\/\*\*/);
  const blob = `${html}\n${text}\n${steps}`;
  assert.doesNotMatch(blob, /sk_live|service_role|SUPABASE_SERVICE_ROLE|RESEND_API_KEY|smtp-password/i);
});

test('Dashboard GoTrue templates use only ConfirmationURL and cover all Auth email kinds', () => {
  for (const kind of NODEXPRO_GOTRUE_EMAIL_KINDS) {
    const html = nodexproGoTrueDashboardHtml(kind);
    const text = nodexproGoTrueDashboardText(kind);
    assert.equal(dashboardTemplateUsesOnlyConfirmationUrl(html), true);
    assert.match(html, /\{\{ \.ConfirmationURL \}\}/);
    assert.match(text, /\{\{ \.ConfirmationURL \}\}/);
    assert.match(nodexproGoTrueEmailSubject(kind), /NodexPro/);
    assert.doesNotMatch(html, /\{\{\s*\.\s*Token/);
    assert.doesNotMatch(html, /token_hash=/i);
    assert.doesNotMatch(html, /sk_live|RESEND_API_KEY|service_role/i);
    assert.doesNotMatch(html, /[\u0590-\u05FF]/);
  }
  assert.match(nodexproGoTrueDashboardHtml('signup'), /Confirm Email/);
  assert.match(nodexproGoTrueDashboardHtml('recovery'), /Reset Password/);
  assert.match(nodexproGoTrueDashboardHtml('invite'), /Accept Invitation/);
  assert.match(nodexproGoTrueDashboardHtml('magic_link'), /Sign in/);
  assert.match(nodexproGoTrueDashboardHtml('email_change'), /Confirm Email/);
});

test('signup redirect is allowlisted and rejects open redirects', () => {
  assert.equal(
    nodexproSignupEmailRedirectTo({ appUrl: 'https://www.nodexpro.com', frontendUrl: null }),
    'https://www.nodexpro.com/auth/confirm',
  );
  assert.equal(
    nodexproSignupEmailRedirectTo({ appUrl: 'https://evil.example/login', frontendUrl: null }),
    'https://www.nodexpro.com/auth/confirm',
  );
  assert.equal(
    nodexproSignupEmailRedirectTo({ appUrl: 'http://localhost:5173', frontendUrl: null }),
    'http://localhost:5173/auth/confirm',
  );
  assert.equal(isAllowedNodexProAuthRedirect('https://www.nodexpro.com/login'), true);
  assert.equal(isAllowedNodexProAuthRedirect('https://www.nodexpro.com/auth/confirm'), true);
  assert.equal(isAllowedNodexProAuthRedirect('https://attacker.example/login'), false);
  assert.equal(isAllowedNodexProAuthRedirect('https://www.nodexpro.com.evil.com/login'), false);
  assert.equal(isAllowedNodexProAuthRedirect('https://www.nodexpro.com/dashboard'), false);
  assert.equal(isAllowedNodexProAuthRedirect('https://www.nodexpro.com/login?next=https://evil.com'), false);
  assert.equal(isAllowedNodexProAuthRedirect('javascript:alert(1)'), false);
  assert.match(authServiceSrc, /emailRedirectTo:\s*nodexproSignupEmailRedirectTo/);
  assert.match(authServiceSrc, /emailRedirectTo/);
});
