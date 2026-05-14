/**
 * Work Engine commands (Stage 2 foundation).
 *
 * Commands implemented:
 *   - create_work_item
 *   - assign_work_item
 *   - change_work_state
 *   - set_work_deadline
 *   - append_work_event
 *   - apply_work_override
 *
 * Architecture rules:
 *   - One user/system action = one command.
 *   - Every successful state-relevant write increments work_items.version and appends a work_transition.
 *   - Frontend never decides state, label, or allowed actions.
 *   - After every command we return the refreshed Work Engine aggregate.
 *     Default: `work_engine_foundation_aggregate`. When `payload.refresh_aggregate`
 *     is `work_engine_queue_aggregate`, the response includes the full queue
 *     aggregate (Stage 3E); optional `payload.aggregate_filters` scopes the
 *     rebuilt queue the same way as GET /aggregates/queue.
 *   - Source: docs/work-engine-domain-model.md, docs/work-engine-state-machine.md,
 *             docs/work-engine-dedup-policy.md, docs/work-engine-override-precedence.md.
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { asOptionalIso, asOptionalString, assertClientBelongsToOrg, assertExpectedVersion, assertOrgScope, assertValidPeriodKey, assertValidWorkState, canReopenFromDone, canTransitionWorkState, isUuid, reqInt, reqString, } from './work-engine.guards.js';
import { buildWorkEngineFoundationAggregate, buildWorkEngineQueueAggregate, coerceWorkEngineQueueFilters, queueAllowedActions, } from './work-engine.read-models.service.js';
import { intakeWorkEvent } from './work-engine.event-intake.service.js';
import { CREATION_SOURCE_TYPES, OVERRIDE_KINDS, OVERRIDE_KINDS_REQUIRING_REASON, } from './work-engine.types.js';
const REFRESH_FOUNDATION = 'work_engine_foundation_aggregate';
const REFRESH_QUEUE = 'work_engine_queue_aggregate';
function parseRefreshAggregateKey(payload) {
    const raw = asOptionalString(payload.refresh_aggregate);
    if (raw === undefined || raw === null || raw === '')
        return 'foundation';
    if (raw === REFRESH_FOUNDATION)
        return 'foundation';
    if (raw === REFRESH_QUEUE)
        return 'queue';
    throw badRequest(`Invalid refresh_aggregate: use '${REFRESH_FOUNDATION}', '${REFRESH_QUEUE}', or omit`, 'invalid_refresh_aggregate');
}
function isQueueRefreshMode(payload) {
    return parseRefreshAggregateKey(payload) === 'queue';
}
async function buildRefreshedForPayload(orgId, payload) {
    if (parseRefreshAggregateKey(payload) === 'queue') {
        const filters = coerceWorkEngineQueueFilters(payload.aggregate_filters);
        return {
            aggregate_key: REFRESH_QUEUE,
            aggregate: await buildWorkEngineQueueAggregate({ orgId, filters }),
        };
    }
    return {
        aggregate_key: REFRESH_FOUNDATION,
        aggregate: await buildWorkEngineFoundationAggregate({ orgId }),
    };
}
/**
 * Stage 3E: recompute the same semantic `allowed_actions` as the queue aggregate
 * and reject if the requested command does not match an enabled action. Never
 * trust client-supplied allowed_actions flags.
 */
