import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertValidOperationalReminderPolicyPayload,
  assertValidOperationalReminderTemplatePayload,
} from '../../src/domains/country-pack/operational-communication-owner-payload.js';
import {
  buildReminderCandidateDedupKey,
  isCadenceStepEligible,
  isManualReminderTriggerType,
  isWorkItemEligibleForAutoReminders,
  listEligibleCadenceSteps,
  resolveCadenceStepFromWorkflow,
  resolveChannelOrder,
  resolveFirstCadenceStepForWorkflow,
  resolveReminderCandidateDedupKeyForInsert,
  resolveReminderTarget,
  resolveWorkflowFromPolicy,
  selectTemplateVersion,
  shouldEvaluateReminderWorkflow,
  type ReminderObligationSnapshot,
} from '../../src/domains/work-engine/work-engine.reminder.logic.js';
import type { WorkItemRow } from '../../src/domains/work-engine/work-engine.types.js';
import { formatOffsetMinutesAsPeriodLabel } from '../../src/domains/work-engine/work-engine.reminder.logic.js';

const policy = assertValidOperationalReminderPolicyPayload({
  type: 'operational_reminder_policy',
  default_channels: ['docflow', 'email'],
  workflows: [
    {
      workflow_type: 'waiting_client',
      enabled: true,
      anchor: 'obligation_starts_at',
      cadence_steps: [
        {
          step_key: 'nudge_1h',
          offset_minutes: 60,
          template_key: 'comm.reminder.template.waiting_client.he',
          channels: ['email'],
        },
      ],
    },
  ],
});

const templateVersion = {
  template_version_id: 'tpl-ver-1',
  template_key: 'comm.reminder.template.waiting_client.he',
  language: 'he',
  channel: 'email',
  payload: assertValidOperationalReminderTemplatePayload({
    type: 'operational_reminder_template',
    template_key: 'comm.reminder.template.waiting_client.he',
    workflow_type: 'waiting_client',
    language: 'he',
    channel: 'email',
    subject_template: 'Hi',
    body_template: 'Body',
    variables: [],
  }),
};

