import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertValidOperationalReminderPolicyPayload,
  assertValidOperationalReminderTemplatePayload,
} from '../../src/domains/country-pack/operational-communication-owner-payload.js';
import { renderReminderTemplate } from '../../src/domains/country-pack/operational-communication-owner-payload.js';

test('operational_reminder_policy validates and sorts cadence steps', () => {
  const policy = assertValidOperationalReminderPolicyPayload({
    type: 'operational_reminder_policy',
    default_channels: ['docflow', 'email'],
    workflows: [
      {
        workflow_type: 'waiting_client',
        enabled: true,
        anchor: 'obligation_starts_at',
        cadence_steps: [
          { step_key: 'nudge_7d', offset_minutes: 10080, template_key: 'comm.reminder.template.waiting_client.he' },
          { step_key: 'nudge_1h', offset_minutes: 60, template_key: 'comm.reminder.template.waiting_client.he' },
        ],
      },
    ],
  });
  assert.equal(policy.approval_required, true);
  assert.deepEqual(
    policy.workflows[0].cadence_steps.map((s) => s.step_key),
    ['nudge_1h', 'nudge_7d'],
  );
});

test('operational_reminder_template requires allowlisted variables', () => {
  assert.throws(() =>
    assertTemplateOnly({
      type: 'operational_reminder_template',
      template_key: 'comm.reminder.template.waiting_client.he',
      workflow_type: 'waiting_client',
      language: 'he',
      channel: 'docflow',
      subject_template: 'Hi {{client_name}}',
      body_template: 'Body {{unknown_var}}',
      variables: ['unknown_var'],
    }),
  );
});

test('renderReminderTemplate substitutes allowlisted variables', () => {
  const tpl = assertValidOperationalReminderTemplatePayload({
    type: 'operational_reminder_template',
    template_key: 'comm.reminder.template.waiting_client.he',
    workflow_type: 'waiting_client',
    language: 'he',
    channel: 'docflow',
    subject_template: 'Hi {{client_name}}',
    body_template: 'Due {{due_date}}',
    variables: ['client_name', 'due_date'],
  });
  const out = renderReminderTemplate(tpl, {
    client_name: 'Acme',
    due_date: '2026-05-15',
  });
  assert.equal(out.subject, 'Hi Acme');
  assert.equal(out.body, 'Due 2026-05-15');
});
