/**
 * P11.6A — Owner Clients aggregates contract tests.
 */

import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCountLabel,
  buildOwnerClientActions,
  buildOwnerClientListRow,
  buildOwnerClientsListAggregate,
  buildOwnerClientDetailAggregate,
  buildUsageLabel,
  NOT_MEASURED_LABEL,
  resolveHealthFromIssue,
} from '../../src/domains/owner-clients/owner-clients.pure.js';
import { resolveCustomerContact, buildMonthlyValueLabel } from '../../src/domains/owner-system-health/owner-system-health.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(join(dir, '../../src/routes/owner-country-pack.routes.ts'), 'utf8');
const serviceSource = readFileSync(join(dir, '../../src/domains/owner-clients/owner-clients.service.ts'), 'utf8');
const pureSource = readFileSync(join(dir, '../../src/domains/owner-clients/owner-clients.pure.ts'), 'utf8');
const readSource = readFileSync(join(dir, '../../src/domains/owner-clients/owner-clients.read.ts'), 'utf8');
const sharedReadSource = readFileSync(join(dir, '../../src/domains/owner-clients/owner-clients.shared-read.ts'), 'utf8');
const detailReadSource = readFileSync(join(dir, '../../src/domains/owner-clients/owner-clients-detail.read.ts'), 'utf8');
const platformOwnerSource = readFileSync(join(dir, '../../src/shared/platform-owner.ts'), 'utf8');

function makeListRow(overrides: Record<string, unknown> = {}) {
  return buildOwnerClientListRow({
    organization_id: 'org-1',
    organization_name: 'Acme',
    country_code: 'IL',
    country_label: 'Israel',
    owner_name: 'Owner',
    owner_email: 'owner@test.local',
    billing_email: 'billing@test.local',
    primary_email: 'primary@test.local',
    plan_label: 'Standard',
    mrr_value: 99,
    mrr_currency: 'ILS',
    active_modules: [
      {
        module_key: 'client-operations',
        label: 'Client Operations',
        status: 'active',
        entitlement_status: 'entitled',
        usage_label: buildUsageLabel('active', 'entitled'),
      },
    ],
    tenant_clients_count: 12,
    users_count: 3,
    documents_count: 45,
    last_activity_at: '2026-06-19T09:00:00.000Z',
    health_issue: null,
    ...overrides,
  });
}

