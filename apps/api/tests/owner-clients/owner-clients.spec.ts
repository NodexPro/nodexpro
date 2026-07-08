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
  formatOwnerClientActivityLabel,
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

test('P11.6B UI: Legal Control does not load /owner/clients on initial mount', () => {
  const legalControl = readFileSync(join(dir, '../../../web/src/pages/PlatformOwnerLegalControl.tsx'), 'utf8');
  assert.doesNotMatch(legalControl, /OWNER\.clients/);
  assert.match(legalControl, /ownerTopSection === 'clients' \? <OwnerClientsSection/);
});

const clientsSectionSource = readFileSync(join(dir, '../../../web/src/pages/OwnerClientsSection.tsx'), 'utf8');
const clientsModalSource = readFileSync(join(dir, '../../../web/src/pages/OwnerClientDetailModal.tsx'), 'utf8');
const legalControlUiSource = readFileSync(join(dir, '../../../web/src/pages/PlatformOwnerLegalControl.tsx'), 'utf8');
const webAppSource = readFileSync(join(dir, '../../../web/src/App.tsx'), 'utf8');

test('P11.6B UI: Clients tab lazy-loads /owner/clients aggregate', () => {
  assert.match(clientsSectionSource, /OWNER\.clients/);
  assert.match(clientsSectionSource, /Data loads only when this tab is opened/);
});

