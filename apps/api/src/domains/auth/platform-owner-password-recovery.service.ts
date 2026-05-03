import crypto from 'crypto';
import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { config } from '../../config.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MIN_PASSWORD_LEN = 8;

function otpPepper(): string {
  const p = process.env.SENSITIVE_ACCESS_CODE_PEPPER?.trim();
  if (p) return p;
  const k = process.env.CLIENT_DATA_ENCRYPTION_KEY?.trim();
  if (k) return k;
  return 'dev-only-pepper-set-SENSITIVE_ACCESS_CODE_PEPPER';
}

function hashOtp(challengeId: string, code: string): string {
  const digits = String(code).replace(/\D/g, '').slice(0, 12);
  return crypto.createHash('sha256').update(`${otpPepper()}:${challengeId}:${digits}`).digest('hex');
}

function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');
}

function normalizeOwnerEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function configuredOwnerEmail(): string | null {
  return config.platformOwner.email?.trim().toLowerCase() ?? null;
}

/** E.164 for Twilio; supports IL local starting with 0 */
export function normalizeSmsDestination(raw: string): string {
  const s = raw.replace(/\s/g, '');
  if (s.startsWith('+')) return s;
  if (s.startsWith('0') && s.length >= 9) return `+972${s.slice(1)}`;
  return s;
}

async function sendRecoverySmsE164(toE164: string, code: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  const msg = `NodexPro — קוד אימות לאיפוס סיסמה: ${code}`;

  if (sid && token && from) {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const params = new URLSearchParams();
    params.set('To', toE164);
    params.set('From', from);
    params.set('Body', msg);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[platform-owner-recovery-sms]', res.status, t.slice(0, 200));
      throw new AppError(503, 'Failed to send verification SMS.', 'SMS_SEND_FAILED');
    }
    return;
  }

  if (config.nodeEnv === 'production') {
    throw new AppError(503, 'SMS provider is not configured.', 'SMS_PROVIDER_NOT_CONFIGURED');
  }
  console.warn('[platform-owner-recovery-sms] Twilio not configured (dev only)');
}

