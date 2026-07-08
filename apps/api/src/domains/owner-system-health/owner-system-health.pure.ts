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
  | 'contact_customer'
  | 'open_organization'
  | 'open_subscription'
  | 'open_logs';

export type CustomerHealthActionKind = 'mailto' | 'navigate' | 'disabled';

export type CustomerHealthActionDescriptor = {
  action_key: CustomerHealthActionKey;
  label: string;
  enabled: boolean;
  reason: string | null;
  kind: CustomerHealthActionKind;
  href: string | null;
};

export type CustomerHealthBorderTone = SystemHealthSeverity | 'none';

export type CustomerHealthNextStepKey =
  | 'renew_subscription'
  | 'disable_unused_module'
  | 'contact_customer'
  | 'check_delivery_provider'
  | 'retry_pdf'
  | 'review_logs';

export type CustomerHealthRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  owner_name: string | null;
  primary_email: string | null;
  billing_email: string | null;
  contact_email: string | null;
  contact_label: string;
  subscription_plan: string | null;
  module_key: string;
  problem: string;
  problem_type: string;
  possible_reason: string;
  recommended_action: string;
  severity: SystemHealthSeverity;
  severity_label: string;
  severity_tone: SystemHealthSeverity;
  border_tone: CustomerHealthBorderTone;
  row_tone: CustomerHealthBorderTone;
  row_border_tone: CustomerHealthBorderTone;
  status: SystemHealthRowStatus;
  since: string | null;
  monthly_value: number | null;
  monthly_value_currency: string | null;
  monthly_value_label: string;
  last_activity_at: string | null;
  last_activity_label: string;
  next_step_key: CustomerHealthNextStepKey;
  next_step_label: string;
  next_step_description: string;
  next_step_tone: CustomerHealthBorderTone;
  organization_display: string;
  contact_display: string;
  plan_display: string;
  module_display: string;
  problem_display: string;
  reason_display: string;
  recommended_action_display: string;
  mrr_display: string;
  last_activity_display: string;
  since_display: string;
  available_actions: CustomerHealthActionDescriptor[];
};

export type CustomerHealthSummaryCardTone = SystemHealthSeverity | 'none';

export type CustomerHealthSummaryCard = {
  key: string;
  label: string;
  value: string;
  tone: CustomerHealthSummaryCardTone;
};

export type CustomerHealthFilterOption = { value: string; label: string };

export type CustomerHealthFilterOptions = {
  severities: CustomerHealthFilterOption[];
  modules: CustomerHealthFilterOption[];
  statuses: CustomerHealthFilterOption[];
  problem_types: CustomerHealthFilterOption[];
};

