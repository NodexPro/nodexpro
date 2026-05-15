import { badRequest } from '../../shared/errors.js';
const VARIABLE_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;
function substituteTemplate(template, context) {
    return template.replace(VARIABLE_PATTERN, (_match, name) => {
        if (!REMINDER_TEMPLATE_VARIABLES.includes(name)) {
            throw badRequest(`Unknown template variable: ${name}`);
        }
        const value = context[name];
        if (value == null || String(value).trim() === '') {
            throw badRequest(`Missing template variable: ${name}`);
        }
        return String(value);
    });
}
export function renderReminderTemplate(templatePayload, context) {
    for (const required of templatePayload.variables) {
        const v = context[required];
        if (v == null || String(v).trim() === '') {
            throw badRequest(`Missing required template variable: ${required}`);
        }
    }
    return {
        subject: substituteTemplate(templatePayload.subject_template, context),
        body: substituteTemplate(templatePayload.body_template, context),
    };
}
import { normalizeLegalValuePayloadJsonInput } from './docflow-communication-owner-payload.js';
import { isDocflowCommunicationOwnerPayload, assertValidDocflowCommunicationOwnerPayload } from './docflow-communication-owner-payload.js';
export const OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY = 'Operational Communication Policies';
export const OPERATIONAL_REMINDER_POLICY_TYPE = 'operational_reminder_policy';
export const OPERATIONAL_REMINDER_TEMPLATE_TYPE = 'operational_reminder_template';
export const REMINDER_TEMPLATE_KEY_PREFIX = 'comm.reminder.template.';
export const REMINDER_WORKFLOW_TYPES = ['waiting_client', 'response_sla', 'review_sla'];
export const REMINDER_CADENCE_ANCHORS = [
    'obligation_starts_at',
    'obligation_due_at',
    'work_state_entered_at',
];
export const REMINDER_CHANNELS = ['docflow', 'email', 'portal'];
export const REMINDER_SEVERITIES = ['info', 'warn', 'urgent'];
export const REMINDER_TEMPLATE_VARIABLES = [
    'client_name',
    'assignee_name',
    'reviewer_name',
    'work_type_label',
    'module_label',
    'period_key',
    'sla_status_label',
    'due_date',
    'portal_link',
    'office_name',
];
export function isOperationalReminderPolicyPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return false;
    return raw.type === OPERATIONAL_REMINDER_POLICY_TYPE;
}
export function isOperationalReminderTemplatePayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return false;
    return raw.type === OPERATIONAL_REMINDER_TEMPLATE_TYPE;
}
function assertReminderChannels(raw, field) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw badRequest(`${field} must be a non-empty array`);
    }
    const out = [];
    for (const item of raw) {
        if (typeof item !== 'string' || !REMINDER_CHANNELS.includes(item)) {
            throw badRequest(`${field} contains invalid channel`);
        }
        out.push(item);
    }
    return out;
}
function assertCadenceSteps(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw badRequest('cadence_steps must be a non-empty array');
    }
    const steps = [];
    const seenKeys = new Set();
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw badRequest('cadence_steps entries must be objects');
        }
        const o = item;
        const stepKey = typeof o.step_key === 'string' ? o.step_key.trim() : '';
        if (!stepKey)
            throw badRequest('cadence_steps.step_key is required');
        if (seenKeys.has(stepKey))
            throw badRequest(`duplicate cadence_steps.step_key: ${stepKey}`);
        seenKeys.add(stepKey);
        if (typeof o.offset_minutes !== 'number' || !Number.isInteger(o.offset_minutes)) {
            throw badRequest('cadence_steps.offset_minutes must be an integer');
        }
        const templateKey = typeof o.template_key === 'string' ? o.template_key.trim() : '';
        if (!templateKey.startsWith(REMINDER_TEMPLATE_KEY_PREFIX)) {
            throw badRequest(`cadence_steps.template_key must start with ${REMINDER_TEMPLATE_KEY_PREFIX}`);
        }
        const step = {
            step_key: stepKey,
            offset_minutes: o.offset_minutes,
            template_key: templateKey,
        };
        if (o.channels !== undefined) {
            step.channels = assertReminderChannels(o.channels, 'cadence_steps.channels');
        }
        if (o.severity !== undefined) {
            if (typeof o.severity !== 'string' || !REMINDER_SEVERITIES.includes(o.severity)) {
                throw badRequest('cadence_steps.severity is invalid');
            }
            step.severity = o.severity;
        }
        steps.push(step);
    }
    steps.sort((a, b) => a.offset_minutes - b.offset_minutes);
    return steps;
}
export function assertValidOperationalReminderPolicyPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw badRequest('operational_reminder_policy payload must be a JSON object');
    }
    const o = raw;
    if (o.type !== OPERATIONAL_REMINDER_POLICY_TYPE) {
        throw badRequest('policy type must be operational_reminder_policy');
    }
    const approvalRequired = o.approval_required === undefined ? true : o.approval_required !== false;
    const defaultChannels = assertReminderChannels(o.default_channels, 'default_channels');
    if (!Array.isArray(o.workflows) || o.workflows.length === 0) {
        throw badRequest('workflows must be a non-empty array');
    }
    const workflows = [];
    const seenWorkflows = new Set();
    for (const wf of o.workflows) {
        if (!wf || typeof wf !== 'object' || Array.isArray(wf)) {
            throw badRequest('workflows entries must be objects');
        }
        const w = wf;
        const workflowType = typeof w.workflow_type === 'string' ? w.workflow_type.trim() : '';
        if (!REMINDER_WORKFLOW_TYPES.includes(workflowType)) {
            throw badRequest('workflows.workflow_type is invalid');
        }
        if (seenWorkflows.has(workflowType)) {
            throw badRequest(`duplicate workflows.workflow_type: ${workflowType}`);
        }
        seenWorkflows.add(workflowType);
        const anchor = typeof w.anchor === 'string' ? w.anchor.trim() : '';
        if (!REMINDER_CADENCE_ANCHORS.includes(anchor)) {
            throw badRequest('workflows.anchor is invalid');
        }
        workflows.push({
            workflow_type: workflowType,
            enabled: w.enabled !== false,
            anchor: anchor,
            cadence_steps: assertCadenceSteps(w.cadence_steps),
        });
    }
    return {
        type: OPERATIONAL_REMINDER_POLICY_TYPE,
        approval_required: approvalRequired,
        default_channels: defaultChannels,
        workflows,
    };
}
export function assertValidOperationalReminderTemplatePayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw badRequest('operational_reminder_template payload must be a JSON object');
    }
    const o = raw;
    if (o.type !== OPERATIONAL_REMINDER_TEMPLATE_TYPE) {
        throw badRequest('template type must be operational_reminder_template');
    }
    const templateKey = typeof o.template_key === 'string' ? o.template_key.trim() : '';
    if (!templateKey.startsWith(REMINDER_TEMPLATE_KEY_PREFIX)) {
        throw badRequest(`template_key must start with ${REMINDER_TEMPLATE_KEY_PREFIX}`);
    }
    const workflowType = typeof o.workflow_type === 'string' ? o.workflow_type.trim() : '';
    if (!REMINDER_WORKFLOW_TYPES.includes(workflowType)) {
        throw badRequest('workflow_type is invalid');
    }
    const language = typeof o.language === 'string' ? o.language.trim() : '';
    if (!language)
        throw badRequest('language is required');
    const channelRaw = typeof o.channel === 'string' ? o.channel.trim() : '';
    if (!REMINDER_CHANNELS.includes(channelRaw)) {
        throw badRequest('channel is invalid');
    }
    const subjectTemplate = typeof o.subject_template === 'string' ? o.subject_template.trim() : '';
    const bodyTemplate = typeof o.body_template === 'string' ? o.body_template.trim() : '';
    if (!subjectTemplate)
        throw badRequest('subject_template is required');
    if (!bodyTemplate)
        throw badRequest('body_template is required');
    let variables = [];
    if (o.variables !== undefined) {
        if (!Array.isArray(o.variables))
            throw badRequest('variables must be an array');
        variables = [];
        for (const v of o.variables) {
            if (typeof v !== 'string' || !REMINDER_TEMPLATE_VARIABLES.includes(v)) {
                throw badRequest(`variables contains disallowed key: ${String(v)}`);
            }
            variables.push(v);
        }
    }
    const tone = typeof o.tone === 'string' && o.tone.trim() ? o.tone.trim() : undefined;
    return {
        type: OPERATIONAL_REMINDER_TEMPLATE_TYPE,
        template_key: templateKey,
        workflow_type: workflowType,
        language,
        channel: channelRaw,
        subject_template: subjectTemplate,
        body_template: bodyTemplate,
        variables,
        tone,
    };
}
export function assertOperationalCommunicationLegalValueMetadata(params) {
    if (params.category !== OPERATIONAL_COMMUNICATION_POLICIES_CATEGORY)
        return;
    if (params.module_scope !== 'work_engine') {
        throw badRequest('Operational Communication Policies require module_scope=work_engine');
    }
    if (params.value_type !== 'json') {
        throw badRequest('Operational Communication Policies require value_type=json');
    }
    const key = params.value_key.trim();
    if (params.value_payload_json !== undefined && params.value_payload_json !== null) {
        const normalized = normalizeLegalValuePayloadJsonInput(params.value_payload_json);
        if (isOperationalReminderPolicyPayload(normalized)) {
            if (key !== 'comm.reminder.policy' && !key.startsWith('comm.reminder.policy.')) {
                throw badRequest('operational_reminder_policy value_key should be comm.reminder.policy');
            }
            assertValidOperationalReminderPolicyPayload(normalized);
            return;
        }
        if (isOperationalReminderTemplatePayload(normalized)) {
            assertValidOperationalReminderTemplatePayload(normalized);
            return;
        }
    }
    if (!key.startsWith('comm.reminder.')) {
        throw badRequest('Operational Communication Policies value_key must start with comm.reminder.');
    }
}
/** Route legal value version payloads to the correct owner validator. */
export function validateLegalValueVersionPayload(raw) {
    const normalized = normalizeLegalValuePayloadJsonInput(raw);
    if (normalized === null)
        return null;
    if (isDocflowCommunicationOwnerPayload(normalized)) {
        return assertValidDocflowCommunicationOwnerPayload(normalized);
    }
    if (isOperationalReminderPolicyPayload(normalized)) {
        return assertValidOperationalReminderPolicyPayload(normalized);
    }
    if (isOperationalReminderTemplatePayload(normalized)) {
        return assertValidOperationalReminderTemplatePayload(normalized);
    }
    return normalized;
}
