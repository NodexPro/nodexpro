/**
 * Memberships service using organization_memberships (RBAC).
 * Supports list, invite, change role, revoke. Owner protection enforced.
 */
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { requireRbacPermission, RBAC_PERMISSIONS } from '../rbac/rbac.service.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import { sendInvitationEmail } from '../../shared/email.service.js';
import { updateUserStoredActiveOrganizationId } from '../auth/active-organization.service.js';
const INVITE_EXPIRY_DAYS = 7;
function writeSystemAudit(params) {
    return supabaseAdmin.from('system_audit_log').insert({
        actor_user_id: params.actorUserId,
        organization_id: params.organizationId,
        target_user_id: params.targetUserId,
        event_type: params.eventType,
        payload_json: params.payload ?? null,
    });
}
export async function listMembersRbac(ctx, orgId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.view_users);
    let { data } = await supabaseAdmin
        .from('organization_memberships')
        .select('id, user_id, role_code, status, invited_at, joined_at, users(id, email, full_name)')
        .eq('organization_id', orgId)
        .eq('status', 'active');
    if (!data?.length) {
        const { data: ouData } = await supabaseAdmin
            .from('organization_users')
            .select('id, user_id, membership_status, joined_at, users(id, email, full_name), roles(code, name)')
            .eq('organization_id', orgId)
            .eq('membership_status', 'active');
        if (ouData?.length) {
            return ouData.map((row) => {
                const r = row;
                const u = supabaseEmbedOne(r.users);
                const roleRow = supabaseEmbedOne(r.roles);
                const code = roleRow?.code ?? 'staff';
                return {
                    id: r.id,
                    user_id: r.user_id,
                    role_code: code,
                    role_name: code.charAt(0).toUpperCase() + code.slice(1),
                    status: r.membership_status,
                    invited_at: null,
                    joined_at: r.joined_at,
                    email: u?.email ?? null,
                    full_name: u?.full_name ?? null,
                };
            });
        }
    }
    return (data ?? []).map((row) => {
        const r = row;
        const u = supabaseEmbedOne(r.users);
        return {
            id: r.id,
            user_id: r.user_id,
            role_code: r.role_code,
            role_name: r.role_code.charAt(0).toUpperCase() + r.role_code.slice(1),
            status: r.status,
            invited_at: r.invited_at,
            joined_at: r.joined_at,
            email: u?.email ?? null,
            full_name: u?.full_name ?? null,
        };
    });
}
export async function inviteUserRbac(ctx, orgId, params) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.invite_users);
    const { email, role_code } = params;
    const emailTrim = email?.trim()?.toLowerCase();
    if (!emailTrim)
        throw badRequest('Email required');
    if (!['admin', 'staff', 'viewer'].includes(role_code))
        throw badRequest('Invalid role. Owner cannot be assigned.');
    const { data: userByEmail } = await supabaseAdmin.from('users').select('id').eq('email', emailTrim).maybeSingle();
    if (userByEmail) {
        const existingMember = await supabaseAdmin
            .from('organization_memberships')
            .select('id')
            .eq('organization_id', orgId)
            .eq('user_id', userByEmail.id)
            .eq('status', 'active')
            .maybeSingle();
        if (existingMember.data)
            throw badRequest('User is already a member');
    }
    const pendingInv = await supabaseAdmin
        .from('user_invitations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('email', emailTrim)
        .eq('status', 'pending')
        .maybeSingle();
    if (pendingInv.data) {
        return {
            status: 'invite_already_exists',
            inviteId: pendingInv.data.id,
        };
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);
    const now = new Date().toISOString();
    const { data: inv } = await supabaseAdmin
        .from('user_invitations')
        .insert({
        organization_id: orgId,
        email: emailTrim,
        role_code,
        invited_by: ctx.user.id,
        token,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        last_sent_at: now,
        send_count: 1,
    })
        .select('id, email, role_code, expires_at')
        .single();
    if (!inv)
        throw new Error('Failed to create invitation');
    await writeSystemAudit({
        actorUserId: ctx.user.id,
        organizationId: orgId,
        eventType: 'user_invited',
        payload: { email: emailTrim, role_code, invitation_id: inv.id },
    });
    const appUrl = process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const inviteLink = `${appUrl}/invite/accept?token=${token}`;
    const expiresAtStr = inv.expires_at;
    const { data: org } = await supabaseAdmin.from('organizations').select('name').eq('id', orgId).single();
    const organizationName = org?.name ?? 'NodexPro';
    try {
        await sendInvitationEmail({
            to: emailTrim,
            organizationName,
            roleCode: role_code,
            inviteLink,
            expiresAt: expiresAtStr,
        });
    }
    catch (err) {
        console.error('[invite] Failed to send invitation email:', err);
        throw new Error(err instanceof Error ? err.message : 'Failed to send invitation email');
    }
    await writeSystemAudit({
        actorUserId: ctx.user.id,
        organizationId: orgId,
        eventType: 'invitation_email_sent',
        payload: { email: emailTrim, role_code, invitation_id: inv.id },
    });
    return {
        id: inv.id,
        email: inv.email,
        role_code: inv.role_code,
        expires_at: expiresAtStr,
        invite_link: inviteLink,
    };
}
export async function listInvitesRbac(ctx, orgId, options) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.view_users);
    let q = supabaseAdmin
        .from('user_invitations')
        .select('id, email, role_code, status, created_at, last_sent_at, send_count')
        .eq('organization_id', orgId);
    if (!options?.includeHistory) {
        q = q.eq('status', 'pending');
    }
    const { data } = await q.order('created_at', { ascending: false });
    const rows = (data ?? []);
    return rows.map((r) => ({
        id: r.id,
        email: r.email,
        role_key: r.role_code,
        status: r.status,
        created_at: r.created_at,
        last_sent_at: r.last_sent_at ?? null,
        send_count: r.send_count ?? 0,
    }));
}
export async function resendInviteRbac(ctx, orgId, inviteId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.invite_users);
    const { data: inv } = await supabaseAdmin
        .from('user_invitations')
        .select('id, organization_id, email, role_code, token, status, expires_at')
        .eq('id', inviteId)
        .eq('organization_id', orgId)
        .single();
    if (!inv)
        throw badRequest('Invitation not found');
    const invRow = inv;
    if (invRow.status !== 'pending')
        throw badRequest('Invitation is not pending');
    const appUrl = process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const inviteLink = `${appUrl}/invite/accept?token=${invRow.token}`;
    const { data: org } = await supabaseAdmin.from('organizations').select('name').eq('id', invRow.organization_id).single();
    const organizationName = org?.name ?? 'NodexPro';
    await sendInvitationEmail({
        to: invRow.email,
        organizationName,
        roleCode: invRow.role_code,
        inviteLink,
        expiresAt: invRow.expires_at,
    });
    const { data: current } = await supabaseAdmin
        .from('user_invitations')
        .select('send_count')
        .eq('id', inviteId)
        .single();
    const newCount = (current?.send_count ?? 0) + 1;
    const now = new Date().toISOString();
    await supabaseAdmin
        .from('user_invitations')
        .update({ last_sent_at: now, send_count: newCount })
        .eq('id', inviteId)
        .eq('organization_id', orgId);
    await writeSystemAudit({
        actorUserId: ctx.user.id,
        organizationId: orgId,
        eventType: 'invitation_email_sent',
        payload: { email: invRow.email, role_code: invRow.role_code, invitation_id: inviteId, resend: true },
    });
    return { success: true };
}
export async function revokeInviteRbac(ctx, orgId, inviteId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.invite_users);
    const { data: inv } = await supabaseAdmin
        .from('user_invitations')
        .select('id, status')
        .eq('id', inviteId)
        .eq('organization_id', orgId)
        .single();
    if (!inv)
        throw badRequest('Invitation not found');
    if (inv.status !== 'pending')
        throw badRequest('Invitation is not pending');
    const now = new Date().toISOString();
    await supabaseAdmin
        .from('user_invitations')
        .update({ status: 'revoked', revoked_at: now })
        .eq('id', inviteId)
        .eq('organization_id', orgId);
    await writeSystemAudit({
        actorUserId: ctx.user.id,
        organizationId: orgId,
        eventType: 'invitation_revoked',
        payload: { invitation_id: inviteId },
    });
    return { success: true };
}
export async function changeUserRoleRbac(ctx, orgId, memberId, roleCode) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.change_user_role);
    if (!['admin', 'staff', 'viewer'].includes(roleCode))
        throw badRequest('Invalid role');
    let member = (await supabaseAdmin.from('organization_memberships').select('id, user_id, role_code').eq('id', memberId).eq('organization_id', orgId).single()).data;
    let targetUserId;
    let targetRole;
    if (member) {
        targetRole = member.role_code;
        targetUserId = member.user_id;
    }
    else {
        const ou = (await supabaseAdmin.from('organization_users').select('id, user_id, role_id').eq('id', memberId).eq('organization_id', orgId).single()).data;
        if (!ou)
            throw forbidden('Member not found');
        targetUserId = ou.user_id;
        const role = (await supabaseAdmin.from('roles').select('code').eq('id', ou.role_id).single()).data;
        targetRole = role?.code ?? 'staff';
    }
    if (targetRole === 'owner')
        throw forbidden('Cannot modify owner');
    if (targetUserId === ctx.user.id)
        throw badRequest('Cannot change your own role');
    const actorMembership = (await supabaseAdmin.from('organization_memberships').select('role_code').eq('organization_id', orgId).eq('user_id', ctx.user.id).eq('status', 'active').single()).data;
    const actorRole = actorMembership?.role_code;
    if (actorRole === 'admin' && targetRole === 'owner')
        throw forbidden('Admin cannot modify owner');
    if (member) {
        await supabaseAdmin.from('organization_memberships').update({ role_code: roleCode, updated_at: new Date().toISOString() }).eq('id', memberId).eq('organization_id', orgId);
    }
    else {
        const roleRow = (await supabaseAdmin.from('roles').select('id').eq('code', roleCode).single()).data;
        if (roleRow) {
            await supabaseAdmin.from('organization_users').update({ role_id: roleRow.id, updated_at: new Date().toISOString() }).eq('id', memberId).eq('organization_id', orgId);
        }
    }
    await writeSystemAudit({
        actorUserId: ctx.user.id,
        organizationId: orgId,
        targetUserId,
        eventType: 'user_role_changed',
        payload: { from_role: targetRole, to_role: roleCode },
    });
    return { success: true };
}
export async function revokeUserAccessRbac(ctx, orgId, memberId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.revoke_user_access);
    let member = (await supabaseAdmin.from('organization_memberships').select('id, user_id, role_code').eq('id', memberId).eq('organization_id', orgId).single()).data;
    let targetUserId;
    let targetRole;
    if (member) {
        targetUserId = member.user_id;
        targetRole = member.role_code;
    }
    else {
        const ou = (await supabaseAdmin.from('organization_users').select('id, user_id, role_id').eq('id', memberId).eq('organization_id', orgId).single()).data;
        if (!ou)
            throw forbidden('Member not found');
        targetUserId = ou.user_id;
        const role = (await supabaseAdmin.from('roles').select('code').eq('id', ou.role_id).single()).data;
        targetRole = role?.code ?? 'staff';
    }
    if (targetRole === 'owner')
        throw forbidden('Cannot revoke owner');
    if (targetUserId === ctx.user.id)
        throw badRequest('Owner cannot revoke their own access');
    const now = new Date().toISOString();
    if (member) {
        await supabaseAdmin.from('organization_memberships').update({ status: 'revoked', revoked_at: now, updated_at: now }).eq('id', memberId).eq('organization_id', orgId);
    }
    else {
        await supabaseAdmin.from('organization_users').update({ membership_status: 'removed', updated_at: now }).eq('id', memberId).eq('organization_id', orgId);
    }
    await writeSystemAudit({
        actorUserId: ctx.user.id,
        organizationId: orgId,
        targetUserId,
        eventType: 'user_access_revoked',
        payload: {},
    });
    return { success: true };
}
export async function acceptInviteRbac(ctx, token) {
    const { data: inv } = await supabaseAdmin
        .from('user_invitations')
        .select('id, organization_id, email, role_code, status, expires_at')
        .eq('token', token)
        .single();
    if (!inv)
        throw badRequest('Invalid invitation');
    const invRow = inv;
    if (invRow.status !== 'pending')
        throw badRequest('Invitation already used or revoked');
    if (new Date(invRow.expires_at) < new Date())
        throw badRequest('Invitation expired');
    if (ctx.user.email?.toLowerCase() !== invRow.email.toLowerCase()) {
        throw badRequest('Invitation was sent to a different email address');
    }
    const existing = await supabaseAdmin
        .from('organization_memberships')
        .select('id')
        .eq('organization_id', invRow.organization_id)
        .eq('user_id', ctx.user.id)
        .eq('status', 'active')
        .maybeSingle();
    if (existing.data)
        throw badRequest('Already a member');
    const now = new Date().toISOString();
    await supabaseAdmin.from('organization_memberships').insert({
        organization_id: invRow.organization_id,
        user_id: ctx.user.id,
        role_code: invRow.role_code,
        status: 'active',
        invited_by: null,
        joined_at: now,
        created_at: now,
        updated_at: now,
    });
    await supabaseAdmin
        .from('user_invitations')
        .update({ status: 'accepted', accepted_at: now })
        .eq('id', inv.id);
    await writeSystemAudit({
        actorUserId: ctx.user.id,
        organizationId: invRow.organization_id,
        targetUserId: ctx.user.id,
        eventType: 'invitation_accepted',
        payload: { invitation_id: inv.id, role_code: invRow.role_code },
    });
    await updateUserStoredActiveOrganizationId(ctx.user.id, invRow.organization_id);
    return { success: true, organization_id: invRow.organization_id };
}
