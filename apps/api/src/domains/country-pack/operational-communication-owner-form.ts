import { badRequest } from '../../shared/errors.js';
import {
  REMINDER_CADENCE_ANCHORS,
  REMINDER_CHANNELS,
  REMINDER_SEVERITIES,
  REMINDER_TEMPLATE_KEY_PREFIX,
  REMINDER_WORKFLOW_TYPES,
  assertValidOperationalReminderPolicyPayload,
  assertValidOperationalReminderTemplatePayload,
  type OperationalReminderPolicyPayload,
  type OperationalReminderTemplatePayload,
  type ReminderCadenceAnchor,
  type ReminderChannel,
  type ReminderWorkflowType,
} from './operational-communication-owner-payload.js';

export const DEFAULT_REMINDER_POLICY_VALUE_KEY = 'comm.reminder.policy';

export function buildReminderTemplateValueKey(workflowType: string, language: string): string {
  const wf = workflowType.trim();
  const lang = language.trim().toLowerCase();
  if (!(REMINDER_WORKFLOW_TYPES as readonly string[]).includes(wf)) {
    throw badRequest('workflow_type is invalid', 'invalid_workflow_type');
  }
  if (!/^[a-z]{2}$/.test(lang)) {
    throw badRequest('language must be a 2-letter code (e.g. he, en)', 'invalid_language');
  }
  return `${REMINDER_TEMPLATE_KEY_PREFIX}${wf}.${lang}`;
}

function assertChannels(raw: unknown, field: string): ReminderChannel[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest(`${field} must be a non-empty array`);
  }
  const out: ReminderChannel[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !(REMINDER_CHANNELS as readonly string[]).includes(item)) {
      throw badRequest(`${field} contains invalid channel`);
    }
    out.push(item as ReminderChannel);
  }
  return out;
}

function parseCadenceSteps(raw: unknown): OperationalReminderPolicyPayload['workflows'][0]['cadence_steps'] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest('cadence_steps must be a non-empty array');
  }
  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw badRequest(`cadence_steps[${idx}] must be an object`);
    }
    const o = item as Record<string, unknown>;
    const step: Record<string, unknown> = {
      step_key: typeof o.step_key === 'string' ? o.step_key.trim() : '',
      offset_minutes: o.offset_minutes,
      template_key: typeof o.template_key === 'string' ? o.template_key.trim() : '',
    };
    if (o.channels !== undefined) step.channels = o.channels;
    if (o.severity !== undefined) step.severity = o.severity;
    return step;
  }) as OperationalReminderPolicyPayload['workflows'][0]['cadence_steps'];
}

function parseWorkflows(raw: unknown): OperationalReminderPolicyPayload['workflows'] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw badRequest('workflows must be a non-empty array');
  }
  const workflows: OperationalReminderPolicyPayload['workflows'] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw badRequest(`workflows[${i}] must be an object`);
    }
    const o = item as Record<string, unknown>;
    const workflowType = typeof o.workflow_type === 'string' ? o.workflow_type.trim() : '';
    if (!(REMINDER_WORKFLOW_TYPES as readonly string[]).includes(workflowType)) {
      throw badRequest(`workflows[${i}].workflow_type is invalid`);
    }
    const anchor = typeof o.anchor === 'string' ? o.anchor.trim() : '';
    if (!(REMINDER_CADENCE_ANCHORS as readonly string[]).includes(anchor)) {
      throw badRequest(`workflows[${i}].anchor is invalid`);
    }
    workflows.push({
      workflow_type: workflowType as ReminderWorkflowType,
      enabled: o.enabled !== false,
      anchor: anchor as ReminderCadenceAnchor,
      cadence_steps: parseCadenceSteps(o.cadence_steps),
    });
  }
  return workflows;
}

/** Owner-friendly policy editor → validated operational_reminder_policy payload. */
export function parseOwnerReminderPolicyForm(raw: unknown): OperationalReminderPolicyPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('policy must be an object');
  }
  const o = raw as Record<string, unknown>;
  const draft = {
    type: 'operational_reminder_policy' as const,
    approval_required: o.approval_required !== false,
    default_channels: assertChannels(o.default_channels, 'default_channels'),
    workflows: parseWorkflows(o.workflows),
  };
  return assertValidOperationalReminderPolicyPayload(draft);
}

/** Owner-friendly template editor → value_key + validated template payload. */
export function parseOwnerReminderTemplateForm(raw: unknown): {
  value_key: string;
  payload: OperationalReminderTemplatePayload;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('template must be an object');
  }
  const o = raw as Record<string, unknown>;
  const workflowType = typeof o.workflow_type === 'string' ? o.workflow_type.trim() : '';
  const language = typeof o.language === 'string' ? o.language.trim() : '';
  const valueKey = buildReminderTemplateValueKey(workflowType, language);
  const draft = {
    type: 'operational_reminder_template' as const,
    template_key: valueKey,
    workflow_type: workflowType,
    language: language.toLowerCase(),
    channel: typeof o.channel === 'string' ? o.channel.trim() : '',
    subject_template: typeof o.subject_template === 'string' ? o.subject_template.trim() : '',
    body_template: typeof o.body_template === 'string' ? o.body_template.trim() : '',
    variables: o.variables,
    tone: o.tone,
  };
  const payload = assertValidOperationalReminderTemplatePayload(draft);
  return { value_key: valueKey, payload };
}

export function buildCommunicationPolicyEditorOptions() {
  const workflowLabels: Record<string, string> = {
    waiting_client: 'Waiting for client',
    response_sla: 'Response SLA',
    review_sla: 'Review SLA',
  };
  const anchorLabels: Record<string, string> = {
    obligation_starts_at: 'Obligation starts',
    obligation_due_at: 'Obligation due',
    work_state_entered_at: 'Work state entered',
  };
  return {
    workflow_types: REMINDER_WORKFLOW_TYPES.map((code) => ({
      code,
      label: workflowLabels[code] ?? code,
    })),
    channels: REMINDER_CHANNELS.map((code) => ({ code, label: code })),
    anchors: REMINDER_CADENCE_ANCHORS.map((code) => ({
      code,
      label: anchorLabels[code] ?? code,
    })),
    severities: REMINDER_SEVERITIES.map((code) => ({ code, label: code })),
    languages: [
      { code: 'he', label: 'Hebrew' },
      { code: 'en', label: 'English' },
    ],
  };
}
