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

test('DB health row is critical when ping fails', () => {
  const issue = resolveSystemHealthIssue('db_unreachable');
  assert.equal(issue.severity, 'critical');
  assert.match(readSource, /if \(!dbPing\.ok\)/);
  assert.match(readSource, /buildDbHealthRow\(\)/);
});

test('delivery failed rows query failed result only and group platform-wide', () => {
  assert.match(readSource, /from\('delivery_attempts'\)/);
  assert.match(readSource, /\.eq\('result',\s*'failed'\)/);
  assert.doesNotMatch(readSource, /\.eq\('result',\s*'sent'\)/);
});

test('income PDF failed rows use pdf_render_status failed only', () => {
  assert.match(readSource, /from\('income_documents'\)/);
  assert.match(readSource, /\.eq\('pdf_render_status',\s*'failed'\)/);
  assert.doesNotMatch(readSource, /\.eq\('pdf_render_status',\s*'rendered'\)/);
});

test('failed work_events are included with processing_status failed', () => {
  assert.match(readSource, /from\('work_events'\)/);
  assert.match(readSource, /\.eq\('processing_status',\s*'failed'\)/);
});

test('rows sanitize secrets and stack traces from failure reasons', () => {
  assert.equal(sanitizeFailureReason('password=abc123'), null);
  assert.equal(sanitizeFailureReason('Error\n    at Object.<anonymous>'), null);
  assert.equal(sanitizeFailureReason('smtp timeout while sending'), 'smtp timeout while sending');
  assert.match(pureSource, /sanitizeFailureReason/);
  assert.match(readSource, /sanitizeFailureReason\(row\.failure_reason\)/);
});

test('aggregate shape is UI-ready with summary rows and sections', () => {
  const aggregate = buildOwnerSystemHealthAggregate({
    lastCheckedAt: '2026-06-19T10:00:00.000Z',
    sourceNotes: [{ source_key: 'scheduler', status: 'not_included', reason: 'test' }],
    rows: [
      {
        id: 'delivery:income:email:timeout',
        module_key: 'income',
        area: 'delivery',
        issue_key: 'smtp_timeout',
        issue_label: 'Email provider timeout',
        severity: 'warning',
        status: 'open',
        count: 2,
        last_seen_at: '2026-06-19T09:00:00.000Z',
        possible_reason: 'smtp timeout',
        recommended_action: 'Check provider status and retry delivery.',
        source_key: 'delivery_attempts_failed',
        source_ref: 'email:timeout',
      },
    ],
  });
  assert.equal(aggregate.aggregate_key, 'owner_system_health_aggregate');
  assert.equal(aggregate.owner_panel.section_key, 'system');
  assert.equal(aggregate.owner_panel.parent_panel_route, '/platform-owner/legal-control');
  assert.equal(typeof aggregate.summary.total_open_issues, 'number');
  assert.equal(aggregate.summary.warning_count, 1);
  assert.ok(Array.isArray(aggregate.rows));
  assert.ok(Array.isArray(aggregate.sections));
  assert.equal(aggregate.sections[0]?.section_key, 'delivery');
});

test('scheduler persisted source is reported as not included', () => {
  assert.match(readSource, /buildSchedulerSourceNote/);
  assert.match(readSource, /status:\s*'not_included'/);
  assert.match(readSource, /No platform-wide persisted scheduler/);
});

test('service uses assertPlatformOwner and does not expose tenant org scope', () => {
  assert.match(serviceSource, /assertPlatformOwner\(ctx\)/);
  assert.doesNotMatch(readSource, /\.eq\('organization_id',\s*orgId\)/);
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