export type CustomerHealthFilters = {
  severity: string | null;
  module: string | null;
  status: string | null;
  problem_type: string | null;
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
    summary_cards: CustomerHealthSummaryCard[];
    filter_options: CustomerHealthFilterOptions;
    applied_filters: CustomerHealthFilters;
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

const SUBSCRIPTION_ISSUE_KEYS = new Set(['license_expired', 'trial_expired', 'entitlement_mismatch']);

const SEVERITY_LABELS: Record<SystemHealthSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

const STATUS_LABELS: Record<SystemHealthRowStatus, string> = {
  open: 'Open',
  observed: 'Observed',
  resolved_unknown: 'Resolved (unknown)',
};

/**
 * Backend-owned contact selection. Frontend must not choose.
 * Prefers billing_email, then primary_email, then owner email.
 */
export function resolveCustomerContact(params: {
  billing_email: string | null;
  primary_email: string | null;
  owner_email: string | null;
}): { contact_email: string | null; contact_label: string } {
  if (params.billing_email) return { contact_email: params.billing_email, contact_label: 'Billing email' };
  if (params.primary_email) return { contact_email: params.primary_email, contact_label: 'Primary email' };
  if (params.owner_email) return { contact_email: params.owner_email, contact_label: 'Owner email' };
  return { contact_email: null, contact_label: 'No contact email' };
}

/** Backend-prepared human-readable monthly value, e.g. "99 ILS" or "—". */
export function buildMonthlyValueLabel(value: number | null, currency: string | null): string {
  if (value == null) return '—';
  return currency ? `${value} ${currency}` : String(value);
}

/** Backend-prepared last activity label using existing data only. */
export function buildLastActivityLabel(lastActivityAt: string | null): string {
  return lastActivityAt ?? 'No activity recorded';
}

/** Backend-prepared severity display fields. */
export function buildSeverityDisplay(severity: SystemHealthSeverity): {
  severity_label: string;
  severity_tone: SystemHealthSeverity;
  border_tone: CustomerHealthBorderTone;
} {
  return {
    severity_label: SEVERITY_LABELS[severity],
    severity_tone: severity,
    border_tone: severity,
  };
}

const NEXT_STEP_BY_ISSUE: Record<string, CustomerHealthNextStepKey> = {
  license_expired: 'renew_subscription',
  trial_expired: 'renew_subscription',
  entitlement_mismatch: 'disable_unused_module',
  delivery_failed: 'check_delivery_provider',
  delivery_failures_high_volume: 'check_delivery_provider',
  smtp_disconnected: 'check_delivery_provider',
  smtp_timeout: 'check_delivery_provider',
  pdf_render_failed: 'retry_pdf',
  work_event_failed: 'review_logs',
  event_schema_version_unsupported: 'review_logs',
  unknown: 'review_logs',
};

const NEXT_STEP_DICTIONARY: Record<CustomerHealthNextStepKey, { label: string; description: string }> = {
  renew_subscription: {
    label: 'Renew subscription',
    description: 'Renew the customer subscription to restore module entitlement.',
  },
  disable_unused_module: {
    label: 'Disable unused module',
    description: 'Disable the active module that has no valid subscription or trial.',
  },
  contact_customer: {
    label: 'Contact customer',
    description: 'Reach out to the customer about this issue.',
  },
  check_delivery_provider: {
    label: 'Check delivery provider',
    description: 'Review the delivery/email provider configuration and status.',
  },
  retry_pdf: {
    label: 'Retry PDF render',
    description: 'Open the income document and retry PDF generation.',
  },
  review_logs: {
    label: 'Review logs',
    description: 'Inspect audit and event logs for this failure.',
  },
};

/** Backend-prepared next step. Frontend renders only. */
export function buildCustomerHealthNextStep(
  issueKey: string,
  severity: SystemHealthSeverity,
): {
  next_step_key: CustomerHealthNextStepKey;
  next_step_label: string;
  next_step_description: string;
  next_step_tone: CustomerHealthBorderTone;
} {
  const key = NEXT_STEP_BY_ISSUE[issueKey] ?? 'review_logs';
  const entry = NEXT_STEP_DICTIONARY[key];
  return {
    next_step_key: key,
    next_step_label: entry.label,
    next_step_description: entry.description,
    next_step_tone: severity,
  };
}

export function buildCustomerHealthActions(params: {
  issueKey: string;
  organizationId: string;
  moduleKey: string;
  contactEmail: string | null;
}): CustomerHealthActionDescriptor[] {
  void params.organizationId;
  void params.moduleKey;
  void SUBSCRIPTION_ISSUE_KEYS;
  const contact: CustomerHealthActionDescriptor = params.contactEmail
    ? {
        action_key: 'contact_customer',
        label: 'Contact customer',
        enabled: true,
        reason: null,
        kind: 'mailto',
        href: `mailto:${params.contactEmail}`,
      }
    : {
        action_key: 'contact_customer',
        label: 'Contact customer',
        enabled: false,
        reason: 'No contact email available.',
        kind: 'disabled',
        href: null,
      };
  // Owner detail routes do not exist yet; expose as disabled descriptors (no invented routes, no commands).
  return [
    contact,
    {
      action_key: 'open_organization',
      label: 'Open organization',
      enabled: false,
      reason: 'Organization detail route is not implemented yet.',
      kind: 'disabled',
      href: null,
    },
    {
      action_key: 'open_subscription',
      label: 'Open subscription',
      enabled: false,
      reason: 'Subscription detail route is not implemented yet.',
      kind: 'disabled',
      href: null,
    },
    {
      action_key: 'open_logs',
      label: 'Open logs',
      enabled: false,
      reason: 'Logs route is not implemented yet.',
      kind: 'disabled',
      href: null,
    },
  ];
}

/** Backend-computed customer health summary cards + optional revenue-availability note. */
export function buildCustomerHealthSummaryCards(rows: CustomerHealthRow[]): {
  cards: CustomerHealthSummaryCard[];
  revenueNote: SystemHealthSourceNote | null;
} {
  const orgIds = new Set(rows.map((row) => row.organization_id));
  const criticalCount = rows.filter((row) => row.severity === 'critical').length;
  const warningCount = rows.filter((row) => row.severity === 'warning').length;
  const missingContactOrgs = new Set(
    rows.filter((row) => !row.contact_email).map((row) => row.organization_id),
  );

  const seen = new Set<string>();
  const currencies = new Set<string>();
  let revenueSum = 0;
  let revenueCounted = 0;
  for (const row of rows) {
    if (row.monthly_value == null) continue;
    const key = `${row.organization_id}:${row.module_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    revenueSum += row.monthly_value;
    revenueCounted += 1;
    if (row.monthly_value_currency) currencies.add(row.monthly_value_currency);
  }

  let revenueValue: string;
  let revenueNote: SystemHealthSourceNote | null = null;
  if (revenueCounted === 0 || currencies.size > 1) {
    revenueValue = '—';
    revenueNote = {
      source_key: 'customer_revenue_at_risk',
      status: 'partial',
      reason:
        revenueCounted === 0
          ? 'Revenue at risk is unavailable because no monthly subscription values are recorded for affected modules.'
          : 'Revenue at risk is unavailable because affected subscriptions use more than one currency.',
    };
  } else {
    const currency = [...currencies][0] ?? null;
    revenueValue = currency ? `${revenueSum} ${currency}` : String(revenueSum);
  }

  const cards: CustomerHealthSummaryCard[] = [
    {
      key: 'organizations_with_issues',
      label: 'Organizations with issues',
      value: String(orgIds.size),
      tone: 'info',
    },
    { key: 'critical', label: 'Critical', value: String(criticalCount), tone: criticalCount > 0 ? 'critical' : 'none' },
    { key: 'warnings', label: 'Warnings', value: String(warningCount), tone: warningCount > 0 ? 'warning' : 'none' },
    { key: 'revenue_at_risk', label: 'Revenue at risk', value: revenueValue, tone: 'none' },
    {
      key: 'missing_contacts',
      label: 'Missing contacts',
      value: String(missingContactOrgs.size),
      tone: missingContactOrgs.size > 0 ? 'warning' : 'none',
    },
  ];
  return { cards, revenueNote };
}

export function normalizeCustomerHealthFilters(
  filters: Partial<CustomerHealthFilters> | null | undefined,
): CustomerHealthFilters {
  const clean = (raw: string | null | undefined): string | null => {
    const value = (raw ?? '').trim();
    return value ? value : null;
  };
  return {
    severity: clean(filters?.severity),
    module: clean(filters?.module),
    status: clean(filters?.status),
    problem_type: clean(filters?.problem_type),
  };
}

function buildCustomerHealthFilterOptions(rows: CustomerHealthRow[]): CustomerHealthFilterOptions {
  const severityRank: Record<SystemHealthSeverity, number> = { critical: 0, warning: 1, info: 2 };
  const severitySet = new Set<SystemHealthSeverity>();
  const moduleSet = new Set<string>();
  const statusSet = new Set<SystemHealthRowStatus>();
  const problemLabelByType = new Map<string, string>();
  for (const row of rows) {
    severitySet.add(row.severity);
    if (row.module_key) moduleSet.add(row.module_key);
    statusSet.add(row.status);
    if (row.problem_type && !problemLabelByType.has(row.problem_type)) {
      problemLabelByType.set(row.problem_type, row.problem);
    }
  }
  return {
    severities: [...severitySet]
      .sort((a, b) => severityRank[a] - severityRank[b])
      .map((value) => ({ value, label: SEVERITY_LABELS[value] })),
    modules: [...moduleSet].sort().map((value) => ({ value, label: value })),
    statuses: [...statusSet].sort().map((value) => ({ value, label: STATUS_LABELS[value] })),
    problem_types: [...problemLabelByType.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  };
}

function applyCustomerHealthFilters(
  rows: CustomerHealthRow[],
  filters: CustomerHealthFilters,
): CustomerHealthRow[] {
  return rows.filter((row) => {
    if (filters.severity && row.severity !== filters.severity) return false;
    if (filters.module && row.module_key !== filters.module) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.problem_type && row.problem_type !== filters.problem_type) return false;
    return true;
  });
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
  customerFilters?: Partial<CustomerHealthFilters> | null;
}): OwnerSystemHealthAggregate {
  const degradedPlatform = params.platformHealthRows.filter(
    (row) => row.status === 'degraded' || row.status === 'critical',
  );
  const allOpenCustomer = params.customerHealthRows.filter((row) => row.status === 'open');
  const filterOptions = buildCustomerHealthFilterOptions(allOpenCustomer);
  const appliedFilters = normalizeCustomerHealthFilters(params.customerFilters);
  const openCustomer = applyCustomerHealthFilters(allOpenCustomer, appliedFilters);
  const { cards: customerSummaryCards, revenueNote } = buildCustomerHealthSummaryCards(openCustomer);
  const sourceNotes = revenueNote ? [...params.sourceNotes, revenueNote] : params.sourceNotes;
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
      rows: openCustomer,
      summary: {
        total_rows: openCustomer.length,
        organizations_with_issues: new Set(openCustomer.map((row) => row.organization_id)).size,
      },
      summary_cards: customerSummaryCards,
      filter_options: filterOptions,
      applied_filters: appliedFilters,
    },
    rows: params.legacyRows,
    sections: [...sectionMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    source_notes: sourceNotes,
  };
}
