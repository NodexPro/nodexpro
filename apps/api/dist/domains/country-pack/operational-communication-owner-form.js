import { badRequest } from '../../shared/errors.js';
import { REMINDER_CADENCE_ANCHORS, REMINDER_CHANNELS, REMINDER_SEVERITIES, REMINDER_TEMPLATE_KEY_PREFIX, REMINDER_TEMPLATE_VARIABLES, REMINDER_WORKFLOW_TYPES, OPERATIONAL_REMINDER_POLICY_TYPE, OPERATIONAL_REMINDER_TEMPLATE_TYPE, assertValidOperationalReminderPolicyPayload, assertValidOperationalReminderTemplatePayload, } from './operational-communication-owner-payload.js';
export const DEFAULT_REMINDER_POLICY_VALUE_KEY = 'comm.reminder.policy';
export const OWNER_REMINDER_PERIOD_UNITS = ['minutes', 'hours', 'days', 'weeks'];
export const OWNER_REMINDER_PRESET_PERIODS = [
    { label: '1 hour', amount: 1, unit: 'hours', period_slug: '1h' },
    { label: '2 days', amount: 2, unit: 'days', period_slug: '2d' },
    { label: '3 days', amount: 3, unit: 'days', period_slug: '3d' },
    { label: '7 days', amount: 7, unit: 'days', period_slug: '7d' },
    { label: '14 days', amount: 14, unit: 'days', period_slug: '14d' },
];
const MAX_PERIOD_MINUTES = 60 * 24 * 60; // 60 days
const CHANNEL_LABELS = {
    docflow: 'DocFlow',
    email: 'Email',
    portal: 'Portal',
};
const SEVERITY_LABELS = {
    info: 'Normal',
    warn: 'Important',
    urgent: 'Urgent',
};
const WORKFLOW_LABELS = {
    waiting_client: 'Waiting for client',
    response_sla: 'Response SLA',
    review_sla: 'Review SLA',
};
const LANGUAGE_LABELS = {
    he: 'Hebrew',
    en: 'English',
};
const VARIABLE_LABELS = {
    client_name: 'Client name',
    assignee_name: 'Assignee name',
    reviewer_name: 'Reviewer name',
    work_type_label: 'Work type',
    module_label: 'Module',
    period_key: 'Period',
    sla_status_label: 'SLA status',
    due_date: 'Due date',
    portal_link: 'Portal link',
    office_name: 'Office name',
};
const DEFAULT_WORKFLOW_ANCHOR = 'obligation_starts_at';
const MESSAGE_VARIABLE_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;
export function periodAmountUnitToOffsetMinutes(amount, unit) {
    switch (unit) {
        case 'minutes':
            return amount;
        case 'hours':
            return amount * 60;
        case 'days':
            return amount * 24 * 60;
        case 'weeks':
            return amount * 7 * 24 * 60;
        default:
            throw badRequest('period unit is invalid', 'invalid_period_unit');
    }
}
export function buildPeriodSlugFromAmountUnit(amount, unit) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw badRequest('period amount must be a positive integer', 'invalid_period_amount');
    }
    switch (unit) {
        case 'minutes':
            return `${amount}m`;
        case 'hours':
            return `${amount}h`;
        case 'days':
            return `${amount}d`;
        case 'weeks':
            return `${amount}w`;
        default:
            throw badRequest('period unit is invalid', 'invalid_period_unit');
    }
}
export function buildPeriodLabelFromAmountUnit(amount, unit) {
    const unitLabel = unit === 'minutes' ? 'minute' : unit === 'hours' ? 'hour' : unit === 'days' ? 'day' : 'week';
    return `${amount} ${unitLabel}${amount === 1 ? '' : 's'}`;
}
export function resolveOwnerPeriodInput(input) {
    const slugRaw = typeof input.period_slug === 'string' ? input.period_slug.trim() : '';
    if (slugRaw && slugRaw !== '__custom__') {
        const preset = OWNER_REMINDER_PRESET_PERIODS.find((p) => p.period_slug === slugRaw);
        if (preset) {
            return {
                period_slug: preset.period_slug,
                offset_minutes: periodAmountUnitToOffsetMinutes(preset.amount, preset.unit),
                label: preset.label,
            };
        }
        if (/^\d+[mhdw]$/.test(slugRaw)) {
            const match = /^(\d+)([mhdw])$/.exec(slugRaw);
            if (!match)
                throw badRequest('period_slug is invalid', 'invalid_period_slug');
            const amount = Number(match[1]);
            const unitMap = {
                m: 'minutes',
                h: 'hours',
                d: 'days',
                w: 'weeks',
            };
            const unit = unitMap[match[2]];
            if (!unit)
                throw badRequest('period_slug is invalid', 'invalid_period_slug');
            const offset = periodAmountUnitToOffsetMinutes(amount, unit);
            if (offset > MAX_PERIOD_MINUTES) {
                throw badRequest('period exceeds maximum of 60 days', 'period_too_long');
            }
            return {
                period_slug: slugRaw,
                offset_minutes: offset,
                label: buildPeriodLabelFromAmountUnit(amount, unit),
            };
        }
        throw badRequest(`Unknown preset period: ${slugRaw}`, 'invalid_period_slug');
    }
    const period = input.period;
    if (!period || typeof period !== 'object' || Array.isArray(period)) {
        throw badRequest('period is required (preset or custom amount + unit)', 'period_required');
    }
    const amount = typeof period.amount === 'number' ? period.amount : Number(period.amount);
    const unitRaw = typeof period.unit === 'string' ? period.unit.trim() : '';
    if (!Number.isInteger(amount) || amount <= 0) {
        throw badRequest('period.amount must be a positive integer', 'invalid_period_amount');
    }
    if (!OWNER_REMINDER_PERIOD_UNITS.includes(unitRaw)) {
        throw badRequest('period.unit is invalid', 'invalid_period_unit');
    }
    const unit = unitRaw;
    const offset_minutes = periodAmountUnitToOffsetMinutes(amount, unit);
    if (offset_minutes > MAX_PERIOD_MINUTES) {
        throw badRequest('period exceeds maximum of 60 days', 'period_too_long');
    }
    const period_slug = buildPeriodSlugFromAmountUnit(amount, unit);
    return {
        period_slug,
        offset_minutes,
        label: buildPeriodLabelFromAmountUnit(amount, unit),
    };
}
export function buildReminderStepKey(workflowType, periodSlug) {
    const wf = workflowType.trim();
    const slug = periodSlug.trim();
    if (!wf || !slug)
        throw badRequest('workflow_type and period are required for step_key');
    return `nudge_${wf}_${slug}`.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
}
/** comm.reminder.template.{workflow}.{period_slug}.{language} */
export function buildReminderTemplateKey(workflowType, periodSlug, language) {
    const wf = workflowType.trim();
    const slug = periodSlug.trim();
    const lang = language.trim().toLowerCase();
    if (!REMINDER_WORKFLOW_TYPES.includes(wf)) {
        throw badRequest('workflow_type is invalid', 'invalid_workflow_type');
    }
    if (!/^[a-z0-9]{1,12}$/.test(slug)) {
        throw badRequest('period_slug is invalid', 'invalid_period_slug');
    }
    if (!/^[a-z]{2}$/.test(lang)) {
        throw badRequest('language must be a 2-letter code (e.g. he, en)', 'invalid_language');
    }
    return `${REMINDER_TEMPLATE_KEY_PREFIX}${wf}.${slug}.${lang}`;
}
export function parseReminderTemplateKeyMetadata(templateKey) {
    if (!templateKey.startsWith(REMINDER_TEMPLATE_KEY_PREFIX))
        return null;
    const rest = templateKey.slice(REMINDER_TEMPLATE_KEY_PREFIX.length);
    const parts = rest.split('.').filter(Boolean);
    if (parts.length === 3) {
        return { workflow_type: parts[0], period_slug: parts[1], language: parts[2] };
    }
    if (parts.length === 2) {
        return { workflow_type: parts[0], period_slug: 'legacy', language: parts[1] };
    }
    return null;
}
function assertChannels(raw, field) {
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
function parseSeverity(raw) {
    if (raw === undefined || raw === null || raw === '')
        return undefined;
    const s = String(raw).trim();
    if (!REMINDER_SEVERITIES.includes(s)) {
        throw badRequest('severity is invalid', 'invalid_severity');
    }
    return s;
}
export function resolveOwnerCadencePeriodToStep(workflowType, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw badRequest('cadence period entry must be an object');
    }
    const o = raw;
    const resolvedPeriod = resolveOwnerPeriodInput({
        period_slug: typeof o.period_slug === 'string' ? o.period_slug : null,
        period: o.period,
    });
    const templateRef = typeof o.template_ref === 'string' ? o.template_ref.trim() : '';
    if (!templateRef) {
        throw badRequest('template_ref is required for each cadence period', 'template_ref_required');
    }
    if (!templateRef.startsWith(REMINDER_TEMPLATE_KEY_PREFIX)) {
        throw badRequest('template_ref must be an existing reminder template', 'invalid_template_ref');
    }
    const channels = assertChannels(o.channels, 'channels');
    const severity = parseSeverity(o.severity);
    const step = {
        step_key: buildReminderStepKey(workflowType, resolvedPeriod.period_slug),
        offset_minutes: resolvedPeriod.offset_minutes,
        template_key: templateRef,
        channels,
    };
    if (severity)
        step.severity = severity;
    return step;
}
function parseCadencePeriods(workflowType, raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw badRequest('cadence_periods must be a non-empty array');
    }
    return raw.map((item, idx) => {
        try {
            return resolveOwnerCadencePeriodToStep(workflowType, item);
        }
        catch (e) {
            if (e instanceof Error && 'code' in e)
                throw e;
            throw badRequest(`cadence_periods[${idx}] is invalid`);
        }
    });
}
function parseWorkflows(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw badRequest('workflows must be a non-empty array');
    }
    const workflows = [];
    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw badRequest(`workflows[${i}] must be an object`);
        }
        const o = item;
        const workflowType = typeof o.workflow_type === 'string' ? o.workflow_type.trim() : '';
        if (!REMINDER_WORKFLOW_TYPES.includes(workflowType)) {
            throw badRequest(`workflows[${i}].workflow_type is invalid`);
        }
        const anchor = typeof o.anchor === 'string' ? o.anchor.trim() : '';
        if (!REMINDER_CADENCE_ANCHORS.includes(anchor)) {
            throw badRequest(`workflows[${i}].anchor is invalid`);
        }
        const cadenceRaw = o.cadence_periods ?? o.cadence_steps;
        const cadence_steps = Array.isArray(cadenceRaw) &&
            cadenceRaw.length > 0 &&
            cadenceRaw[0] &&
            typeof cadenceRaw[0] === 'object' &&
            'template_ref' in cadenceRaw[0]
            ? parseCadencePeriods(workflowType, cadenceRaw)
            : parseLegacyCadenceSteps(cadenceRaw);
        workflows.push({
            workflow_type: workflowType,
            enabled: o.enabled !== false,
            anchor: anchor,
            cadence_steps,
        });
    }
    return workflows;
}
/** Legacy technical cadence_steps (tests / migration only). */
function parseLegacyCadenceSteps(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw badRequest('cadence_steps must be a non-empty array');
    }
    return raw.map((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw badRequest(`cadence_steps[${idx}] must be an object`);
        }
        const o = item;
        const step = {
            step_key: typeof o.step_key === 'string' ? o.step_key.trim() : '',
            offset_minutes: o.offset_minutes,
            template_key: typeof o.template_key === 'string' ? o.template_key.trim() : '',
        };
        if (o.channels !== undefined)
            step.channels = o.channels;
        if (o.severity !== undefined)
            step.severity = o.severity;
        return step;
    });
}
export function extractVariablesFromReminderMessage(message) {
    const found = new Set();
    for (const match of message.matchAll(MESSAGE_VARIABLE_PATTERN)) {
        const name = match[1];
        if (REMINDER_TEMPLATE_VARIABLES.includes(name)) {
            found.add(name);
        }
    }
    return [...found];
}
function pickPrimaryReminderChannel(channels) {
    if (channels.includes('docflow'))
        return 'docflow';
    if (channels.includes('email'))
        return 'email';
    return channels[0];
}
/** Unified owner wizard → templates + single workflow cadence (policy merge on command). */
export function parseOwnerReminderWorkflowForm(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw badRequest('workflow payload must be an object');
    }
    const o = raw;
    const workflowTypeRaw = typeof o.workflow_type === 'string' ? o.workflow_type.trim() : '';
    if (!REMINDER_WORKFLOW_TYPES.includes(workflowTypeRaw)) {
        throw badRequest('workflow_type is invalid', 'invalid_workflow_type');
    }
    const workflowType = workflowTypeRaw;
    const approvalRequired = o.approval_required !== false;
    const defaultChannels = assertChannels(o.default_channels, 'default_channels');
    if (!Array.isArray(o.reminders) || o.reminders.length === 0) {
        throw badRequest('reminders must be a non-empty array', 'reminders_required');
    }
    const cadenceSteps = [];
    const templates = [];
    const seenStepKeys = new Set();
    for (let i = 0; i < o.reminders.length; i++) {
        const item = o.reminders[i];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw badRequest(`reminders[${i}] must be an object`);
        }
        const r = item;
        const resolvedPeriod = resolveOwnerPeriodInput({
            period_slug: typeof r.period_slug === 'string' ? r.period_slug : null,
            period: r.period,
        });
        const channels = assertChannels(r.channels, `reminders[${i}].channels`);
        const severity = parseSeverity(r.severity);
        if (!severity) {
            throw badRequest(`reminders[${i}].severity is required`, 'severity_required');
        }
        const language = typeof r.language === 'string' ? r.language.trim().toLowerCase() : '';
        if (!/^[a-z]{2}$/.test(language)) {
            throw badRequest(`reminders[${i}].language must be a 2-letter code`, 'invalid_language');
        }
        const message = typeof r.message === 'string' ? r.message.trim() : '';
        if (!message) {
            throw badRequest(`reminders[${i}].message is required`, 'message_required');
        }
        const subjectRaw = typeof r.subject === 'string' ? r.subject.trim() : '';
        if (channels.includes('email') && !subjectRaw) {
            throw badRequest(`reminders[${i}].subject is required when email channel is selected`, 'subject_required');
        }
        const templateKey = buildReminderTemplateKey(workflowType, resolvedPeriod.period_slug, language);
        const stepKey = buildReminderStepKey(workflowType, resolvedPeriod.period_slug);
        if (seenStepKeys.has(stepKey)) {
            throw badRequest(`duplicate reminder period in schedule: ${resolvedPeriod.label}`, 'duplicate_reminder_period');
        }
        seenStepKeys.add(stepKey);
        const variables = extractVariablesFromReminderMessage(message);
        const primaryChannel = pickPrimaryReminderChannel(channels);
        const subjectTemplate = subjectRaw || message.split('\n')[0]?.slice(0, 120) || 'Reminder';
        const templatePayload = assertValidOperationalReminderTemplatePayload({
            type: OPERATIONAL_REMINDER_TEMPLATE_TYPE,
            template_key: templateKey,
            workflow_type: workflowType,
            language,
            channel: primaryChannel,
            subject_template: subjectTemplate,
            body_template: message,
            variables,
        });
        const wfLabel = WORKFLOW_LABELS[workflowType] ?? workflowType;
        const langLabel = LANGUAGE_LABELS[language] ?? language;
        templates.push({
            value_key: templateKey,
            label: `${wfLabel} · ${resolvedPeriod.label} · ${langLabel}`,
            payload: templatePayload,
        });
        const step = {
            step_key: stepKey,
            offset_minutes: resolvedPeriod.offset_minutes,
            template_key: templateKey,
            channels,
            severity,
        };
        cadenceSteps.push(step);
    }
    cadenceSteps.sort((a, b) => a.offset_minutes - b.offset_minutes);
    return {
        workflow_type: workflowType,
        approval_required: approvalRequired,
        default_channels: defaultChannels,
        templates,
        policy_workflow: {
            workflow_type: workflowType,
            enabled: true,
            anchor: DEFAULT_WORKFLOW_ANCHOR,
            cadence_steps: cadenceSteps,
        },
    };
}
export function offsetMinutesToOwnerPeriodForm(offsetMinutes) {
    const preset = OWNER_REMINDER_PRESET_PERIODS.find((p) => periodAmountUnitToOffsetMinutes(p.amount, p.unit) === offsetMinutes);
    if (preset) {
        return { period_slug: preset.period_slug, custom_amount: preset.amount, custom_unit: preset.unit };
    }
    if (offsetMinutes % (7 * 24 * 60) === 0) {
        const amount = offsetMinutes / (7 * 24 * 60);
        return { period_slug: '__custom__', custom_amount: amount, custom_unit: 'weeks' };
    }
    if (offsetMinutes % (24 * 60) === 0) {
        const amount = offsetMinutes / (24 * 60);
        return { period_slug: '__custom__', custom_amount: amount, custom_unit: 'days' };
    }
    if (offsetMinutes % 60 === 0) {
        const amount = offsetMinutes / 60;
        return { period_slug: '__custom__', custom_amount: amount, custom_unit: 'hours' };
    }
    return { period_slug: '__custom__', custom_amount: offsetMinutes, custom_unit: 'minutes' };
}
export function setWorkflowEnabledInPolicy(policy, workflowType, enabled) {
    let found = false;
    const workflows = policy.workflows.map((w) => {
        if (w.workflow_type !== workflowType)
            return w;
        found = true;
        return { ...w, enabled };
    });
    if (!found) {
        throw badRequest(`Workflow '${workflowType}' is not in this policy version`, 'reminder_workflow_not_found');
    }
    return assertValidOperationalReminderPolicyPayload({
        ...policy,
        workflows,
    });
}
export function buildReminderWorkflowEditableForm(params) {
    const wf = params.policy.workflows.find((w) => w.workflow_type === params.workflowType);
    if (!wf) {
        throw badRequest(`Workflow '${params.workflowType}' is not in this policy version`, 'reminder_workflow_not_found');
    }
    const reminders = wf.cadence_steps.map((step) => {
        const period = offsetMinutesToOwnerPeriodForm(step.offset_minutes);
        const template = params.templateBodiesByKey.get(step.template_key);
        const periodPart = period.period_slug === '__custom__'
            ? { period: { amount: period.custom_amount, unit: period.custom_unit } }
            : { period_slug: period.period_slug };
        return {
            ...periodPart,
            severity: step.severity ?? 'info',
            channels: step.channels ?? params.policy.default_channels,
            language: template?.language ?? 'he',
            ...(template?.channel === 'email' || (step.channels ?? []).includes('email')
                ? { subject: template?.subject_template ?? '' }
                : {}),
            message: template?.body_template ?? '',
        };
    });
    return {
        country_code: params.countryCode,
        country_pack_id: params.countryPackId,
        country_pack_ruleset_id: params.rulesetId,
        policy_legal_value_version_id: params.policyVersionId,
        effective_from: params.effectiveFrom,
        effective_to: params.effectiveTo,
        activate_after_create: params.versionStatus === 'active',
        workflow_type: params.workflowType,
        approval_required: params.policy.approval_required !== false,
        default_channels: params.policy.default_channels,
        reminders,
    };
}
export function mergeReminderWorkflowIntoPolicy(existing, parsed) {
    const incomingWorkflow = parsed.policy_workflow;
    const workflows = existing
        ? existing.workflows.filter((w) => w.workflow_type !== parsed.workflow_type)
        : [];
    workflows.push(incomingWorkflow);
    return assertValidOperationalReminderPolicyPayload({
        type: OPERATIONAL_REMINDER_POLICY_TYPE,
        approval_required: parsed.approval_required,
        default_channels: parsed.default_channels,
        workflows,
    });
}
/** Owner-friendly policy editor → validated operational_reminder_policy payload. */
export function parseOwnerReminderPolicyForm(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw badRequest('policy must be an object');
    }
    const o = raw;
    const draft = {
        type: 'operational_reminder_policy',
        approval_required: o.approval_required !== false,
        default_channels: assertChannels(o.default_channels, 'default_channels'),
        workflows: parseWorkflows(o.workflows),
    };
    return assertValidOperationalReminderPolicyPayload(draft);
}
/** Owner-friendly template editor → value_key + validated template payload. */
export function parseOwnerReminderTemplateForm(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw badRequest('template must be an object');
    }
    const o = raw;
    const workflowType = typeof o.workflow_type === 'string' ? o.workflow_type.trim() : '';
    const language = typeof o.language === 'string' ? o.language.trim().toLowerCase() : '';
    const displayName = typeof o.template_display_name === 'string' ? o.template_display_name.trim() : '';
    if (!displayName) {
        throw badRequest('template_display_name is required', 'template_display_name_required');
    }
    const resolvedPeriod = resolveOwnerPeriodInput({
        period_slug: typeof o.period_slug === 'string' ? o.period_slug : null,
        period: o.period,
    });
    const valueKey = buildReminderTemplateKey(workflowType, resolvedPeriod.period_slug, language);
    const draft = {
        type: 'operational_reminder_template',
        template_key: valueKey,
        workflow_type: workflowType,
        language,
        channel: typeof o.channel === 'string' ? o.channel.trim() : '',
        subject_template: typeof o.subject_template === 'string' ? o.subject_template.trim() : '',
        body_template: typeof o.body_template === 'string' ? o.body_template.trim() : '',
        variables: o.variables,
        tone: o.tone,
    };
    const payload = assertValidOperationalReminderTemplatePayload(draft);
    return {
        value_key: valueKey,
        payload,
        period_slug: resolvedPeriod.period_slug,
        period_label: resolvedPeriod.label,
    };
}
export function buildExistingTemplatesCatalog(templateRows) {
    const out = [];
    for (const row of templateRows) {
        const templateKey = String(row.template_key ?? row.value_key ?? '').trim();
        if (!templateKey.startsWith(REMINDER_TEMPLATE_KEY_PREFIX))
            continue;
        const meta = parseReminderTemplateKeyMetadata(templateKey);
        const workflowType = String(row.workflow_type ?? meta?.workflow_type ?? '');
        const language = String(row.language ?? meta?.language ?? '');
        const periodSlug = meta?.period_slug ?? 'legacy';
        const preset = OWNER_REMINDER_PRESET_PERIODS.find((p) => p.period_slug === periodSlug);
        const periodLabel = preset?.label ?? (periodSlug === 'legacy' ? 'Legacy' : periodSlug);
        const displayName = String(row.label ?? '').trim() || displayNameFromTemplate(templateKey, periodLabel);
        out.push({
            template_key: templateKey,
            display_name: displayName,
            workflow_type: workflowType,
            period_slug: periodSlug,
            period_label: periodLabel,
            language,
            channel: String(row.channel ?? ''),
            country_code: String(row.country_code ?? '').toUpperCase(),
        });
    }
    return out;
}
function displayNameFromTemplate(templateKey, periodLabel) {
    const meta = parseReminderTemplateKeyMetadata(templateKey);
    if (!meta)
        return templateKey;
    const wf = WORKFLOW_LABELS[meta.workflow_type] ?? meta.workflow_type;
    const lang = LANGUAGE_LABELS[meta.language] ?? meta.language;
    return `${wf} · ${periodLabel} · ${lang}`;
}
export function buildCommunicationPolicyEditorOptions(templateRows = []) {
    const templates = buildExistingTemplatesCatalog(templateRows);
    const byWorkflow = {};
    for (const t of templates) {
        const list = byWorkflow[t.workflow_type] ?? [];
        list.push(t);
        byWorkflow[t.workflow_type] = list;
    }
    return {
        workflow_types: REMINDER_WORKFLOW_TYPES.map((code) => ({
            code,
            label: WORKFLOW_LABELS[code] ?? code,
        })),
        channels: REMINDER_CHANNELS.map((code) => ({
            code,
            label: CHANNEL_LABELS[code] ?? code,
        })),
        anchors: REMINDER_CADENCE_ANCHORS.map((code) => ({
            code,
            label: code === 'obligation_starts_at'
                ? 'Obligation starts'
                : code === 'obligation_due_at'
                    ? 'Obligation due'
                    : 'Work state entered',
        })),
        severities: REMINDER_SEVERITIES.map((code) => ({
            code,
            label: SEVERITY_LABELS[code] ?? code,
        })),
        languages: Object.entries(LANGUAGE_LABELS).map(([code, label]) => ({ code, label })),
        preset_periods: OWNER_REMINDER_PRESET_PERIODS.map((p) => ({
            label: p.label,
            amount: p.amount,
            unit: p.unit,
            period_slug: p.period_slug,
        })),
        allowed_units: OWNER_REMINDER_PERIOD_UNITS.map((unit) => ({
            code: unit,
            label: unit.charAt(0).toUpperCase() + unit.slice(1),
        })),
        existing_templates: templates,
        existing_templates_by_workflow: byWorkflow,
        template_variables: REMINDER_TEMPLATE_VARIABLES.map((code) => ({
            code,
            label: VARIABLE_LABELS[code] ?? code,
            token: `{{${code}}}`,
        })),
    };
}
/** @deprecated Use buildReminderTemplateKey with period_slug */
export function buildReminderTemplateValueKey(workflowType, language) {
    return buildReminderTemplateKey(workflowType, 'legacy', language);
}
