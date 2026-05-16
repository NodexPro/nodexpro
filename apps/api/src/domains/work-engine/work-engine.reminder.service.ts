/**
 * Work Engine reminder candidate generation (Stage 10 Phase 3B-2).
 * All reminder generation logic for tenant commands lives here only.
 */

import { supabaseAdmin } from '../../db/client.js';
import { businessYmd } from '../../shared/business-time.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { isUuid } from './work-engine.guards.js';
import { resolveOperationalCommunicationPolicies } from '../country-pack/operational-communication-policy.service.js';
import {
  renderReminderTemplate,
  type ReminderTemplateRenderContext,
  type ReminderWorkflowType,
} from '../country-pack/operational-communication-owner-payload.js';
import type { WorkSlaObligationRow } from './work-engine.sla.service.js';
import {
  ACTIVE_REMINDER_CANDIDATE_STATUSES,
  assertResolvedReminderPolicy,
  buildReminderCandidateDedupKey,
  isManualReminderTriggerType,
  isWorkItemEligibleForAutoReminders,
  listEligibleCadenceSteps,
  parseGenerateReminderCandidateWorkflowType,
  resolveActiveObligationForWorkflow,
  resolveCadenceStepFromWorkflow,
  resolveChannelOrder,
  resolveReminderCandidateDedupKeyForInsert,
  resolveReminderTarget,
  resolveWorkflowFromPolicy,
  selectTemplateVersion,
  shouldEvaluateReminderWorkflow,
  TERMINAL_REMINDER_CANDIDATE_STATUSES,
  type ReminderObligationSnapshot,
} from './work-engine.reminder.logic.js';
import type { WorkItemRow } from './work-engine.types.js';

export type {
  ReminderCandidateTargetType,
} from './work-engine.reminder.logic.js';
export {
  buildReminderCandidateDedupKey,
  parseGenerateReminderCandidateWorkflowType,
  resolveCadenceStepFromWorkflow,
  resolveChannelOrder,
  resolveReminderTarget,
  resolveWorkflowFromPolicy,
  selectTemplateVersion,
} from './work-engine.reminder.logic.js';

export type GenerateReminderCandidateParams = {
  orgId: string;
  workItem: WorkItemRow;
  workflowType: ReminderWorkflowType;
  stepKey: string;
  triggerType?: string;
};

export type GenerateReminderCandidateResult = {
  candidateId: string;
  created: boolean;
  dedupHit: boolean;
};

export type EvaluateRemindersForWorkItemResult = {
  evaluated_steps: number;
  created_candidate_ids: string[];
  dedup_hits: number;
};

function humanizeKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function moduleLabel(key: string): string {
  switch (key) {
    case 'payroll':
      return 'Payroll';
    case 'vat':
      return 'VAT';
    case 'annual_report':
      return 'Annual Report';
    case 'income_tax':
      return 'Income Tax';
    case 'national_insurance':
      return 'National Insurance';
    case 'client_obligations':
      return 'Client Obligations';
    case 'docflow':
      return 'DocFlow';
    case 'work_engine':
      return 'Work Engine';
    default:
      return humanizeKey(key);
  }
}

function workTypeLabel(key: string): string {
  switch (key) {
    case 'payroll_document_collection':
      return 'Payroll Documents';
    case 'vat_document_collection':
      return 'VAT Documents';
    case 'annual_report_document_collection':
      return 'Annual Report Documents';
    case 'docflow_thread_followup':
      return 'Conversation';
    default:
      return humanizeKey(key);
  }
}

function slaStatusLabel(status: string): string {
  switch (status) {
    case 'none':
      return 'No SLA';
    case 'on_track':
      return 'On track';
    case 'due_soon':
      return 'Due soon';
    case 'overdue':
      return 'Overdue';
    case 'breached':
      return 'Breached';
    default:
      return humanizeKey(status);
  }
}

function formatDueDate(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  return businessYmd(d);
}

function buildPortalLink(orgId: string, workItemId: string, clientId: string): string {
  return `/portal/orgs/${orgId}/clients/${clientId}/work-items/${workItemId}`;
}

async function loadReminderTemplateContext(
  orgId: string,
  workItem: WorkItemRow,
): Promise<ReminderTemplateRenderContext> {
  const clientId = workItem.client_id;
  let clientName: string | null = null;
  if (clientId) {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('display_name')
      .eq('id', clientId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (error) throw error;
    clientName = data?.display_name?.trim() || clientId;
  }

  const userIds = [workItem.assigned_user_id, workItem.reviewer_user_id].filter(
    (v): v is string => !!v,
  );
  const userNameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .in('id', userIds);
    if (error) throw error;
    for (const u of data ?? []) {
      userNameById.set(
        String(u.id),
        String(u.full_name ?? '').trim() || String(u.email ?? '').trim() || String(u.id),
      );
    }
  }

  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle();
  if (orgErr) throw orgErr;

  const dueDate = formatDueDate(workItem.due_at);
  const portalLink =
    clientId && workItem.id ? buildPortalLink(orgId, workItem.id, clientId) : null;

  return {
    client_name: clientName,
    assignee_name: workItem.assigned_user_id
      ? userNameById.get(workItem.assigned_user_id) ?? workItem.assigned_user_id
      : null,
    reviewer_name: workItem.reviewer_user_id
      ? userNameById.get(workItem.reviewer_user_id) ?? workItem.reviewer_user_id
      : null,
    work_type_label: workTypeLabel(workItem.work_type),
    module_label: moduleLabel(workItem.module_key),
    period_key: workItem.period_key,
    sla_status_label: slaStatusLabel(workItem.sla_status),
    due_date: dueDate,
    portal_link: portalLink,
    office_name: org?.name?.trim() || orgId,
  };
}

