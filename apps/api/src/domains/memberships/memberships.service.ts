import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';

export async function listMembers(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  if (!ctx.membership?.permissions?.includes('members:read')) throw forbidden('Insufficient permission');
  const { data } = await supabaseAdmin
    .from('organization_users')
    .select('id, user_id, role_id, membership_status, joined_at, users(id, email, full_name), roles(code, name)')
    .eq('organization_id', orgId)
    .eq('membership_status', 'active');
  return data ?? [];
}

export async function addMember(ctx: RequestContext, orgId: string, params: { userId: string; roleId: string }) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  if (!ctx.membership?.permissions?.includes('members:write')) throw forbidden('Insufficient permission');
  const { data: role } = await supabaseAdmin.from('roles').select('id').eq('id', params.roleId).single();
  if (!role) throw badRequest('Invalid role');
  const { data: existing } = await supabaseAdmin.from('organization_users').select('id').eq('organization_id', orgId).eq('user_id', params.userId).single();
  if (existing) throw badRequest('User already in organization');
  const { data: ou } = await supabaseAdmin
    .from('organization_users')
    .insert({
      organization_id: orgId,
      user_id: params.userId,
      role_id: params.roleId,
      membership_status: 'active',
      invited_by: ctx.user.id,
    })
    .select('id, user_id, role_id')
    .single();
  if (!ou) throw new Error('Failed to add member');
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'organization_user',
    entityId: ou.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_CREATED,
    payload: { userId: params.userId, roleId: params.roleId },
  });
  return ou;
}

export async function updateMember(ctx: RequestContext, orgId: string, memberId: string, params: { roleId?: string }) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  if (!ctx.membership?.permissions?.includes('members:write')) throw forbidden('Insufficient permission');
  if (params.roleId) {
    const { data: role } = await supabaseAdmin.from('roles').select('id').eq('id', params.roleId).single();
    if (!role) throw badRequest('Invalid role');
  }
  const { data: ou } = await supabaseAdmin
    .from('organization_users')
    .update({ role_id: params.roleId ?? undefined, updated_at: new Date().toISOString() })
    .eq('id', memberId)
    .eq('organization_id', orgId)
    .select('id, role_id')
    .single();
  if (!ou) throw forbidden('Member not found');
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'organization_user',
    entityId: ou.id,
    action: AUDIT_ACTIONS.ROLE_ASSIGNED,
    payload: { roleId: params.roleId },
  });
  return ou;
}

export async function removeMember(ctx: RequestContext, orgId: string, memberId: string) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  if (!ctx.membership?.permissions?.includes('members:revoke')) throw forbidden('Only owner can revoke access');
  const { data: org } = await supabaseAdmin.from('organizations').select('owner_user_id').eq('id', orgId).single();
  if (!org || (org as { owner_user_id: string | null }).owner_user_id !== ctx.user.id) {
    throw forbidden('Only organization owner can revoke access');
  }
  const { data: ou } = await supabaseAdmin
    .from('organization_users')
    .select('id, user_id')
    .eq('id', memberId)
    .eq('organization_id', orgId)
    .single();
  if (!ou) throw forbidden('Member not found');
  const targetUserId = (ou as { user_id: string }).user_id;
  if (targetUserId === ctx.user.id) throw badRequest('Owner cannot revoke their own access');
  const { error } = await supabaseAdmin
    .from('organization_users')
    .update({ membership_status: 'removed', updated_at: new Date().toISOString() })
    .eq('id', memberId)
    .eq('organization_id', orgId);
  if (error) throw new Error('Failed to revoke access');
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'organization_user',
    entityId: ou.id,
    action: AUDIT_ACTIONS.MEMBERSHIP_DELETED,
    payload: { revokedUserId: targetUserId },
  });
  return { success: true };
}
