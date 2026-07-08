/**
 * Platform owner — system center aggregate (pure read-model shaping).
 */

export type SystemHealthSeverity = 'critical' | 'warning' | 'info';
export type SystemHealthRowStatus = 'open' | 'observed' | 'resolved_unknown';
export type PlatformHealthComponentStatus =
  | 'healthy'
  | 'degraded'
  | 'critical'
  | 'unknown'
  | 'not_monitored';

export type SystemHealthRow = {
  id: string;
  module_key: string;
  area: string;
  issue_key: string;
  issue_label: string;
  severity: SystemHealthSeverity;
  status: SystemHealthRowStatus;
  count: number;
  last_seen_at: string | null;
  possible_reason: string;
  recommended_action: string;
  source_key: string;
  source_ref: string | null;
};

export type PlatformHealthRow = {
  id: string;
  component_key: string;
  component_label: string;
  status: PlatformHealthComponentStatus;
  problem: string | null;
  recommendation: string | null;
  last_check_at: string;
  severity: SystemHealthSeverity | 'none';
};

export type CustomerHealthActionKey =
  | 'open_organization'
  | 'open_billing'
  | 'contact_customer'
  | 'suspend_module'
  | 'renew_subscription';

export type CustomerHealthActionDescriptor = {
  action_key: CustomerHealthActionKey;
  label: string;
  enabled: boolean;
  reason: string | null;
};

export type CustomerHealthRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  owner_name: string | null;
  primary_email: string | null;
  billing_email: string | null;
  subscription_plan: string | null;
  module_key: string;
  problem: string;
  possible_reason: string;
  recommended_action: string;
  severity: SystemHealthSeverity;
  status: SystemHealthRowStatus;
  since: string | null;
  monthly_value: number | null;
  monthly_value_currency: string | null;
  last_activity_at: string | null;
  available_actions: CustomerHealthActionDescriptor[];
};

export type SystemHealthSection = {
  section_key: string;
  label: string;
  count: number;
};

export type SystemHealthSourceNote = {
  source_key: string;
  status: 'included' | 'not_included' | 'partial';
  reason: string;
};

export type OwnerPanelSectionContext = {
  parent_panel_key: 'owner_legal_control_panel_aggregate';
  parent_panel_route: '/platform-owner/legal-control';
  section_key: 'system';
  section_label: string;
  section_description: string;
  read_route: '/owner/system-health';
};

export type OwnerSystemHealthAggregate = {
  aggregate_key: 'owner_system_health_aggregate';
  owner_panel: OwnerPanelSectionContext;
  summary: {
    total_open_issues: number;
    critical_count: number;
    warning_count: number;
    info_count: number;
    platform_component_count: number;
    customer_issue_count: number;
    last_checked_at: string;
  };
  platform_health: {
    rows: PlatformHealthRow[];
    summary: {
      total_components: number;
      degraded_count: number;
      critical_count: number;
    };
  };
  customer_health: {
    future_health_score: null;
    rows: CustomerHealthRow[];
    summary: {
      total_rows: number;
      organizations_with_issues: number;
    };
  };
  /** @deprecated P11.5A legacy flat rows — mirrors platform issue signals */
  rows: SystemHealthRow[];
  sections: SystemHealthSection[];
  source_notes: SystemHealthSourceNote[];
};

export type SystemHealthIssueDictionaryEntry = {
  issue_key: string;
  issue_label: string;
  possible_reason: string;
  recommended_action: string;
  severity: SystemHealthSeverity;
};

export type CustomerHealthIssueDictionaryEntry = SystemHealthIssueDictionaryEntry;

const ISSUE_DICTIONARY: Record<string, SystemHealthIssueDictionaryEntry> = {
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

export function sanitizeFailureReason(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('\n    at ')) return null;
  if (SECRET_PATTERNS.some((pattern) => pattern.test(trimmed))) return null;
  const singleLine = trimmed.replace(/\s+/g, ' ');
  if (singleLine.length > 200) return `${singleLine.slice(0, 197)}...`;
  return singleLine;
}

function normalizeDictionaryKey(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('timeout') && (value.includes('smtp') || value.includes('email'))) {
    return 'smtp_timeout';
  }
  if (value.includes('unsupported schema_version')) return 'event_schema_version_unsupported';
  if (value.includes('pdf')) return 'pdf_render_failed';
  return 'unknown';
}

export function resolveSystemHealthIssue(
  issueKey: string,
  failureReason?: string | null,
): SystemHealthIssueDictionaryEntry {
  if (issueKey in ISSUE_DICTIONARY) {
    return ISSUE_DICTIONARY[issueKey]!;
  }
  const derived = normalizeDictionaryKey(failureReason);
  if (derived in ISSUE_DICTIONARY) {
    return ISSUE_DICTIONARY[derived]!;
  }
  return ISSUE_DICTIONARY.unknown;
}

export function buildSystemHealthRowId(parts: string[]): string {
  return parts.map((p) => p.replace(/[^a-zA-Z0-9._-]+/g, '_')).join(':');
}

export function buildCustomerHealthActions(params: {
  issueKey: string;
  organizationId: string;
  moduleKey: string;
}): CustomerHealthActionDescriptor[] {
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

export function buildOwnerPanelSystemSectionContext(): OwnerPanelSectionContext {
  return {
    parent_panel_key: 'owner_legal_control_panel_aggregate',
    parent_panel_route: '/platform-owner/legal-control',
    section_key: 'system',
    section_label: 'System',
    section_description: 'Platform diagnostics, customer health, and operations center.',
    read_route: '/owner/system-health',
  };
}

function countSeverity(rows: Array<{ severity: SystemHealthSeverity | 'none' }>, severity: SystemHealthSeverity): number {
  return rows.filter((row) => row.severity === severity).length;
}

export function buildOwnerSystemHealthAggregate(params: {
  lastCheckedAt: string;
  sourceNotes: SystemHealthSourceNote[];
  platformHealthRows: PlatformHealthRow[];
  customerHealthRows: CustomerHealthRow[];
  legacyRows: SystemHealthRow[];
}): OwnerSystemHealthAggregate {
  const degradedPlatform = params.platformHealthRows.filter(
    (row) => row.status === 'degraded' || row.status === 'critical',
  );
  const openCustomer = params.customerHealthRows.filter((row) => row.status === 'open');
  const severityRows = [
    ...degradedPlatform.filter((row) => row.severity !== 'none'),
    ...openCustomer,
  ] as Array<{ severity: SystemHealthSeverity }>;

  const sectionMap = new Map<string, SystemHealthSection>();
  for (const row of openCustomer) {
    const key = row.module_key;
    const existing = sectionMap.get(key);
    if (existing) existing.count += 1;
    else sectionMap.set(key, { section_key: key, label: key, count: 1 });
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
