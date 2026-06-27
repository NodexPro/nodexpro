/**
 * Work Engine event intake.
 *
 * Stage 2 (preserved): `acceptWorkEngineEvent(env)` is the raw event-envelope
 * audit log writer. It validates the envelope, deduplicates by event_id /
 * idempotency_key, and stores every accepted/duplicate/failed row in
 * `work_events`. It does NOT auto-create work_items.
 *
 * Stage 3A: `intakeWorkEvent(caller, payload)` is the canonical command handler
 * for `intake_work_event` via `POST /api/v1/work-engine/commands`. It:
 *   1. validates the intake payload against tenant context;
 *   2. enforces idempotency by event_id and (source_module, idempotency_key);
 *   3. respects the active-work-item invariant
 *      (org_id, client_id, module_key, work_type, period_key)
 *      WHERE work_state NOT IN ('done','archived')
 *      — if active exists, the event is recorded against it and an audit
 *      transition is appended (no duplicate work_item);
 *   4. links the event row to the work_item it created or reused;
 *   5. writes audit rows for received / duplicate / created / reused outcomes.
 *
 * Stage 3B (new): the workflow contract (module_key, work_type, initial
 * work_state) is decided by the explicit allowlist mapper in
 * `work-engine.event-mapping.service.ts`. Emitter-supplied `work_type` is
 * intentionally IGNORED — backend trusts only the allowlist. Unknown event
 * types and events missing required envelope fields are persisted with
 * `processing_outcome = '<mapping reason>'` and DO NOT create a work_item.
 *
 * Stage 3A+3B is intake + dedup + mapped work item creation ONLY. No SLA, no
 * country deadlines, no notifications, no assignment, no DocFlow, no UI.
 *
 * Source of truth: docs/work-engine-event-contract.md, docs/work-engine-dedup-policy.md,
 *                  docs/work-engine-domain-model.md, docs/work-engine-state-machine.md.
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { ACTOR_TYPES, } from './work-engine.types.js';
import { PERIOD_KEY_REGEX, assertOrgScope, assertValidPeriodKey, isUuid, } from './work-engine.guards.js';
import { PENDING_MAPPING_PROCESSING_OUTCOMES, resolveEventMapping, } from './work-engine.event-mapping.service.js';
import { assertIncomeDocumentIntakeSourceEntity } from './work-engine-income-intake.guards.js';
function validateEnvelope(env) {
    if (!env || typeof env !== 'object')
        throw badRequest('event envelope is required');
    if (!env.event_id || !isUuid(env.event_id)) {
        throw badRequest('event_id must be a uuid');
    }
    if (!env.org_id || !isUuid(env.org_id)) {
        throw badRequest('org_id must be a uuid');
    }
    if (env.client_id !== null && !isUuid(String(env.client_id))) {
        throw badRequest('client_id must be a uuid or null');
    }
    if (!env.source_module || !String(env.source_module).trim()) {
        throw badRequest('source_module is required');
    }
    if (!env.source_entity_type || !String(env.source_entity_type).trim()) {
        throw badRequest('source_entity_type is required');
    }
    if (!env.source_entity_id || !String(env.source_entity_id).trim()) {
        throw badRequest('source_entity_id is required');
    }
    if (!env.event_type || !String(env.event_type).trim()) {
        throw badRequest('event_type is required');
    }
    if (!env.occurred_at || !Number.isFinite(new Date(env.occurred_at).getTime())) {
        throw badRequest('occurred_at must be an ISO datetime');
    }
    if (!ACTOR_TYPES.includes(env.emitted_by_type)) {
        throw badRequest('emitted_by_type must be user|system|rule');
    }
    if (env.emitted_by_id !== null && !isUuid(String(env.emitted_by_id))) {
        throw badRequest('emitted_by_id must be a uuid or null');
    }
    if (typeof env.schema_version !== 'number' ||
        !Number.isInteger(env.schema_version) ||
        env.schema_version < 1) {
        throw badRequest('schema_version must be an integer >= 1');
    }
    if (!env.idempotency_key || !String(env.idempotency_key).trim()) {
        throw badRequest('idempotency_key is required');
    }
    if (env.period_key !== null) {
        const pk = String(env.period_key).trim();
        if (pk && !PERIOD_KEY_REGEX.test(pk)) {
            throw badRequest(`period_key must match ${PERIOD_KEY_REGEX.source} (see docs/work-engine-dedup-policy.md §8)`);
        }
    }
}
async function findExistingEvent(orgId, eventId, sourceModule, idempotencyKey) {
    const byEvent = await supabaseAdmin
        .from('work_events')
        .select('id')
        .eq('org_id', orgId)
        .eq('event_id', eventId)
        .maybeSingle();
    if (byEvent.error)
        throw byEvent.error;
    if (byEvent.data)
        return String(byEvent.data.id);
    const byIdem = await supabaseAdmin
        .from('work_events')
        .select('id')
        .eq('org_id', orgId)
        .eq('source_module', sourceModule)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
    if (byIdem.error)
        throw byIdem.error;
    return byIdem.data ? String(byIdem.data.id) : null;
}
/**
 * Accept a cross-module event envelope.
 *
 * Returns one of:
 *   - `accepted`  — new row written with `processing_status='accepted'`;
 *   - `duplicate` — same `(org_id, event_id)` or `(org_id, source_module, idempotency_key)` already exists;
 *   - `rejected`  — domain-level failure (tenant mismatch, client not found). A `failed` row is still written.
 *
 * Envelope-level validation failures throw `badRequest` and do NOT persist anything.
 */
