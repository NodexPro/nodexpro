import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODEXPRO_AUTH_REDIRECT_ALLOWLIST,
  NODEXPRO_SUPABASE_AUTH_EMAIL_DASHBOARD_STEPS,
  NODEXPRO_VERIFICATION_FROM_DISPLAY,
  NODEXPRO_VERIFICATION_SUBJECT,
  NODEXPRO_VERIFICATION_TOKEN_TTL_HOURS,
  nodexproVerificationConfirmUrl,
  nodexproVerificationEmailHtml,
  nodexproVerificationEmailText,
} from '../../src/domains/auth/nodexpro-verification-email.pure.js';

test('NodexPro verification email is English, branded, and does not embed secrets', () => {
  const url = nodexproVerificationConfirmUrl('https://www.nodexpro.com', 'abc.def');
  assert.equal(url, 'https://www.nodexpro.com/auth/confirm?token_hash=abc.def&type=signup');
  const html = nodexproVerificationEmailHtml({ confirmUrl: url });
  const text = nodexproVerificationEmailText({ confirmUrl: url });
  assert.match(NODEXPRO_VERIFICATION_SUBJECT, /NodexPro/);
  assert.match(NODEXPRO_VERIFICATION_FROM_DISPLAY, /NodexPro/);
  assert.match(html, /Confirm your email/);
  assert.match(html, /NodexPro/);
  assert.doesNotMatch(html, /[\u0590-\u05FF]/);
  assert.match(text, /Confirm your email/);
  assert.equal(NODEXPRO_VERIFICATION_TOKEN_TTL_HOURS, 24);
  assert.ok(NODEXPRO_AUTH_REDIRECT_ALLOWLIST.includes('https://www.nodexpro.com/login'));
  assert.ok(NODEXPRO_SUPABASE_AUTH_EMAIL_DASHBOARD_STEPS.length >= 6);
  const blob = `${html}\n${text}\n${NODEXPRO_SUPABASE_AUTH_EMAIL_DASHBOARD_STEPS.join('\n')}`;
  assert.doesNotMatch(blob, /sk_live|service_role|SUPABASE_SERVICE_ROLE|RESEND_API_KEY|smtp-password/i);
});
