/**
 * P11.5A — Owner system health aggregate contract tests.
 */

import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildOwnerSystemHealthAggregate,
  buildOwnerPanelSystemSectionContext,
  buildCustomerHealthActions,
  buildCustomerHealthNextStep,
  buildLastActivityLabel,
  buildMonthlyValueLabel,
  buildSeverityDisplay,
  resolveCustomerContact,
  resolveSystemHealthIssue,
  sanitizeFailureReason,
  type CustomerHealthRow,
} from '../../src/domains/owner-system-health/owner-system-health.pure.js';

function makeCustomerRow(overrides: Partial<CustomerHealthRow> = {}): CustomerHealthRow {
  return {
    id: 'customer_health:org-1:client-operations:license_expired',
    organization_id: 'org-1',
    organization_name: 'Acme',
    owner_name: 'Owner',
    primary_email: 'primary@test.local',
    billing_email: 'billing@test.local',
    contact_email: 'billing@test.local',
    contact_label: 'Billing email',
    subscription_plan: 'Standard',
    module_key: 'client-operations',
    problem: 'License expired',
    problem_type: 'license_expired',
    possible_reason: 'Subscription ended',
    recommended_action: 'Renew subscription.',
    severity: 'warning',
    severity_label: 'Warning',
    severity_tone: 'warning',
    border_tone: 'warning',
    status: 'open',
    since: '2026-06-01T00:00:00.000Z',
    row_tone: 'warning',
    row_border_tone: 'warning',
    monthly_value: 99,
    monthly_value_currency: 'ILS',
    monthly_value_label: '99 ILS',
    last_activity_at: '2026-06-19T09:00:00.000Z',
    last_activity_label: '2026-06-19T09:00:00.000Z',
    next_step_key: 'renew_subscription',
    next_step_label: 'Renew subscription',
    next_step_description: 'Renew the customer subscription to restore module entitlement.',
    next_step_tone: 'warning',
    organization_display: 'Acme',
    contact_display: 'Owner',
    plan_display: 'Standard',
    module_display: 'client-operations',
    problem_display: 'License expired',
    reason_display: 'Subscription ended',
    recommended_action_display: 'Renew subscription.',
    mrr_display: '99 ILS',
    last_activity_display: '2026-06-19T09:00:00.000Z',
    since_display: '2026-06-01T00:00:00.000Z',
    available_actions: buildCustomerHealthActions({
      issueKey: 'license_expired',
      organizationId: 'org-1',
      moduleKey: 'client-operations',
      contactEmail: 'billing@test.local',
    }),
    ...overrides,
  };
}

const dir = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(join(dir, '../../src/routes/owner-country-pack.routes.ts'), 'utf8');
const readSource = readFileSync(
  join(dir, '../../src/domains/owner-system-health/owner-system-health.read.ts'),
  'utf8',
);
const platformReadSource = readFileSync(
  join(dir, '../../src/domains/owner-system-health/owner-system-health.platform-health.read.ts'),
  'utf8',
);
const customerReadSource = readFileSync(
  join(dir, '../../src/domains/owner-system-health/owner-system-health.customer-health.read.ts'),
  'utf8',
);
const sharedReadSource = readFileSync(
  join(dir, '../../src/domains/owner-system-health/owner-system-health.shared-read.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/owner-system-health/owner-system-health.service.ts'),
  'utf8',
);
const pureSource = readFileSync(
  join(dir, '../../src/domains/owner-system-health/owner-system-health.pure.ts'),
  'utf8',
);
const webSectionSource = readFileSync(
  join(dir, '../../../web/src/pages/OwnerSystemHealthSection.tsx'),
  'utf8',
);

const legalControlSource = readFileSync(
  join(dir, '../../src/domains/country-pack/country-pack-read-models.service.ts'),
  'utf8',
);
const platformOwnerSource = readFileSync(join(dir, '../../src/shared/platform-owner.ts'), 'utf8');