export async function acceptWorkEngineEvent(env) {
    validateEnvelope(env);
    const existing = await findExistingEvent(env.org_id, env.event_id, env.source_module, env.idempotency_key);
    if (existing) {
        return {
            result: 'duplicate',
            work_event_id: existing,
            processing_status: 'ignored_duplicate',
            processing_outcome: 'ignored_duplicate',
            processing_error: null,
        };
    }
    let processingStatus = 'accepted';
    let processingOutcome = 'accepted_pending_routing';
    let processingError = null;
    if (env.client_id) {
        const { data: client, error } = await supabaseAdmin
            .from('clients')
            .select('id, organization_id')
            .eq('id', env.client_id)
            .maybeSingle();
        if (error)
            throw error;
        if (!client) {
            processingStatus = 'failed';
            processingOutcome = 'client_not_found';
            processingError = `client ${env.client_id} not found`;
        }
        else if (client.organization_id !== env.org_id) {
            processingStatus = 'failed';
            processingOutcome = 'tenant_mismatch';
            processingError = 'client.organization_id does not match envelope org_id';
        }
    }
    // Stage 2: per task spec, do NOT auto-create work_items.
    // Persist envelope for audit; Stage 3 will add the routing/dedup consumer.
    const insertResp = await supabaseAdmin
        .from('work_events')
        .insert({
        event_id: env.event_id,
        org_id: env.org_id,
        direction: 'inbound',
        source_module: env.source_module,
        source_entity_type: env.source_entity_type,
        source_entity_id: env.source_entity_id,
        event_type: env.event_type,
        client_id: env.client_id,
        period_key: env.period_key,
        work_item_id: null,
        occurred_at: env.occurred_at,
        emitted_by_type: env.emitted_by_type,
        emitted_by_id: env.emitted_by_id,
        schema_version: env.schema_version,
        idempotency_key: env.idempotency_key,
        payload: env.payload && typeof env.payload === 'object' && !Array.isArray(env.payload)
            ? env.payload
            : {},
        processing_status: processingStatus,
        processing_outcome: processingOutcome,
        processing_error: processingError,
    })
        .select('id')
        .single();
    if (insertResp.error) {
        const code = insertResp.error.code;
        if (code === '23505') {
            const again = await findExistingEvent(env.org_id, env.event_id, env.source_module, env.idempotency_key);
            return {
                result: 'duplicate',
                work_event_id: again,
                processing_status: 'ignored_duplicate',
                processing_outcome: 'ignored_duplicate',
                processing_error: null,
            };
        }
        throw insertResp.error;
    }
    const id = String(insertResp.data.id);
    if (processingStatus === 'failed') {
        return {
            result: 'rejected',
            work_event_id: id,
            processing_status: 'failed',
            processing_outcome: processingOutcome,
            processing_error: processingError,
        };
    }
    return {
        result: 'accepted',
        work_event_id: id,
        processing_status: 'accepted',
        processing_outcome: processingOutcome,
        processing_error: null,
    };
}
function reqNonEmpty(obj, key) {
    const v = String(obj[key] ?? '').trim();
    if (!v)
        throw badRequest(`${key} is required`);
    return v;
}
function ensureRecord(v) {
    return v && typeof v === 'object' && !Array.isArray(v)
        ? v
        : {};
}
/**
 * Shared body of intake_work_event validation once `org_id` is resolved and
 * (for office) membership asserted elsewhere.
 */
