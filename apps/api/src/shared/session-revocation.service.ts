import { config } from '../config.js';
import { supabaseAdmin } from '../db/client.js';
import { writeAudit } from './audit-events.js';
import { safeSecurityPayload } from './security-event.pure.js';

export async function revokeCompromisedUserSessions(input: {
  actorUserId: string;
  incidentId?: string | null;
  reason?: string | null;
}): Promise<{ revoked: boolean }> {
  const user = await supabaseAdmin.from('users').select('id, auth_user_id, email').eq('id', input.actorUserId).maybeSingle();
  const authUserId = user.data?.auth_user_id ? String(user.data.auth_user_id) : '';
  if (!authUserId) return { revoked: false };
  const ownerEmail = config.platformOwner.email?.trim().toLowerCase() ?? '';
  const actorEmail = String(user.data?.email ?? '').trim().toLowerCase();
  if (ownerEmail && actorEmail && actorEmail === ownerEmail) return { revoked: false };
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${authUserId}/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      apikey: config.supabaseServiceRoleKey,
    },
  });
  await writeAudit({
    organizationId: null,
    actorUserId: input.actorUserId,
    entityType: 'security',
    entityId: input.incidentId ?? null,
    action: 'security.sessions_revoked',
    payload: safeSecurityPayload({
      reason: input.reason ?? 'confirmed_containment',
      http_status: response.status,
    }),
  });
  return { revoked: response.ok };
}
