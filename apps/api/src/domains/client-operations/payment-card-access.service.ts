import crypto from 'crypto';
import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';

export type PaymentContext = 'vat' | 'income_tax';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const OTP_LENGTH = 6;
const MAX_ATTEMPTS = 5;

function otpPepper(): string {
  const p = process.env.SENSITIVE_ACCESS_CODE_PEPPER?.trim();
  if (p) return p;
  const k = process.env.CLIENT_DATA_ENCRYPTION_KEY?.trim();
  if (k) return k;
  return 'dev-only-pepper-set-SENSITIVE_ACCESS_CODE_PEPPER';
}

export function hashOtpCode(challengeId: string, code: string): string {
  const digits = String(code).replace(/\D/g, '').slice(0, 12);
  return crypto.createHash('sha256').update(`${otpPepper()}:${challengeId}:${digits}`).digest('hex');
}

function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');
}

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

async function getOrganizationPhone(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('phone')
    .eq('organization_id', orgId)
    .maybeSingle();
  const p = (data as { phone?: string | null } | null)?.phone?.trim();
  return p || null;
}

async function insertPaymentCardEventLog(params: {
  organizationId: string;
  clientId: string;
  userId: string;
  actionType: string;
  fieldChanged: string;
}): Promise<void> {
  await supabaseAdmin.from('client_tax_settings_event_log').insert({
    organization_id: params.organizationId,
    client_id: params.clientId,
    user_id: params.userId,
    action_type: params.actionType,
    field_changed: params.fieldChanged,
    old_value: null,
    new_value: '[event]',
  });
}

async function sendOtpSms(toPhone: string, code: string): Promise<void> {
  const msg = `NodexPro — קוד אימות לפרטי כרטיס: ${code}`;
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();

  if (sid && token && from) {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const params = new URLSearchParams();
    params.set('To', toPhone);
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
      console.error('[twilio-sms]', res.status, t);
      throw new AppError(503, 'שליחת קוד האימות נכשלה. נסה שוב מאוחר יותר.', 'SMS_SEND_FAILED');
    }
    return;
  }

  console.warn(`[payment-card-sms] Twilio not configured — OTP for ${toPhone}: ${code}`);
}

async function deactivateExpiredSessions(orgId: string, clientId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('client_sensitive_access_sessions')
    .update({ is_active: false })
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .lt('expires_at', now);
}

export type PaymentSecureSessionInfo = { active: boolean; expires_at: string | null };

export async function getPaymentSecureSessionsForUser(
  orgId: string,
  userId: string,
  clientId: string
): Promise<{ vat: PaymentSecureSessionInfo; income_tax: PaymentSecureSessionInfo }> {
  await deactivateExpiredSessions(orgId, clientId, userId);

  const { data: rows } = await supabaseAdmin
    .from('client_sensitive_access_sessions')
    .select('payment_context, expires_at, is_active')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .eq('is_active', true);

  const now = Date.now();
  const pick = (ctx: PaymentContext): PaymentSecureSessionInfo => {
    const r = rows?.find((x: { payment_context: string }) => x.payment_context === ctx);
    if (!r) return { active: false, expires_at: null };
    const exp = new Date(r.expires_at).getTime();
    if (exp <= now) return { active: false, expires_at: null };
    return { active: true, expires_at: r.expires_at as string };
  };

  return {
    vat: pick('vat'),
    income_tax: pick('income_tax'),
  };
}

export async function assertPaymentCardSecureSessionActive(
  ctx: RequestContext,
  clientId: string,
  paymentContext: PaymentContext
): Promise<void> {
  const orgId = assertOrg(ctx);
  const userId = ctx.user.id;
  const sessions = await getPaymentSecureSessionsForUser(orgId, userId, clientId);
  const s = paymentContext === 'vat' ? sessions.vat : sessions.income_tax;
  if (s.active) return;

  throw new AppError(
    403,
    'נדרש אימות טלפוני (קוד לטלפון הארגון) כדי להעתיק את פרטי הכרטיס.',
    'SECURE_SESSION_REQUIRED'
  );
}