function parseIntakeWorkEventEnvelope(orgId, raw) {
    const clientId = reqNonEmpty(raw, 'client_id');
    if (!isUuid(clientId))
        throw badRequest('client_id must be a uuid');
    const sourceModule = reqNonEmpty(raw, 'source_module');
    const sourceEntityType = reqNonEmpty(raw, 'source_entity_type');
    const sourceEntityId = reqNonEmpty(raw, 'source_entity_id');
    const eventType = reqNonEmpty(raw, 'event_type');
    // work_type — optional; never invented by backend.
    const workTypeRaw = String(raw.work_type ?? '').trim();
    const workType = workTypeRaw ? workTypeRaw : null;
    // period_key — optional; when present must match the canonical regex.
    const periodKeyRaw = String(raw.period_key ?? '').trim();
    const periodKey = periodKeyRaw
        ? assertValidPeriodKey(periodKeyRaw)
        : null;
    const occurredAtRaw = String(raw.occurred_at ?? '').trim();
    if (!occurredAtRaw || !Number.isFinite(new Date(occurredAtRaw).getTime())) {
        throw badRequest('occurred_at must be an ISO datetime');
    }
    const schemaVersionRaw = raw.schema_version;
    const schemaVersion = typeof schemaVersionRaw === 'number' ? schemaVersionRaw : Number(schemaVersionRaw);
    if (!Number.isFinite(schemaVersion) ||
        !Number.isInteger(schemaVersion) ||
        schemaVersion < 1) {
        throw badRequest('schema_version must be an integer >= 1');
    }
    const eventIdRaw = raw.event_id;
    let eventId;
    if (eventIdRaw === undefined || eventIdRaw === null || eventIdRaw === '') {
        eventId = randomUUID();
    }
    else {
        eventId = String(eventIdRaw).trim();
        if (!isUuid(eventId))
            throw badRequest('event_id must be a uuid');
    }
    const emittedByTypeRaw = String(raw.emitted_by_type ?? 'system').trim();
    if (!ACTOR_TYPES.includes(emittedByTypeRaw)) {
        throw badRequest('emitted_by_type must be one of user|system|rule');
    }
    // User-emitted events are not the Stage 3A contract; intake is an automation
    // surface. Reject explicitly to keep "state ≠ action ≠ event" invariants.
    if (emittedByTypeRaw === 'user') {
        throw badRequest("emitted_by_type='user' is not allowed for intake_work_event; use a user-driven command instead", 'intake_user_emitter_forbidden');
    }
    const emittedByType = emittedByTypeRaw;
    let emittedById = null;
    if (raw.emitted_by_id !== undefined && raw.emitted_by_id !== null) {
        const s = String(raw.emitted_by_id).trim();
        if (s) {
            if (!isUuid(s))
                throw badRequest('emitted_by_id must be a uuid or null');
            emittedById = s;
        }
    }
    // Dedup tuple per rule 1: (org_id, source_module, source_entity_id, event_type, period_key).
    // Missing period_key is encoded as the literal empty string so the unique
    // index (org_id, source_module, idempotency_key) still distinguishes
    // "periodless" events from period-scoped ones.
    const dedupKey = `${sourceEntityId}|${eventType}|${periodKey ?? ''}`;
    return {
        event_id: eventId,
        org_id: orgId,
        client_id: clientId,
        source_module: sourceModule,
        source_entity_type: sourceEntityType,
        source_entity_id: sourceEntityId,
        event_type: eventType,
        work_type: workType,
        period_key: periodKey,
        occurred_at: occurredAtRaw,
        schema_version: schemaVersion,
        emitted_by_type: emittedByType,
        emitted_by_id: emittedById,
        payload: ensureRecord(raw.payload),
        dedup_key: dedupKey,
    };
}
function validateIntakePayload(ctx, raw) {
    const ctxOrgId = ctx.organizationId;
    if (!ctxOrgId || !ctx.membership) {
        throw forbidden('Organization context required');
    }
    const payloadOrgIdRaw = raw.org_id;
    const orgId = String(payloadOrgIdRaw ?? ctxOrgId).trim();
    if (!isUuid(orgId))
        throw badRequest('org_id must be a uuid');
    if (payloadOrgIdRaw !== undefined && payloadOrgIdRaw !== null) {
        if (orgId !== ctxOrgId) {
            throw forbidden('payload.org_id does not match authenticated organization');
        }
    }
    // Final cross-check via the same guard used by every command.
    assertOrgScope(ctx, orgId);
    return parseIntakeWorkEventEnvelope(orgId, raw);
}
/** Portal-trusted intake: org_id resolved from verified portal session only. */
function validateIntakePayloadForTrustedOrg(orgIdTrusted, raw) {
    const payloadOrgIdRaw = raw.org_id;
    const orgId = String(payloadOrgIdRaw ?? orgIdTrusted).trim();
    if (!isUuid(orgId))
        throw badRequest('org_id must be a uuid');
    if (orgId !== orgIdTrusted) {
        throw forbidden('payload.org_id does not match trusted organization context');
    }
    return parseIntakeWorkEventEnvelope(orgId, raw);
}
async function assertClientInOrg(orgId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id, organization_id')
        .eq('id', clientId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw badRequest(`client ${clientId} not found`, 'client_not_found');
    if (data.organization_id !== orgId) {
        throw forbidden('client does not belong to authenticated organization');
    }
}
/** Look up the existing event row + its work_item_id (if any) for an idempotency-collision read. */
async function findExistingIntakeEvent(orgId, eventId, sourceModule, dedupKey) {
    const byEvent = await supabaseAdmin
        .from('work_events')
        .select('id, work_item_id')
        .eq('org_id', orgId)
        .eq('event_id', eventId)
        .maybeSingle();
    if (byEvent.error)
        throw byEvent.error;
    if (byEvent.data) {
        return {
            id: String(byEvent.data.id),
            work_item_id: byEvent.data.work_item_id ?? null,
        };
    }
    const byIdem = await supabaseAdmin
        .from('work_events')
        .select('id, work_item_id')
        .eq('org_id', orgId)
        .eq('source_module', sourceModule)
        .eq('idempotency_key', dedupKey)
        .maybeSingle();
    if (byIdem.error)
        throw byIdem.error;
    if (!byIdem.data)
        return null;
    return {
        id: String(byIdem.data.id),
        work_item_id: byIdem.data.work_item_id ?? null,
    };
}
/** Find the single active work_item for the dedup tuple. */
async function findActiveWorkItem(orgId, clientId, moduleKey, workType, periodKey) {
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .select('*')
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .eq('module_key', moduleKey)
        .eq('work_type', workType)
        .eq('period_key', periodKey)
        .not('work_state', 'in', '(done,archived)')
        .maybeSingle();
    if (error)
        throw error;
    return data ?? null;
}
async function insertIntakeEventRow(v, workItemId, processingOutcome) {
    const insertResp = await supabaseAdmin
        .from('work_events')
        .insert({
        event_id: v.event_id,
        org_id: v.org_id,
        direction: 'inbound',
        source_module: v.source_module,
        source_entity_type: v.source_entity_type,
        source_entity_id: v.source_entity_id,
        event_type: v.event_type,
        client_id: v.client_id,
        period_key: v.period_key,
        work_item_id: workItemId,
        occurred_at: v.occurred_at,
        emitted_by_type: v.emitted_by_type,
        emitted_by_id: v.emitted_by_id,
        schema_version: v.schema_version,
        idempotency_key: v.dedup_key,
        payload: v.payload,
        processing_status: 'accepted',
        processing_outcome: processingOutcome,
        processing_error: null,
    })
        .select('id')
        .single();
    if (insertResp.error)
        throw insertResp.error;
    return String(insertResp.data.id);
}
async function insertIntakeTransition(args) {
    const { error } = await supabaseAdmin.from('work_transitions').insert({
        org_id: args.orgId,
        work_item_id: args.workItemId,
        from_state: args.fromState,
        to_state: args.toState,
        transition_kind: 'automation',
        action_code: args.actionCode,
        actor_type: 'system',
        actor_user_id: null,
        reason_text: null,
        metadata_json: args.payloadSnapshot,
        expected_version: null,
        resulting_version: args.resultingVersion,
    });
    if (error)
        throw error;
}
async function auditIntake(v, actorUserId, action, workItemId, workEventId, extra) {
    await writeAudit({
        organizationId: v.org_id,
        actorUserId,
        moduleCode: 'work_engine',
        entityType: workItemId ? 'work_item' : 'work_event',
        entityId: workItemId ?? workEventId ?? null,
        action,
        payload: {
            event_id: v.event_id,
            event_type: v.event_type,
            source_module: v.source_module,
            source_entity_type: v.source_entity_type,
            source_entity_id: v.source_entity_id,
            client_id: v.client_id,
            work_type: v.work_type,
            period_key: v.period_key,
            dedup_key: v.dedup_key,
            work_event_id: workEventId,
            work_item_id: workItemId,
            ...extra,
        },
    });
}
/**
 * Stage 3A canonical event intake command handler.
 *
 * Returns the metadata about the intake outcome; the caller (commands service)
 * is responsible for attaching a refreshed Work Engine aggregate to the
 * response envelope.
 */
export async function intakeWorkEvent(caller, payloadInput) {
    const raw = ensureRecord(payloadInput);
    const v = caller.kind === 'office_request'
        ? validateIntakePayload(caller.ctx, raw)
        : validateIntakePayloadForTrustedOrg(caller.orgId, raw);
    await assertClientInOrg(v.org_id, v.client_id);
    await assertIncomeDocumentIntakeSourceEntity({
        org_id: v.org_id,
        client_id: v.client_id,
        source_module: v.source_module,
        source_entity_type: v.source_entity_type,
        source_entity_id: v.source_entity_id,
        event_type: v.event_type,
    });
    const actorUserId = caller.kind === 'office_request' ? caller.ctx.user.id : caller.auditActorUserId;
    // Always audit "received" first so duplicate/failure paths still leave a trail.
    await auditIntake(v, actorUserId, AUDIT_ACTIONS.WORK_EVENT_RECEIVED, null, null, {
        emitted_by_type: v.emitted_by_type,
    });
    // ---- Step 1: event-level idempotency ----
    const existing = await findExistingIntakeEvent(v.org_id, v.event_id, v.source_module, v.dedup_key);
    if (existing) {
        await auditIntake(v, actorUserId, AUDIT_ACTIONS.WORK_EVENT_DUPLICATE_SKIPPED, existing.work_item_id, existing.id, { duplicate_of_work_event_id: existing.id });
        return {
            intake_result: 'duplicate_event',
            work_event_id: existing.id,
            work_item_id: existing.work_item_id,
            event_id: v.event_id,
            dedup_key: v.dedup_key,
        };
    }
    // ---- Step 2: explicit mapping (Stage 3B) ----
    // Backend ONLY trusts the static allowlist in event-mapping.service.ts. The
    // mapper picks module_key / work_type / initial_state from that allowlist.
    // Anything emitter sent under payload.work_type is intentionally ignored —
    // backend never lets emitters "claim" a workflow domain.
    const mapping = resolveEventMapping({
        event_type: v.event_type,
        period_key: v.period_key,
    });
    if (!mapping.resolved) {
        const workEventId = await insertIntakeEventRow(v, null, mapping.reason);
        await auditIntake(v, actorUserId, AUDIT_ACTIONS.WORK_EVENT_MAPPING_PENDING, null, workEventId, {
            pending_reason: mapping.reason,
            missing_fields: mapping.missing_fields ?? null,
        });
        return {
            intake_result: 'pending_mapping',
            work_event_id: workEventId,
            work_item_id: null,
            event_id: v.event_id,
            dedup_key: v.dedup_key,
            pending_reason: mapping.reason,
        };
    }
    // Mapper resolved → authoritative workflow contract for this event.
    const mappedModuleKey = mapping.module_key;
    const mappedWorkType = mapping.work_type;
    const mappedInitialState = mapping.initial_state;
    // period_key existence is guaranteed by the mapper (`requires_period_key`).
    const periodKey = v.period_key;
    await auditIntake(v, actorUserId, AUDIT_ACTIONS.WORK_EVENT_MAPPING_RESOLVED, null, null, {
        mapped_module_key: mappedModuleKey,
        mapped_work_type: mappedWorkType,
        mapped_initial_state: mappedInitialState,
    });
    // ---- Step 3: active work_item dedup ----
    // Dedup tuple per docs/work-engine-dedup-policy.md:
    //   (org_id, client_id, module_key, work_type, period_key) WHERE work_state
    //   NOT IN ('done','archived'). module_key/work_type come from the mapper.
    const active = await findActiveWorkItem(v.org_id, v.client_id, mappedModuleKey, mappedWorkType, periodKey);
    if (active) {
        const workEventId = await insertIntakeEventRow(v, active.id, 'reused_existing_active_work_item');
        await insertIntakeTransition({
            orgId: v.org_id,
            workItemId: active.id,
            fromState: active.work_state,
            toState: active.work_state,
            actionCode: 'intake_event_appended_to_existing',
            resultingVersion: active.version,
            payloadSnapshot: {
                event_id: v.event_id,
                event_type: v.event_type,
                source_entity_id: v.source_entity_id,
            },
        });
        await auditIntake(v, actorUserId, AUDIT_ACTIONS.WORK_ITEM_EXISTING_REUSED_FROM_EVENT, active.id, workEventId, { work_state: active.work_state, work_item_version: active.version });
        return {
            intake_result: 'reused_existing',
            work_event_id: workEventId,
            work_item_id: active.id,
            event_id: v.event_id,
            dedup_key: v.dedup_key,
        };
    }
    // ---- Step 4: create new work_item ----
    // module_key + work_type + initial_state come from the mapper. source_module
    // stays as the emitter identity (audit lineage).
    const createResp = await supabaseAdmin
        .from('work_items')
        .insert({
        org_id: v.org_id,
        client_id: v.client_id,
        module_key: mappedModuleKey,
        work_type: mappedWorkType,
        period_key: periodKey,
        work_state: mappedInitialState,
        owner_user_id: null,
        assigned_user_id: null,
        reviewer_user_id: null,
        escalation_owner_id: null,
        due_at: null,
        sla_status: 'none',
        source_module: v.source_module,
        source_entity_type: v.source_entity_type,
        source_entity_id: v.source_entity_id,
        created_by_rule_id: null,
        created_by_event_id: v.event_id,
        created_by_user_id: null,
        creation_source_type: 'event',
        version: 0,
        override_active: false,
    })
        .select('*')
        .single();
    if (createResp.error) {
        const code = createResp.error.code;
        if (code === '23505') {
            // Race: someone created the active work_item between our SELECT and INSERT.
            // Fall back to the reuse path with a fresh fetch.
            const raceWinner = await findActiveWorkItem(v.org_id, v.client_id, mappedModuleKey, mappedWorkType, periodKey);
            if (!raceWinner)
                throw createResp.error;
            const workEventId = await insertIntakeEventRow(v, raceWinner.id, 'reused_existing_active_work_item_after_race');
            await insertIntakeTransition({
                orgId: v.org_id,
                workItemId: raceWinner.id,
                fromState: raceWinner.work_state,
                toState: raceWinner.work_state,
                actionCode: 'intake_event_appended_to_existing',
                resultingVersion: raceWinner.version,
                payloadSnapshot: {
                    event_id: v.event_id,
                    event_type: v.event_type,
                    source_entity_id: v.source_entity_id,
                    race_resolved: true,
                },
            });
            await auditIntake(v, actorUserId, AUDIT_ACTIONS.WORK_ITEM_EXISTING_REUSED_FROM_EVENT, raceWinner.id, workEventId, {
                work_state: raceWinner.work_state,
                work_item_version: raceWinner.version,
                race_resolved: true,
            });
            return {
                intake_result: 'reused_existing',
                work_event_id: workEventId,
                work_item_id: raceWinner.id,
                event_id: v.event_id,
                dedup_key: v.dedup_key,
            };
        }
        throw createResp.error;
    }
    const created = createResp.data;
    const workEventId = await insertIntakeEventRow(v, created.id, 'created_new_work_item');
    await insertIntakeTransition({
        orgId: v.org_id,
        workItemId: created.id,
        fromState: null,
        toState: mappedInitialState,
        actionCode: 'create_from_event',
        resultingVersion: created.version,
        payloadSnapshot: {
            event_id: v.event_id,
            event_type: v.event_type,
            source_entity_id: v.source_entity_id,
            creation_source_type: 'event',
            mapped_module_key: mappedModuleKey,
            mapped_work_type: mappedWorkType,
        },
    });
    await auditIntake(v, actorUserId, AUDIT_ACTIONS.WORK_ITEM_AUTO_CREATED_FROM_EVENT, created.id, workEventId, {
        work_state: mappedInitialState,
        mapped_module_key: mappedModuleKey,
        mapped_work_type: mappedWorkType,
    });
    return {
        intake_result: 'created',
        work_event_id: workEventId,
        work_item_id: created.id,
        event_id: v.event_id,
        dedup_key: v.dedup_key,
    };
}
async function updatePendingWorkEventOutcome(workEventId, orgId, workItemId, processingOutcome) {
    const { error } = await supabaseAdmin
        .from('work_events')
        .update({
        work_item_id: workItemId,
        processing_outcome: processingOutcome,
    })
        .eq('id', workEventId)
        .eq('org_id', orgId);
    if (error)
        throw error;
}
/**
 * Scheduler batch: retry mapping for persisted events that previously stayed pending.
 * No module-specific logic — only the shared allowlist mapper.
 */
export async function reprocessPendingWorkEventsForOrg(params) {
    const result = {
        scanned: 0,
        resolved: 0,
        still_pending: 0,
        linked_work_item_ids: [],
        errors: 0,
    };
    const { data, error } = await supabaseAdmin
        .from('work_events')
        .select('id, org_id, event_id, client_id, source_module, source_entity_type, source_entity_id, event_type, period_key, idempotency_key, payload, processing_outcome')
        .eq('org_id', params.orgId)
        .is('work_item_id', null)
        .in('processing_outcome', PENDING_MAPPING_PROCESSING_OUTCOMES)
        .order('received_at', { ascending: true })
        .limit(params.limit);
    if (error)
        throw error;
    const rows = (data ?? []);
    result.scanned = rows.length;
    for (const row of rows) {
        try {
            if (!row.client_id || !isUuid(row.client_id)) {
                result.still_pending += 1;
                continue;
            }
            const mapping = resolveEventMapping({
                event_type: row.event_type,
                period_key: row.period_key,
            });
            if (!mapping.resolved) {
                result.still_pending += 1;
                continue;
            }
            const periodKey = row.period_key;
            const active = await findActiveWorkItem(row.org_id, row.client_id, mapping.module_key, mapping.work_type, periodKey);
            if (params.dryRun) {
                result.resolved += 1;
                if (active)
                    result.linked_work_item_ids.push(active.id);
                continue;
            }
            if (active) {
                await updatePendingWorkEventOutcome(row.id, row.org_id, active.id, 'reused_existing_active_work_item');
                await insertIntakeTransition({
                    orgId: row.org_id,
                    workItemId: active.id,
                    fromState: active.work_state,
                    toState: active.work_state,
                    actionCode: 'intake_event_appended_to_existing',
                    resultingVersion: active.version,
                    payloadSnapshot: {
                        event_id: row.event_id,
                        event_type: row.event_type,
                        source_entity_id: row.source_entity_id,
                        scheduler_reprocess: true,
                    },
                });
                result.resolved += 1;
                result.linked_work_item_ids.push(active.id);
                continue;
            }
            const createResp = await supabaseAdmin
                .from('work_items')
                .insert({
                org_id: row.org_id,
                client_id: row.client_id,
                module_key: mapping.module_key,
                work_type: mapping.work_type,
                period_key: periodKey,
                work_state: mapping.initial_state,
                owner_user_id: null,
                assigned_user_id: null,
                reviewer_user_id: null,
                escalation_owner_id: null,
                due_at: null,
                sla_status: 'none',
                source_module: row.source_module,
                source_entity_type: row.source_entity_type,
                source_entity_id: row.source_entity_id,
                created_by_rule_id: null,
                created_by_event_id: row.event_id,
                created_by_user_id: null,
                creation_source_type: 'event',
                version: 0,
                override_active: false,
            })
                .select('*')
                .single();
            if (createResp.error) {
                const code = createResp.error.code;
                if (code === '23505') {
                    const raceWinner = await findActiveWorkItem(row.org_id, row.client_id, mapping.module_key, mapping.work_type, periodKey);
                    if (!raceWinner)
                        throw createResp.error;
                    await updatePendingWorkEventOutcome(row.id, row.org_id, raceWinner.id, 'reused_existing_active_work_item_after_race');
                    result.resolved += 1;
                    result.linked_work_item_ids.push(raceWinner.id);
                    continue;
                }
                throw createResp.error;
            }
            const created = createResp.data;
            await updatePendingWorkEventOutcome(row.id, row.org_id, created.id, 'created_new_work_item');
            await insertIntakeTransition({
                orgId: row.org_id,
                workItemId: created.id,
                fromState: null,
                toState: mapping.initial_state,
                actionCode: 'create_from_event',
                resultingVersion: created.version,
                payloadSnapshot: {
                    event_id: row.event_id,
                    event_type: row.event_type,
                    source_entity_id: row.source_entity_id,
                    scheduler_reprocess: true,
                },
            });
            result.resolved += 1;
            result.linked_work_item_ids.push(created.id);
        }
        catch {
            result.errors += 1;
        }
    }
    return result;
}
