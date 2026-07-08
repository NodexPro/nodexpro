/**
 * Platform owner — platform health component rows.
 */

import {
  buildSystemHealthRowId,
  resolveSystemHealthIssue,
  type PlatformHealthRow,
  type SystemHealthRow,
  type SystemHealthSourceNote,
} from './owner-system-health.pure.js';
import {
  loadDeliveryFailureGroups,
  loadIncomePdfFailuresByOrg,
  loadWorkEventFailureGroups,
  pingDatabase,
} from './owner-system-health.shared-read.js';

function componentRow(params: {
  component_key: string;
  component_label: string;
  status: PlatformHealthRow['status'];
  problem: string | null;
  recommendation: string | null;
  last_check_at: string;
  severity: PlatformHealthRow['severity'];
}): PlatformHealthRow {
  return {
    id: buildSystemHealthRowId(['platform_health', params.component_key]),
    component_key: params.component_key,
    component_label: params.component_label,
    status: params.status,
    problem: params.problem,
    recommendation: params.recommendation,
    last_check_at: params.last_check_at,
    severity: params.severity,
  };
}

export function buildSchedulerSourceNote(): SystemHealthSourceNote {
  return {
    source_key: 'scheduler',
    status: 'not_included',
    reason: 'No platform-wide persisted scheduler run/status table exists yet.',
  };
}

