import { supabaseAdmin } from '../../db/client.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import { loadMembershipWithPermissions, mergeLegacyOrganizationUserPermissions } from '../rbac/rbac.service.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function getUserStoredActiveOrganizationId(userId) {
    const { data } = await supabaseAdmin.from('users').select('active_organization_id').eq('id', userId).maybeSingle();
    const v = data?.active_organization_id;
    if (typeof v !== 'string')
        return null;
    const t = v.trim();
    return UUID_RE.test(t) ? t : null;
}
export async function updateUserStoredActiveOrganizationId(userId, organizationId) {
    await supabaseAdmin
        .from('users')
        .update({ active_organization_id: organizationId, updated_at: new Date().toISOString() })
        .eq('id', userId);
}
export async function listUserActiveOrganizationIds(userId) {
    let { data } = await supabaseAdmin.from('organization_memberships').select('organization_id').eq('user_id', userId).eq('status', 'active');
    const ids = new Set((data ?? []).map((r) => r.organization_id).filter(Boolean));
    if (!ids.size) {
        const ou = await supabaseAdmin
            .from('organization_users')
            .select('organization_id')
            .eq('user_id', userId)
            .eq('membership_status', 'active');
        for (const r of ou.data ?? [])
            ids.add(r.organization_id);
    }
    return [...ids];
}
export async function loadOrgMembershipForUser(userId, organizationId) {
    const m = await loadMembershipWithPermissions(userId, organizationId);
    if (m) {
        return {
            organizationId: m.organizationId,
            userId: m.userId,
            roleId: '',
            roleCode: m.roleCode,
            permissions: m.permissions,
        };
    }
    const { data: ou } = await supabaseAdmin
        .from('organization_users')
        .select('organization_id, user_id, role_id, roles(code, role_permissions(permissions(code)))')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('membership_status', 'active')
        .single();
    if (!ou)
        return null;
    const role = supabaseEmbedOne(ou.roles);
    const rp = role?.role_permissions ?? [];
    const directPerms = rp.map((x) => x.permissions?.code).filter((c) => !!c);
    const permissions = await mergeLegacyOrganizationUserPermissions(role?.code ?? '', directPerms);
    return {
        organizationId: ou.organization_id,
        userId: ou.user_id,
        roleId: '',
        roleCode: role?.code ?? '',
        permissions,
    };
}
/**
 * When the request has no valid explicit org header: use persisted preference, repair invalid rows,
 * auto-persist single-org tenants.
 */
export async function resolveStoredOrSingleAutoOrgContext(userId) {
    const stored = await getUserStoredActiveOrganizationId(userId);
    if (stored) {
        const m = await loadOrgMembershipForUser(userId, stored);
        if (m)
            return { organizationId: stored, membership: m };
        await updateUserStoredActiveOrganizationId(userId, null);
    }
    const orgIds = await listUserActiveOrganizationIds(userId);
    if (orgIds.length === 1) {
        const id = orgIds[0];
        await updateUserStoredActiveOrganizationId(userId, id);
        const m = await loadOrgMembershipForUser(userId, id);
        return { organizationId: id, membership: m };
    }
    return { organizationId: null, membership: null };
}
