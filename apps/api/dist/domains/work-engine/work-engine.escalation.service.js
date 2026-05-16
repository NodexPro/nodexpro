/**
 * Work Engine escalation commands (Stage 10 Phase 3C-1).
 * All escalation write semantics live here only.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { hasPermission } from '../rbac/rbac.service.js';
import { isUuid } from './work-engine.guards.js';
import { assertCanEscalateWorkItem, assertHasEscalationPriorState, assertWorkItemIsEscalated, AUTO_ESCALATION_REASON, AUTO_ESCALATION_SOURCE, canAcknowledgeEscalation, canEscalateWorkItem, canReassignEscalationOwner, canResolveEscalation, isEscalationAcknowledged, parseEscalationReason, resolveAutoEscalationOwnerId, shouldAutoEscalateForSla, } from './work-engine.escalation.logic.js';
import { WORK_ENGINE_PERMISSIONS } from './work-engine.rbac.js';
async function assertActiveOrgMember(orgId, userId) {
    if (!isUuid(userId))
        throw badRequest('user id must be a uuid');
    const { data, error } = await supabaseAdmin
        .from('organization_memberships')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw badRequest('escalation_owner_id must be an active organization member', 'invalid_escalation_owner');
}
function escalationPermContext(actorUserId, roleCode, permissions) {
    return { userId: actorUserId, roleCode, permissions };
}
function assertMayEscalate(ctx, row, permissions) {
    const may = canEscalateWorkItem(ctx, row, hasPermission(permissions, WORK_ENGINE_PERMISSIONS.override) ||
        hasPermission(permissions, WORK_ENGINE_PERMISSIONS.admin));
    if (!may)
        throw forbidden('Insufficient permission to escalate work item', 'FORBIDDEN');
}
function assertMayAcknowledge(ctx, row) {
    if (!canAcknowledgeEscalation(ctx, row)) {
        throw forbidden('Insufficient permission to acknowledge escalation', 'FORBIDDEN');
    }
}
function assertMayResolve(ctx, row) {
    if (!canResolveEscalation(ctx, row)) {
        throw forbidden('Insufficient permission to resolve escalation', 'FORBIDDEN');
    }
}
function assertMayReassign(ctx, row) {
    if (!canReassignEscalationOwner(ctx, row)) {
        throw forbidden('Insufficient permission to reassign escalation owner', 'FORBIDDEN');
    }
}
export async function escalateWorkItem(params) {
    const ctx = escalationPermContext(params.actorUserId, params.roleCode, params.permissions);
    assertMayEscalate(ctx, params.workItem, params.permissions);
    assertCanEscalateWorkItem(params.workItem);
    const escalationOwnerId = params.escalationOwnerId.trim();
    if (!isUuid(escalationOwnerId)) {
        throw badRequest('escalation_owner_id must be a uuid', 'invalid_escalation_owner');
    }
    await assertActiveOrgMember(params.orgId, escalationOwnerId);
    const reason = parseEscalationReason(params.escalationReason);
    const priorWorkState = params.workItem.work_state;
    const newVersion = params.workItem.version + 1;
    const { error, count } = await supabaseAdmin
        .from('work_items')
        .update({
        work_state: 'escalated',
        escalation_owner_id: escalationOwnerId,
        escalation_reason: reason,
        escalation_source: params.escalationSource,
        escalation_prior_work_state: priorWorkState,
        escalation_acknowledged_at: null,
        escalation_acknowledged_by_user_id: null,
        version: newVersion,
    }, { count: 'exact' })
        .eq('id', params.workItem.id)
        .eq('org_id', params.orgId)
        .eq('version', params.expectedVersion);
    if (error)
        throw error;
    if (count === 0)
        throw conflict('Version conflict on update', 'version_conflict_on_update');
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_item',
        entityId: params.workItem.id,
        action: AUDIT_ACTIONS.WORK_ITEM_ESCALATED,
        payload: {
            from_state: priorWorkState,
            to_state: 'escalated',
            escalation_owner_id: escalationOwnerId,
            escalation_reason: reason,
            escalation_source: params.escalationSource,
            prior_work_state: priorWorkState,
            idempotency_key: params.idempotencyKey ?? null,
        },
    });
    return { priorWorkState, newVersion };
}
export async function acknowledgeEscalation(params) {
    const ctx = escalationPermContext(params.actorUserId, params.roleCode, params.permissions);
    assertWorkItemIsEscalated(params.workItem);
    assertMayAcknowledge(ctx, params.workItem);
    if (isEscalationAcknowledged(params.workItem)) {
        throw badRequest('Escalation is already acknowledged', 'escalation_already_acknowledged');
    }
    const newVersion = params.workItem.version + 1;
    const acknowledgedAt = new Date().toISOString();
    const { error, count } = await supabaseAdmin
        .from('work_items')
        .update({
        escalation_acknowledged_at: acknowledgedAt,
        escalation_acknowledged_by_user_id: params.actorUserId,
        version: newVersion,
    }, { count: 'exact' })
        .eq('id', params.workItem.id)
        .eq('org_id', params.orgId)
        .eq('version', params.expectedVersion);
    if (error)
        throw error;
    if (count === 0)
        throw conflict('Version conflict on update', 'version_conflict_on_update');
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_item',
        entityId: params.workItem.id,
        action: AUDIT_ACTIONS.WORK_ITEM_ESCALATION_ACKNOWLEDGED,
        payload: {
            escalation_owner_id: params.workItem.escalation_owner_id,
            acknowledged_at: acknowledgedAt,
        },
    });
    return { newVersion };
}
export async function resolveEscalation(params) {
    const ctx = escalationPermContext(params.actorUserId, params.roleCode, params.permissions);
    assertWorkItemIsEscalated(params.workItem);
    assertMayResolve(ctx, params.workItem);
    const restoredWorkState = assertHasEscalationPriorState(params.workItem);
    const newVersion = params.workItem.version + 1;
    const { error, count } = await supabaseAdmin
        .from('work_items')
        .update({
        work_state: restoredWorkState,
        escalation_owner_id: null,
        escalation_reason: null,
        escalation_source: null,
        escalation_prior_work_state: null,
        escalation_acknowledged_at: null,
        escalation_acknowledged_by_user_id: null,
        version: newVersion,
    }, { count: 'exact' })
        .eq('id', params.workItem.id)
        .eq('org_id', params.orgId)
        .eq('version', params.expectedVersion);
    if (error)
        throw error;
    if (count === 0)
        throw conflict('Version conflict on update', 'version_conflict_on_update');
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_item',
        entityId: params.workItem.id,
        action: AUDIT_ACTIONS.WORK_ITEM_ESCALATION_RESOLVED,
        payload: {
            from_state: 'escalated',
            to_state: restoredWorkState,
            prior_work_state: restoredWorkState,
            resolution_note: params.resolutionNote ?? null,
        },
    });
    return { restoredWorkState, newVersion };
}
export async function reassignEscalationOwner(params) {
    const ctx = escalationPermContext(params.actorUserId, params.roleCode, params.permissions);
    assertWorkItemIsEscalated(params.workItem);
    assertMayReassign(ctx, params.workItem);
    const newOwnerId = params.newEscalationOwnerId.trim();
    if (!isUuid(newOwnerId)) {
        throw badRequest('escalation_owner_id must be a uuid', 'invalid_escalation_owner');
    }
    await assertActiveOrgMember(params.orgId, newOwnerId);
    const previousOwnerId = params.workItem.escalation_owner_id;
    if (previousOwnerId === newOwnerId) {
        throw badRequest('Escalation owner is already assigned to this user', 'escalation_owner_unchanged');
    }
    const newVersion = params.workItem.version + 1;
    const { error, count } = await supabaseAdmin
        .from('work_items')
        .update({
        escalation_owner_id: newOwnerId,
        escalation_acknowledged_at: null,
        escalation_acknowledged_by_user_id: null,
        version: newVersion,
    }, { count: 'exact' })
        .eq('id', params.workItem.id)
        .eq('org_id', params.orgId)
        .eq('version', params.expectedVersion);
    if (error)
        throw error;
    if (count === 0)
        throw conflict('Version conflict on update', 'version_conflict_on_update');
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_item',
        entityId: params.workItem.id,
        action: AUDIT_ACTIONS.WORK_ITEM_ESCALATION_OWNER_REASSIGNED,
        payload: {
            previous_escalation_owner_id: previousOwnerId,
            new_escalation_owner_id: newOwnerId,
        },
    });
    return { previousOwnerId, newVersion };
}
export async function loadEscalationOwnerOptions(orgId) {
    const { data: memberships, error: memErr } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('status', 'active');
    if (memErr)
        throw memErr;
    const userIds = Array.from(new Set((memberships ?? [])
        .map((m) => String(m.user_id ?? '').trim())
        .filter(Boolean)));
    if (userIds.length === 0)
        return [];
    const { data: users, error: userErr } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email')
        .in('id', userIds);
    if (userErr)
        throw userErr;
    const options = (users ?? []).map((u) => {
        const id = String(u.id);
        const name = String(u.full_name ?? '').trim();
        const email = String(u.email ?? '').trim();
        return { value: id, label: name || email || id };
    });
    options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return options;
}
async function loadActiveAndBreachedObligations(orgId, workItemId) {
    const { data, error } = await supabaseAdmin
        .from('work_sla_obligations')
        .select('*')
        .eq('org_id', orgId)
        .eq('work_item_id', workItemId)
        .in('status', ['active', 'breached']);
    if (error)
        throw error;
    return (data ?? []);
}
async function loadOrgMembersForAutoEscalation(orgId) {
    const { data, error } = await supabaseAdmin
        .from('organization_memberships')
        .select('user_id, role_code')
        .eq('organization_id', orgId)
        .eq('status', 'active');
    if (error)
        throw error;
    return (data ?? []).map((row) => ({
        user_id: String(row.user_id),
        role_code: String(row.role_code ?? 'staff'),
    }));
}
async function insertEscalationTransition(row) {
    const { error } = await supabaseAdmin.from('work_transitions').insert({
        org_id: row.org_id,
        work_item_id: row.work_item_id,
        from_state: row.from_state,
        to_state: row.to_state,
        transition_kind: 'automation',
        action_code: row.action_code,
        actor_type: 'rule',
        actor_user_id: row.actor_user_id,
        reason_text: row.reason_text,
        metadata_json: row.metadata_json,
        expected_version: row.expected_version,
        resulting_version: row.resulting_version,
    });
    if (error)
        throw error;
}
/**
 * Policy-driven automatic escalation (Phase 3C-2 MVP).
 * Creates escalated work_state only — never sends, never resolves.
 */
