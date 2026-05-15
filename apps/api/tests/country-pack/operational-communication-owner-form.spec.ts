import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReminderTemplateValueKey,
  parseOwnerReminderPolicyForm,
  parseOwnerReminderTemplateForm,
} from '../../src/domains/country-pack/operational-communication-owner-form.js';

test('parseOwnerReminderPolicyForm builds validated policy payload', () => {
  const policy = parseOwnerReminderPolicyForm({
    approval_required: true,
    default_channels: ['docflow'],
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
          },
        ],
      },
    ],
  });
  assert.equal(policy.type, 'operational_reminder_policy');
  assert.equal(policy.workflows[0].cadence_steps[0].step_key, 'nudge_1h');
});

test('parseOwnerReminderTemplateForm builds template_key from workflow and language', () => {
  const out = parseOwnerReminderTemplateForm({
    workflow_type: 'waiting_client',
    language: 'he',
    channel: 'email',
    subject_template: 'Hi',
    body_template: 'Body',
    variables: [],
  });
  assert.equal(out.value_key, buildReminderTemplateValueKey('waiting_client', 'he'));
  assert.equal(out.payload.template_key, out.value_key);
});
