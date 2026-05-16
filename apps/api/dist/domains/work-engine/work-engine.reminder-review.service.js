/**
 * Work Engine reminder candidate review commands (Stage 10 Phase 3B-3).
 * Human review / approve / cancel / snooze — delivery only on explicit approve.
 */
import { supabaseAdmin } from '../../db/client.js';
import { businessYmd } from '../../shared/business-time.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { isUuid } from './work-engine.guards.js';
import { REMINDER_CHANNELS, } from '../country-pack/operational-communication-owner-payload.js';
import { resolveOperationalCommunicationPolicies } from '../country-pack/operational-communication-policy.service.js';
import { formatOffsetMinutesAsPeriodLabel } from './work-engine.reminder.logic.js';
import { createSystemMessageCore } from '../docflow/docflow-system-message-core.service.js';
export const REMINDER_SNOOZE_PRESETS = [
    { preset_key: '1h', label: '1 hour', duration_minutes: 60 },
    { preset_key: '4h', label: '4 hours', duration_minutes: 240 },
    { preset_key: '1d', label: '1 day', duration_minutes: 1440 },
    { preset_key: '3d', label: '3 days', duration_minutes: 4320 },
];
const REVIEWABLE_STATUSES = ['pending_review', 'edited'];
function humanizeKey(key) {
    return key
        .split(/[_-]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}
function workflowTypeLabel(workflowType) {
    switch (workflowType) {
        case 'waiting_client':
            return 'Waiting for client';
        case 'response_sla':
            return 'Response SLA';
        case 'review_sla':
            return 'Review SLA';
        default:
            return humanizeKey(workflowType);
    }
}
function channelLabel(channel) {
    switch (channel) {
        case 'docflow':
            return 'DocFlow';
        case 'email':
            return 'Email';
        case 'portal':
            return 'Portal';
        default:
            return humanizeKey(channel);
    }
}
/** Map policy channel tokens to canonical keys; never surface docflow:thread:uuid in UI. */
function normalizeReminderChannelKey(raw) {
    const t = raw.trim().toLowerCase();
    if (!t)
        return null;
    if (t === 'docflow' || t.startsWith('docflow:'))
        return 'docflow';
    if (t === 'email' || t.startsWith('email:'))
        return 'email';
    if (t === 'portal' || t.startsWith('portal:'))
        return 'portal';
    if (REMINDER_CHANNELS.includes(t)) {
        return t;
    }
    return null;
}
function humanChannelLabelsFromSnapshot(snapshot, primaryChannel) {
    const keys = [];
    const seen = new Set();
    const pushKey = (raw) => {
        const key = normalizeReminderChannelKey(raw);
        if (!key || seen.has(key))
            return;
        seen.add(key);
        keys.push(key);
    };
    if (Array.isArray(snapshot)) {
        for (const item of snapshot)
            pushKey(String(item));
    }
    pushKey(primaryChannel);
    return keys.map(channelLabel);
}
function formatChannelCell(labels) {
    return labels.length > 0 ? labels.join(', ') : '—';
}
function displayClientName(name, clientId) {
    if (!name?.trim())
        return null;
    const trimmed = name.trim();
    if (clientId && trimmed === clientId)
        return null;
    if (isUuid(trimmed))
        return null;
    return trimmed;
}
function resolveReminderCadencePeriodLabel(candidate, snap, policy) {
    const offsetRaw = snap.offset_minutes;
    if (typeof offsetRaw === 'number' && Number.isFinite(offsetRaw) && offsetRaw >= 0) {
        return formatOffsetMinutesAsPeriodLabel(Math.floor(offsetRaw));
    }
    if (policy) {
        const workflow = policy.workflows.find((w) => w.workflow_type === candidate.workflow_type);
        const step = workflow?.cadence_steps.find((s) => s.step_key === candidate.step_key);
        if (step)
            return formatOffsetMinutesAsPeriodLabel(step.offset_minutes);
    }
    return null;
}
function candidateStateLabel(status) {
    switch (status) {
        case 'pending_review':
            return 'Pending review';
        case 'edited':
            return 'Edited';
        case 'approved':
            return 'Approved';
        case 'sent':
            return 'Sent';
        case 'cancelled':
            return 'Cancelled';
        case 'snoozed':
            return 'Snoozed';
        default:
            return humanizeKey(status);
    }
}
function severityFromSlaSnapshot(snapshot) {
    const sla = String(snapshot.sla_status ?? 'none');
    switch (sla) {
        case 'breached':
            return { key: 'breached', label: 'Breached', urgent: true, overdue: true };
        case 'overdue':
            return { key: 'overdue', label: 'Overdue', urgent: true, overdue: true };
        case 'due_soon':
            return { key: 'due_soon', label: 'Due soon', urgent: true, overdue: false };
        default:
            return { key: 'normal', label: 'Normal', urgent: false, overdue: false };
    }
}
function formatQueueLabel(iso) {
    if (!iso)
        return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toLocaleString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        hour12: false,
    });
}
function parseChannelOrder(snapshot) {
    if (!Array.isArray(snapshot))
        return [];
    const keys = [];
    const seen = new Set();
    for (const item of snapshot) {
        const key = normalizeReminderChannelKey(String(item));
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        keys.push(key);
    }
    return keys;
}
function notificationAudience(targetType) {
    switch (targetType) {
        case 'client':
            return 'client_portal';
        case 'reviewer':
            return 'office_reviewer';
        case 'escalation_owner':
            return 'office_escalation_owner';
        default:
            return 'office_assigned';
    }
}
function notificationSeverity(snapshot) {
    const sla = String(snapshot.sla_status ?? 'none');
    if (sla === 'breached' || sla === 'overdue')
        return 'urgent';
    if (sla === 'due_soon')
        return 'warn';
    return 'info';
}
export function parseReminderSnoozePreset(raw) {
    const key = String(raw ?? '').trim();
    const found = REMINDER_SNOOZE_PRESETS.find((p) => p.preset_key === key);
    if (!found)
        throw badRequest('Invalid snooze_preset');
    return found.preset_key;
}
export async function loadReminderCandidate(orgId, candidateId) {
    const { data, error } = await supabaseAdmin
        .from('work_reminder_candidates')
        .select('id, org_id, work_item_id, client_id, workflow_type, step_key, status, channel, channel_order_snapshot, target_type, subject, body, edited_body, suggested_send_at, snoozed_until, sla_context_snapshot, version, created_at, updated_at')
        .eq('org_id', orgId)
        .eq('id', candidateId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Reminder candidate not found');
    return data;
}
function assertReviewable(candidate) {
    if (candidate.status === 'snoozed') {
        const until = candidate.snoozed_until ? new Date(candidate.snoozed_until).getTime() : 0;
        if (until > Date.now()) {
            throw badRequest('Reminder candidate is snoozed');
        }
        return;
    }
    if (!REVIEWABLE_STATUSES.includes(candidate.status)) {
        throw badRequest(`Reminder candidate cannot be modified in status ${candidate.status}`);
    }
}
async function assertExpectedCandidateVersion(orgId, candidateId, expectedVersion) {
    const row = await loadReminderCandidate(orgId, candidateId);
    if (row.version !== expectedVersion) {
        throw conflict('Reminder candidate was updated by another session');
    }
    return row;
}
export async function loadReminderReviewCounts(orgId) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('work_reminder_candidates')
        .select('status, snoozed_until, sla_context_snapshot')
        .eq('org_id', orgId)
        .in('status', ['pending_review', 'edited', 'snoozed'])
        .limit(5000);
    if (error)
        throw error;
    let pending_count = 0;
    let urgent_count = 0;
    let overdue_count = 0;
    for (const row of data ?? []) {
        const status = String(row.status);
        if (status === 'snoozed') {
            const until = row.snoozed_until ? new Date(String(row.snoozed_until)).getTime() : 0;
            if (until > Date.now())
                continue;
        }
        else if (status !== 'pending_review' && status !== 'edited') {
            continue;
        }
        pending_count += 1;
        const snap = (row.sla_context_snapshot ?? {});
        const sev = severityFromSlaSnapshot(snap);
        if (sev.urgent)
            urgent_count += 1;
        if (sev.overdue)
            overdue_count += 1;
    }
    return { pending_count, urgent_count, overdue_count };
}
export async function editReminderCandidate(params) {
    const current = await assertExpectedCandidateVersion(params.orgId, params.candidateId, params.expectedVersion);
    assertReviewable(current);
    const bodyTrim = params.body.trim();
    if (!bodyTrim)
        throw badRequest('body is required');
    const subjectTrim = params.subject?.trim() || current.subject;
    const { data, error } = await supabaseAdmin
        .from('work_reminder_candidates')
        .update({
        subject: subjectTrim,
        body: bodyTrim,
        edited_body: bodyTrim,
        status: 'edited',
        version: current.version + 1,
    })
        .eq('org_id', params.orgId)
        .eq('id', params.candidateId)
        .eq('version', current.version)
        .select('id')
        .single();
    if (error)
        throw error;
    if (!data)
        throw conflict('Reminder candidate was updated by another session');
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_reminder_candidate',
        entityId: params.candidateId,
        action: AUDIT_ACTIONS.REMINDER_CANDIDATE_EDITED,
        payload: { work_item_id: current.work_item_id },
    });
    return { candidateId: params.candidateId };
}
async function loadWorkItemForReminder(orgId, workItemId) {
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .select('id, client_id, module_key, period_key, work_type')
        .eq('org_id', orgId)
        .eq('id', workItemId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Work item not found');
    return data;
}
export async function approveSendReminderCandidate(params) {
    const current = await assertExpectedCandidateVersion(params.orgId, params.candidateId, params.expectedVersion);
    assertReviewable(current);
    const workItem = await loadWorkItemForReminder(params.orgId, current.work_item_id);
    const clientId = current.client_id ?? workItem.client_id;
    if (!clientId)
        throw badRequest('Reminder candidate has no client target');
    const messageBody = (current.edited_body ?? current.body).trim();
    if (!messageBody)
        throw badRequest('Reminder message body is empty');
    const slaSnap = (current.sla_context_snapshot ?? {});
    const dedupKey = `reminder_candidate:${current.id}`;
    const channels = parseChannelOrder(current.channel_order_snapshot);
    const primaryChannel = current.channel || channels[0] || 'docflow';
    let notificationId;
    const { data: insertedNotif, error: notifErr } = await supabaseAdmin
        .from('work_notifications')
        .insert({
        org_id: params.orgId,
        work_item_id: current.work_item_id,
        audience: notificationAudience(current.target_type),
        intent_type: 'reminder_candidate_approved',
        severity: notificationSeverity(slaSnap),
        dedup_key: dedupKey,
        payload_snapshot: {
            reminder_candidate_id: current.id,
            subject: current.subject,
            body: messageBody,
            channels,
            primary_channel: primaryChannel,
            workflow_type: current.workflow_type,
            step_key: current.step_key,
        },
        delivery_status: 'pending_dispatch',
        source_reminder_candidate_id: current.id,
    })
        .select('id')
        .single();
    if (notifErr) {
        const code = notifErr.code;
        if (code !== '23505')
            throw notifErr;
        const { data: existing, error: existingErr } = await supabaseAdmin
            .from('work_notifications')
            .select('id')
            .eq('org_id', params.orgId)
            .eq('work_item_id', current.work_item_id)
            .eq('dedup_key', dedupKey)
            .maybeSingle();
        if (existingErr)
            throw existingErr;
        if (!existing?.id)
            throw notifErr;
        notificationId = String(existing.id);
    }
    else {
        notificationId = String(insertedNotif?.id ?? '');
    }
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_notifications',
        entityId: notificationId,
        action: AUDIT_ACTIONS.REMINDER_DELIVERY_INTENT_CREATED,
        payload: {
            reminder_candidate_id: current.id,
            work_item_id: current.work_item_id,
        },
    });
    const shouldDocflow = primaryChannel === 'docflow' || channels.includes('docflow');
    if (shouldDocflow) {
        await createSystemMessageCore({
            orgId: params.orgId,
            clientId,
            moduleKey: workItem.module_key || 'docflow',
            messageType: 'reminder',
            body: messageBody,
            idempotencyKey: `work_reminder_candidate:${current.id}`,
            ruleCode: 'work_engine_reminder_candidate_approved',
            ruleContextKey: current.id,
            sendModeRaw: 'auto_send_allowed',
            autoSendAllowedByRule: true,
            allowPublishWithoutAutoSendRule: true,
            threadIdInput: null,
            actorUserId: params.actorUserId,
        });
        await supabaseAdmin
            .from('work_notifications')
            .update({ delivery_status: 'dispatched_to_outbox' })
            .eq('id', notificationId)
            .eq('org_id', params.orgId);
    }
    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
        .from('work_reminder_candidates')
        .update({
        status: 'sent',
        approved_by_user_id: params.actorUserId,
        approved_at: nowIso,
        sent_at: nowIso,
        work_notification_id: notificationId,
        version: current.version + 1,
    })
        .eq('org_id', params.orgId)
        .eq('id', params.candidateId)
        .eq('version', current.version);
    if (updErr)
        throw updErr;
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_reminder_candidate',
        entityId: params.candidateId,
        action: AUDIT_ACTIONS.REMINDER_CANDIDATE_APPROVED,
        payload: {
            work_item_id: current.work_item_id,
            work_notification_id: notificationId,
            channel: primaryChannel,
        },
    });
    return { candidateId: params.candidateId, notificationId };
}
export async function cancelReminderCandidate(params) {
    const current = await assertExpectedCandidateVersion(params.orgId, params.candidateId, params.expectedVersion);
    assertReviewable(current);
    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin
        .from('work_reminder_candidates')
        .update({
        status: 'cancelled',
        cancelled_by_user_id: params.actorUserId,
        cancelled_at: nowIso,
        version: current.version + 1,
    })
        .eq('org_id', params.orgId)
        .eq('id', params.candidateId)
        .eq('version', current.version);
    if (error)
        throw error;
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_reminder_candidate',
        entityId: params.candidateId,
        action: AUDIT_ACTIONS.REMINDER_CANDIDATE_CANCELLED,
        payload: {
            work_item_id: current.work_item_id,
            reason: params.reason?.trim() || null,
        },
    });
    return { candidateId: params.candidateId };
}
export async function snoozeReminderCandidate(params) {
    const current = await assertExpectedCandidateVersion(params.orgId, params.candidateId, params.expectedVersion);
    assertReviewable(current);
    const preset = REMINDER_SNOOZE_PRESETS.find((p) => p.preset_key === params.snoozePreset);
    if (!preset)
        throw badRequest('Invalid snooze_preset');
    const snoozedUntil = new Date(Date.now() + preset.duration_minutes * 60_000).toISOString();
    const { error } = await supabaseAdmin
        .from('work_reminder_candidates')
        .update({
        status: 'snoozed',
        snoozed_until: snoozedUntil,
        version: current.version + 1,
    })
        .eq('org_id', params.orgId)
        .eq('id', params.candidateId)
        .eq('version', current.version);
    if (error)
        throw error;
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_reminder_candidate',
        entityId: params.candidateId,
        action: AUDIT_ACTIONS.REMINDER_CANDIDATE_SNOOZED,
        payload: {
            work_item_id: current.work_item_id,
            snooze_preset: params.snoozePreset,
            snoozed_until: snoozedUntil,
        },
    });
    return { candidateId: params.candidateId, snoozedUntil };
}
function buildReminderAllowedActions(row, viewer) {
    const canWrite = viewer != null;
    const disabled = (reason) => canWrite ? { enabled: true, disabled_reason: null } : { enabled: false, disabled_reason: reason };
    const base = disabled('Organization membership required');
    const payloadBase = {
        reminder_candidate_id: row.id,
        expected_version: row.version,
        idempotency_key: null,
    };
    return [
        {
            action_key: 'edit_reminder_candidate',
            label: 'Edit',
            command: 'edit_reminder_candidate',
            command_payload: { ...payloadBase },
            ...base,
        },
        {
            action_key: 'approve_send_reminder',
            label: 'Approve & send',
            command: 'approve_send_reminder_candidate',
            command_payload: { ...payloadBase },
            ...base,
        },
        {
            action_key: 'cancel_reminder_candidate',
            label: 'Cancel',
            command: 'cancel_reminder_candidate',
            command_payload: { ...payloadBase },
            ...base,
        },
        {
            action_key: 'snooze_reminder_candidate',
            label: 'Snooze',
            command: 'snooze_reminder_candidate',
            command_payload: {
                ...payloadBase,
                snooze_presets: REMINDER_SNOOZE_PRESETS.map((p) => ({
                    preset_key: p.preset_key,
                    label: p.label,
                })),
            },
            ...base,
        },
    ];
}
export async function loadReminderReviewPage(params) {
    const nowIso = new Date().toISOString();
    const { data: raw, error, count } = await supabaseAdmin
        .from('work_reminder_candidates')
        .select('id, org_id, work_item_id, client_id, workflow_type, step_key, status, channel, channel_order_snapshot, target_type, subject, body, edited_body, suggested_send_at, snoozed_until, sla_context_snapshot, version, created_at, updated_at', { count: 'exact' })
        .eq('org_id', params.orgId)
        .in('status', ['pending_review', 'edited', 'snoozed'])
        .order('created_at', { ascending: false })
        .range(params.offset, params.offset + params.limit - 1);
    if (error)
        throw error;
    const candidates = (raw ?? []).filter((c) => {
        if (c.status === 'snoozed') {
            const until = c.snoozed_until ? new Date(c.snoozed_until).getTime() : 0;
            return until <= Date.now();
        }
        return c.status === 'pending_review' || c.status === 'edited';
    });
    const clientIds = Array.from(new Set(candidates.map((c) => c.client_id).filter((v) => !!v)));
    const workItemIds = Array.from(new Set(candidates.map((c) => c.work_item_id)));
    const clientNameById = new Map();
    if (clientIds.length > 0) {
        const { data, error: cErr } = await supabaseAdmin
            .from('clients')
            .select('id, display_name')
            .eq('organization_id', params.orgId)
            .in('id', clientIds);
        if (cErr)
            throw cErr;
        for (const c of data ?? []) {
            clientNameById.set(String(c.id), String(c.display_name ?? c.id));
        }
    }
    if (workItemIds.length > 0) {
        const { data, error: wErr } = await supabaseAdmin
            .from('work_items')
            .select('id, client_id')
            .eq('org_id', params.orgId)
            .in('id', workItemIds);
        if (wErr)
            throw wErr;
        for (const w of data ?? []) {
            const cid = w.client_id ? String(w.client_id) : null;
            if (cid && !clientNameById.has(cid)) {
                clientNameById.set(cid, cid);
            }
        }
    }
    let reminderPolicy = null;
    try {
        const resolved = await resolveOperationalCommunicationPolicies(params.orgId, businessYmd(new Date()));
        reminderPolicy = resolved.active_reminder_policy;
    }
    catch {
        reminderPolicy = null;
    }
    const rows = candidates.map((c) => {
        const channelLabels = humanChannelLabelsFromSnapshot(c.channel_order_snapshot, c.channel);
        const snap = (c.sla_context_snapshot ?? {});
        const sev = severityFromSlaSnapshot(snap);
        const dueAt = c.suggested_send_at ?? (snap.due_at ? String(snap.due_at) : null);
        const body = (c.edited_body ?? c.body).trim();
        const workflowLabel = workflowTypeLabel(c.workflow_type);
        const periodLabel = resolveReminderCadencePeriodLabel(c, snap, reminderPolicy);
        const stateLabel = candidateStateLabel(c.status);
        const clientName = c.client_id
            ? displayClientName(clientNameById.get(c.client_id) ?? null, c.client_id)
            : null;
        const createdLabel = formatQueueLabel(c.created_at);
        const dueLabel = formatQueueLabel(dueAt);
        const subjectTrim = c.subject?.trim() || null;
        const showSubject = channelLabels.includes('Email');
        const summary_fields = [
            { key: 'client', label: 'Client', value: clientName },
            { key: 'workflow', label: 'Workflow', value: workflowLabel },
            { key: 'period', label: 'Period', value: periodLabel },
            { key: 'channel', label: 'Channel', value: formatChannelCell(channelLabels) },
            { key: 'status', label: 'Status', value: stateLabel },
        ];
        if (createdLabel) {
            summary_fields.push({ key: 'created_at', label: 'Created', value: createdLabel });
        }
        if (dueLabel) {
            summary_fields.push({ key: 'due', label: 'Due', value: dueLabel });
        }
        if (sev.label && sev.key !== 'normal') {
            summary_fields.push({ key: 'severity', label: 'Severity', value: sev.label });
        }
        return {
            reminder_candidate_id: c.id,
            queue_cells: {
                client: clientName,
                workflow: workflowLabel,
                period: periodLabel,
                channel: formatChannelCell(channelLabels),
                status: stateLabel,
            },
            open_detail: {
                label: 'View',
                enabled: true,
                disabled_reason: null,
            },
            reminder_detail_model: {
                title: '',
                subtitle: clientName ? `${clientName} · ${workflowLabel}` : workflowLabel,
                summary_fields,
                message: {
                    subject_label: 'Email subject',
                    subject: subjectTrim,
                    show_subject: showSubject,
                    body_label: 'Message',
                    body,
                },
                channel_labels: channelLabels,
            },
            allowed_actions: buildReminderAllowedActions(c, params.viewer),
        };
    });
    return { rows, total: count ?? rows.length };
}
export function buildReminderReviewBanner(counts) {
    const n = counts.pending_count;
    const visible = n > 0;
    const variant = counts.overdue_count > 0 ? 'warning' : 'brand';
    const title = n === 1 ? '1 reminder requires approval' : `${n} reminders require approval`;
    return {
        visible,
        variant,
        title,
        subtitle: 'The Work Engine prepared reminders that need your review before sending.',
        cta_label: 'Review now',
        cta_action: { action_key: 'open_reminder_review' },
        dismissible: true,
    };
}