test('P11.6B UI: filters reload aggregate with backend query params', () => {
  assert.match(clientsSectionSource, /params\.set\('country'/);
  assert.match(clientsSectionSource, /params\.set\('plan'/);
  assert.match(clientsSectionSource, /params\.set\('status'/);
  assert.match(clientsSectionSource, /params\.set\('module'/);
  assert.match(clientsSectionSource, /params\.set\('health'/);
  assert.match(clientsSectionSource, /filter_options/);
});

test('P11.6B UI: no client-side row filtering', () => {
  assert.doesNotMatch(clientsSectionSource, /\.filter\(\(row\)/);
  assert.match(clientsSectionSource, /aggregate\?\.rows/);
});

test('P11.6B UI: table renders backend-prepared labels only', () => {
  assert.match(clientsSectionSource, /organization_display/);
  assert.match(clientsSectionSource, /country_label/);
  assert.match(clientsSectionSource, /mrr_label/);
  assert.match(clientsSectionSource, /modules_count_label/);
  assert.match(clientsSectionSource, /tenant_clients_count_label/);
  assert.match(clientsSectionSource, /users_count_label/);
  assert.match(clientsSectionSource, /documents_count_label/);
  assert.match(clientsSectionSource, /last_activity_label/);
  assert.match(clientsSectionSource, /health_status_label/);
  assert.match(clientsSectionSource, /next_step_label/);
});

test('P11.6B UI: row click and open_client_modal lazy-load client detail', () => {
  assert.match(clientsSectionSource, /openModal\(row\.organization_id\)/);
  assert.match(clientsSectionSource, /action\.kind === 'modal'/);
  assert.match(clientsModalSource, /OWNER\.clientDetail/);
});

test('P11.6B UI: modal renders backend tabs and sections', () => {
  assert.match(clientsModalSource, /aggregate\.tabs/);
  assert.match(clientsModalSource, /activeTab === 'overview'/);
  assert.match(clientsModalSource, /activeTab === 'modules'/);
  assert.match(clientsModalSource, /activeTab === 'billing'/);
  assert.match(clientsModalSource, /activeTab === 'users'/);
  assert.match(clientsModalSource, /activeTab === 'usage'/);
  assert.match(clientsModalSource, /activeTab === 'health'/);
  assert.match(clientsModalSource, /activeTab === 'logs'/);
  assert.match(clientsModalSource, /header\?\.organization_display/);
});

test('P11.6B UI: no separate /platform-owner/clients route', () => {
  assert.doesNotMatch(webAppSource, /platform-owner\/clients/);
});

test('P11.6B UI: actions render descriptor kinds modal, mailto, disabled', () => {
  assert.match(clientsSectionSource, /action\.kind === 'mailto'/);
  assert.match(clientsSectionSource, /action\.kind === 'modal'/);
  assert.match(clientsSectionSource, /action\.href/);
  assert.match(clientsSectionSource, /disabled=\{!action\.enabled\}/);
});

test('P11.6B UI: no owner commands are called from Clients UI', () => {
  assert.doesNotMatch(clientsSectionSource, /OWNER\.command/);
  assert.doesNotMatch(clientsModalSource, /OWNER\.command/);
  assert.doesNotMatch(clientsSectionSource, /onSubmit/);
  assert.doesNotMatch(legalControlUiSource, /OWNER\.clients/);
});

test('P11.6 fix: list returns exactly one row per organization', () => {
  const duplicated = [
    makeListRow(),
    makeListRow(), // same organization_id 'org-1'
    makeListRow({ organization_id: 'org-2', organization_name: 'Beta' }),
  ];
  const aggregate = buildOwnerClientsListAggregate({ rows: duplicated });
  const orgIds = aggregate.rows.map((r) => r.organization_id);
  assert.equal(orgIds.length, new Set(orgIds).size);
  assert.equal(aggregate.rows.length, 2);
});

test('P11.6 fix: total_organizations counts unique organizations, not rows', () => {
  const aggregate = buildOwnerClientsListAggregate({
    rows: [
      makeListRow(),
      makeListRow(),
      makeListRow({ organization_id: 'org-2', organization_name: 'Beta' }),
    ],
  });
  assert.equal(aggregate.summary.total_organizations, 2);
});

test('P11.6 fix: module filter still returns one row per organization', () => {
  const rows = [
    makeListRow({
      active_modules: [
        { module_key: 'income', label: 'Income', status: 'active', entitlement_status: 'entitled', usage_label: 'In use' },
        { module_key: 'client-operations', label: 'Client Operations', status: 'active', entitlement_status: 'entitled', usage_label: 'In use' },
      ],
    }),
    makeListRow(), // duplicate org-1
    makeListRow({
      organization_id: 'org-2',
      organization_name: 'Beta',
      active_modules: [
        { module_key: 'income', label: 'Income', status: 'active', entitlement_status: 'entitled', usage_label: 'In use' },
      ],
    }),
  ];
  const aggregate = buildOwnerClientsListAggregate({
    rows,
    filters: { country: null, plan: null, status: null, module: 'income', health: null },
  });
  const orgIds = aggregate.rows.map((r) => r.organization_id);
  assert.equal(orgIds.length, new Set(orgIds).size);
  assert.ok(orgIds.includes('org-1'));
  assert.ok(orgIds.includes('org-2'));
});

test('P11.6 fix: modules are summarized into count + label fields on each row', () => {
  const row = makeListRow({
    active_modules: [
      { module_key: 'income', label: 'Income', status: 'active', entitlement_status: 'entitled', usage_label: 'In use' },
      { module_key: 'client-operations', label: 'Client Operations', status: 'active', entitlement_status: 'trial', usage_label: 'In use' },
    ],
  });
  assert.equal(row.modules_count, 2);
  assert.equal(row.modules_count_label, '2 modules');
  assert.equal(row.active_modules_label, 'Income, Client Operations');
});

test('P11.6 fix: last_activity_label is a backend short date, not raw ISO', () => {
  assert.equal(formatOwnerClientActivityLabel('2026-07-08T09:30:00.000Z'), '08 Jul 2026');
  assert.equal(formatOwnerClientActivityLabel(null), 'No activity recorded');
  const row = makeListRow({ last_activity_at: '2026-07-08T09:30:00.000Z' });
  assert.equal(row.last_activity_label, '08 Jul 2026');
  // Row must not surface a raw ISO timestamp in the prepared label.
  assert.doesNotMatch(row.last_activity_label, /T\d\d:\d\d/);
});

test('P11.6 fix: frontend renders last_activity_label and does not format dates locally', () => {
  assert.match(clientsSectionSource, /row\.last_activity_label/);
  assert.doesNotMatch(clientsSectionSource, /last_activity_at/);
  assert.doesNotMatch(clientsSectionSource, /toLocaleDateString/);
  assert.doesNotMatch(clientsSectionSource, /new Date\(/);
});

test('P11.6 fix: frontend does not dedupe or group rows locally', () => {
  assert.doesNotMatch(clientsSectionSource, /new Set\(/);
  assert.doesNotMatch(clientsSectionSource, /\.reduce\(/);
  assert.doesNotMatch(clientsSectionSource, /groupBy/);
  assert.match(clientsSectionSource, /aggregate\?\.rows/);
});

test('P11.6 fix: detail modal still contains full module list', () => {
  const detail = buildOwnerClientDetailAggregate({
    organization_id: 'org-1',
    organization_name: 'Acme',
    country_label: 'Israel',
    contact_email: 'owner@test.local',
    mrr_label: '99 ILS',
    health_status_label: 'Healthy',
    overview: {},
    modules: [
      { module_key: 'income', module_label: 'Income', entitlement_status: 'entitled' },
      { module_key: 'client-operations', module_label: 'Client Operations', entitlement_status: 'trial' },
    ],
    billing: { subscriptions: [] },
    users: [],
    usage: {},
    health: { issues: [] },
    logs: [],
  });
  assert.equal(detail.modules.length, 2);
  assert.match(clientsModalSource, /activeTab === 'modules'/);
  assert.match(clientsModalSource, /aggregate\.modules/);
});