test('route GET /system-health requires platform owner guard', () => {
  assert.match(routesSource, /router\.get\('\/system-health'/);
  assert.match(routesSource, /assertOwnerOrAuditFailure\(ctx, req\)/);
  assert.match(routesSource, /buildOwnerSystemHealthAggregate\(ctx,/);
});

test('route applies backend customer health filters from query params', () => {
  assert.match(routesSource, /customer_severity/);
  assert.match(routesSource, /customer_module/);
  assert.match(routesSource, /customer_status/);
  assert.match(routesSource, /customer_problem_type/);
});

test('service rejects organization tenant context via assertPlatformOwner', () => {
  assert.match(serviceSource, /assertPlatformOwner\(ctx\)/);
  assert.match(platformOwnerSource, /PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN/);
  assert.match(platformOwnerSource, /Platform owner access required/);
});

test('aggregate is wired to owner legal control panel as a future System section', () => {
  const panel = buildOwnerPanelSystemSectionContext();
  assert.equal(panel.parent_panel_key, 'owner_legal_control_panel_aggregate');
  assert.equal(panel.parent_panel_route, '/platform-owner/legal-control');
  assert.equal(panel.section_key, 'system');
  assert.equal(panel.read_route, '/owner/system-health');
  assert.match(legalControlSource, /owner_panel_sections/);
  assert.match(legalControlSource, /read_route: '\/owner\/system-health'/);
  assert.match(legalControlSource, /aggregate_key: 'owner_system_health_aggregate'/);
});

test('legal-control panel does not embed system health rows (lazy section load)', () => {
  assert.doesNotMatch(legalControlSource, /buildOwnerSystemHealthAggregate/);
  assert.doesNotMatch(legalControlSource, /loadOwnerSystemHealthRows/);
});

test('aggregate includes platform_health and customer_health sections', () => {
  assert.match(pureSource, /platform_health:/);
  assert.match(pureSource, /customer_health:/);
  assert.match(pureSource, /future_health_score: null/);
  assert.match(pureSource, /available_actions/);
});

test('platform health rows use component columns from backend', () => {
  assert.match(platformReadSource, /component_label/);
  assert.match(platformReadSource, /component_key: 'database'/);
  assert.match(platformReadSource, /component_key: 'event_intake'/);
});

test('customer health rows are organization-scoped with contact enrichment', () => {
  assert.match(customerReadSource, /organization_name/);
  assert.match(customerReadSource, /owner_name/);
  assert.match(customerReadSource, /primary_email/);
  assert.match(customerReadSource, /subscription_plan/);
  assert.match(customerReadSource, /buildCustomerHealthActions/);
});

test('DB health row is critical when ping fails', () => {
  const issue = resolveSystemHealthIssue('db_unreachable');
  assert.equal(issue.severity, 'critical');
  assert.match(platformReadSource, /if \(!dbPing\.ok\)/);
  assert.match(platformReadSource, /status: 'critical'/);
});

test('delivery failed rows query failed result only', () => {
  assert.match(readSource, /delivery_attempts/);
  assert.match(platformReadSource, /loadDeliveryFailureGroups/);
});

test('income PDF failed rows use pdf_render_status failed only', () => {
  assert.match(customerReadSource, /pdf_render_failed/);
  assert.match(customerReadSource, /loadIncomePdfFailuresByOrg/);
});

test('failed work_events are included with processing_status failed', () => {
  assert.match(customerReadSource, /loadWorkEventFailureGroups/);
  assert.match(customerReadSource, /work_event_failed/);
});

test('rows sanitize secrets and stack traces from failure reasons', () => {
  assert.equal(sanitizeFailureReason('password=abc123'), null);
  assert.equal(sanitizeFailureReason('Error\n    at Object.<anonymous>'), null);
  assert.equal(sanitizeFailureReason('smtp timeout while sending'), 'smtp timeout while sending');
  assert.match(pureSource, /sanitizeFailureReason/);
  assert.match(sharedReadSource, /sanitizeFailureReason\(row\.failure_reason\)/);
});

test('aggregate shape is UI-ready with platform and customer health', () => {
  const aggregate = buildOwnerSystemHealthAggregate({
    lastCheckedAt: '2026-06-19T10:00:00.000Z',
    sourceNotes: [{ source_key: 'scheduler', status: 'not_included', reason: 'test' }],
    legacyRows: [],
    platformHealthRows: [
      {
        id: 'platform_health:delivery',
        component_key: 'delivery',
        component_label: 'Delivery',
        status: 'degraded',
        problem: 'Delivery failed (2)',
        recommendation: 'Check delivery provider settings or retry from the source module.',
        last_check_at: '2026-06-19T09:00:00.000Z',
        severity: 'warning',
      },
    ],
    customerHealthRows: [makeCustomerRow()],
  });
  assert.equal(aggregate.aggregate_key, 'owner_system_health_aggregate');
  assert.equal(aggregate.owner_panel.section_key, 'system');
  assert.equal(aggregate.platform_health.rows.length, 1);
  assert.equal(aggregate.customer_health.future_health_score, null);
  assert.equal(aggregate.customer_health.rows.length, 1);
  assert.equal(typeof aggregate.summary.total_open_issues, 'number');
});

test('contact_email is backend-selected preferring billing then primary then owner', () => {
  assert.deepEqual(
    resolveCustomerContact({ billing_email: 'b@x', primary_email: 'p@x', owner_email: 'o@x' }),
    { contact_email: 'b@x', contact_label: 'Billing email' },
  );
  assert.deepEqual(
    resolveCustomerContact({ billing_email: null, primary_email: 'p@x', owner_email: 'o@x' }),
    { contact_email: 'p@x', contact_label: 'Primary email' },
  );
  assert.deepEqual(
    resolveCustomerContact({ billing_email: null, primary_email: null, owner_email: 'o@x' }),
    { contact_email: 'o@x', contact_label: 'Owner email' },
  );
  assert.deepEqual(
    resolveCustomerContact({ billing_email: null, primary_email: null, owner_email: null }),
    { contact_email: null, contact_label: 'No contact email' },
  );
  assert.match(customerReadSource, /resolveCustomerContact\(/);
});

test('monthly_value_label is backend-prepared', () => {
  assert.equal(buildMonthlyValueLabel(99, 'ILS'), '99 ILS');
  assert.equal(buildMonthlyValueLabel(99, null), '99');
  assert.equal(buildMonthlyValueLabel(null, 'ILS'), '—');
  assert.match(customerReadSource, /buildMonthlyValueLabel\(/);
});

test('last_activity_label is backend-prepared with no-activity fallback', () => {
  assert.equal(buildLastActivityLabel('2026-06-19T09:00:00.000Z'), '2026-06-19T09:00:00.000Z');
  assert.equal(buildLastActivityLabel(null), 'No activity recorded');
  assert.match(customerReadSource, /buildLastActivityLabel\(/);
});

test('severity_label/tone/border_tone are backend-prepared', () => {
  assert.deepEqual(buildSeverityDisplay('critical'), {
    severity_label: 'Critical',
    severity_tone: 'critical',
    border_tone: 'critical',
  });
  assert.deepEqual(buildSeverityDisplay('warning'), {
    severity_label: 'Warning',
    severity_tone: 'warning',
    border_tone: 'warning',
  });
  assert.match(customerReadSource, /buildSeverityDisplay\(/);
});

test('customer health actions are descriptors only with kind + href (no command execution)', () => {
  const actions = buildCustomerHealthActions({
    issueKey: 'license_expired',
    organizationId: 'org-1',
    moduleKey: 'client-operations',
    contactEmail: 'billing@test.local',
  });
  const keys = actions.map((a) => a.action_key).sort();
  assert.deepEqual(keys, ['contact_customer', 'open_logs', 'open_organization', 'open_subscription']);
  for (const action of actions) {
    assert.equal(typeof action.enabled, 'boolean');
    assert.ok(action.kind === 'mailto' || action.kind === 'navigate' || action.kind === 'disabled');
    assert.ok('reason' in action);
    assert.ok('href' in action);
  }
  const contact = actions.find((a) => a.action_key === 'contact_customer');
  assert.equal(contact?.kind, 'mailto');
  assert.equal(contact?.href, 'mailto:billing@test.local');
  assert.equal(contact?.enabled, true);
  // Owner detail routes are not invented: open_* are disabled with a reason and no href.
  for (const key of ['open_organization', 'open_subscription', 'open_logs']) {
    const action = actions.find((a) => a.action_key === key);
    assert.equal(action?.kind, 'disabled');
    assert.equal(action?.enabled, false);
    assert.equal(action?.href, null);
    assert.ok(action?.reason && /not implemented yet/.test(action.reason));
  }
  const disabledContact = buildCustomerHealthActions({
    issueKey: 'delivery_failed',
    organizationId: 'org-1',
    moduleKey: 'delivery',
    contactEmail: null,
  }).find((a) => a.action_key === 'contact_customer');
  assert.equal(disabledContact?.enabled, false);
  assert.equal(disabledContact?.kind, 'disabled');
  assert.equal(disabledContact?.href, null);
  assert.equal(disabledContact?.reason, 'No contact email available.');
});

test('next_step is backend-prepared per problem type', () => {
  assert.equal(buildCustomerHealthNextStep('license_expired', 'warning').next_step_key, 'renew_subscription');
  assert.equal(buildCustomerHealthNextStep('entitlement_mismatch', 'warning').next_step_key, 'disable_unused_module');
  assert.equal(buildCustomerHealthNextStep('delivery_failed', 'warning').next_step_key, 'check_delivery_provider');
  assert.equal(buildCustomerHealthNextStep('pdf_render_failed', 'warning').next_step_key, 'retry_pdf');
  assert.equal(buildCustomerHealthNextStep('work_event_failed', 'warning').next_step_key, 'review_logs');
  const step = buildCustomerHealthNextStep('license_expired', 'critical');
  assert.equal(step.next_step_label, 'Renew subscription');
  assert.ok(step.next_step_description.length > 0);
  assert.equal(step.next_step_tone, 'critical');
  assert.match(customerReadSource, /buildCustomerHealthNextStep\(/);
});

test('compact display fields are backend-prepared', () => {
  for (const field of [
    'organization_display',
    'contact_display',
    'plan_display',
    'module_display',
    'problem_display',
    'reason_display',
    'recommended_action_display',
    'mrr_display',
    'last_activity_display',
    'since_display',
    'row_tone',
    'row_border_tone',
  ]) {
    assert.match(customerReadSource, new RegExp(field));
  }
});

test('filter_options are backend-prepared from unfiltered rows', () => {
  const aggregate = buildOwnerSystemHealthAggregate({
    lastCheckedAt: '2026-06-19T10:00:00.000Z',
    sourceNotes: [],
    legacyRows: [],
    platformHealthRows: [],
    customerHealthRows: [
      makeCustomerRow(),
      makeCustomerRow({
        id: 'row-2',
        organization_id: 'org-2',
        module_key: 'income',
        problem: 'PDF render failed',
        problem_type: 'pdf_render_failed',
        severity: 'critical',
        severity_label: 'Critical',
        severity_tone: 'critical',
        border_tone: 'critical',
      }),
    ],
  });
  const options = aggregate.customer_health.filter_options;
  assert.deepEqual(options.severities.map((o) => o.value), ['critical', 'warning']);
  assert.deepEqual(options.modules.map((o) => o.value).sort(), ['client-operations', 'income']);
  assert.deepEqual(options.statuses.map((o) => o.value), ['open']);
  assert.deepEqual(options.problem_types.map((o) => o.value).sort(), ['license_expired', 'pdf_render_failed']);
});

test('backend filters customer rows when filters supplied; options remain from full set', () => {
  const rows = [
    makeCustomerRow(),
    makeCustomerRow({
      id: 'row-2',
      organization_id: 'org-2',
      module_key: 'income',
      problem: 'PDF render failed',
      problem_type: 'pdf_render_failed',
      severity: 'critical',
      severity_label: 'Critical',
      severity_tone: 'critical',
      border_tone: 'critical',
    }),
  ];
  const filtered = buildOwnerSystemHealthAggregate({
    lastCheckedAt: '2026-06-19T10:00:00.000Z',
    sourceNotes: [],
    legacyRows: [],
    platformHealthRows: [],
    customerHealthRows: rows,
    customerFilters: { severity: 'critical', module: null, status: null, problem_type: null },
  });
  assert.equal(filtered.customer_health.rows.length, 1);
  assert.equal(filtered.customer_health.rows[0]!.organization_id, 'org-2');
  assert.equal(filtered.customer_health.applied_filters.severity, 'critical');
  assert.equal(filtered.customer_health.summary.total_rows, 1);
  assert.equal(filtered.customer_health.filter_options.severities.length, 2);
});

test('customer health summary_cards are backend-computed', () => {
  const aggregate = buildOwnerSystemHealthAggregate({
    lastCheckedAt: '2026-06-19T10:00:00.000Z',
    sourceNotes: [],
    legacyRows: [],
    platformHealthRows: [],
    customerHealthRows: [
      makeCustomerRow(),
      makeCustomerRow({
        id: 'row-2',
        organization_id: 'org-2',
        module_key: 'income',
        problem_type: 'pdf_render_failed',
        severity: 'critical',
        monthly_value: 150,
        monthly_value_currency: 'ILS',
      }),
    ],
  });
  const cards = aggregate.customer_health.summary_cards;
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c.value]));
  assert.equal(byKey.organizations_with_issues, '2');
  assert.equal(byKey.critical, '1');
  assert.equal(byKey.warnings, '1');
  assert.equal(byKey.revenue_at_risk, '249 ILS');
  assert.equal(byKey.missing_contacts, '0');
});

test('missing contact increments Missing contacts card', () => {
  const aggregate = buildOwnerSystemHealthAggregate({
    lastCheckedAt: '2026-06-19T10:00:00.000Z',
    sourceNotes: [],
    legacyRows: [],
    platformHealthRows: [],
    customerHealthRows: [
      makeCustomerRow({ id: 'r1', organization_id: 'org-1', contact_email: null }),
      makeCustomerRow({ id: 'r2', organization_id: 'org-2' }),
    ],
  });
  const missing = aggregate.customer_health.summary_cards.find((c) => c.key === 'missing_contacts');
  assert.equal(missing?.value, '1');
});

test('revenue at risk is unavailable with an aggregate note when values are missing or mixed currency', () => {
  const noValue = buildOwnerSystemHealthAggregate({
    lastCheckedAt: '2026-06-19T10:00:00.000Z',
    sourceNotes: [],
    legacyRows: [],
    platformHealthRows: [],
    customerHealthRows: [makeCustomerRow({ monthly_value: null, monthly_value_currency: null })],
  });
  assert.equal(
    noValue.customer_health.summary_cards.find((c) => c.key === 'revenue_at_risk')?.value,
    '—',
  );
  assert.ok(noValue.source_notes.some((n) => n.source_key === 'customer_revenue_at_risk'));

  const mixed = buildOwnerSystemHealthAggregate({
    lastCheckedAt: '2026-06-19T10:00:00.000Z',
    sourceNotes: [],
    legacyRows: [],
    platformHealthRows: [],
    customerHealthRows: [
      makeCustomerRow({ id: 'r1', organization_id: 'o1', monthly_value: 99, monthly_value_currency: 'ILS' }),
      makeCustomerRow({ id: 'r2', organization_id: 'o2', monthly_value: 50, monthly_value_currency: 'USD' }),
    ],
  });
  assert.equal(mixed.customer_health.summary_cards.find((c) => c.key === 'revenue_at_risk')?.value, '—');
  assert.ok(mixed.source_notes.some((n) => n.source_key === 'customer_revenue_at_risk'));
});

test('frontend Customer Health renders backend fields, summary cards, and filters (render-only)', () => {
  assert.match(webSectionSource, /summary_cards/);
  assert.match(webSectionSource, /filter_options/);
  assert.match(webSectionSource, /customer_severity/);
  assert.match(webSectionSource, /customer_module/);
  assert.match(webSectionSource, /customer_status/);
  assert.match(webSectionSource, /customer_problem_type/);
  assert.match(webSectionSource, /organization_display/);
  assert.match(webSectionSource, /contact_display/);
  assert.match(webSectionSource, /module_display/);
  assert.match(webSectionSource, /plan_display/);
  assert.match(webSectionSource, /problem_display/);
  assert.match(webSectionSource, /next_step_label/);
  assert.match(webSectionSource, /mrr_display/);
  assert.match(webSectionSource, /last_activity_display/);
  assert.match(webSectionSource, /severity_label/);
  assert.match(webSectionSource, /row_border_tone/);
  assert.match(webSectionSource, /available_actions/);
  // mailto is rendered only from the backend descriptor href, never constructed on the client.
  assert.match(webSectionSource, /action\.href/);
  assert.doesNotMatch(webSectionSource, /mailto:\$\{/);
  // no local filtering / MRR / next-step computation
  assert.doesNotMatch(webSectionSource, /\.filter\(\(row\)/);
});

test('scheduler persisted source is reported as not included', () => {
  assert.match(platformReadSource, /buildSchedulerSourceNote/);
  assert.match(platformReadSource, /status:\s*'not_included'/);
  assert.match(platformReadSource, /No platform-wide persisted scheduler/);
});

test('service uses assertPlatformOwner and customer health is organization scoped', () => {
  assert.match(serviceSource, /assertPlatformOwner\(ctx\)/);
  assert.match(customerReadSource, /organization_id/);
});

test('no frontend files were added for owner system health', () => {
  const webApp = readFileSync(join(dir, '../../../web/src/App.tsx'), 'utf8');
  assert.doesNotMatch(webApp, /system-health/);
  assert.doesNotMatch(webApp, /platform-owner\/system/);
});

test('human-readable dictionary includes delivery, pdf, event version, entitlement, unknown', () => {
  assert.match(pureSource, /smtp_timeout/);
  assert.match(pureSource, /pdf_render_failed/);
  assert.match(pureSource, /event_schema_version_unsupported/);
  assert.match(pureSource, /entitlement_mismatch/);
  assert.match(pureSource, /unknown/);
});
