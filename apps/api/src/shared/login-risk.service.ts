import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../db/client.js';
import { isHighRiskChallengePath } from './login-risk.pure.js';

export { isHighRiskChallengePath };

const HIGH_RISK_PENDING_SECONDS = 12 * 60 * 60;

function pendingKey(authUserId: string, kind: 'hr' | 'mfa' = 'hr'): string {
  return `${kind}:${createHash('sha256').update(authUserId).digest('hex').slice(0, 36)}`;
}

export async function markHighRiskLoginPending(authUserId: string): Promise<void> {
  if (!authUserId) return;
  try {
    await supabaseAdmin.rpc('consume_security_rate_bucket', {
      p_key: pendingKey(authUserId, 'hr'),
      p_window_seconds: HIGH_RISK_PENDING_SECONDS,
      p_max: 1000,
    });
  } catch {
    // Pending mark is best-effort; AAL2 enforcement still applies when a factor exists.
  }
}

async function isPendingBucket(authUserId: string, kind: 'hr' | 'mfa'): Promise<boolean> {
  if (!authUserId) return false;
  try {
    const read = await supabaseAdmin
      .from('security_rate_buckets')
      .select('request_count, window_started_at')
      .eq('bucket_key', pendingKey(authUserId, kind))
      .maybeSingle();
    if (read.error || !read.data) return false;
    const started = Date.parse(String(read.data.window_started_at ?? ''));
    if (!Number.isFinite(started) || Date.now() - started > HIGH_RISK_PENDING_SECONDS * 1000) return false;
    return Number(read.data.request_count ?? 0) >= 1;
  } catch {
    return false;
  }
}

export async function isHighRiskLoginPending(authUserId: string): Promise<boolean> {
  return isPendingBucket(authUserId, 'hr');
}

export async function markMfaChallengePending(authUserId: string): Promise<void> {
  if (!authUserId) return;
  try {
    await supabaseAdmin.rpc('consume_security_rate_bucket', {
      p_key: pendingKey(authUserId, 'mfa'),
      p_window_seconds: HIGH_RISK_PENDING_SECONDS,
      p_max: 1000,
    });
  } catch {
    // Pending mark is best-effort; session aggregate still lists verified factors.
  }
}

export async function isMfaChallengePending(authUserId: string): Promise<boolean> {
  return isPendingBucket(authUserId, 'mfa');
}