export async function loadPlatformHealthRows(lastCheckedAt: string): Promise<{
  rows: PlatformHealthRow[];
  legacyRows: SystemHealthRow[];
}> {
  const dbPing = await pingDatabase();
  const rows: PlatformHealthRow[] = [];
  const legacyRows: SystemHealthRow[] = [];

  rows.push(
    componentRow({
      component_key: 'api',
      component_label: 'API',
      status: 'healthy',
      problem: null,
      recommendation: null,
      last_check_at: lastCheckedAt,
      severity: 'none',
    }),
  );

  if (!dbPing.ok) {
    const issue = resolveSystemHealthIssue('db_unreachable');
    rows.push(
      componentRow({
        component_key: 'database',
        component_label: 'Database',
        status: 'critical',
        problem: issue.issue_label,
        recommendation: issue.recommended_action,
        last_check_at: lastCheckedAt,
        severity: issue.severity,
      }),
    );
    legacyRows.push({
      id: buildSystemHealthRowId(['platform', 'database', 'db_unreachable']),
      module_key: 'platform',
      area: 'database',
      issue_key: issue.issue_key,
      issue_label: issue.issue_label,
      severity: issue.severity,
      status: 'open',
      count: 1,
      last_seen_at: lastCheckedAt,
      possible_reason: issue.possible_reason,
      recommended_action: issue.recommended_action,
      source_key: 'database_ping',
      source_ref: null,
    });
    return { rows, legacyRows };
  }

  rows.push(
    componentRow({
      component_key: 'database',
      component_label: 'Database',
      status: 'healthy',
      problem: null,
      recommendation: null,
      last_check_at: lastCheckedAt,
      severity: 'none',
    }),
  );

  const schedulerNote = buildSchedulerSourceNote();
  rows.push(
    componentRow({
      component_key: 'scheduler',
      component_label: 'Scheduler',
      status: 'not_monitored',
      problem: schedulerNote.reason,
      recommendation: 'Add persisted scheduler status source in a future phase.',
      last_check_at: lastCheckedAt,
      severity: 'info',
    }),
  );

  const [deliveryGroups, pdfByOrg, workEventGroups] = await Promise.all([
    loadDeliveryFailureGroups(),
    loadIncomePdfFailuresByOrg(),
    loadWorkEventFailureGroups(),
  ]);

  const deliveryCount = deliveryGroups.reduce((sum, g) => sum + g.count, 0);
  const deliveryLastSeen = deliveryGroups.reduce<string | null>((max, g) => {
    if (!g.last_seen_at) return max;
    if (!max || g.last_seen_at > max) return g.last_seen_at;
    return max;
  }, null);
  if (deliveryCount > 0) {
    const issue = resolveSystemHealthIssue('delivery_failed');
    rows.push(
      componentRow({
        component_key: 'delivery',
        component_label: 'Delivery',
        status: 'degraded',
        problem: `${issue.issue_label} (${deliveryCount})`,
        recommendation: issue.recommended_action,
        last_check_at: deliveryLastSeen ?? lastCheckedAt,
        severity: issue.severity,
      }),
    );
  } else {
    rows.push(
      componentRow({
        component_key: 'delivery',
        component_label: 'Delivery',
        status: 'healthy',
        problem: null,
        recommendation: null,
        last_check_at: lastCheckedAt,
        severity: 'none',
      }),
    );
  }

  const docflowCount = deliveryGroups
    .filter((g) => g.source_module === 'docflow' || g.channel === 'docflow')
    .reduce((sum, g) => sum + g.count, 0);
  rows.push(
    componentRow({
      component_key: 'docflow',
      component_label: 'DocFlow',
      status: docflowCount > 0 ? 'degraded' : 'healthy',
      problem: docflowCount > 0 ? `Delivery failures detected (${docflowCount})` : null,
      recommendation: docflowCount > 0 ? 'Review DocFlow delivery configuration.' : null,
      last_check_at: deliveryLastSeen ?? lastCheckedAt,
      severity: docflowCount > 0 ? 'warning' : 'none',
    }),
  );

  const smtpCount = deliveryGroups
    .filter((g) => g.channel === 'email')
    .reduce((sum, g) => sum + g.count, 0);
  const smtpIssue = smtpCount > 0 ? resolveSystemHealthIssue('smtp_timeout') : null;
  rows.push(
    componentRow({
      component_key: 'smtp',
      component_label: 'SMTP',
      status: smtpCount > 0 ? 'degraded' : 'healthy',
      problem: smtpCount > 0 ? `${smtpIssue?.issue_label ?? 'Email delivery failed'} (${smtpCount})` : null,
      recommendation: smtpCount > 0 ? smtpIssue?.recommended_action ?? null : null,
      last_check_at: deliveryLastSeen ?? lastCheckedAt,
      severity: smtpCount > 0 ? 'warning' : 'none',
    }),
  );

  rows.push(
    componentRow({
      component_key: 'storage',
      component_label: 'Storage',
      status: 'not_monitored',
      problem: 'No platform-wide storage health source yet.',
      recommendation: 'Add storage diagnostics in a future phase.',
      last_check_at: lastCheckedAt,
      severity: 'info',
    }),
  );

  rows.push(
    componentRow({
      component_key: 'background_workers',
      component_label: 'Background workers',
      status: 'not_monitored',
      problem: 'No platform-wide background worker status source yet.',
      recommendation: 'Add worker heartbeat source in a future phase.',
      last_check_at: lastCheckedAt,
      severity: 'info',
    }),
  );

  const eventCount = workEventGroups.reduce((sum, g) => sum + g.count, 0);
  const eventLastSeen = workEventGroups.reduce<string | null>((max, g) => {
    if (!g.last_seen_at) return max;
    if (!max || g.last_seen_at > max) return g.last_seen_at;
    return max;
  }, null);
  rows.push(
    componentRow({
      component_key: 'queue',
      component_label: 'Queue',
      status: eventCount > 0 ? 'degraded' : 'not_monitored',
      problem: eventCount > 0 ? `Failed work events detected (${eventCount})` : 'Queue depth source not included yet.',
      recommendation: eventCount > 0 ? 'Review event intake failures.' : 'Add queue depth source in a future phase.',
      last_check_at: eventLastSeen ?? lastCheckedAt,
      severity: eventCount > 0 ? 'warning' : 'info',
    }),
  );

  const intakeUnsupported = workEventGroups.filter((g) =>
    g.sample_reason?.includes('Unsupported schema_version'),
  );
  const intakeCount = workEventGroups.reduce((sum, g) => sum + g.count, 0);
  const intakeIssue = intakeUnsupported.length
    ? resolveSystemHealthIssue('event_schema_version_unsupported')
    : resolveSystemHealthIssue('work_event_failed');
  rows.push(
    componentRow({
      component_key: 'event_intake',
      component_label: 'Event Intake',
      status: intakeCount > 0 ? 'degraded' : 'healthy',
      problem: intakeCount > 0 ? `${intakeIssue.issue_label} (${intakeCount})` : null,
      recommendation: intakeCount > 0 ? intakeIssue.recommended_action : null,
      last_check_at: eventLastSeen ?? lastCheckedAt,
      severity: intakeCount > 0 ? intakeIssue.severity : 'none',
    }),
  );

  const pdfCount = pdfByOrg.reduce((sum, g) => sum + g.count, 0);
  if (pdfCount > 0) {
    const issue = resolveSystemHealthIssue('pdf_render_failed');
    legacyRows.push({
      id: buildSystemHealthRowId(['income', 'pdf', 'pdf_render_failed']),
      module_key: 'income',
      area: 'pdf',
      issue_key: issue.issue_key,
      issue_label: issue.issue_label,
      severity: issue.severity,
      status: 'open',
      count: pdfCount,
      last_seen_at: pdfByOrg[0]?.last_seen_at ?? null,
      possible_reason: issue.possible_reason,
      recommended_action: issue.recommended_action,
      source_key: 'income_pdf_render_failed',
      source_ref: null,
    });
  }

  for (const group of deliveryGroups.slice(0, 20)) {
    const issue = resolveSystemHealthIssue(
      group.sample_reason?.toLowerCase().includes('timeout') ? 'smtp_timeout' : 'delivery_failed',
      group.sample_reason,
    );
    legacyRows.push({
      id: buildSystemHealthRowId(['delivery', group.source_module, group.channel, group.failure_bucket]),
      module_key: group.source_module,
      area: 'delivery',
      issue_key: issue.issue_key,
      issue_label: issue.issue_label,
      severity: issue.severity,
      status: 'open',
      count: group.count,
      last_seen_at: group.last_seen_at,
      possible_reason: group.sample_reason ?? issue.possible_reason,
      recommended_action: issue.recommended_action,
      source_key: 'delivery_attempts_failed',
      source_ref: `${group.channel}:${group.failure_bucket}`,
    });
  }

  return { rows, legacyRows };
}
