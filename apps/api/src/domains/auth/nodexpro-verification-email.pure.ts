/**
 * NodexPro GoTrue (Supabase Auth) email branding.
 * Dashboard templates must use the literal placeholder {{ .ConfirmationURL }}.
 * Never paste token_hash, {{ .Token }}, or SMTP secrets into git, logs, or chat.
 */

export const NODEXPRO_GOTRUE_CONFIRMATION_URL = '{{ .ConfirmationURL }}';

export const NODEXPRO_VERIFICATION_FROM_DISPLAY = 'NodexPro <noreply@nodexpro.com>';
export const NODEXPRO_VERIFICATION_SUBJECT = 'Confirm your NodexPro email';
export const NODEXPRO_VERIFICATION_TOKEN_TTL_HOURS = 24;

export const NODEXPRO_AUTH_SITE_URL = 'https://www.nodexpro.com';
export const NODEXPRO_LOGO_URL = 'https://www.nodexpro.com/nodexpro-logo.png';

export type NodexProGoTrueEmailKind = 'signup' | 'recovery' | 'invite' | 'magic_link' | 'email_change';

export const NODEXPRO_GOTRUE_EMAIL_KINDS: readonly NodexProGoTrueEmailKind[] = [
  'signup',
  'recovery',
  'invite',
  'magic_link',
  'email_change',
];

export const NODEXPRO_AUTH_REDIRECT_PATHS = [
  '/login',
  '/auth/confirm',
  '/auth/callback',
  '/reset-password',
] as const;

export const NODEXPRO_PRODUCTION_AUTH_ORIGINS = ['https://www.nodexpro.com', 'https://nodexpro.com'] as const;

export const NODEXPRO_AUTH_REDIRECT_ALLOWLIST: string[] = NODEXPRO_PRODUCTION_AUTH_ORIGINS.flatMap((origin) =>
  NODEXPRO_AUTH_REDIRECT_PATHS.map((path) => `${origin}${path}`),
);

const DEEP_OCEAN = {
  page: '#061428',
  card: '#0b1f3d',
  border: '#1a3a66',
  accent: '#268cff',
  text: '#e8eef7',
  muted: '#9fb3cc',
  buttonText: '#061428',
} as const;

const COPY: Record<
  NodexProGoTrueEmailKind,
  { subject: string; title: string; intro: string; button: string; hint: string }
