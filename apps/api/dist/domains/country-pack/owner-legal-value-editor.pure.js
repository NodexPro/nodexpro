/**
 * Owner Legal Value specialized editors — registry, read projection, command payload assembly.
 * JSON remains internal storage; Owner UI reads/writes field models only.
 */
import { ownerLegalValueRulesetMissingMessage, resolveOwnerLegalValueRulesetContextFromTables, } from './owner-legal-value-ruleset.pure.js';
import { badRequest } from '../../shared/errors.js';
import { IL_ISSUE_MONTH_WINDOW_FALLBACK, parseIssueMonthWindowFromLegalPayload, } from '../income/income-issue-month-window-fallback.pure.js';
export const IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY = 'il_income_issue_month_window';
export const OWNER_LEGAL_VALUE_EDITOR_ISSUE_MONTH_WINDOW = 'issue_month_window';
const VALUE_KEY_EDITOR_MAP = {
    [IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY]: OWNER_LEGAL_VALUE_EDITOR_ISSUE_MONTH_WINDOW,
};
function monthLabel(count, direction) {
    const unit = count === 1 ? 'month' : 'months';
    return direction === 'back' ? `Back: ${count} ${unit}` : `Forward: ${count} ${unit}`;
}
function numberField(key, label, value, opts) {
    return {
        key,
        label,
        input_type: 'number',
        value: String(value),
        required: true,
        min: opts?.min ?? 0,
        max: opts?.max ?? 24,
        step: 1,
        placeholder: null,
        help_text: opts?.help_text ?? null,
    };
}
function textField(key, label, value, required, placeholder) {
    return {
        key,
        label,
        input_type: 'text',
        value,
        required,
        placeholder: placeholder ?? null,
        help_text: null,
    };
}
function dateField(key, label, value, required) {
    return {
        key,
        label,
        input_type: 'date',
        value,
        required,
        placeholder: null,
        help_text: null,
    };
}
export function resolveOwnerLegalValueEditorKey(valueKey, valueType) {
    const key = valueKey.trim();
    if (VALUE_KEY_EDITOR_MAP[key])
        return VALUE_KEY_EDITOR_MAP[key];
    const vt = String(valueType ?? '').trim().toLowerCase();
    if (vt === 'percentage')
        return 'percentage';
    if (vt === 'boolean')
        return 'boolean';
    if (vt === 'money')
        return 'money';
    if (vt === 'date')
        return 'date';
    if (vt === 'number')
        return 'number';
    return null;
}
export function formatOwnerLegalValueHumanSummary(valueKey, valueType, payload) {
    const editorKey = resolveOwnerLegalValueEditorKey(valueKey, valueType);
    if (editorKey === OWNER_LEGAL_VALUE_EDITOR_ISSUE_MONTH_WINDOW) {
        const parsed = parseIssueMonthWindowFromLegalPayload(payload) ?? IL_ISSUE_MONTH_WINDOW_FALLBACK;
        const lines = [monthLabel(parsed.months_back, 'back'), monthLabel(parsed.months_ahead, 'forward')];
        return {
            title: 'Issue month window',
            lines,
            display: ['Issue month window', ...lines].join('\n'),
        };
    }
    if (editorKey === 'percentage' && payload != null) {
        const n = typeof payload === 'number' ? payload : Number(String(payload).replace('%', '').trim());
        if (!Number.isFinite(n))
            return null;
        const label = n > 1 ? `${n}%` : `${Math.round(n * 100)}%`;
        return { title: 'Percentage', lines: [label], display: label };
    }
    if (editorKey === 'boolean' && payload != null) {
        const label = payload === true || payload === 'true' ? 'Yes' : 'No';
        return { title: 'Boolean', lines: [label], display: label };
    }
    if ((editorKey === 'number' || editorKey === 'money') && payload != null) {
        const label = String(payload);
        return { title: editorKey === 'money' ? 'Money' : 'Number', lines: [label], display: label };
    }
    if (editorKey === 'date' && typeof payload === 'string') {
        return { title: 'Date', lines: [payload], display: payload };
    }
    return null;
}
function buildIssueMonthWindowEditor(params) {
    const parsed = parseIssueMonthWindowFromLegalPayload(params.currentPayload) ?? IL_ISSUE_MONTH_WINDOW_FALLBACK;
    const ctx = params.versionContext ?? {};
    const today = new Date().toISOString().slice(0, 10);
    const effectiveDate = String(ctx.effective_from ?? today);
    const rulesetContext = params.rulesetContext ??
        resolveOwnerLegalValueRulesetContextFromTables({
            countryCode: params.countryCode,
            effectiveDate,
        });
    const contextDisplay = [
        {
            key: 'country',
            label: 'Country',
            value: rulesetContext
                ? `${rulesetContext.country_name} (${rulesetContext.country_code})`
                : params.countryCode,
        },
        {
            key: 'ruleset',
            label: 'Ruleset',
            value: rulesetContext?.ruleset_label ?? '—',
        },
    ];
    return {
        editor_key: OWNER_LEGAL_VALUE_EDITOR_ISSUE_MONTH_WINDOW,
        title: 'Allowed Issue Month Window',
        subtitle: 'Configure how many months back and ahead an income tax invoice may be issued.',
        value_fields: [
            numberField('months_back', 'Months back', parsed.months_back, {
                help_text: 'Maximum months before the current month.',
            }),
            numberField('months_ahead', 'Months ahead', parsed.months_ahead, {
                help_text: 'Maximum months after the current month.',
            }),
        ],
        version_fields: [
            dateField('effective_from', 'Effective from', effectiveDate, true),
            dateField('effective_to', 'Effective to', ctx.effective_to == null ? '' : String(ctx.effective_to), false),
        ],
        context_display: contextDisplay,
        active_ruleset_id: rulesetContext?.active_ruleset_id ?? null,
        ruleset_resolution_error: rulesetContext
            ? null
            : ownerLegalValueRulesetMissingMessage(params.countryCode),
    };
}
export function buildOwnerLegalValueEditorDescriptor(params) {
    const editorKey = resolveOwnerLegalValueEditorKey(params.value_key, params.value_type);
    const countryCode = String(params.country_code ?? '').trim().toUpperCase();
    const versionContext = params.version_context ?? {};
    const effectiveDate = String(versionContext.effective_from ?? '').trim() || new Date().toISOString().slice(0, 10);
    const resolvedRulesetContext = params.ruleset_context ??
        (countryCode
            ? resolveOwnerLegalValueRulesetContextFromTables({
                countryCode,
                effectiveDate,
                countries: params.country_catalog?.countries,
                countryPacks: params.country_catalog?.country_packs,
                rulesets: params.country_catalog?.rulesets,
            })
            : null);
    if (editorKey === OWNER_LEGAL_VALUE_EDITOR_ISSUE_MONTH_WINDOW) {
        return buildIssueMonthWindowEditor({
            currentPayload: params.current_payload,
            versionContext,
            countryCode,
            rulesetContext: resolvedRulesetContext,
        });
    }
    return null;
}
function readIntegerField(payload, key) {
    const raw = payload[key];
    if (raw == null || raw === '')
        return null;
    const n = Number(raw);
    if (!Number.isInteger(n))
        return null;
    return n;
}
export function assembleLegalValuePayloadFromOwnerEditorInput(valueKey, valueType, payload) {
    const editorKey = resolveOwnerLegalValueEditorKey(valueKey, valueType);
    if (editorKey === OWNER_LEGAL_VALUE_EDITOR_ISSUE_MONTH_WINDOW) {
        const monthsBack = readIntegerField(payload, 'months_back');
        const monthsAhead = readIntegerField(payload, 'months_ahead');
        if (monthsBack == null || monthsAhead == null) {
            throw badRequest('months_back and months_ahead must be whole numbers');
        }
        const parsed = parseIssueMonthWindowFromLegalPayload({
            months_back: monthsBack,
            months_ahead: monthsAhead,
        });
        if (!parsed) {
            throw badRequest('months_back and months_ahead must be between 0 and 24');
        }
        return parsed;
    }
    return undefined;
}
export function ownerEditorInputPresent(valueKey, valueType, payload) {
    const editorKey = resolveOwnerLegalValueEditorKey(valueKey, valueType);
    if (editorKey === OWNER_LEGAL_VALUE_EDITOR_ISSUE_MONTH_WINDOW) {
        return payload.months_back != null || payload.months_ahead != null;
    }
    return false;
}