async function findActiveCandidateByTuple(params: {
  orgId: string;
  workItemId: string;
  workflowType: string;
  stepKey: string;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('work_reminder_candidates')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('work_item_id', params.workItemId)
    .eq('workflow_type', params.workflowType)
    .eq('step_key', params.stepKey.trim())
    .in('status', [...ACTIVE_REMINDER_CANDIDATE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? { id: String(data.id) } : null;
}

async function countTerminalCandidatesByTuple(params: {
  orgId: string;
  workItemId: string;
  workflowType: string;
  stepKey: string;
}): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('work_reminder_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', params.orgId)
    .eq('work_item_id', params.workItemId)
    .eq('workflow_type', params.workflowType)
    .eq('step_key', params.stepKey.trim())
    .in('status', [...TERMINAL_REMINDER_CANDIDATE_STATUSES]);
  if (error) throw error;
  return count ?? 0;
}

async function findLatestTerminalCandidateByTuple(params: {
  orgId: string;
  workItemId: string;
  workflowType: string;
  stepKey: string;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('work_reminder_candidates')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('work_item_id', params.workItemId)
    .eq('workflow_type', params.workflowType)
    .eq('step_key', params.stepKey.trim())
    .in('status', [...TERMINAL_REMINDER_CANDIDATE_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? { id: String(data.id) } : null;
}

export async function generateReminderCandidate(
  params: GenerateReminderCandidateParams,
): Promise<GenerateReminderCandidateResult> {
  const workflowType = params.workflowType;
  const stepKey = params.stepKey.trim();
  if (!stepKey) throw badRequest('step_key is required');

  const asOfDate = businessYmd(new Date());
  const resolved = await resolveOperationalCommunicationPolicies(params.orgId, asOfDate);
  assertResolvedReminderPolicy(resolved);

  const policy = resolved.active_reminder_policy;
  const workflow = resolveWorkflowFromPolicy(policy, workflowType);
  const cadenceStep = resolveCadenceStepFromWorkflow(workflow, stepKey);
  const channelOrder = resolveChannelOrder(policy, cadenceStep);
  const primaryChannel = channelOrder[0];
  const templateVersion = selectTemplateVersion(resolved, cadenceStep.template_key, primaryChannel);

  const templateContext = await loadReminderTemplateContext(params.orgId, params.workItem);
  const rendered = renderReminderTemplate(templateVersion.payload, templateContext);
  const target = resolveReminderTarget(workflowType, params.workItem);
  const baseDedupKey = buildReminderCandidateDedupKey({
    workItemId: params.workItem.id,
    workflowType,
    stepKey,
  });

  const tuple = {
    orgId: params.orgId,
    workItemId: params.workItem.id,
    workflowType,
    stepKey,
  };

  const active = await findActiveCandidateByTuple(tuple);
  if (active) {
    return { candidateId: active.id, created: false, dedupHit: true };
  }

  const triggerType = (params.triggerType ?? 'manual_command').trim() || 'manual_command';
  const terminalCount = await countTerminalCandidatesByTuple(tuple);
  const manualTest = isManualReminderTriggerType(triggerType);

  if (terminalCount > 0 && !manualTest) {
    const latest = await findLatestTerminalCandidateByTuple(tuple);
    if (latest) {
      return { candidateId: latest.id, created: false, dedupHit: true };
    }
  }

  const dedupKey = resolveReminderCandidateDedupKeyForInsert({
    baseKey: baseDedupKey,
    terminalAttemptCount: manualTest ? terminalCount : 0,
  });
  const slaSnapshot = {
    work_state: params.workItem.work_state,
    sla_status: params.workItem.sla_status,
    due_at: params.workItem.due_at,
    workflow_type: workflowType,
    step_key: stepKey,
    anchor: workflow.anchor,
    offset_minutes: cadenceStep.offset_minutes,
  };

  const insertResp = await supabaseAdmin
    .from('work_reminder_candidates')
    .insert({
      org_id: params.orgId,
      work_item_id: params.workItem.id,
      country_code: resolved.country_code,
      workflow_type: workflowType,
      trigger_type: triggerType,
      step_key: stepKey,
      policy_version_id: resolved.policy_version_id,
      template_version_id: templateVersion.template_version_id,
      status: 'pending_review',
      channel: primaryChannel,
      channel_order_snapshot: channelOrder,
      target_type: target.target_type,
      target_user_id: target.target_user_id,
      client_id: target.client_id,
      subject: rendered.subject,
      generated_subject: rendered.subject,
      body: rendered.body,
      generated_body: rendered.body,
      suggested_send_at: null,
      sla_context_snapshot: slaSnapshot,
      created_by_system_rule: !isManualReminderTriggerType(triggerType),
      dedup_key: dedupKey,
      idempotency_key: null,
    })
    .select('id')
    .single();

  if (insertResp.error) {
    const code = (insertResp.error as { code?: string }).code;
    if (code === '23505') {
      const racedActive = await findActiveCandidateByTuple(tuple);
      if (racedActive) {
        return { candidateId: racedActive.id, created: false, dedupHit: true };
      }
    }
    throw insertResp.error;
  }

  return {
    candidateId: String(insertResp.data.id),
    created: true,
    dedupHit: false,
  };
}

function obligationSnapshots(rows: WorkSlaObligationRow[]): ReminderObligationSnapshot[] {
  return rows.map((o) => ({
    kind: o.kind,
    starts_at: o.starts_at,
    due_at: o.due_at,
    status: o.status,
    paused_at: o.paused_at,
  }));
}

async function loadWorkItemForReminderEvaluation(
  orgId: string,
  workItemId: string,
): Promise<WorkItemRow> {
  if (!isUuid(workItemId)) throw badRequest('work_item_id must be a uuid');
  const { data, error } = await supabaseAdmin
    .from('work_items')
    .select('*')
    .eq('id', workItemId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Work item not found');
  return data as WorkItemRow;
}

async function loadActiveObligationsForWorkItem(
  orgId: string,
  workItemId: string,
): Promise<WorkSlaObligationRow[]> {
  const { data, error } = await supabaseAdmin
    .from('work_sla_obligations')
    .select('*')
    .eq('org_id', orgId)
    .eq('work_item_id', workItemId)
    .eq('status', 'active');
  if (error) throw error;
  return (data ?? []) as WorkSlaObligationRow[];
}

/**
 * Policy-driven automatic reminder candidate generation (Phase 3B-5).
 * Creates pending_review candidates only — never sends or inserts work_notifications.
 */
export async function evaluateRemindersForWorkItem(params: {
  orgId: string;
  workItemId: string;
  actorUserId?: string | null;
  asOf?: Date;
}): Promise<EvaluateRemindersForWorkItemResult> {
  const result: EvaluateRemindersForWorkItemResult = {
    evaluated_steps: 0,
    created_candidate_ids: [],
    dedup_hits: 0,
  };

  const workItem = await loadWorkItemForReminderEvaluation(params.orgId, params.workItemId);
  if (!isWorkItemEligibleForAutoReminders(workItem.work_state)) {
    return result;
  }

  const asOf = params.asOf ?? new Date();
  const asOfDate = businessYmd(asOf);
  const nowMs = asOf.getTime();

  let resolved: Awaited<ReturnType<typeof resolveOperationalCommunicationPolicies>>;
  try {
    resolved = await resolveOperationalCommunicationPolicies(params.orgId, asOfDate);
    assertResolvedReminderPolicy(resolved);
  } catch {
    return result;
  }

  const reminderPolicy = resolved.active_reminder_policy;
  const obligations = obligationSnapshots(
    await loadActiveObligationsForWorkItem(params.orgId, params.workItemId),
  );

  for (const workflowConfig of reminderPolicy.workflows) {
    if (!workflowConfig.enabled) continue;

    const workflowType = workflowConfig.workflow_type;
    if (
      !shouldEvaluateReminderWorkflow({
        workflowType,
        workState: workItem.work_state,
        obligations,
      })
    ) {
      continue;
    }

    const obligation = resolveActiveObligationForWorkflow(workflowType, obligations);
    if (!obligation) continue;

    let workflow;
    try {
      workflow = resolveWorkflowFromPolicy(reminderPolicy, workflowType);
    } catch {
      continue;
    }

    const eligibleSteps = listEligibleCadenceSteps({ workflow, obligation, nowMs });
    for (const step of eligibleSteps) {
      result.evaluated_steps += 1;
      const outcome = await generateReminderCandidate({
        orgId: params.orgId,
        workItem,
        workflowType,
        stepKey: step.step_key,
        triggerType: 'system_rule',
      });

      if (outcome.created) {
        result.created_candidate_ids.push(outcome.candidateId);
        await writeAudit({
          organizationId: params.orgId,
          actorUserId: params.actorUserId ?? null,
          moduleCode: 'work_engine',
          entityType: 'work_reminder_candidate',
          entityId: outcome.candidateId,
          action: AUDIT_ACTIONS.REMINDER_CANDIDATE_CREATED,
          payload: {
            work_item_id: params.workItemId,
            workflow_type: workflowType,
            step_key: step.step_key,
            trigger_type: 'system_rule',
            offset_minutes: step.offset_minutes,
            policy_version_id: resolved.policy_version_id,
            auto_generated: true,
          },
        });
      } else if (outcome.dedupHit) {
        result.dedup_hits += 1;
      }
    }
  }

  return result;
}
