/**
 * Dev / admin-only queue helpers (Stage 10 Phase 3B).
 * Visibility and payloads are backend-owned; UI renders verbatim.
 */
import { config } from '../../config.js';
import { forbidden } from '../../shared/errors.js';
import { hasPermission } from '../rbac/rbac.service.js';
import { WORK_ENGINE_PERMISSIONS } from './work-engine.rbac.js';
export const GENERATE_REMINDER_DRAFT_WORKFLOW_TYPE = 'waiting_client';
export const GENERATE_REMINDER_DRAFT_STEP_KEY = 'nudge_1h';
export function canAccessReminderDraftDevTool(viewer) {
    const perms = [...viewer.permissions];
    const isOrgAdmin = viewer.roleCode === 'owner' ||
        viewer.roleCode === 'admin' ||
        hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin);
    if (config.nodeEnv === 'production') {
        return isOrgAdmin;
    }
    return isOrgAdmin || hasPermission(perms, WORK_ENGINE_PERMISSIONS.write);
}
export function assertGenerateReminderCandidateDevAccess(ctx) {
    if (!ctx.membership || !ctx.user) {
        throw forbidden('Organization membership required');
    }
    const viewer = {
        userId: ctx.user.id,
        permissions: ctx.membership.permissions ?? [],
        roleCode: ctx.membership.roleCode,
    };
    if (!canAccessReminderDraftDevTool(viewer)) {
        throw forbidden('Generate reminder draft is only available to administrators (or in non-production for users with work engine write access)');
    }
}