function assertQueueActionEnabled(current, semantic) {
    const actions = queueAllowedActions(current.work_state);
    const row = actions.find((a) => a.command === semantic);
    if (!row?.enabled) {
        throw badRequest(row?.reason ?? `Queue action '${semantic}' is not allowed for work_state='${current.work_state}'`, 'queue_action_not_allowed');
    }
}
function ensureObj(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function ensurePayloadObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v)
        ? v
        : {};
}
async function audit(orgId, actorUserId, entityType, entityId, action, payload) {
    await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'work_engine',
        entityType,
        entityId,
        action,
        payload,
    });
}
async function loadWorkItem(orgId, workItemId) {
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
async function insertTransition(row) {
    const { error } = await supabaseAdmin.from('work_transitions').insert(row);
    if (error)
        throw error;
}
async function updateWorkItemWithVersion(args) {
    const { error, count } = await supabaseAdmin
        .from('work_items')
        .update({ ...args.patch, version: args.newVersion }, { count: 'exact' })
        .eq('id', args.workItemId)
        .eq('org_id', args.orgId)
        .eq('version', args.expectedVersion);
    if (error)
        throw error;
    if (count === 0) {
        throw conflict('Version conflict on update', 'version_conflict_on_update');
    }
}
export async function executeWorkEngineCommand(ctx, command, payloadInput) {
    const payload = ensureObj(payloadInput);
    const orgId = ctx.organizationId ?? reqString(payload, 'org_id');
    assertOrgScope(ctx, orgId);
    const actorUserId = ctx.user.id;
    switch (command) {
        case 'create_work_item': {
            const clientId = reqString(payload, 'client_id');
            await assertClientBelongsToOrg(orgId, clientId);
            const moduleKey = reqString(payload, 'module_key');
            const workType = reqString(payload, 'work_type');
            const periodKey = assertValidPeriodKey(reqString(payload, 'period_key'));
            const sourceModule = reqString(payload, 'source_module');
            const sourceEntityType = reqString(payload, 'source_entity_type');
            const sourceEntityId = reqString(payload, 'source_entity_id');
            const creationSourceRaw = asOptionalString(payload.creation_source_type) ?? 'command';
            if (!CREATION_SOURCE_TYPES.includes(creationSourceRaw)) {
                throw badRequest('Invalid creation_source_type');
            }
            const creationSourceType = creationSourceRaw;
            const ownerUserId = asOptionalString(payload.owner_user_id);
            const assignedUserId = asOptionalString(payload.assigned_user_id);
            const reviewerUserId = asOptionalString(payload.reviewer_user_id);
            const escalationOwnerId = asOptionalString(payload.escalation_owner_id);
            const dueAt = asOptionalIso(payload.due_at);
            const createdByRuleId = asOptionalString(payload.created_by_rule_id);
            const createdByEventId = asOptionalString(payload.created_by_event_id);
            const initialState = assignedUserId ? 'assigned' : 'new';
            const insertResp = await supabaseAdmin
                .from('work_items')
                .insert({
                org_id: orgId,
                client_id: clientId,
                module_key: moduleKey,
                work_type: workType,
                period_key: periodKey,
                work_state: initialState,
                owner_user_id: ownerUserId,
                assigned_user_id: assignedUserId,
                reviewer_user_id: reviewerUserId,
                escalation_owner_id: escalationOwnerId,
                due_at: dueAt,
                sla_status: 'none',
                source_module: sourceModule,
                source_entity_type: sourceEntityType,
                source_entity_id: sourceEntityId,
                created_by_rule_id: createdByRuleId,
                created_by_event_id: createdByEventId,
                created_by_user_id: actorUserId,
                creation_source_type: creationSourceType,
                version: 0,
                override_active: false,
            })
                .select('*')
                .single();
            if (insertResp.error) {
                const code = insertResp.error.code;
                if (code === '23505') {
                    throw conflict('Active work item already exists for this dedup key', 'work_item_dedup_conflict');
                }
                throw insertResp.error;
            }
            const row = insertResp.data;
            await insertTransition({
                org_id: orgId,
                work_item_id: row.id,
                from_state: null,
                to_state: initialState,
                transition_kind: 'command',
                action_code: 'create_work_item',
                actor_type: 'user',
                actor_user_id: actorUserId,
                reason_text: asOptionalString(payload.reason_text),
                metadata_json: {
                    source_module: sourceModule,
                    source_entity_type: sourceEntityType,
                    source_entity_id: sourceEntityId,
                    creation_source_type: creationSourceType,
                },
                expected_version: null,
                resulting_version: row.version,
            });
            await audit(orgId, actorUserId, 'work_item', row.id, AUDIT_ACTIONS.WORK_ITEM_CREATED, {
                module_key: moduleKey,
                work_type: workType,
                period_key: periodKey,
                work_state: initialState,
            });
            return { ok: true, command, refreshed: await buildRefreshedForPayload(orgId, payload) };
        }
        case 'assign_work_item': {
            const workItemId = reqString(payload, 'work_item_id');
            const expectedVersion = reqInt(payload, 'expected_version');
            // Explicit null clears the assignment; otherwise must be a non-empty string.
            const assignedUserIdRaw = payload.assigned_user_id === null
                ? null
                : asOptionalString(payload.assigned_user_id);
            const current = await loadWorkItem(orgId, workItemId);
            assertExpectedVersion(current.version, expectedVersion);
            if (isQueueRefreshMode(payload))
                assertQueueActionEnabled(current, 'assign');
            // Auto-promote new -> assigned when assigning a user for the first time.
            const willMoveFromNewToAssigned = current.work_state === 'new' && assignedUserIdRaw !== null;
            const nextState = willMoveFromNewToAssigned
                ? 'assigned'
                : current.work_state;
            const newVersion = current.version + 1;
            await updateWorkItemWithVersion({
                orgId,
                workItemId,
                expectedVersion,
                newVersion,
                patch: {
                    assigned_user_id: assignedUserIdRaw,
                    work_state: nextState,
                },
            });
            await insertTransition({
                org_id: orgId,
                work_item_id: workItemId,
                from_state: current.work_state,
                to_state: nextState,
                transition_kind: 'command',
                action_code: 'assign_work_item',
                actor_type: 'user',
                actor_user_id: actorUserId,
                reason_text: asOptionalString(payload.reason_text),
                metadata_json: {
                    previous_assigned_user_id: current.assigned_user_id,
                    new_assigned_user_id: assignedUserIdRaw,
                },
                expected_version: expectedVersion,
                resulting_version: newVersion,
            });
            await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_ASSIGNED, {
                previous_assigned_user_id: current.assigned_user_id,
                new_assigned_user_id: assignedUserIdRaw,
                from_state: current.work_state,
                to_state: nextState,
            });
            return { ok: true, command, refreshed: await buildRefreshedForPayload(orgId, payload) };
        }
        case 'change_work_state': {
            const workItemId = reqString(payload, 'work_item_id');
            const expectedVersion = reqInt(payload, 'expected_version');
            const toState = assertValidWorkState(reqString(payload, 'to_state'));
            const current = await loadWorkItem(orgId, workItemId);
            assertExpectedVersion(current.version, expectedVersion);
            if (isQueueRefreshMode(payload)) {
                if (toState === 'archived')
                    assertQueueActionEnabled(current, 'archive');
                else
                    assertQueueActionEnabled(current, 'change_state');
            }
            if (!canTransitionWorkState(current.work_state, toState)) {
                throw badRequest(`Invalid transition: ${current.work_state} -> ${toState}`, 'invalid_transition');
            }
            const newVersion = current.version + 1;
            await updateWorkItemWithVersion({
                orgId,
                workItemId,
                expectedVersion,
                newVersion,
                patch: { work_state: toState },
            });
            await insertTransition({
                org_id: orgId,
                work_item_id: workItemId,
                from_state: current.work_state,
                to_state: toState,
                transition_kind: 'command',
                action_code: 'change_work_state',
                actor_type: 'user',
                actor_user_id: actorUserId,
                reason_text: asOptionalString(payload.reason_text),
                metadata_json: {},
                expected_version: expectedVersion,
                resulting_version: newVersion,
            });
            await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_STATE_CHANGED, { from_state: current.work_state, to_state: toState });
            return { ok: true, command, refreshed: await buildRefreshedForPayload(orgId, payload) };
        }
        case 'set_work_deadline': {
            const workItemId = reqString(payload, 'work_item_id');
            const expectedVersion = reqInt(payload, 'expected_version');
            const dueAt = payload.due_at === null ? null : asOptionalIso(payload.due_at);
            const isOverride = payload.override === true;
            const reasonText = asOptionalString(payload.reason_text);
            // docs/work-engine-override-precedence.md §3: reason_text required for deadline overrides.
            if (isOverride && !reasonText) {
                throw badRequest('reason_text is required for deadline override', 'override_reason_required');
            }
            const current = await loadWorkItem(orgId, workItemId);
            assertExpectedVersion(current.version, expectedVersion);
            if (isQueueRefreshMode(payload))
                assertQueueActionEnabled(current, 'set_deadline');
            const newVersion = current.version + 1;
            const overrideSummary = isOverride
                ? {
                    field: 'due_at',
                    previous_value: current.due_at,
                    new_value: dueAt,
                    overridden_at: new Date().toISOString(),
                    overridden_by: actorUserId,
                    reason_text: reasonText,
                }
                : null;
            const patch = { due_at: dueAt };
            if (isOverride) {
                patch.override_active = true;
                patch.override_summary_json = overrideSummary;
            }
            await updateWorkItemWithVersion({
                orgId,
                workItemId,
                expectedVersion,
                newVersion,
                patch,
            });
            await insertTransition({
                org_id: orgId,
                work_item_id: workItemId,
                from_state: current.work_state,
                to_state: current.work_state,
                transition_kind: isOverride ? 'override' : 'command',
                action_code: 'set_work_deadline',
                actor_type: 'user',
                actor_user_id: actorUserId,
                reason_text: reasonText,
                metadata_json: {
                    previous_due_at: current.due_at,
                    new_due_at: dueAt,
                    override: isOverride,
                },
                expected_version: expectedVersion,
                resulting_version: newVersion,
            });
            await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_DEADLINE_SET, { previous_due_at: current.due_at, new_due_at: dueAt, override: isOverride });
            return { ok: true, command, refreshed: await buildRefreshedForPayload(orgId, payload) };
        }
        case 'append_work_event': {
            const workItemIdOpt = asOptionalString(payload.work_item_id);
            const sourceModule = reqString(payload, 'source_module');
            const sourceEntityType = reqString(payload, 'source_entity_type');
            const sourceEntityId = reqString(payload, 'source_entity_id');
            const eventType = reqString(payload, 'event_type');
            const idempotencyKey = reqString(payload, 'idempotency_key');
            const periodKey = asOptionalString(payload.period_key);
            const directionRaw = asOptionalString(payload.direction) ?? 'outbound';
            if (directionRaw !== 'inbound' && directionRaw !== 'outbound') {
                throw badRequest('direction must be inbound or outbound');
            }
            const direction = directionRaw;
            const eventId = asOptionalString(payload.event_id) ?? randomUUID();
            const occurredAt = asOptionalIso(payload.occurred_at) ?? new Date().toISOString();
            const eventPayload = ensurePayloadObject(payload.payload);
            let clientId = null;
            if (workItemIdOpt) {
                const wi = await loadWorkItem(orgId, workItemIdOpt);
                clientId = wi.client_id;
            }
            else {
                const cidOpt = asOptionalString(payload.client_id);
                if (cidOpt) {
                    await assertClientBelongsToOrg(orgId, cidOpt);
                    clientId = cidOpt;
                }
            }
            const insertResp = await supabaseAdmin
                .from('work_events')
                .insert({
                event_id: eventId,
                org_id: orgId,
                direction,
                source_module: sourceModule,
                source_entity_type: sourceEntityType,
                source_entity_id: sourceEntityId,
                event_type: eventType,
                client_id: clientId,
                period_key: periodKey,
                work_item_id: workItemIdOpt,
                occurred_at: occurredAt,
                emitted_by_type: 'user',
                emitted_by_id: actorUserId,
                schema_version: 1,
                idempotency_key: idempotencyKey,
                payload: eventPayload,
                processing_status: 'accepted',
                processing_outcome: 'manual_command_append',
            })
                .select('id')
                .single();
            if (insertResp.error) {
                const code = insertResp.error.code;
                if (code === '23505') {
                    throw conflict('Duplicate work_event (event_id or idempotency_key already used)', 'work_event_duplicate');
                }
                throw insertResp.error;
            }
            const rowId = String(insertResp.data?.id ?? '');
            await audit(orgId, actorUserId, 'work_event', rowId || null, AUDIT_ACTIONS.WORK_EVENT_APPENDED, {
                source_module: sourceModule,
                event_type: eventType,
                direction,
                work_item_id: workItemIdOpt,
            });
            return { ok: true, command, refreshed: await buildRefreshedForPayload(orgId, payload) };
        }
        case 'apply_work_override': {
            const workItemId = reqString(payload, 'work_item_id');
            const expectedVersion = reqInt(payload, 'expected_version');
            const overrideKindRaw = reqString(payload, 'override_kind');
            if (!OVERRIDE_KINDS.includes(overrideKindRaw)) {
                throw badRequest(`Invalid override_kind: ${overrideKindRaw}`, 'invalid_override_kind');
            }
            const overrideKind = overrideKindRaw;
            const reasonText = asOptionalString(payload.reason_text);
            if (OVERRIDE_KINDS_REQUIRING_REASON.has(overrideKind) && !reasonText) {
                throw badRequest(`reason_text is required for override kind '${overrideKind}'`, 'override_reason_required');
            }
            const current = await loadWorkItem(orgId, workItemId);
            assertExpectedVersion(current.version, expectedVersion);
            if (isQueueRefreshMode(payload))
                assertQueueActionEnabled(current, 'apply_override');
            const toStateRaw = asOptionalString(payload.to_state);
            let nextState = current.work_state;
            if (toStateRaw) {
                nextState = assertValidWorkState(toStateRaw);
            }
            // Reopen is the only path out of `done` (which is terminal for normal
            // transitions). Other override kinds may NOT touch a `done` item.
            if (overrideKind === 'reopen') {
                if (current.work_state !== 'done') {
                    throw badRequest(`Override 'reopen' is only valid from work_state='done' (current='${current.work_state}')`, 'invalid_reopen_source');
                }
                if (!toStateRaw) {
                    throw badRequest(`Override 'reopen' requires 'to_state' (one of assigned|waiting_human|waiting_client)`, 'reopen_target_required');
                }
                if (!canReopenFromDone(nextState)) {
                    throw badRequest(`Override 'reopen' cannot target '${nextState}'; allowed: assigned, waiting_human, waiting_client`, 'invalid_reopen_target');
                }
            }
            else if (toStateRaw &&
                nextState !== current.work_state &&
                !canTransitionWorkState(current.work_state, nextState)) {
                throw badRequest(`Invalid override transition: ${current.work_state} -> ${nextState}`, 'invalid_transition');
            }
            const newVersion = current.version + 1;
            const overrideSummary = {
                kind: overrideKind,
                previous_state: current.work_state,
                new_state: nextState,
                overridden_at: new Date().toISOString(),
                overridden_by: actorUserId,
                reason_text: reasonText,
                previous_value: payload.previous_value ?? null,
                new_value: payload.new_value ?? null,
            };
            await updateWorkItemWithVersion({
                orgId,
                workItemId,
                expectedVersion,
                newVersion,
                patch: {
                    work_state: nextState,
                    override_active: true,
                    override_summary_json: overrideSummary,
                },
            });
            await insertTransition({
                org_id: orgId,
                work_item_id: workItemId,
                from_state: current.work_state,
                to_state: nextState,
                transition_kind: 'override',
                action_code: 'apply_work_override',
                actor_type: 'user',
                actor_user_id: actorUserId,
                reason_text: reasonText,
                metadata_json: overrideSummary,
                expected_version: expectedVersion,
                resulting_version: newVersion,
            });
            await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_OVERRIDE_APPLIED, {
                override_kind: overrideKind,
                from_state: current.work_state,
                to_state: nextState,
            });
            return { ok: true, command, refreshed: await buildRefreshedForPayload(orgId, payload) };
        }
        case 'intake_work_event': {
            // Stage 3A: thin dispatcher only — all intake / dedup / work_item creation
            // logic lives in work-engine.event-intake.service.ts. The route layer must
            // not make any workflow decisions.
            const meta = await intakeWorkEvent(ctx, payload);
            return {
                ok: true,
                command,
                refreshed: await buildRefreshedForPayload(orgId, payload),
                meta,
            };
        }
        default: {
            const exhaustive = command;
            throw badRequest(`Unknown work engine command: ${String(exhaustive)}`);
        }
    }
}