export async function requestPlatformOwnerRecovery(params: {
  email: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ recovery_session_id: string }> {
  const want = configuredOwnerEmail();
  if (!want) {
    throw forbidden('Platform owner access is not configured', 'PLATFORM_OWNER_NOT_CONFIGURED');
  }

  const email = normalizeOwnerEmail(params.email);
  if (email !== want) {
    await writeAudit({
      organizationId: null,
      actorUserId: null,
      entityType: 'platform_owner_password_recovery',
      action: AUDIT_ACTIONS.OWNER_PASSWORD_RECOVERY_EMAIL_REJECTED,
      payload: { reason: 'not_owner_email' },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw forbidden('Platform owner recovery is not available for this email.', 'OWNER_RECOVERY_EMAIL_NOT_ALLOWED');
  }

  const phoneRaw = config.platformOwner.phone?.trim();
  if (!phoneRaw) {
    await writeAudit({
      organizationId: null,
      actorUserId: null,
      entityType: 'platform_owner_password_recovery',
      action: AUDIT_ACTIONS.OWNER_PASSWORD_RECOVERY_FAILED,
      payload: { reason: 'owner_phone_not_configured' },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw new AppError(503, 'Platform owner phone is not configured.', 'OWNER_RECOVERY_PHONE_NOT_CONFIGURED');
  }

  const to = normalizeSmsDestination(phoneRaw);
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const id = crypto.randomUUID();
  const otpHash = hashOtp(id, code);

  const { error: insErr } = await supabaseAdmin.from('platform_owner_password_recovery_challenges').insert({
    id,
    otp_hash: otpHash,
    expires_at: expiresAt,
  });

  if (insErr) {
    console.error('[platform-owner-recovery] insert failed', insErr.message);
    throw new AppError(500, 'Could not start recovery.', 'OWNER_RECOVERY_START_FAILED');
  }

  try {
    await sendRecoverySmsE164(to, code);
  } catch (e) {
    await supabaseAdmin.from('platform_owner_password_recovery_challenges').delete().eq('id', id);
    throw e;
  }

  await writeAudit({
    organizationId: null,
    actorUserId: null,
    entityType: 'platform_owner_password_recovery',
    entityId: id,
    action: AUDIT_ACTIONS.OWNER_PASSWORD_RECOVERY_OTP_SENT,
    payload: { channel: 'sms' },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return { recovery_session_id: String(id) };
}

export async function verifyPlatformOwnerRecoveryOtp(params: {
  recovery_session_id: string;
  code: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ verified: true }> {
  const id = String(params.recovery_session_id ?? '').trim();
  if (!id) throw badRequest('recovery_session_id required');

  const { data: row, error } = await supabaseAdmin
    .from('platform_owner_password_recovery_challenges')
    .select('id, otp_hash, expires_at, used_at, otp_verified_at, attempt_count')
    .eq('id', id)
    .maybeSingle();

  if (error || !row) throw badRequest('Invalid recovery session');

  const now = Date.now();
  const exp = new Date(String(row.expires_at)).getTime();
  if (now > exp) {
    await writeAudit({
      organizationId: null,
      actorUserId: null,
      entityType: 'platform_owner_password_recovery',
      entityId: id,
      action: AUDIT_ACTIONS.OWNER_PASSWORD_RECOVERY_OTP_FAILED,
      payload: { reason: 'expired' },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw badRequest('Code expired');
  }
  if (row.used_at) {
    throw badRequest('Recovery session already used');
  }
  if (row.otp_verified_at) {
    return { verified: true };
  }

  const attempts = Number(row.attempt_count ?? 0);
  if (attempts >= MAX_OTP_ATTEMPTS) {
    await writeAudit({
      organizationId: null,
      actorUserId: null,
      entityType: 'platform_owner_password_recovery',
      entityId: id,
      action: AUDIT_ACTIONS.OWNER_PASSWORD_RECOVERY_OTP_FAILED,
      payload: { reason: 'too_many_attempts' },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw forbidden('Too many attempts', 'OWNER_RECOVERY_TOO_MANY_ATTEMPTS');
  }

  const expectedHash = String(row.otp_hash ?? '');
  const actualHash = hashOtp(id, params.code);

  if (actualHash !== expectedHash) {
    await supabaseAdmin
      .from('platform_owner_password_recovery_challenges')
      .update({ attempt_count: attempts + 1 })
      .eq('id', id);
    await writeAudit({
      organizationId: null,
      actorUserId: null,
      entityType: 'platform_owner_password_recovery',
      entityId: id,
      action: AUDIT_ACTIONS.OWNER_PASSWORD_RECOVERY_OTP_FAILED,
      payload: { reason: 'invalid_code' },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw badRequest('Invalid code');
  }

  await supabaseAdmin
    .from('platform_owner_password_recovery_challenges')
    .update({ otp_verified_at: new Date().toISOString() })
    .eq('id', id);

  await writeAudit({
    organizationId: null,
    actorUserId: null,
    entityType: 'platform_owner_password_recovery',
    entityId: id,
    action: AUDIT_ACTIONS.OWNER_PASSWORD_RECOVERY_OTP_VERIFIED,
    payload: {},
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return { verified: true };
}

export async function completePlatformOwnerPasswordReset(params: {
  recovery_session_id: string;
  new_password: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ ok: true }> {
  const ownerEmail = configuredOwnerEmail();
  if (!ownerEmail) {
    throw forbidden('Platform owner access is not configured', 'PLATFORM_OWNER_NOT_CONFIGURED');
  }

  const id = String(params.recovery_session_id ?? '').trim();
  const pw = String(params.new_password ?? '');
  if (!id) throw badRequest('recovery_session_id required');
  if (pw.length < MIN_PASSWORD_LEN) throw badRequest(`Password must be at least ${MIN_PASSWORD_LEN} characters`);

  const { data: row, error } = await supabaseAdmin
    .from('platform_owner_password_recovery_challenges')
    .select('id, expires_at, used_at, otp_verified_at')
    .eq('id', id)
    .maybeSingle();

  if (error || !row) throw badRequest('Invalid recovery session');

  const now = Date.now();
  const exp = new Date(String(row.expires_at)).getTime();
  if (now > exp) throw badRequest('Recovery session expired');
  if (row.used_at) throw badRequest('Recovery session already used');
  if (!row.otp_verified_at) throw badRequest('OTP not verified');

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('auth_user_id')
    .eq('email', ownerEmail)
    .maybeSingle();

  const authUserId = (userRow as { auth_user_id?: string } | null)?.auth_user_id;
  if (!authUserId) {
    console.error('[platform-owner-recovery] no users row for owner email');
    throw new AppError(500, 'Owner account is not provisioned.', 'OWNER_USER_NOT_FOUND');
  }

  const { error: updAuthErr } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    password: pw,
  });

  if (updAuthErr) {
    console.error('[platform-owner-recovery] updateUserById failed', updAuthErr.message);
    throw new AppError(500, 'Could not update password.', 'OWNER_PASSWORD_UPDATE_FAILED');
  }

  await supabaseAdmin
    .from('platform_owner_password_recovery_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('id', id);

  await writeAudit({
    organizationId: null,
    actorUserId: null,
    entityType: 'platform_owner_password_recovery',
    entityId: id,
    action: AUDIT_ACTIONS.OWNER_PASSWORD_RECOVERY_COMPLETED,
    payload: {},
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return { ok: true };
}
