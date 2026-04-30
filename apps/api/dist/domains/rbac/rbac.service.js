/**
 * RBAC service - single source of truth for permissions.
 * Uses organization_memberships + rbac_role_permissions.
 * Maps new permission codes to legacy codes for backward compatibility.
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
/** New RBAC permission codes */
export const RBAC_PERMISSIONS = {
    view_clients: 'view_clients',
    edit_clients: 'edit_clients',
    archive_clients: 'archive_clients',
    view_documents: 'view_documents',
    upload_documents: 'upload_documents',
    delete_documents: 'delete_documents',
    view_users: 'view_users',
    invite_users: 'invite_users',
    change_user_role: 'change_user_role',
    revoke_user_access: 'revoke_user_access',
    access_settings: 'access_settings',
    access_billing: 'access_billing',
    /** DocFlow: run communication rules, review drafts, office communication commands using legal-value templates */
    docflow_review: 'docflow.review',
};
/** Map RBAC codes to legacy API permission codes (for backward compatibility) */
const RBAC_TO_LEGACY = {
    view_clients: ['clients:read'],
    edit_clients: ['clients:write'],
    archive_clients: ['clients:archive'],
    view_documents: ['documents:read'],
    upload_documents: ['documents:write'],
    delete_documents: ['documents:archive'],
    view_users: ['members:read', 'roles:read'],
    invite_users: ['members:write'],
    change_user_role: ['members:write'],
    revoke_user_access: ['members:revoke'],
    access_settings: ['settings:read', 'settings:write'],
    access_billing: ['subscriptions:read'],
    'docflow.review': ['docflow:system_message_write'],
};
/**
 * Legacy `organization_users.roles.code` values → `rbac_role_permissions.role_code`.
 * Used when JWT context is built from organization_users (no organization_memberships row).
 */
export const LEGACY_ORG_ROLE_TO_RBAC_ROLE = {
    owner: 'owner',
    admin: 'admin',
    member: 'admin',
    staff: 'staff',
    viewer: 'viewer',
    admin_manager: 'admin',
};
function expandPermissionCodesWithRbacLegacy(codes) {
    const out = new Set();
    for (const code of codes) {
        out.add(code);
        for (const leg of RBAC_TO_LEGACY[code] ?? [])
            out.add(leg);
    }
    return [...out];
}
/**
 * Merge legacy role_permissions rows with rbac_role_permissions for the mapped RBAC role.
 * Without this, users only in organization_users never receive module RBAC rows (e.g. DocFlow).
 */
export async function mergeLegacyOrganizationUserPermissions(legacyRoleCode, directPermissionCodesFromRolePermissions) {
    const key = (legacyRoleCode ?? '').trim().toLowerCase();
    const rbacRole = LEGACY_ORG_ROLE_TO_RBAC_ROLE[key] ?? 'staff';
    const { data: rows } = await supabaseAdmin
        .from('rbac_role_permissions')
        .select('permission_code')
        .eq('role_code', rbacRole);
    const rbacCodes = (rows ?? []).map((r) => r.permission_code);
    const combined = [...new Set([...directPermissionCodesFromRolePermissions, ...rbacCodes])];
    return expandPermissionCodesWithRbacLegacy(combined);
}
/**
 * Load membership from organization_memberships with permissions from rbac_role_permissions.
 * Returns permissions including both RBAC codes and legacy codes.
 */
export async function loadMembershipWithPermissions(userId, organizationId) {
    const { data: m } = await supabaseAdmin
        .from('organization_memberships')
        .select('organization_id, user_id, role_code')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .single();
    if (!m)
        return null;
    const roleCode = m.role_code;
    const { data: perms } = await supabaseAdmin
        .from('rbac_role_permissions')
        .select('permission_code')
        .eq('role_code', roleCode);
    const rbacCodes = (perms ?? []).map((p) => p.permission_code);
    const legacyCodes = new Set();
    for (const code of rbacCodes) {
        for (const leg of RBAC_TO_LEGACY[code] ?? [])
            legacyCodes.add(leg);
    }
    const permissions = [...new Set([...rbacCodes, ...legacyCodes])];
    return {
        organizationId: m.organization_id,
        userId: m.user_id,
        roleCode,
        permissions,
    };
}
/**
 * Central permission check. All APIs must use this.
 */
export async function checkPermission(userId, organizationId, permissionCode) {
    const { data } = await supabaseAdmin.rpc('check_permission', {
        p_user_id: userId,
        p_organization_id: organizationId,
        p_permission_code: permissionCode,
    });
    return data === true;
}
/**
 * Check if user has permission (from pre-loaded membership).
 * Supports both RBAC and legacy permission codes.
 */
export function hasPermission(permissions, permissionCode) {
    if (permissions.includes(permissionCode))
        return true;
    if (permissionCode === 'docflow:system_message_write' &&
        permissions.includes(RBAC_PERMISSIONS.docflow_review)) {
        return true;
    }
    if (permissionCode === RBAC_PERMISSIONS.docflow_review &&
        permissions.includes('docflow:system_message_write')) {
        return true;
    }
    const legacy = RBAC_TO_LEGACY[permissionCode];
    if (legacy?.some((l) => permissions.includes(l)))
        return true;
    return false;
}
/**
 * Require permission or throw. Use in route handlers.
 */
export function requireRbacPermission(ctx, orgId, permissionCode) {
    if (ctx.organizationId !== orgId || !ctx.membership)
        throw forbidden('Organization context required');
    if (!hasPermission(ctx.membership.permissions ?? [], permissionCode))
        throw forbidden('Insufficient permission');
}
