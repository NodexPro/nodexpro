/**
 * NodexPro branded verification email (English).
 * Auth confirmation is delivered by Supabase Auth (GoTrue SMTP), not the app Resend adapter.
 * Do not put API keys, SMTP passwords, or production secrets in this file.
 */

export const NODEXPRO_VERIFICATION_FROM_DISPLAY = 'NodexPro <noreply@nodexpro.com>';
export const NODEXPRO_VERIFICATION_SUBJECT = 'Confirm your NodexPro email';
export const NODEXPRO_VERIFICATION_TOKEN_TTL_HOURS = 24;

export const NODEXPRO_AUTH_REDIRECT_ALLOWLIST = [
  'https://www.nodexpro.com/login',
  'https://nodexpro.com/login',
  'https://www.nodexpro.com/auth/callback',
  'https://nodexpro.com/auth/callback',
] as const;

export function nodexproVerificationConfirmUrl(baseSiteUrl: string, tokenHash: string): string {
  const origin = String(baseSiteUrl ?? '').replace(/\/+$/, '');
  const hash = encodeURIComponent(String(tokenHash ?? '').trim());
  return `${origin}/auth/confirm?token_hash=${hash}&type=signup`;
}

export function nodexproVerificationEmailText(input: {
  confirmUrl: string;
  expiresHours?: number;
}): string {
  const hours = input.expiresHours ?? NODEXPRO_VERIFICATION_TOKEN_TTL_HOURS;
  return [
    'NodexPro',
    '',
    'Confirm your email to finish creating your account.',
    '',
    `Open this link: ${input.confirmUrl}`,
    '',
    `This link expires in ${hours} hours. If you did not create a NodexPro account, ignore this email.`,
  ].join('\n');
}

export function nodexproVerificationEmailHtml(input: {
  confirmUrl: string;
  expiresHours?: number;
}): string {
  const hours = input.expiresHours ?? NODEXPRO_VERIFICATION_TOKEN_TTL_HOURS;
  const url = String(input.confirmUrl ?? '').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Confirm your NodexPro email</title>
</head>
<body style="margin:0;padding:0;background:#061428;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#061428;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0b1f3d;border:1px solid rgba(125,236,247,0.22);border-radius:8px;">
          <tr>
            <td style="padding:28px 28px 8px;color:#7decf7;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;">NodexPro</td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0;color:#eef6ff;font-size:22px;font-weight:700;">Confirm your email</td>
          </tr>
          <tr>
            <td style="padding:12px 28px 24px;color:#c8d9ed;font-size:15px;line-height:1.5;">
              Please confirm this address to finish creating your NodexPro account. Then return to sign in with the confirmed email and password.
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;" align="center">
              <a href="${url}" style="display:inline-block;background:#268cff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;line-height:1.2;padding:10px 20px;border-radius:6px;">Confirm email</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;color:rgba(200,217,237,0.72);font-size:12px;line-height:1.5;">
              This link expires in ${hours} hours. If the button does not work, paste this URL into your browser:<br />
              <span style="word-break:break-all;color:#7decf7;">${url}</span><br /><br />
              If you did not create a NodexPro account, you can ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Manual Supabase Dashboard steps. Do not apply SMTP/secret changes without explicit approval. */
export const NODEXPRO_SUPABASE_AUTH_EMAIL_DASHBOARD_STEPS = [
  'Authentication → URL Configuration → Site URL = https://www.nodexpro.com',
  'Authentication → URL Configuration → Redirect URLs: add https://www.nodexpro.com/** and https://nodexpro.com/** (login + auth/callback + auth/confirm). Do not use a wildcard that includes untrusted hosts.',
  'Authentication → Emails → Confirm signup: enable custom template. Subject: Confirm your NodexPro email. Paste the English HTML/text from nodexpro-verification-email.pure.ts. Use {{ .ConfirmationURL }} only — never log or echo the raw token.',
  'Authentication → Emails → Mailer settings: Confirm email = ON. Inactivity timeout / OTP expiry = 86400 seconds (24h) unless a shorter policy is required.',
  'Project Settings → Authentication → SMTP: keep current production SMTP until agreed. Preferred path: Resend SMTP with from NodexPro <noreply@nodexpro.com> on a verified domain. Do not paste keys into git or chat.',
  'DNS for the sending domain: SPF include:resend.com (or the current SMTP vendor), DKIM CNAMEs from the vendor, DMARC p=quarantine or p=reject after alignment is confirmed.',
  'Verify domain in Resend (or current SMTP) before switching production SMTP. Send a test confirmation to a mailbox you control and confirm From, SPF/DKIM pass, and that the link lands on the allowlisted confirm URL.',
  'Do not disable email confirmation, do not lengthen token TTL beyond 24h without review, and do not put the service-role key in the email template.',
] as const;