export async function requestPaymentCardAccessCode(
  ctx: RequestContext,
  clientId: string,
  paymentContext: PaymentContext
): Promise<{ challenge_id: string; expires_in_seconds: number }> {
  const orgId = assertOrg(ctx);
  const userId = ctx.user.id;

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (!client) throw forbidden('Client not found');

  const phone = await getOrganizationPhone(orgId);
  if (!phone) {
    throw badRequest(
      'לא מוגדר מספר טלפון בארגון. הוסף טלפון בהגדרות הארגון כדי לקבל קוד אימות.',
      'ORG_PHONE_MISSING'
    );
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const challengeId = crypto.randomUUID();

  const { data: inserted, error } = await supabaseAdmin
    .from('client_sensitive_access_challenges')
    .insert({
      id: challengeId,
      organization_id: orgId,
      client_id: clientId,
      user_id: userId,
      payment_context: paymentContext,
      code_hash: hashOtpCode(challengeId, code),
      expires_at: expiresAt,
      attempts_left: MAX_ATTEMPTS,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error || !inserted) {
    throw new AppError(500, error?.message ?? 'challenge insert failed', 'CHALLENGE_FAILED');
  }

  await sendOtpSms(phone, code);

  await insertPaymentCardEventLog({
    organizationId: orgId,
    clientId,
    userId,
    actionType: 'payment_card_access_code_sent',
    fieldChanged: `${paymentContext}:challenge`,
  });

  await writeAudit({
    organizationId: orgId,
    actorUserId: userId,
    moduleCode: 'client-operations',
    entityType: 'client_tax_settings',
    entityId: clientId,
    action: AUDIT_ACTIONS.PAYMENT_CARD_ACCESS_CODE_SENT,
    payload: { client_id: clientId, payment_context: paymentContext },
  });

  return {
    challenge_id: inserted.id as string,
    expires_in_seconds: Math.floor(CHALLENGE_TTL_MS / 1000),
  };
}

export async function verifyPaymentCardAccessCode(
  ctx: RequestContext,
  clientId: string,
  challengeId: string,
  code: string,
  paymentContext: PaymentContext
): Promise<{ secure_session_active: boolean; expires_at: string }> {
  const orgId = assertOrg(ctx);
  const userId = ctx.user.id;

  const { data: ch, error } = await supabaseAdmin
    .from('client_sensitive_access_challenges')
    .select('*')
    .eq('id', challengeId)
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .eq('payment_context', paymentContext)
    .maybeSingle();

  if (error || !ch) {
    throw badRequest('בקשת אימות לא נמצאה או פגה.');
  }

  const row = ch as {
    status: string;
    expires_at: string;
    attempts_left: number;
    code_hash: string;
  };

  if (row.status !== 'pending') {
    throw badRequest('קוד האימות כבר נוצל או בוטל.');
  }
  if (new Date(row.expires_at) < new Date()) {
    await supabaseAdmin.from('client_sensitive_access_challenges').update({ status: 'expired' }).eq('id', challengeId);
    throw badRequest('קוד האימות פג תוקף. בקש קוד חדש.');
  }

  const expectedHash = hashOtpCode(challengeId, code);
  if (expectedHash !== row.code_hash) {
    const nextAttempts = Math.max(0, row.attempts_left - 1);
    await supabaseAdmin
      .from('client_sensitive_access_challenges')
      .update({
        attempts_left: nextAttempts,
        status: nextAttempts <= 0 ? 'failed' : 'pending',
      })
      .eq('id', challengeId);
    throw badRequest(nextAttempts <= 0 ? 'יותר מדי ניסיונות שגויים. בקש קוד חדש.' : 'קוד שגוי.');
  }

  await supabaseAdmin.from('client_sensitive_access_challenges').update({ status: 'verified' }).eq('id', challengeId);

  const sessionExpires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const grantedAt = new Date().toISOString();

  const { data: existing } = await supabaseAdmin
    .from('client_sensitive_access_sessions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .eq('payment_context', paymentContext)
    .maybeSingle();

  if (existing?.id) {
    await supabaseAdmin
      .from('client_sensitive_access_sessions')
      .update({
        challenge_id: challengeId,
        granted_at: grantedAt,
        expires_at: sessionExpires,
        is_active: true,
      })
      .eq('id', existing.id);
  } else {
    await supabaseAdmin.from('client_sensitive_access_sessions').insert({
      organization_id: orgId,
      client_id: clientId,
      user_id: userId,
      payment_context: paymentContext,
      challenge_id: challengeId,
      granted_at: grantedAt,
      expires_at: sessionExpires,
      is_active: true,
    });
  }

  await insertPaymentCardEventLog({
    organizationId: orgId,
    clientId,
    userId,
    actionType: 'payment_card_secure_session_granted',
    fieldChanged: `${paymentContext}:session`,
  });

  await writeAudit({
    organizationId: orgId,
    actorUserId: userId,
    moduleCode: 'client-operations',
    entityType: 'client_tax_settings',
    entityId: clientId,
    action: AUDIT_ACTIONS.PAYMENT_CARD_ACCESS_VERIFIED,
    payload: { client_id: clientId, payment_context: paymentContext },
  });

  return { secure_session_active: true, expires_at: sessionExpires };
}
