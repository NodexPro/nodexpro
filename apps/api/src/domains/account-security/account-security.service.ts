import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { supabaseAdmin } from '../../db/client.js';
import { sendEmail } from '../delivery/delivery-email.transport.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, tooManyRequests, unauthorized } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import {
  additionalEmailAllowedActions,
  canReplaceAdditionalEmail,
  canRequestAdditionalEmail,
  normalizeEmail,
  resolveCanonicalLoginEmail,
  type AdditionalLoginEmailRow,
  validateNewPassword,
} from './account-security.pure.js';

const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey);
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_WINDOW_MS = 15 * 60 * 1000;
const RESEND_MAX = 5;

type LoginEmailDbRow = {
  id: string;
  user_id: string;
  email: string;
  status: AdditionalLoginEmailRow['status'];
  verification_token_hash: string | null;
  verification_expires_at: string | null;
  verified_at: string | null;
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function requestAppUrl(): string {
  return (process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '');
}

function auditMeta(ctx: RequestContext, req?: { ip?: string; headers?: Record<string, unknown> }) {
  return {
    ipAddress: typeof req?.ip === 'string' ? req.ip : null,
    userAgent: typeof req?.headers?.['user-agent'] === 'string' ? String(req.headers['user-agent']) : null,
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
  };
}

export async function lookupVerifiedSecondary(identifier: string): Promise<{
  email: string;
  primaryEmail: string;
} | null> {
  const email = normalizeEmail(identifier);
  const { data } = await supabaseAdmin
    .from('user_login_emails')
    .select('email, user_id')
    .eq('email', email)
    .eq('status', 'verified')
    .maybeSingle();
  const row = data as { email?: string; user_id?: string } | null;
  if (!row?.user_id) return null;
  const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', row.user_id).maybeSingle();
  const primary = typeof user?.email === 'string' ? normalizeEmail(user.email) : '';
  if (!primary) return null;
  return { email: normalizeEmail(row.email ?? email), primaryEmail: primary };
}

export async function resolveLoginIdentifier(identifier: string): Promise<string> {
  const verifiedSecondary = await lookupVerifiedSecondary(identifier);
  return resolveCanonicalLoginEmail({ identifier, verifiedSecondary });
}

async function loadLoginEmails(userId: string): Promise<LoginEmailDbRow[]> {
  const { data, error } = await supabaseAdmin
    .from('user_login_emails')
    .select('id, user_id, email, status, verification_token_hash, verification_expires_at, verified_at')
    .eq('user_id', userId)
    .neq('status', 'revoked');
  if (error) throw error;
  return (data ?? []) as LoginEmailDbRow[];
}

async function emailsRegisteredToOtherAccounts(email: string, userId: string): Promise<string[]> {
  const taken: string[] = [];
  const { data: users } = await supabaseAdmin.from('users').select('id, email').eq('email', email);
  if ((users ?? []).some((row) => row.id !== userId)) taken.push(email);
  const { data: aliases } = await supabaseAdmin
    .from('user_login_emails')
    .select('user_id, email, status')
    .eq('email', email)
    .neq('status', 'revoked');
  if ((aliases ?? []).some((row) => row.user_id !== userId)) taken.push(email);
  return taken;
}

async function assertResendRate(userId: string): Promise<void> {
  const since = new Date(Date.now() - RESEND_WINDOW_MS).toISOString();
  const { count } = await supabaseAdmin
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_user_id', userId)
    .eq('action', AUDIT_ACTIONS.AUTH_ADDITIONAL_EMAIL_RESENT)
    .gte('created_at', since);
  if ((count ?? 0) >= RESEND_MAX) {
    throw tooManyRequests('Too many verification emails. Please wait and try again.');
  }
}

async function issueVerification(rowId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const { error } = await supabaseAdmin
    .from('user_login_emails')
    .update({
      verification_token_hash: hashToken(token),
      verification_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);
  if (error) throw error;
  return token;
}

async function sendVerificationEmail(ctx: RequestContext, to: string, token: string): Promise<void> {
  if (!ctx.organizationId) {
    throw badRequest('Organization context is required to send verification email.', 'EMAIL_CONTEXT_REQUIRED');
  }
  const verifyUrl = `${requestAppUrl()}/verify-additional-email?token=${encodeURIComponent(token)}`;
  const result = await sendEmail({
    organizationId: ctx.organizationId,
    to,
    subject: 'Verify your additional NodexPro login email',
    body_text: `Confirm this additional login email for your NodexPro account:\n${verifyUrl}\nThis link expires in 24 hours and can be used once.`,
    body_html: `<p>Confirm this additional login email for your NodexPro account.</p><p><a href="${verifyUrl}">Verify email</a></p><p>This link expires in 24 hours and can be used once.</p>`,
  });
  if (result.status !== 'sent') {
    throw badRequest(
      'Verification email could not be sent. Check the office email provider configuration.',
      'EMAIL_PROVIDER_NOT_CONFIGURED',
    );
  }
}

export async function buildAccountSecurityAggregate(ctx: RequestContext, emailVerified: boolean) {
  const rows = await loadLoginEmails(ctx.user.id);
  const verified = rows.find((row) => row.status === 'verified') ?? null;
  const pending = rows.find(
    (row) => row.status === 'pending_verification' || row.status === 'pending_replacement',
  );
  return {
    primary_login_email: ctx.user.email,
    primary_email_verified: emailVerified,
    additional_login_email: verified?.email ?? null,
    additional_status: verified?.status ?? pending?.status ?? null,
    additional_pending_email: pending?.email ?? null,
    allowed_actions: additionalEmailAllowedActions(rows),
    password_indicator: '••••••••••••',
    password_reveal_forbidden: true,
  };
}

export async function requestAdditionalLoginEmail(
  ctx: RequestContext,
  requestedEmailRaw: string,
  req?: { ip?: string; headers?: Record<string, unknown> },
) {
  const requestedEmail = normalizeEmail(requestedEmailRaw);
  const existing = await loadLoginEmails(ctx.user.id);
  const taken = await emailsRegisteredToOtherAccounts(requestedEmail, ctx.user.id);
  const allowed = canRequestAdditionalEmail({
    primaryEmail: ctx.user.email,
    requestedEmail,
    existing,
    emailsRegisteredToOtherAccounts: taken,
  });
  if (!allowed.ok) throw conflict(allowed.message, allowed.code);
  await assertResendRate(ctx.user.id);
  const { data, error } = await supabaseAdmin
    .from('user_login_emails')
    .insert({
      user_id: ctx.user.id,
      email: requestedEmail,
      status: 'pending_verification',
    })
    .select('id')
    .single();
  if (error || !data?.id) throw conflict('This email cannot be used.', 'EMAIL_TAKEN');
  const token = await issueVerification(String(data.id));
  try {
    await sendVerificationEmail(ctx, requestedEmail, token);
  } catch (err) {
    await supabaseAdmin.from('user_login_emails').delete().eq('id', data.id);
    throw err;
  }
  await writeAudit({
    ...auditMeta(ctx, req),
    entityType: 'user_login_email',
    entityId: data.id,
    action: AUDIT_ACTIONS.AUTH_ADDITIONAL_EMAIL_REQUESTED,
    payload: { additional_email: requestedEmail },
  });
}

export async function replaceAdditionalLoginEmail(
  ctx: RequestContext,
  requestedEmailRaw: string,
  req?: { ip?: string; headers?: Record<string, unknown> },
) {
  const requestedEmail = normalizeEmail(requestedEmailRaw);
  const existing = await loadLoginEmails(ctx.user.id);
  const taken = await emailsRegisteredToOtherAccounts(requestedEmail, ctx.user.id);
  const allowed = canReplaceAdditionalEmail({
    primaryEmail: ctx.user.email,
    requestedEmail,
    existing,
    emailsRegisteredToOtherAccounts: taken,
  });
  if (!allowed.ok) throw conflict(allowed.message, allowed.code);
  await assertResendRate(ctx.user.id);
  const { data, error } = await supabaseAdmin
    .from('user_login_emails')
    .insert({
      user_id: ctx.user.id,
      email: requestedEmail,
      status: 'pending_replacement',
    })
    .select('id')
    .single();
  if (error || !data?.id) throw conflict('This email cannot be used.', 'EMAIL_TAKEN');
  const token = await issueVerification(String(data.id));
  try {
    await sendVerificationEmail(ctx, requestedEmail, token);
  } catch (err) {
    await supabaseAdmin.from('user_login_emails').delete().eq('id', data.id);
    throw err;
  }
  await writeAudit({
    ...auditMeta(ctx, req),
    entityType: 'user_login_email',
    entityId: data.id,
    action: AUDIT_ACTIONS.AUTH_ADDITIONAL_EMAIL_REPLACED,
    payload: { additional_email: requestedEmail, previous_remains_active: true },
  });
}

export async function resendAdditionalLoginEmail(
  ctx: RequestContext,
  req?: { ip?: string; headers?: Record<string, unknown> },
) {
  const existing = await loadLoginEmails(ctx.user.id);
  const pending = existing.find(
    (row) => row.status === 'pending_verification' || row.status === 'pending_replacement',
  );
  if (!pending) throw badRequest('No pending additional email to verify.');
  await assertResendRate(ctx.user.id);
  const token = await issueVerification(pending.id);
  await sendVerificationEmail(ctx, pending.email, token);
  await writeAudit({
    ...auditMeta(ctx, req),
    entityType: 'user_login_email',
    entityId: pending.id,
    action: AUDIT_ACTIONS.AUTH_ADDITIONAL_EMAIL_RESENT,
    payload: { additional_email: pending.email },
  });
}

export async function removeAdditionalLoginEmail(
  ctx: RequestContext,
  req?: { ip?: string; headers?: Record<string, unknown> },
) {
  const existing = await loadLoginEmails(ctx.user.id);
  if (existing.length === 0) throw badRequest('No additional login email to remove.');
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('user_login_emails')
    .update({
      status: 'revoked',
      verification_token_hash: null,
      verification_expires_at: null,
      updated_at: now,
    })
    .eq('user_id', ctx.user.id)
    .neq('status', 'revoked');
  if (error) throw error;
  await writeAudit({
    ...auditMeta(ctx, req),
    entityType: 'user_login_email',
    entityId: ctx.user.id,
    action: AUDIT_ACTIONS.AUTH_ADDITIONAL_EMAIL_REMOVED,
    payload: { primary_preserved: true },
  });
}

export async function verifyAdditionalLoginEmail(rawToken: string, req?: { ip?: string }) {
  const token = rawToken.trim();
  if (!token) throw badRequest('Verification token is required.');
  const tokenHash = hashToken(token);
  const { data, error } = await supabaseAdmin
    .from('user_login_emails')
    .select('id, user_id, email, status, verification_expires_at')
    .eq('verification_token_hash', tokenHash)
    .maybeSingle();
  if (error) throw error;
  const row = data as LoginEmailDbRow | null;
  if (!row) throw badRequest('This verification link is invalid or was already used.', 'INVALID_TOKEN');
  if (row.verification_expires_at && new Date(row.verification_expires_at).getTime() <= Date.now()) {
    throw badRequest('This verification link has expired.', 'EXPIRED_TOKEN');
  }
  const now = new Date().toISOString();
  if (row.status === 'pending_replacement') {
    await supabaseAdmin
      .from('user_login_emails')
      .update({
        status: 'revoked',
        verification_token_hash: null,
        verification_expires_at: null,
        updated_at: now,
      })
      .eq('user_id', row.user_id)
      .eq('status', 'verified');
  }
  const { error: verifyErr } = await supabaseAdmin
    .from('user_login_emails')
    .update({
      status: 'verified',
      verification_token_hash: null,
      verification_expires_at: null,
      verified_at: now,
      updated_at: now,
    })
    .eq('id', row.id);
  if (verifyErr) throw conflict('This email cannot be used.', 'EMAIL_TAKEN');
  await writeAudit({
    organizationId: null,
    actorUserId: row.user_id,
    entityType: 'user_login_email',
    entityId: row.id,
    action: AUDIT_ACTIONS.AUTH_ADDITIONAL_EMAIL_VERIFIED,
    payload: { additional_email: row.email },
    ipAddress: typeof req?.ip === 'string' ? req.ip : null,
  });
  return { ok: true, user_id: row.user_id };
}

export async function changePasswordThroughSupabase(
  ctx: RequestContext,
  input: { currentPassword: string; newPassword: string; confirmPassword: string },
  req?: { ip?: string; headers?: Record<string, unknown> },
) {
  if (input.newPassword !== input.confirmPassword) {
    throw badRequest('New password and confirmation do not match.', 'PASSWORD_MISMATCH');
  }
  const invalid = validateNewPassword(input.newPassword);
  if (invalid) throw badRequest(invalid, 'WEAK_PASSWORD');
  const { error: reauthError } = await supabaseAuth.auth.signInWithPassword({
    email: ctx.user.email,
    password: input.currentPassword,
  });
  if (reauthError) throw unauthorized('Current password is incorrect.', 'REAUTH_FAILED');
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(ctx.user.authUserId, {
    password: input.newPassword,
  });
  if (updateError) throw badRequest(updateError.message, 'PASSWORD_UPDATE_FAILED');
  await writeAudit({
    ...auditMeta(ctx, req),
    entityType: 'user',
    entityId: ctx.user.id,
    action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
    payload: { method: 'reauth_current_password' },
  });
}
