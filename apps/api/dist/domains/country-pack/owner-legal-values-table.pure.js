/**
 * Owner Legal Values — backend-prepared compact table model (read-only projection).
 */
import { buildOwnerLegalValueEditorDescriptor, formatOwnerLegalValueHumanSummary, } from './owner-legal-value-editor.pure.js';
const TABLE_COLUMNS = [
    { key: 'value_key', label: 'Key' },
    { key: 'label', label: 'Label' },
    { key: 'country_code', label: 'Country' },
    { key: 'category', label: 'Category' },
    { key: 'module_scope', label: 'Module Scope' },
    { key: 'value_type', label: 'Value Type' },
    { key: 'current_value', label: 'Current Value' },
    { key: 'version_status', label: 'Version Status' },
    { key: 'effective_from', label: 'Effective From' },
];
const ROW_ACTION_KEYS = [
    'create_legal_value_version',
    'update_legal_value_metadata',
    'update_legal_value_version',
    'activate_legal_value_version',
    'deactivate_legal_value_version',
    'update_owner_note',
    'update_usage_hint',
    'update_module_scope',
];
const ROW_ACTION_LABELS = {
    create_legal_value_version: 'New version',
    update_legal_value_metadata: 'Edit metadata',
    update_legal_value_version: 'Edit version',
    activate_legal_value_version: 'Activate',
    deactivate_legal_value_version: 'Deactivate',
    update_owner_note: 'Owner note',
    update_usage_hint: 'Usage hint',
    update_module_scope: 'Module scope',
};
function textOrDash(value) {
    const s = value == null ? '' : String(value).trim();
    return s || '—';
}
function resolveActiveVersion(versions, today) {
    return (versions.find((item) => {
        const status = String(item.status ?? '');
        const from = String(item.effective_from ?? '');
        const to = item.effective_to == null ? null : String(item.effective_to);
        return status === 'active' && from <= today && (to == null || to >= today);
    }) ?? null);
}
function resolveLatestDraftVersion(versions) {
    const drafts = versions.filter((v) => String(v.status ?? '') === 'draft');
    if (!drafts.length)
        return null;
    return drafts
        .slice()
        .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0] ?? null;
}
export function formatLegalValueCurrentDisplay(value, valueType, valueKey) {
    if (valueKey) {
        const summary = formatOwnerLegalValueHumanSummary(valueKey, valueType, value);
        if (summary)
            return summary.display;
    }
    if (value == null)
        return 'No active version';
    const vt = String(valueType ?? '').trim().toLowerCase();
    if (vt === 'json') {
        try {
            const compact = JSON.stringify(value);
            return compact.length > 120 ? `${compact.slice(0, 117)}…` : compact;
        }
        catch {
            return 'Invalid JSON';
        }
    }
    if (vt === 'percentage') {
        const n = typeof value === 'number' ? value : Number(String(value).replace('%', '').trim());
        if (Number.isFinite(n))
            return n > 1 ? `${n}%` : `${Math.round(n * 100)}%`;
    }
    if (vt === 'boolean') {
        return value === true || value === 'true' ? 'true' : 'false';
    }
    if (typeof value === 'string')
        return value.trim() || '—';
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (typeof value === 'object') {
        try {
            const compact = JSON.stringify(value);
            return compact.length > 120 ? `${compact.slice(0, 117)}…` : compact;
        }
        catch {
            return '—';
        }
    }
    return String(value);
}
function versionStatusDisplay(activeVersion, definitionStatusBadge) {
    if (activeVersion) {
        const badge = activeVersion.status_badge;
        return textOrDash(badge?.label ?? activeVersion.status);
    }
    return textOrDash(definitionStatusBadge?.label ?? 'No active version');
}
function buildRowEditor(row, actionKey, version) {
    if (actionKey !== 'create_legal_value_version' &&
        actionKey !== 'update_legal_value_version') {
        return null;
    }
    const valueKey = String(row.value_key ?? '').trim();
    if (!valueKey)
        return null;
    const currentPayload = actionKey === 'update_legal_value_version'
        ? version?.value_payload_json ?? row.current_active_value
        : row.current_active_value;
    return buildOwnerLegalValueEditorDescriptor({
        value_key: valueKey,
        value_type: row.value_type,
        current_payload: currentPayload,
        version_context: version
            ? {
                effective_from: version.effective_from,
                effective_to: version.effective_to,
                country_pack_ruleset_id: version.country_pack_ruleset_id,
                status: version.status,
            }
            : undefined,
    });
}
function buildRowActions(row, globalActions) {
    const countryCode = textOrDash(row.country_code);
    const valueKey = textOrDash(row.value_key);
    const versions = Array.isArray(row.versions) ? row.versions : [];
    const activeVersion = resolveActiveVersion(versions, new Date().toISOString().slice(0, 10));
    const latestDraft = resolveLatestDraftVersion(versions);
    const basePrefill = {
        country_code: countryCode === '—' ? '' : countryCode,
        value_key: valueKey === '—' ? '' : valueKey,
        owner_note: row.owner_note ?? '',
        usage_hint: row.usage_hint ?? '',
        module_scope: row.module_scope ?? '',
    };
    return ROW_ACTION_KEYS.map((actionKey) => {
        const global = globalActions.find((a) => String(a.action_key ?? '') === actionKey);
        const globallyEnabled = global?.enabled !== false;
        let enabled = globallyEnabled;
        let disabledReason = globallyEnabled ? null : 'Action disabled by aggregate';
        const prefill = { ...basePrefill };
        if (actionKey === 'update_legal_value_version' || actionKey === 'activate_legal_value_version') {
            const version = actionKey === 'activate_legal_value_version' ? latestDraft : activeVersion ?? latestDraft;
            if (!version?.id) {
                enabled = false;
                disabledReason =
                    actionKey === 'activate_legal_value_version'
                        ? 'No draft version to activate'
                        : 'No version available to edit';
            }
            else {
                prefill.legal_value_version_id = String(version.id);
                if (version.country_pack_ruleset_id) {
                    prefill.country_pack_ruleset_id = String(version.country_pack_ruleset_id);
                }
                if (version.effective_from)
                    prefill.effective_from = String(version.effective_from);
                if (version.effective_to != null)
                    prefill.effective_to = String(version.effective_to);
                if (version.value_payload_json != null) {
                    prefill.value_payload_json = version.value_payload_json;
                }
            }
        }
        if (actionKey === 'deactivate_legal_value_version') {
            if (!activeVersion?.id) {
                enabled = false;
                disabledReason = 'No active version to deactivate';
            }
            else {
                prefill.legal_value_version_id = String(activeVersion.id);
            }
        }
        const editorVersion = actionKey === 'update_legal_value_version'
            ? activeVersion ?? latestDraft
            : actionKey === 'create_legal_value_version'
                ? activeVersion
                : null;
        return {
            action_key: actionKey,
            enabled,
            button_label: global?.button_label?.trim() || ROW_ACTION_LABELS[actionKey],
            disabled_reason: enabled ? null : disabledReason,
            prefill,
            editor: buildRowEditor(row, actionKey, editorVersion),
        };
    });
}
export function buildOwnerLegalValuesTableModel(rows, globalActions = []) {
    const today = new Date().toISOString().slice(0, 10);
    const tableRows = rows.map((row) => {
        const versions = Array.isArray(row.versions) ? row.versions : [];
        const activeVersion = resolveActiveVersion(versions, today);
        const valueKey = textOrDash(row.value_key);
        const summary = formatOwnerLegalValueHumanSummary(valueKey === '—' ? '' : valueKey, row.value_type, row.current_active_value);
        const currentValueDisplay = formatLegalValueCurrentDisplay(row.current_active_value, row.value_type, valueKey === '—' ? null : valueKey);
        const currentValueSummaryLines = summary
            ? summary.lines
            : currentValueDisplay === 'No active version'
                ? ['No active version']
                : [currentValueDisplay];
        const versionStatus = versionStatusDisplay(activeVersion, row.status_badge);
        const effectiveFrom = activeVersion
            ? textOrDash(activeVersion.effective_from)
            : 'No active version';
        const countryCode = textOrDash(row.country_code);
        const editorDescriptor = buildOwnerLegalValueEditorDescriptor({
            value_key: valueKey === '—' ? '' : valueKey,
            value_type: row.value_type,
            current_payload: row.current_active_value,
        });
        const cells = {
            value_key: valueKey,
            label: textOrDash(row.label),
            country_code: countryCode,
            category: textOrDash(row.category),
            module_scope: textOrDash(row.module_scope),
            value_type: textOrDash(row.value_type),
            current_value: currentValueDisplay,
            version_status: versionStatus,
            effective_from: effectiveFrom,
        };
        return {
            row_id: `${countryCode}:${valueKey}`,
            cells,
            current_value_display: currentValueDisplay,
            current_value_summary_lines: currentValueSummaryLines,
            version_status_display: versionStatus,
            effective_from_display: effectiveFrom,
            editor_key: editorDescriptor?.editor_key ?? null,
            actions: buildRowActions(row, globalActions),
        };
    });
    return {
        columns: TABLE_COLUMNS,
        rows: tableRows,
        empty_state: {
            visible: tableRows.length === 0,
            title: 'No legal values',
            description: 'Use the actions above to create a legal value definition.',
        },
    };
}