export async function evaluateEscalationsForWorkItem(params) {
    const workItem = await loadWorkItemForEscalation(params.orgId, params.workItemId);
    if (workItem.work_state === 'escalated') {
        return {
            evaluated: true,
            created: false,
            skipped_reason: 'already_escalated',
            escalation_owner_id: workItem.escalation_owner_id,
        };
    }
    if (workItem.work_state === 'done' || workItem.work_state === 'archived') {
        return {
            evaluated: true,
            created: false,
            skipped_reason: 'terminal_work_state',
            escalation_owner_id: null,
        };
    }
    const obligations = await loadActiveAndBreachedObligations(params.orgId, params.workItemId);
    const hasBreachedObligation = obligations.some((o) => o.status === 'breached');
    if (!shouldAutoEscalateForSla({
        work_state: workItem.work_state,
        sla_status: workItem.sla_status,
        has_breached_obligation: hasBreachedObligation,
    })) {
        return {
            evaluated: true,
            created: false,
            skipped_reason: 'sla_not_breached',
            escalation_owner_id: null,
        };
    }
    const members = await loadOrgMembersForAutoEscalation(params.orgId);
    const escalationOwnerId = resolveAutoEscalationOwnerId(workItem, members);
    if (!escalationOwnerId) {
        await writeAudit({
            organizationId: params.orgId,
            actorUserId: params.actorUserId ?? null,
            moduleCode: 'work_engine',
            entityType: 'work_item',
            entityId: workItem.id,
            action: AUDIT_ACTIONS.WORK_ITEM_AUTO_ESCALATION_SKIPPED,
            payload: {
                reason: 'no_eligible_escalation_owner',
                sla_status: workItem.sla_status,
                has_breached_obligation: hasBreachedObligation,
            },
        });
        return {
            evaluated: true,
            created: false,
            skipped_reason: 'no_eligible_escalation_owner',
            escalation_owner_id: null,
        };
    }
    const priorWorkState = workItem.work_state;
    const expectedVersion = workItem.version;
    const newVersion = expectedVersion + 1;
    const { error, count } = await supabaseAdmin
        .from('work_items')
        .update({
        work_state: 'escalated',
        escalation_owner_id: escalationOwnerId,
        escalation_reason: AUTO_ESCALATION_REASON,
        escalation_source: AUTO_ESCALATION_SOURCE,
        escalation_prior_work_state: priorWorkState,
        escalation_acknowledged_at: null,
        escalation_acknowledged_by_user_id: null,
        version: newVersion,
    }, { count: 'exact' })
        .eq('id', workItem.id)
        .eq('org_id', params.orgId)
        .eq('version', expectedVersion);
    if (error)
        throw error;
    if (count === 0) {
        return {
            evaluated: true,
            created: false,
            skipped_reason: 'version_conflict',
            escalation_owner_id: null,
        };
    }
    await insertEscalationTransition({
        org_id: params.orgId,
        work_item_id: workItem.id,
        from_state: priorWorkState,
        to_state: 'escalated',
        action_code: 'auto_escalate_work_item',
        actor_user_id: params.actorUserId ?? null,
        reason_text: AUTO_ESCALATION_REASON,
        metadata_json: {
            escalation_owner_id: escalationOwnerId,
            escalation_source: AUTO_ESCALATION_SOURCE,
            prior_work_state: priorWorkState,
            trigger: 'sla_breached',
            auto_generated: true,
        },
        expected_version: expectedVersion,
        resulting_version: newVersion,
    });
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId ?? null,
        moduleCode: 'work_engine',
        entityType: 'work_item',
        entityId: workItem.id,
        action: AUDIT_ACTIONS.WORK_ITEM_ESCALATED,
        payload: {
            from_state: priorWorkState,
            to_state: 'escalated',
            escalation_owner_id: escalationOwnerId,
            escalation_reason: AUTO_ESCALATION_REASON,
            escalation_source: AUTO_ESCALATION_SOURCE,
            prior_work_state: priorWorkState,
            trigger_type: 'system_rule',
            auto_generated: true,
        },
    });
    return {
        evaluated: true,
        created: true,
        skipped_reason: null,
        escalation_owner_id: escalationOwnerId,
    };
}
export async function loadWorkItemForEscalation(orgId, workItemId) {
    if (!isUuid(workItemId))
        throw badRequest('work_item_id must be a uuid');
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .select('*')
        .eq('id', workItemId)
        .eq('org_id', orgId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Work item not found');
    return data;
}
