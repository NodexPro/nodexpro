/**
 * Platform owner — system health aggregate (pure read-model shaping).
 */

export type SystemHealthSeverity = 'critical' | 'warning' | 'info';
export type SystemHealthRowStatus = 'open' | 'observed' | 'resolved_unknown';

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
    last_checked_at: string;
  };
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
    recommended_action: 'Check subscription/trial or deactivate module for organization.',
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

export function buildOwnerPanelSystemSectionContext(): OwnerPanelSectionContext {
  return {
    parent_panel_key: 'owner_legal_control_panel_aggregate',
    parent_panel_route: '/platform-owner/legal-control',
    section_key: 'system',
    section_label: 'System',
    section_description: 'Platform diagnostics, failed operations, and configuration health.',
    read_route: '/owner/system-health',
  };
}

export function buildOwnerSystemHealthAggregate(params: {
  rows: SystemHealthRow[];
  lastCheckedAt: string;
  sourceNotes: SystemHealthSourceNote[];
}): OwnerSystemHealthAggregate {
  const openRows = params.rows.filter((row) => row.status === 'open' && row.count > 0);
  const critical_count = openRows.filter((row) => row.severity === 'critical').length;
  const warning_count = openRows.filter((row) => row.severity === 'warning').length;
  const info_count = openRows.filter((row) => row.severity === 'info').length;

  const sectionMap = new Map<string, SystemHealthSection>();
  for (const row of openRows) {
    const existing = sectionMap.get(row.area);
    if (existing) {
      existing.count += row.count;
    } else {
      sectionMap.set(row.area, { section_key: row.area, label: row.area, count: row.count });
    }
  }

  const sections = [...sectionMap.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    aggregate_key: 'owner_system_health_aggregate',
    owner_panel: buildOwnerPanelSystemSectionContext(),
    summary: {
      total_open_issues: openRows.reduce((sum, row) => sum + row.count, 0),
      critical_count,
      warning_count,
      info_count,
      last_checked_at: params.lastCheckedAt,
    },
    rows: params.rows,
    sections,
    source_notes: params.sourceNotes,
  };
}
