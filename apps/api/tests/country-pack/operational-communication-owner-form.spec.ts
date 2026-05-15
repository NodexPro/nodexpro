import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReminderStepKey,
  buildReminderTemplateKey,
  extractVariablesFromReminderMessage,
  mergeReminderWorkflowIntoPolicy,
  periodAmountUnitToOffsetMinutes,
  parseOwnerReminderPolicyForm,
  parseOwnerReminderTemplateForm,
  parseOwnerReminderWorkflowForm,
  resolveOwnerPeriodInput,
} from '../../src/domains/country-pack/operational-communication-owner-form.js';

test('resolveOwnerPeriodInput uses preset 14 days', () => {
  const p = resolveOwnerPeriodInput({ period_slug: '14d' });
  assert.equal(p.period_slug, '14d');
  assert.equal(p.offset_minutes, 14 * 24 * 60);
  assert.equal(p.label, '14 days');
});

test('resolveOwnerPeriodInput computes custom period slug and offset', () => {
  const p = resolveOwnerPeriodInput({ period: { amount: 5, unit: 'days' } });
  assert.equal(p.period_slug, '5d');
  assert.equal(p.offset_minutes, periodAmountUnitToOffsetMinutes(5, 'days'));
});

test('buildReminderTemplateKey includes workflow period and language', () => {
  const key = buildReminderTemplateKey('waiting_client', '14d', 'he');
  assert.equal(key, 'comm.reminder.template.waiting_client.14d.he');
});

test('parseOwnerReminderTemplateForm generates template_key without owner input', () => {
  const out = parseOwnerReminderTemplateForm({
    workflow_type: 'waiting_client',
    period_slug: '1h',
    language: 'he',
    channel: 'docflow',
    template_display_name: 'Client nudge 1h',
    subject_template: 'Hi',
    body_template: 'Body',
    variables: ['client_name'],
  });
  assert.equal(out.value_key, 'comm.reminder.template.waiting_client.1h.he');
  assert.equal(out.payload.template_key, out.value_key);
});

test('parseOwnerReminderPolicyForm builds cadence from human cadence_periods', () => {
  const templateKey = buildReminderTemplateKey('waiting_client', '1h', 'he');
  const policy = parseOwnerReminderPolicyForm({
    approval_required: true,
    default_channels: ['docflow'],
    workflows: [
      {
        workflow_type: 'waiting_client',
        enabled: true,
        anchor: 'obligation_starts_at',
        cadence_periods: [
          {
            period_slug: '1h',
            channels: ['email'],
            severity: 'warn',
            template_ref: templateKey,
          },
        ],
      },
    ],
  });
  const step = policy.workflows[0].cadence_steps[0];
  assert.equal(step.step_key, buildReminderStepKey('waiting_client', '1h'));
  assert.equal(step.offset_minutes, 60);
  assert.equal(step.template_key, templateKey);
  assert.equal(step.severity, 'warn');
});

test('extractVariablesFromReminderMessage finds allowlisted tokens only', () => {
  const vars = extractVariablesFromReminderMessage('Hi {{client_name}} and {{unknown}}');
  assert.deepEqual(vars, ['client_name']);
});

test('parseOwnerReminderWorkflowForm builds templates and cadence from reminders', () => {
  const parsed = parseOwnerReminderWorkflowForm({
    workflow_type: 'waiting_client',
    approval_required: true,
    default_channels: ['docflow', 'email'],
    reminders: [
      {
        period_slug: '7d',
        severity: 'urgent',
        channels: ['docflow'],
        language: 'he',
        message: 'שלום {{client_name}}, ממתינים למסמכים.',
      },
      {
        period: { amount: 1, unit: 'hours' },
        severity: 'info',
        channels: ['email'],
        language: 'he',
        subject: 'תזכורת',
        message: 'Email body {{client_name}}',
      },
    ],
  });
  assert.equal(parsed.templates.length, 2);
  assert.equal(parsed.policy_workflow.cadence_steps.length, 2);
  assert.equal(
    parsed.templates[0].value_key,
    buildReminderTemplateKey('waiting_client', '7d', 'he'),
  );
  const step7d = parsed.policy_workflow.cadence_steps.find(
    (s) => s.step_key === buildReminderStepKey('waiting_client', '7d'),
  );
  assert.ok(step7d);
});

test('mergeReminderWorkflowIntoPolicy replaces same workflow_type', () => {
  const existing = parseOwnerReminderPolicyForm({
    approval_required: true,
    default_channels: ['docflow'],
    workflows: [
      {
        workflow_type: 'response_sla',
        enabled: true,
        anchor: 'obligation_starts_at',
        cadence_periods: [
          {
            period_slug: '2d',
            channels: ['docflow'],
            severity: 'info',
            template_ref: buildReminderTemplateKey('response_sla', '2d', 'he'),
          },
        ],
      },
    ],
  });
  const parsed = parseOwnerReminderWorkflowForm({
    workflow_type: 'waiting_client',
    approval_required: false,
    default_channels: ['email'],
    reminders: [
      {
        period_slug: '1h',
        severity: 'warn',
        channels: ['email'],
        language: 'he',
        subject: 'Hi',
        message: 'Body {{client_name}}',
      },
    ],
  });
  const merged = mergeReminderWorkflowIntoPolicy(existing, parsed);
  assert.equal(merged.workflows.length, 2);
  assert.equal(merged.approval_required, false);
  assert.equal(merged.workflows.find((w) => w.workflow_type === 'waiting_client')?.cadence_steps.length, 1);
});
