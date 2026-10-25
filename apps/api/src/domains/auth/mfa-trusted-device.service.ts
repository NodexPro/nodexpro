import { supabaseAdmin } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { getPrivilegedMfaGate } from '../../shared/privileged-mfa-gate.js';
import {
  MFA_DEVICE_TTL_SECONDS,
  hashDeviceCredential,
  newDeviceCredential,
  trustedDeviceState,
} from './mfa-trusted-device.pure.js';

export async function recognizeTrustedDevice(userId: string, credential: string): Promise<boolean> {
  if (!getPrivilegedMfaGate().trustedDevicesReady) return false;
  const hash = hashDeviceCredential(credential);
  const { data, error } = await supabaseAdmin
    .from('mfa_trusted_devices')
    .select('id, expires_at, revoked_at')
    .eq('user_id', userId)
    .eq('credential_hash', hash)
    .limit(1);
  if (error || !data?.[0]) return false;
  const row = data[0];
  const state = trustedDeviceState({
    storageReady: true,
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    revokedAt: typeof row.revoked_at === 'string' ? row.revoked_at : null,
    now: new Date().toISOString(),
  });
  if (state !== 'trusted') return false;
  await supabaseAdmin.from('mfa_trusted_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id);
  return true;
}

export async function listTrustedDevices(userId: string): Promise<Array<{ id: string; expires_at: string; revoked: boolean }>> {
  if (!getPrivilegedMfaGate().trustedDevicesReady) return [];
  const { data, error } = await supabaseAdmin
    .from('mfa_trusted_devices')
    .select('id, expires_at, revoked_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return (data ?? []).map((row) => ({
    id: String(row.id),
    expires_at: String(row.expires_at),
    revoked: Boolean(row.revoked_at),
  }));
}

export async function issueTrustedDevice(userId: string): Promise<{ id: string; credential: string }> {
  if (!getPrivilegedMfaGate().trustedDevicesReady) {
    throw new AppError(503, 'זיהוי מכשיר מהימן עדיין לא זמין', 'TRUSTED_DEVICE_NOT_READY');
  }
  const credential = newDeviceCredential();
  const inserted = await supabaseAdmin
    .from('mfa_trusted_devices')
    .insert({
      user_id: userId,
      credential_hash: hashDeviceCredential(credential),
      expires_at: new Date(Date.now() + MFA_DEVICE_TTL_SECONDS * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data?.id) {
    throw new AppError(503, 'זיהוי מכשיר מהימן עדיין לא זמין', 'TRUSTED_DEVICE_NOT_READY');
  }
  return { id: String(inserted.data.id), credential };
}

export async function revokeTrustedDeviceForUser(userId: string, deviceId: string): Promise<boolean> {
  if (!getPrivilegedMfaGate().trustedDevicesReady) {
    throw new AppError(503, 'זיהוי מכשיר מהימן עדיין לא זמין', 'TRUSTED_DEVICE_NOT_READY');
  }
  const revoked = await supabaseAdmin
    .from('mfa_trusted_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', deviceId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');
  if (revoked.error) throw new AppError(503, 'זיהוי מכשיר מהימן עדיין לא זמין', 'TRUSTED_DEVICE_NOT_READY');
  return Boolean(revoked.data?.length);
}

export async function revokeAllTrustedDevices(userId: string): Promise<void> {
  if (!getPrivilegedMfaGate().trustedDevicesReady) return;
  await supabaseAdmin
    .from('mfa_trusted_devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
}
