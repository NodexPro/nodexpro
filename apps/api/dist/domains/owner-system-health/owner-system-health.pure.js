/**
 * Platform owner — system center aggregate (pure read-model shaping).
 */
const ISSUE_DICTIONARY = {
    db_unreachable: {
        issue_key: 'db_unreachable',
        issue_label: 'Database unreachable',
        possible_reason: 'The API could not reach the database.',
        recommended_action: 'Check database connectivity, credentials, and network.',
        severity: 'critical',
    },
    delivery_failed: {
        issue_key: 'delivery_failed',
        issue_label: 'Delivery failed',
        possible_reason: 'A delivery attempt did not complete successfully.',
        recommended_action: 'Check delivery provider settings or retry from the source module.',
        severity: 'warning',
    },
    smtp_timeout: {
        issue_key: 'smtp_timeout',
        issue_label: 'Email provider timeout',
        possible_reason: 'The email provider did not respond in time.',
        recommended_action: 'Check provider status and retry delivery.',
        severity: 'warning',
    },
    pdf_render_failed: {
        issue_key: 'pdf_render_failed',
        issue_label: 'PDF render failed',
        possible_reason: 'Document PDF could not be generated.',
        recommended_action: 'Open the income document and retry PDF render.',
        severity: 'warning',
    },
    work_event_failed: {
        issue_key: 'work_event_failed',
        issue_label: 'Work event failed',
        possible_reason: 'A work event could not be processed.',
        recommended_action: 'Check event payload, schema version, and source module.',
        severity: 'warning',
    },
    event_schema_version_unsupported: {
        issue_key: 'event_schema_version_unsupported',
        issue_label: 'Unsupported event version',
        possible_reason: 'A module emitted an event version Work Engine does not support.',
        recommended_action: 'Check platform event catalog and consumer compatibility.',
        severity: 'warning',
    },
    entitlement_mismatch: {
        issue_key: 'entitlement_mismatch',
        issue_label: 'Module active but not entitled',
        possible_reason: 'Organization module is active without a valid subscription or trial.',
        recommended_action: 'Disable unused module or renew subscription/trial.',
        severity: 'warning',
    },
    license_expired: {
        issue_key: 'license_expired',
        issue_label: 'License expired',
        possible_reason: 'The module subscription is no longer active.',
        recommended_action: 'Renew subscription.',
        severity: 'warning',
    },
    trial_expired: {
        issue_key: 'trial_expired',
        issue_label: 'Trial expired',
        possible_reason: 'The organization trial period has ended.',
        recommended_action: 'Contact customer or renew subscription.',
        severity: 'warning',
    },
    smtp_disconnected: {
        issue_key: 'smtp_disconnected',
        issue_label: 'SMTP disconnected',
        possible_reason: 'Email provider is not configured for this organization.',
        recommended_action: 'Reconnect SMTP or configure email provider.',
        severity: 'warning',
    },
    delivery_failures_high_volume: {
        issue_key: 'delivery_failures_high_volume',
        issue_label: 'Large amount of failed email',
        possible_reason: 'Many email delivery attempts failed for this organization.',
        recommended_action: 'Review delivery configuration and contact customer.',
        severity: 'warning',
    },
    unknown: {
        issue_key: 'unknown',
        issue_label: 'Unknown platform error',
        possible_reason: 'The system recorded a failure without a known reason.',
        recommended_action: 'Check audit log and source module.',
        severity: 'info',
    },
};
const SECRET_PATTERNS = [
    /password\s*[:=]/i,
    /secret\s*[:=]/i,
    /api[_-]?key\s*[:=]/i,
    /bearer\s+[a-z0-9._-]+/i,
    /postgres:\/\//i,
    /supabase[_-]?service[_-]?role/i,
];
export function sanitizeFailureReason(raw) {
    const trimmed = (raw ?? '').trim();
    if (!trimmed)
        return null;
    if (trimmed.includes('\n    at '))
        return null;
    if (SECRET_PATTERNS.some((pattern) => pattern.test(trimmed)))
        return null;
    const singleLine = trimmed.replace(/\s+/g, ' ');
    if (singleLine.length > 200)
        return `${singleLine.slice(0, 197)}...`;
    return singleLine;
}
function normalizeDictionaryKey(raw) {
    const value = (raw ?? '').trim().toLowerCase();
    if (!value)
        return 'unknown';
    if (value.includes('timeout') && (value.includes('smtp') || value.includes('email'))) {
        return 'smtp_timeout';
    }
    if (value.includes('unsupported schema_version'))
        return 'event_schema_version_unsupported';
    if (value.includes('pdf'))
        return 'pdf_render_failed';
    return 'unknown';
}
export function resolveSystemHealthIssue(issueKey, failureReason) {
    if (issueKey in ISSUE_DICTIONARY) {
        return ISSUE_DICTIONARY[issueKey];
    }
    const derived = normalizeDictionaryKey(failureReason);
    if (derived in ISSUE_DICTIONARY) {
        return ISSUE_DICTIONARY[derived];
    }
    return ISSUE_DICTIONARY.unknown;
}
export function buildSystemHealthRowId(parts) {
    return parts.map((p) => p.replace(/[^a-zA-Z0-9._-]+/g, '_')).join(':');
}
export function buildCustomerHealthActions(params) {
    const subscriptionIssues = new Set([
        'license_expired',
        'trial_expired',
        'entitlement_mismatch',
    ]);
    return [
        {
            action_key: 'open_organization',
            label: 'Open organization',
            enabled: true,
            reason: null,
        },
        {
            action_key: 'open_billing',
            label: 'Open billing',
            enabled: subscriptionIssues.has(params.issueKey),
            reason: subscriptionIssues.has(params.issueKey) ? null : 'Available for subscription-related issues only.',
        },
        {
            action_key: 'contact_customer',
            label: 'Contact customer',
            enabled: true,
            reason: null,
        },
        {
            action_key: 'suspend_module',
            label: 'Suspend module',
            enabled: params.moduleKey !== 'platform',
            reason: params.moduleKey === 'platform' ? 'Not applicable for platform-wide issues.' : null,
        },
        {
            action_key: 'renew_subscription',
            label: 'Renew subscription',
            enabled: subscriptionIssues.has(params.issueKey),
            reason: subscriptionIssues.has(params.issueKey) ? null : 'Available for subscription-related issues only.',
        },
    ];
}
export function buildOwnerPanelSystemSectionContext() {
    return {
        parent_panel_key: 'owner_legal_control_panel_aggregate',
        parent_panel_route: '/platform-owner/legal-control',
        section_key: 'system',
        section_label: 'System',
        section_description: 'Platform diagnostics, customer health, and operations center.',
        read_route: '/owner/system-health',
    };
}
function countSeverity(rows, severity) {
    return rows.filter((row) => row.severity === severity).length;
}
export function buildOwnerSystemHealthAggregate(params) {
    const degradedPlatform = params.platformHealthRows.filter((row) => row.status === 'degraded' || row.status === 'critical');
    const openCustomer = params.customerHealthRows.filter((row) => row.status === 'open');
    const severityRows = [
        ...degradedPlatform.filter((row) => row.severity !== 'none'),
        ...openCustomer,
    ];
    const sectionMap = new Map();
    for (const row of openCustomer) {
        const key = row.module_key;
        const existing = sectionMap.get(key);
        if (existing)
            existing.count += 1;
        else
            sectionMap.set(key, { section_key: key, label: key, count: 1 });
    }
    return {
        aggregate_key: 'owner_system_health_aggregate',
        owner_panel: buildOwnerPanelSystemSectionContext(),
        summary: {
            total_open_issues: degradedPlatform.length + openCustomer.length,
            critical_count: countSeverity(severityRows, 'critical'),
            warning_count: countSeverity(severityRows, 'warning'),
            info_count: countSeverity(severityRows, 'info'),
            platform_component_count: params.platformHealthRows.length,
            customer_issue_count: openCustomer.length,
            last_checked_at: params.lastCheckedAt,
        },
        platform_health: {
            rows: params.platformHealthRows,
            summary: {
                total_components: params.platformHealthRows.length,
                degraded_count: degradedPlatform.length,
                critical_count: params.platformHealthRows.filter((row) => row.status === 'critical').length,
            },
        },
        customer_health: {
            future_health_score: null,
            rows: params.customerHealthRows,
            summary: {
                total_rows: openCustomer.length,
                organizations_with_issues: new Set(openCustomer.map((row) => row.organization_id)).size,
            },
        },
        rows: params.legacyRows,
        sections: [...sectionMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        source_notes: params.sourceNotes,
    };
}