test('GET /clients requires platform owner guard', () => {
  assert.match(routesSource, /router\.get\('\/clients'/);
  assert.match(routesSource, /buildOwnerClientsListAggregate\(ctx,/);
  assert.match(routesSource, /assertOwnerOrAuditFailure\(ctx, req\)/);
});

test('GET /client-detail requires platform owner guard and organization_id', () => {
  assert.match(routesSource, /router\.get\('\/client-detail'/);
  assert.match(routesSource, /buildOwnerClientDetailAggregate\(ctx, organizationId\)/);
  assert.match(routesSource, /organization_id is required/);
});

test('tenant user cannot access owner clients aggregates', () => {
  assert.match(serviceSource, /assertPlatformOwner\(ctx\)/);
  assert.match(platformOwnerSource, /PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN/);
});

test('rows include backend-prepared labels', () => {
  const row = makeListRow();
  assert.equal(row.organization_display, 'Acme');
  assert.equal(row.mrr_label, '99 ILS');
  assert.equal(row.users_count_label, '3 users');
  assert.equal(row.tenant_clients_count_label, '12 clients');
  assert.equal(row.documents_count_label, '45 documents');
  assert.equal(row.time_spent_label, NOT_MEASURED_LABEL);
  assert.match(readSource, /buildOwnerClientListRow\(/);
});

test('contact_email is selected backend-side', () => {
  const row = makeListRow();
  assert.deepEqual(resolveCustomerContact({
    billing_email: 'billing@test.local',
    primary_email: 'primary@test.local',
    owner_email: 'owner@test.local',
  }), { contact_email: 'billing@test.local', contact_label: 'Billing email' });
  assert.equal(row.contact_email, 'billing@test.local');
  assert.equal(row.contact_label, 'Billing email');
});

test('active modules are backend-prepared with entitlement status', () => {
  assert.match(readSource, /entitlement_status/);
  assert.match(readSource, /computeEntitlementStatus/);
  const row = makeListRow();
  assert.equal(row.active_modules[0]!.entitlement_status, 'entitled');
  assert.equal(row.active_modules[0]!.usage_label, 'In use');
});

test('MRR labels are backend-prepared', () => {
  assert.equal(buildMonthlyValueLabel(99, 'ILS'), '99 ILS');
  const row = makeListRow({ mrr_value: null, mrr_currency: null });
  assert.equal(row.mrr_label, '—');
});

test('tenant clients count uses clients table with safe fallback label', () => {
  assert.match(sharedReadSource, /from\('clients'\)/);
  assert.match(sharedReadSource, /is_archived/);
  assert.equal(buildCountLabel(null, 'client', 'clients'), NOT_MEASURED_LABEL);
});

test('documents count uses income_documents with safe fallback label', () => {
  assert.match(sharedReadSource, /from\('income_documents'\)/);
  const row = makeListRow({ documents_count: null });
  assert.equal(row.documents_count_label, NOT_MEASURED_LABEL);
});

test('last activity label is backend-prepared', () => {
  assert.match(sharedReadSource, /loadLastActivityByOrg/);
  assert.match(sharedReadSource, /audit_log/);
  const row = makeListRow({ last_activity_at: null });
  assert.equal(row.last_activity_label, 'No activity recorded');
});

test('time spent returns Not measured yet when no persisted source', () => {
  assert.match(pureSource, /NOT_MEASURED_LABEL/);
  assert.doesNotMatch(sharedReadSource, /time_spent/);
  const row = makeListRow();
  assert.equal(row.time_spent_label, NOT_MEASURED_LABEL);
});

test('backend filters are applied with backend-prepared filter_options', () => {
  assert.match(routesSource, /req\.query\.country/);
  assert.match(routesSource, /req\.query\.health/);
  const aggregate = buildOwnerClientsListAggregate({
    rows: [
      makeListRow(),
      makeListRow({
        organization_id: 'org-2',
        organization_name: 'Beta',
        country_code: 'US',
        country_label: 'United States',
        health_issue: { issue_key: 'license_expired', issue_label: 'License expired', severity: 'warning' },
      }),
    ],
    filters: { country: 'US', plan: null, status: null, module: null, health: null },
  });
  assert.equal(aggregate.rows.length, 1);
  assert.equal(aggregate.rows[0]!.organization_id, 'org-2');
  assert.ok(aggregate.filter_options.countries.length >= 2);
  assert.equal(aggregate.applied_filters.country, 'US');
});

test('action descriptors are backend-prepared without commands', () => {
  const actions = buildOwnerClientActions('owner@test.local');
  assert.deepEqual(actions.map((a) => a.action_key), ['open_client_modal', 'contact_customer']);
  const modal = actions.find((a) => a.action_key === 'open_client_modal');
  assert.equal(modal?.kind, 'modal');
  assert.equal(modal?.enabled, true);
  assert.equal(modal?.href, null);
  const contact = actions.find((a) => a.action_key === 'contact_customer');
  assert.equal(contact?.kind, 'mailto');
  assert.equal(contact?.href, 'mailto:owner@test.local');
  assert.doesNotMatch(pureSource, /command/);
});

test('detail route returns modal-ready aggregate shape', () => {
  const detail = buildOwnerClientDetailAggregate({
    organization_id: 'org-1',
    organization_name: 'Acme',
    country_label: 'Israel',
    contact_email: 'owner@test.local',
    mrr_label: '99 ILS',
    health_status_label: 'Healthy',
    overview: { organization_display: 'Acme' },
    modules: [{ module_key: 'client-operations', module_label: 'Client Operations' }],
    billing: { mrr_label: '99 ILS', subscriptions: [] },
    users: [{ email: 'owner@test.local' }],
    usage: { time_spent_label: NOT_MEASURED_LABEL },
    health: { health_status_label: 'Healthy', issues: [] },
    logs: [],
  });
  assert.equal(detail.aggregate_key, 'owner_client_detail_aggregate');
  assert.equal(detail.tabs.length, 7);
  assert.match(detailReadSource, /buildOwnerClientDetailAggregate\(/);
  assert.match(detailReadSource, /ORGANIZATION_NOT_FOUND/);
});

test('detail route uses notFound for missing organization', () => {
  assert.match(detailReadSource, /notFound\('Organization not found'/);
});

test('no ambiguous organization_users → users embeds without FK hints', () => {
  assert.match(sharedReadSource, /users!organization_users_user_id_fkey/);
  assert.doesNotMatch(sharedReadSource, /users\(email/);
  assert.doesNotMatch(sharedReadSource, /users\(id, email/);
});

test('health and next step are backend-prepared from customer health issues', () => {
  const healthy = resolveHealthFromIssue({ issue_key: null, issue_label: null, severity: null });
  assert.equal(healthy.health_status, 'healthy');
  assert.equal(healthy.next_step_label, '—');
  const warning = resolveHealthFromIssue({
    issue_key: 'license_expired',
    issue_label: 'License expired',
    severity: 'warning',
  });
  assert.equal(warning.health_status, 'warning');
  assert.equal(warning.next_step_label, 'Renew subscription');
  assert.match(sharedReadSource, /loadCustomerHealthRows/);
});

test('summary cards metrics are backend-computed', () => {
  const aggregate = buildOwnerClientsListAggregate({
    rows: [
      makeListRow(),
      makeListRow({
        organization_id: 'org-2',
        contact_email: null,
        billing_email: null,
        primary_email: null,
        owner_email: null,
        mrr_value: 50,
        mrr_currency: 'ILS',
        active_modules: [
          {
            module_key: 'income',
            label: 'Income',
            status: 'active',
            entitlement_status: 'expired',
            usage_label: 'Active, not entitled',
          },
        ],
        health_issue: { issue_key: 'license_expired', issue_label: 'License expired', severity: 'warning' },
      }),
    ],
  });
  assert.equal(aggregate.summary.total_organizations, 2);
  assert.equal(aggregate.summary.missing_contacts_count, 1);
  assert.equal(aggregate.summary.total_mrr_label, '149 ILS');
  assert.equal(aggregate.summary.revenue_at_risk_label, '50 ILS');
});

test('no frontend files changed for owner clients', () => {
  const webApp = readFileSync(join(dir, '../../../web/src/App.tsx'), 'utf8');
  const legalControl = readFileSync(join(dir, '../../../web/src/pages/PlatformOwnerLegalControl.tsx'), 'utf8');
  assert.doesNotMatch(webApp, /owner\/clients/);
  assert.doesNotMatch(legalControl, /owner\/clients/);
  assert.doesNotMatch(legalControl, /OwnerClients/);
});
