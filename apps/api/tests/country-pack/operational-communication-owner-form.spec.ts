import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReminderStepKey,
  buildReminderTemplateKey,
  periodAmountUnitToOffsetMinutes,
  parseOwnerReminderPolicyForm,
  parseOwnerReminderTemplateForm,
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