function baseWorkItem(overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    org_id: '22222222-2222-4222-8222-222222222222',
    client_id: '33333333-3333-4333-8333-333333333333',
    module_key: 'payroll',
    work_type: 'payroll_document_collection',
    period_key: 'payroll:2026-05',
    work_state: 'waiting_client',
    owner_user_id: null,
    assigned_user_id: '44444444-4444-4444-8444-444444444444',
    reviewer_user_id: null,
    escalation_owner_id: null,
    escalation_reason: null,
    escalation_source: null,
    escalation_prior_work_state: null,
    escalation_acknowledged_at: null,
    escalation_acknowledged_by_user_id: null,
    due_at: '2026-05-20T12:00:00.000Z',
    sla_status: 'on_track',
    source_module: 'smoke_test',
    source_entity_type: 'test',
    source_entity_id: 'ent-1',
    created_by_rule_id: null,
    created_by_event_id: null,
    created_by_user_id: null,
    creation_source_type: 'command',
    version: 1,
    override_active: false,
    override_summary_json: null,
    claimed_by_user_id: null,
    claimed_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

test('buildReminderCandidateDedupKey is stable per work item workflow step', () => {
  const key = buildReminderCandidateDedupKey({
    workItemId: '11111111-1111-4111-8111-111111111111',
    workflowType: 'waiting_client',
    stepKey: 'nudge_1h',
  });
  assert.equal(key, 'reminder:11111111-1111-4111-8111-111111111111:waiting_client:nudge_1h');
});

test('resolveWorkflowFromPolicy rejects missing workflow', () => {
  assert.throws(
    () => resolveWorkflowFromPolicy(policy, 'review_sla'),
    (e: Error & { code?: string }) => e.code === 'reminder_workflow_not_found',
  );
});

test('resolveCadenceStepFromWorkflow finds configured step', () => {
  const wf = resolveWorkflowFromPolicy(policy, 'waiting_client');
  const step = resolveCadenceStepFromWorkflow(wf, 'nudge_1h');
  assert.equal(step.template_key, 'comm.reminder.template.waiting_client.he');
});

test('resolveFirstCadenceStepForWorkflow returns first configured cadence period', () => {
  const policyMulti = assertValidOperationalReminderPolicyPayload({
    type: 'operational_reminder_policy',
    default_channels: ['docflow'],
    workflows: [
      {
        workflow_type: 'waiting_client',
        enabled: true,
        anchor: 'obligation_starts_at',
        cadence_steps: [
          {
            step_key: 'nudge_waiting_client_1h',
            offset_minutes: 60,
            template_key: 'comm.reminder.template.waiting_client.1h.he',
          },
          {
            step_key: 'nudge_waiting_client_2d',
            offset_minutes: 2880,
            template_key: 'comm.reminder.template.waiting_client.2d.he',
          },
        ],
      },
    ],
  });
  const step = resolveFirstCadenceStepForWorkflow(policyMulti, 'waiting_client');
  assert.equal(step.step_key, 'nudge_waiting_client_1h');
});

test('policy validation rejects empty cadence_steps', () => {
  assert.throws(() =>
    assertValidOperationalReminderPolicyPayload({
      type: 'operational_reminder_policy',
      default_channels: ['docflow'],
      workflows: [
        {
          workflow_type: 'waiting_client',
          enabled: true,
          anchor: 'obligation_starts_at',
          cadence_steps: [],
        },
      ],
    }),
  );
});

const responsePolicy = assertValidOperationalReminderPolicyPayload({
  type: 'operational_reminder_policy',
  default_channels: ['docflow'],
  workflows: [
    {
      workflow_type: 'response_sla',
      enabled: true,
      anchor: 'obligation_due_at',
      cadence_steps: [
        {
          step_key: 'due_soon_1h',
          offset_minutes: -60,
          template_key: 'comm.reminder.template.response_sla.due_soon.he',
        },
        {
          step_key: 'overdue_0',
          offset_minutes: 0,
          template_key: 'comm.reminder.template.response_sla.overdue.he',
        },
      ],
    },
  ],
});

function activeObligation(
  kind: ReminderObligationSnapshot['kind'],
  startsAt: string,
  dueAt: string,
): ReminderObligationSnapshot {
  return { kind, starts_at: startsAt, due_at: dueAt, status: 'active', paused_at: null };
}

test('isCadenceStepEligible supports negative offsets before due_at', () => {
  const dueAt = '2026-05-20T12:00:00.000Z';
  const oneHourBeforeDue = new Date('2026-05-20T11:00:00.000Z').getTime();
  const twoHoursBeforeDue = new Date('2026-05-20T10:00:00.000Z').getTime();
  assert.equal(isCadenceStepEligible(oneHourBeforeDue, dueAt, -60), true);
  assert.equal(isCadenceStepEligible(twoHoursBeforeDue, dueAt, -60), false);
  assert.equal(isCadenceStepEligible(oneHourBeforeDue, dueAt, 0), false);
});

test('listEligibleCadenceSteps filters by anchor and now', () => {
  const wf = resolveWorkflowFromPolicy(responsePolicy, 'response_sla');
  const obligation = activeObligation(
    'response',
    '2026-05-19T12:00:00.000Z',
    '2026-05-20T12:00:00.000Z',
  );
  const atDue = new Date('2026-05-20T12:00:00.000Z').getTime();
  const eligible = listEligibleCadenceSteps({ workflow: wf, obligation, nowMs: atDue });
  assert.deepEqual(
    eligible.map((s) => s.step_key),
    ['due_soon_1h', 'overdue_0'],
  );
});

test('shouldEvaluateReminderWorkflow for waiting_client uses work_state or obligation', () => {
  const obligations = [activeObligation('waiting_client', '2026-05-01T00:00:00.000Z', '2026-05-02T00:00:00.000Z')];
  assert.equal(
    shouldEvaluateReminderWorkflow({
      workflowType: 'waiting_client',
      workState: 'in_progress',
      obligations,
    }),
    true,
  );
  assert.equal(
    shouldEvaluateReminderWorkflow({
      workflowType: 'waiting_client',
      workState: 'in_progress',
      obligations: [],
    }),
    false,
  );
  assert.equal(
    shouldEvaluateReminderWorkflow({
      workflowType: 'waiting_client',
      workState: 'waiting_client',
      obligations: [],
    }),
    true,
  );
});

test('isWorkItemEligibleForAutoReminders excludes terminal work states', () => {
  assert.equal(isWorkItemEligibleForAutoReminders('waiting_client'), true);
  assert.equal(isWorkItemEligibleForAutoReminders('done'), false);
  assert.equal(isWorkItemEligibleForAutoReminders('archived'), false);
});

test('resolveChannelOrder prefers step channels over policy default', () => {
  const wf = resolveWorkflowFromPolicy(policy, 'waiting_client');
  const step = resolveCadenceStepFromWorkflow(wf, 'nudge_1h');
  assert.deepEqual(resolveChannelOrder(policy, step), ['email']);
});

test('selectTemplateVersion prefers channel match', () => {
  const picked = selectTemplateVersion(
    {
      country_code: 'IL',
      ruleset_id: 'rs-1',
      policy_version_id: 'pol-1',
      active_reminder_policy: policy,
      templates_by_key: {
        'comm.reminder.template.waiting_client.he': [
          { ...templateVersion, channel: 'docflow' },
          templateVersion,
        ],
      },
      warnings: [],
    },
    'comm.reminder.template.waiting_client.he',
    'email',
  );
  assert.equal(picked.channel, 'email');
});

test('resolveReminderTarget maps waiting_client to client target', () => {
  const target = resolveReminderTarget('waiting_client', baseWorkItem());
  assert.equal(target.target_type, 'client');
  assert.equal(target.client_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(target.target_user_id, null);
});

test('formatOffsetMinutesAsPeriodLabel returns owner preset labels', () => {
  assert.equal(formatOffsetMinutesAsPeriodLabel(60), '1 hour');
  assert.equal(formatOffsetMinutesAsPeriodLabel(2 * 24 * 60), '2 days');
  assert.equal(formatOffsetMinutesAsPeriodLabel(14 * 24 * 60), '14 days');
});

test('resolveReminderCandidateDedupKeyForInsert uses attempt suffix after terminal rows', () => {
  const base = buildReminderCandidateDedupKey({
    workItemId: 'wi-1',
    workflowType: 'waiting_client',
    stepKey: 'nudge_1h',
  });
  assert.equal(resolveReminderCandidateDedupKeyForInsert({ baseKey: base, terminalAttemptCount: 0 }), base);
  assert.equal(
    resolveReminderCandidateDedupKeyForInsert({ baseKey: base, terminalAttemptCount: 1 }),
    `${base}:attempt:2`,
  );
});

test('isManualReminderTriggerType recognizes admin test triggers', () => {
  assert.equal(isManualReminderTriggerType('manual_command'), true);
  assert.equal(isManualReminderTriggerType('admin_test'), true);
  assert.equal(isManualReminderTriggerType('system_rule'), false);
});