> = {
  signup: {
    subject: NODEXPRO_VERIFICATION_SUBJECT,
    title: 'Confirm your email',
    intro: 'Welcome to NodexPro. Confirm this email address to activate your account and continue setup.',
    button: 'Confirm Email',
    hint: 'This link expires in 24 hours. If you did not create a NodexPro account, you can ignore this message.',
  },
  recovery: {
    subject: 'Reset your NodexPro password',
    title: 'Reset your password',
    intro: 'We received a request to reset the password for your NodexPro account. Use the button below to choose a new password.',
    button: 'Reset Password',
    hint: 'This link expires in 24 hours. If you did not request a password reset, you can ignore this message.',
  },
  invite: {
    subject: "You've been invited to NodexPro",
    title: 'You are invited',
    intro: 'You were invited to join an organization on NodexPro. Confirm this email to accept the invitation.',
    button: 'Accept Invitation',
    hint: 'This link expires in 24 hours. If you were not expecting this invitation, you can ignore this message.',
  },
  magic_link: {
    subject: 'Sign in to NodexPro',
    title: 'Sign in to NodexPro',
    intro: 'Use the button below to sign in to your NodexPro account. No password is required for this step.',
    button: 'Sign in',
    hint: 'This link expires in 24 hours. If you did not request a sign-in link, you can ignore this message.',
  },
  email_change: {
    subject: 'Confirm your new NodexPro email',
    title: 'Confirm your new email',
    intro: 'Confirm this email address to finish updating the login email on your NodexPro account.',
    button: 'Confirm Email',
    hint: 'This link expires in 24 hours. If you did not request an email change, you can ignore this message.',
  },
};

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeAuthEmailHref(raw: string): boolean {
  const value = String(raw ?? '').trim();
  if (value === NODEXPRO_GOTRUE_CONFIRMATION_URL) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function hrefForTemplate(confirmUrl: string): string {
  const value = String(confirmUrl ?? '').trim();
  if (value === NODEXPRO_GOTRUE_CONFIRMATION_URL) return NODEXPRO_GOTRUE_CONFIRMATION_URL;
  if (!isSafeAuthEmailHref(value)) return '#';
  return escapeHtml(value);
}

export function isAllowedNodexProAuthRedirect(
  raw: string | null | undefined,
  extraOrigins: Array<string | null | undefined> = [],
): boolean {
  const value = String(raw ?? '').trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.hash || url.search) return false;
    const origin = `${url.protocol}//${url.host}`.replace(/\/$/, '');
    const pathOk = (NODEXPRO_AUTH_REDIRECT_PATHS as readonly string[]).includes(url.pathname);
    if (!pathOk) return false;
    if ((NODEXPRO_PRODUCTION_AUTH_ORIGINS as readonly string[]).includes(origin)) {
      return url.protocol === 'https:';
    }
    const extras = extraOrigins
      .map((item) => String(item ?? '').trim().replace(/\/$/, ''))
      .filter((item) => /^https?:\/\//i.test(item));
    if (!extras.includes(origin)) return false;
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (local) return url.protocol === 'http:' || url.protocol === 'https:';
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function nodexproSignupEmailRedirectTo(env: {
  appUrl?: string | null;
  frontendUrl?: string | null;
}): string {
  const fallback = `${NODEXPRO_AUTH_SITE_URL}/auth/confirm`;
  const origins = [env.appUrl, env.frontendUrl]
    .map((item) => String(item ?? '').trim().replace(/\/$/, ''))
    .filter(Boolean);
  for (const origin of origins) {
    const candidate = `${origin}/auth/confirm`;
    if (isAllowedNodexProAuthRedirect(candidate, origins)) return candidate;
  }
  return fallback;
}

/** Token-hash helper for the /auth/confirm page. Do not paste this URL into Dashboard templates. */
export function nodexproVerificationConfirmUrl(appOrigin: string, tokenHash: string): string {
  const origin = String(appOrigin ?? '').trim().replace(/\/$/, '');
  const hash = String(tokenHash ?? '').trim();
  return `${origin}/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=signup`;
}

function brandedHtml(kind: NodexProGoTrueEmailKind, confirmUrl: string): string {
  const copy = COPY[kind];
  const href = hrefForTemplate(confirmUrl);
  const logo = escapeHtml(NODEXPRO_LOGO_URL);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(copy.title)}</title>
</head>
<body style="margin:0;padding:0;background:${DEEP_OCEAN.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${DEEP_OCEAN.page};">
<tr><td style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:${DEEP_OCEAN.card};border:1px solid ${DEEP_OCEAN.border};border-radius:8px;">
<tr><td style="padding:28px 28px 8px;text-align:center;">
<img src="${logo}" alt="NodexPro" width="160" style="display:inline-block;max-width:160px;height:auto;border:0;outline:none;text-decoration:none;">
<p style="margin:12px 0 0;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:${DEEP_OCEAN.accent};font-weight:700;">NodexPro</p>
</td></tr>
<tr><td style="padding:8px 28px 28px;">
<h1 style="margin:16px 0 12px;font-size:22px;line-height:1.25;color:${DEEP_OCEAN.text};font-weight:700;">${escapeHtml(copy.title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:${DEEP_OCEAN.muted};">${escapeHtml(copy.intro)}</p>
<p style="margin:0 0 24px;text-align:center;">
<a href="${href}" style="display:inline-block;padding:8px 20px;background:${DEEP_OCEAN.accent};color:${DEEP_OCEAN.buttonText};text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;line-height:1.2;">${escapeHtml(copy.button)}</a>
</p>
<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${DEEP_OCEAN.muted};">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all;color:${DEEP_OCEAN.accent};">${href}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:${DEEP_OCEAN.muted};">${escapeHtml(copy.hint)}</p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid ${DEEP_OCEAN.border};">
<p style="margin:0;font-size:12px;color:${DEEP_OCEAN.muted};">This message was sent by NodexPro. Please do not reply.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function brandedText(kind: NodexProGoTrueEmailKind, confirmUrl: string): string {
  const copy = COPY[kind];
  const href = String(confirmUrl ?? '').trim() || NODEXPRO_GOTRUE_CONFIRMATION_URL;
  return [
    'NodexPro',
    '',
    copy.title,
    '',
    copy.intro,
    '',
    `${copy.button}: ${href}`,
    '',
    copy.hint,
    '',
    'This message was sent by NodexPro. Please do not reply.',
  ].join('\n');
}

export function nodexproGoTrueEmailSubject(kind: NodexProGoTrueEmailKind): string {
  return COPY[kind].subject;
}

/** Dashboard paste: literal {{ .ConfirmationURL }} only. */
export function nodexproGoTrueDashboardHtml(kind: NodexProGoTrueEmailKind): string {
  return brandedHtml(kind, NODEXPRO_GOTRUE_CONFIRMATION_URL);
}

export function nodexproGoTrueDashboardText(kind: NodexProGoTrueEmailKind): string {
  return brandedText(kind, NODEXPRO_GOTRUE_CONFIRMATION_URL);
}

export function nodexproVerificationEmailHtml(input: { confirmUrl: string }): string {
  return brandedHtml('signup', input.confirmUrl);
}

export function nodexproVerificationEmailText(input: { confirmUrl: string }): string {
  return brandedText('signup', input.confirmUrl);
}

export function dashboardTemplateUsesOnlyConfirmationUrl(html: string): boolean {
  const body = String(html ?? '');
  if (!body.includes(NODEXPRO_GOTRUE_CONFIRMATION_URL)) return false;
  if (/\{\{\s*\.\s*Token(Hash)?\s*\}\}/.test(body)) return false;
  if (/token_hash=/i.test(body)) return false;
  return true;
}

/**
 * Manual steps only. Do not apply SMTP, secrets, or Auth Dashboard changes from this codebase.
 * Reuse the existing verified Resend domain. Do not create a second mail stack.
 */
export const NODEXPRO_SUPABASE_AUTH_EMAIL_DASHBOARD_STEPS: string[] = [
  'Resend: confirm that domain nodexpro.com is already verified. Reuse this domain; do not create a second provider or domain for Auth mail.',
  'Resend DNS (existing domain): SPF include for Resend/Amazon SES, DKIM CNAME records from the Resend domain page, and a DMARC TXT at _dmarc.nodexpro.com (start with v=DMARC1; p=none; then tighten after pass).',
  'Supabase Dashboard → Authentication → Emails → SMTP Settings: enable custom SMTP. Host smtp.resend.com, port 465 (SSL) or 587 (STARTTLS), username resend, password = existing Resend API key pasted only in Dashboard (never git or chat).',
  'Sender: display name NodexPro, sender email noreply@nodexpro.com (must match the verified Resend domain).',
  `Site URL: ${NODEXPRO_AUTH_SITE_URL}`,
  `Redirect URLs (exact, no /** wildcard): ${NODEXPRO_AUTH_REDIRECT_ALLOWLIST.join(', ')}`,
  'Confirm signup template: paste nodexproGoTrueDashboardHtml("signup") and nodexproGoTrueDashboardText("signup"). Subject: Confirm your NodexPro email. The only link variable is {{ .ConfirmationURL }}. Do not use {{ .Token }} or {{ .TokenHash }}.',
  'Reset password template: paste recovery HTML/text. Subject: Reset your NodexPro password. Same {{ .ConfirmationURL }} rule.',
  'Also replace Magic Link, Invite user, and Change Email Address templates with the matching NodexPro dashboard HTML so unused GoTrue types are not the Supabase default.',
  'Do not log confirmation URLs, token_hash, or SMTP passwords. After save, register a test mailbox on www.nodexpro.com and confirm From is NodexPro <noreply@nodexpro.com>.',
];
