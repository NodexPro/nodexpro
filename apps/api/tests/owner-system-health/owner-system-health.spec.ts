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
  resolveSystemHealthIssue,
  sanitizeFailureReason,
} from '../../src/domains/owner-system-health/owner-system-health.pure.js';

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

const legalControlSource = readFileSync(
  join(dir, '../../src/domains/country-pack/country-pack-read-models.service.ts'),
  'utf8',
);
const platformOwnerSource = readFileSync(join(dir, '../../src/shared/platform-owner.ts'), 'utf8');

test('route GET /system-health requires platform owner guard', () => {
  assert.match(routesSource, /router\.get\('\/system-health'/);
  assert.match(routesSource, /assertOwnerOrAuditFailure\(ctx, req\)/);
  assert.match(routesSource, /buildOwnerSystemHealthAggregate\(ctx\)/);
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
    customerHealthRows: [
      {
        id: 'customer:org:mod:issue',
        organization_id: 'org-1',
        organization_name: 'Acme',
        owner_name: 'Owner',
        primary_email: 'owner@test.local',
        billing_email: 'owner@test.local',
        subscription_plan: 'Standard',
        module_key: 'client-operations',
        problem: 'License expired',
        possible_reason: 'Subscription ended',
        recommended_action: 'Renew subscription.',
        severity: 'warning',
        status: 'open',
        since: '2026-06-01T00:00:00.000Z',
        monthly_value: 99,
        monthly_value_currency: 'ILS',
        last_activity_at: '2026-06-19T09:00:00.000Z',
        available_actions: [
          { action_key: 'renew_subscription', label: 'Renew subscription', enabled: true, reason: null },
        ],
      },
    ],
  });
  assert.equal(aggregate.aggregate_key, 'owner_system_health_aggregate');
  assert.equal(aggregate.owner_panel.section_key, 'system');
  assert.equal(aggregate.platform_health.rows.length, 1);
  assert.equal(aggregate.customer_health.future_health_score, null);
  assert.equal(aggregate.customer_health.rows.length, 1);
  assert.equal(typeof aggregate.summary.total_open_issues, 'number');
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
