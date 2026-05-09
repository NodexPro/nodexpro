/**
 * Email delivery via Resend.
 * Used for invitation emails and other transactional emails.
 */
import { Resend } from 'resend';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_NAME = process.env.APP_NAME ?? 'NodexPro';
const _emailFrom = process.env.EMAIL_FROM ?? process.env.INVITE_FROM_EMAIL ?? 'onboarding@resend.dev';
const FROM_EMAIL = _emailFrom.includes('<') ? _emailFrom : `${APP_NAME} <${_emailFrom}>`;
let resend = null;
function getResend() {
    if (!RESEND_API_KEY)
        return null;
    if (!resend)
        resend = new Resend(RESEND_API_KEY);
    return resend;
}
const INVITE_SUBJECT = "You've been invited to join NodexPro";
function buildInviteHtml(params) {
    const { organizationName, roleCode, inviteLink } = params;
    const roleLabel = roleCode ? roleCode.charAt(0).toUpperCase() + roleCode.slice(1) : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invitation</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;color:#374151;background:#f9fafb;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;">
<tr><td style="padding:32px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;">
<tr><td style="padding:32px 24px;">
<p style="margin:0 0 16px;color:#111827;font-size:16px;">You were invited to join an organization in NodexPro.</p>
${organizationName ? `<p style="margin:0 0 16px;color:#374151;font-size:16px;"><strong>Organization:</strong> ${organizationName}</p>` : ''}
${roleLabel ? `<p style="margin:0 0 24px;color:#374151;font-size:16px;"><strong>Role:</strong> ${roleLabel}</p>` : ''}
<p style="margin:0 0 24px;"><a href="${inviteLink}" style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">Accept Invitation</a></p>
<p style="margin:0 0 8px;font-size:14px;color:#6b7280;">If the button doesn't work, copy this link:</p>
<p style="margin:0 0 24px;font-size:14px;word-break:break-all;color:#059669;">${inviteLink}</p>
<p style="margin:0;font-size:14px;color:#6b7280;">If you were not expecting this invitation, you can ignore this email.</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
<p style="margin:0;font-size:12px;color:#9ca3af;">This email was sent by NodexPro</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
function buildInviteText(params) {
    const { organizationName, roleCode, inviteLink } = params;
    const roleLabel = roleCode ? roleCode.charAt(0).toUpperCase() + roleCode.slice(1) : '';
    const lines = [
        'You were invited to join an organization in NodexPro.',
        '',
    ];
    if (organizationName) {
        lines.push(`Organization: ${organizationName}`);
        lines.push('');
    }
    if (roleLabel) {
        lines.push(`Role: ${roleLabel}`);
        lines.push('');
    }
    lines.push('Accept Invitation:');
    lines.push(inviteLink);
    lines.push('');
    lines.push('If you were not expecting this invitation, you can ignore this email.');
    lines.push('');
    lines.push('—');
    lines.push('This email was sent by NodexPro');
    return lines.join('\n');
}
/**
 * Sends invitation email via Resend.
 * @throws Error if RESEND_API_KEY is missing or email send fails
 */
export async function sendInvitationEmail(params) {
    const client = getResend();
    if (!client) {
        throw new Error('RESEND_API_KEY is not configured. Cannot send invitation email.');
    }
    const { to } = params;
    const response = await client.emails.send({
        from: FROM_EMAIL,
        to: [to],
        subject: INVITE_SUBJECT,
        html: buildInviteHtml(params),
        text: buildInviteText(params),
    });
    console.log('EMAIL SEND RESPONSE:', response);
    const { error } = response;
    if (error) {
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : error && typeof error === 'object' && 'name' in error
                ? String(error.name ?? '')
                : '';
        console.error('EMAIL SEND ERROR:', error.message, code || '(no code)');
        throw new Error(`Failed to send invitation email: ${error.message}`);
    }
}
