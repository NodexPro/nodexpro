import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AppError } from '../../src/shared/errors.js';
import { assertPlatformOwner } from '../../src/shared/platform-owner.js';
import {
  auditPayloadHasSecret,
  capabilityRequiredForOwnerCommand,
  evaluateOwnerLegalCommandAccess,
  normalizeGrantedCapabilities,
  normalizeOwnerLegalEmail,
} from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import { isOwnerCountryLegalAccessAdminCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function professionalCtx() {
  return {
    user: {
      id: '00000000-0000-0000-0000-000000000099',
      authUserId: '00000000-0000-0000-0000-000000000099',
      email: 'tenant@example.com',
      fullName: null,
      status: 'active' as const,
      uiLanguage: 'en' as const,
    },
    membership: {
      organizationId: '00000000-0000-0000-0000-000000000088',
      userId: '00000000-0000-0000-0000-000000000099',
      roleId: 'r',
      roleCode: 'admin',
      permissions: ['*'],
    },
    organizationId: '00000000-0000-0000-0000-000000000088',
  };
}

const ilView = {
  kind: 'country_legal_maintainer' as const,
  capabilitiesByCountry: { IL: ['legal_knowledge.view'] },
};
const ilEditor = {
  kind: 'country_legal_maintainer' as const,
  capabilitiesByCountry: {
    IL: ['legal_knowledge.view', 'legal_knowledge.draft_create', 'legal_knowledge.draft_edit'],
  },
};
const ilActivator = {
  kind: 'country_legal_maintainer' as const,
  capabilitiesByCountry: {
    IL: ['legal_knowledge.view', 'legal_knowledge.draft_edit', 'legal_knowledge.activate'],
  },
};
const owner = { kind: 'platform_owner' as const, capabilitiesByCountry: {} };
const none = { kind: 'none' as const, capabilitiesByCountry: {} };

test('1-2 professional users cannot access owner admin commands or reuse tenant RBAC', () => {
  assert.equal(isOwnerCountryLegalAccessAdminCommand('approve_country_legal_access_request'), true);
  assert.equal(evaluateOwnerLegalCommandAccess(none, 'approve_country_legal_access_request', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(ilEditor, 'approve_country_legal_access_request', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(ilEditor, 'grant_country_legal_assignment', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'approve_country_legal_access_request', 'IL').ok, true);

  const ctx = professionalCtx();
  assert.throws(
    () => assertPlatformOwner(ctx),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test('3 pending request grants zero access', () => {
  assert.deepEqual(evaluateOwnerLegalCommandAccess(none, 'create_tax_source', 'IL'), {
    ok: false,
    code: 'OWNER_LEGAL_ACCESS_REQUIRED',
  });
  assert.equal(evaluateOwnerLegalCommandAccess(none, 'request_country_legal_access', 'IL').ok, true);
});

test('4-5 IL maintainer cannot read or mutate DE', () => {
  assert.deepEqual(evaluateOwnerLegalCommandAccess(ilEditor, 'create_tax_rule', 'DE'), {
    ok: false,
    code: 'OWNER_LEGAL_CAPABILITY_REQUIRED',
  });
  assert.equal(evaluateOwnerLegalCommandAccess(ilEditor, 'create_tax_rule', 'IL').ok, true);
  assert.equal(evaluateOwnerLegalCommandAccess(ilView, 'create_tax_rule', 'IL').ok, false);
});

test('6 view-only cannot edit', () => {
  assert.equal(evaluateOwnerLegalCommandAccess(ilView, 'create_tax_source', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(ilView, 'update_tax_rule_version_draft', 'IL').ok, false);
  assert.equal(capabilityRequiredForOwnerCommand('update_tax_rule_version_draft'), 'legal_knowledge.draft_edit');
  assert.equal(capabilityRequiredForOwnerCommand('create_tax_domain'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('create_tax_legal_node'), 'legal_sources.manage');
  assert.equal(capabilityRequiredForOwnerCommand('link_tax_rule_legal_node'), 'legal_knowledge.draft_edit');
  assert.equal(evaluateOwnerLegalCommandAccess(ilEditor, 'create_tax_domain', 'IL').ok, false);
});

test('7-8 draft editor cannot activate; activate is country-exact', () => {
  assert.equal(capabilityRequiredForOwnerCommand('activate_tax_rule_version'), 'legal_knowledge.activate');
  assert.deepEqual(evaluateOwnerLegalCommandAccess(ilEditor, 'activate_tax_rule_version', 'IL'), {
    ok: false,
    code: 'OWNER_LEGAL_ACTIVATE_REQUIRED',
  });
  assert.equal(evaluateOwnerLegalCommandAccess(ilActivator, 'activate_tax_rule_version', 'IL').ok, true);
  assert.deepEqual(evaluateOwnerLegalCommandAccess(ilActivator, 'activate_tax_rule_version', 'DE'), {
    ok: false,
    code: 'OWNER_LEGAL_ACTIVATE_REQUIRED',
  });
  const granted = normalizeGrantedCapabilities(['legal_knowledge.draft_edit']);
  assert.equal(granted.includes('legal_knowledge.view'), true);
  assert.equal(granted.includes('legal_knowledge.activate'), false);
});

test('9-10 revoked and suspended assignments are not active actors', () => {
  assert.equal(evaluateOwnerLegalCommandAccess(none, 'create_tax_source', 'IL').ok, false);
  const service = readRepo(
    'apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.service.ts',
  );
  assert.match(service, /const active = mine\.filter\(\(row\) => row\.status === 'active'\)/);
  assert.match(service, /\.in\('status', \['active', 'suspended'\]\)/);
  assert.doesNotMatch(service, /status === 'revoked'[\s\S]{0,40}capabilitiesByCountry/);
});

test('11 platform owner retains all-country authority', () => {
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'create_tax_source', 'DE').ok, true);
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'activate_tax_rule_version', 'IL').ok, true);
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'create_country', 'IL').ok, true);
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'disable_country', 'XA').ok, true);
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'enable_country', 'XA').ok, true);
  assert.equal(evaluateOwnerLegalCommandAccess(owner, 'update_country_localization', 'IL').ok, true);
  assert.equal(evaluateOwnerLegalCommandAccess(ilEditor, 'create_country', 'IL').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(ilEditor, 'disable_country', 'XA').ok, false);
  assert.equal(evaluateOwnerLegalCommandAccess(ilEditor, 'update_country_localization', 'IL').ok, false);
});

test('12 duplicate normalized email handling', () => {
  assert.equal(normalizeOwnerLegalEmail('  A@Example.COM '), 'a@example.com');
  const migration = readRepo('supabase/migrations/620_owner_country_legal_access.sql');
  assert.match(migration, /uq_owner_legal_access_request_pending_email/);
  assert.match(migration, /uq_owner_legal_assignment_live_email_country/);
});

test('13-14 assignment audit events contain no secrets', () => {
  const audit = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(audit, /OWNER_COUNTRY_LEGAL_ACCESS_REQUEST_CREATED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_INVITATION_CREATED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_ACCESS_REQUEST_APPROVED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_ACCESS_REQUEST_REJECTED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_ASSIGNMENT_CREATED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_COUNTRY_ADDED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_COUNTRY_REMOVED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_CAPABILITY_CHANGED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_ACTIVATE_GRANTED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_ACTIVATE_REMOVED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_ASSIGNMENT_SUSPENDED/);
  assert.match(audit, /OWNER_COUNTRY_LEGAL_ASSIGNMENT_REVOKED/);
  const commands = readRepo(
    'apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-commands.service.ts',
  );
  assert.match(commands, /auditPayloadHasSecret/);
  assert.doesNotMatch(commands, /passwordHash|refresh_token|service_role/);
  assert.equal(auditPayloadHasSecret({ action: 'assignment_created', target_email: 'a@b.com' }), false);
  assert.equal(auditPayloadHasSecret({ token: 'secret-value' }), true);
});

test('assertPlatformOwner success conditions are unchanged', () => {
  const src = readRepo('apps/api/src/shared/platform-owner.ts');
  const start = src.indexOf('export function assertPlatformOwner');
  const end = src.indexOf('export function isPlatformOwnerContext');
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.match(body, /PLATFORM_OWNER_NOT_CONFIGURED/);
  assert.match(body, /PLATFORM_OWNER_REQUIRED/);
  assert.match(body, /PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN/);
  assert.match(body, /ctx\.membership\?\.roleCode/);
  assert.doesNotMatch(body, /owner_country_legal_assignments/);
  assert.doesNotMatch(body, /legal_knowledge/);
});

test('owner command dispatch does not loosen commercial owner APIs', () => {
  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /commandName === 'request_country_legal_access'/);
  assert.match(routes, /isOwnerCountryLegalAccessAdminCommand/);
  assert.match(routes, /isOwnerLegalValueCommand/);
  assert.match(routes, /assertOwnerOrAuditFailure\(ctx, req\)/);
  assert.match(routes, /assertOwnerLegalWorkspaceOrAuditFailure/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);
  const pricing = routes.slice(routes.indexOf("router.get('/pricing'"));
  assert.match(pricing, /assertOwnerOrAuditFailure/);
});

test('country isolation is entity-first, not payload-trusted', () => {
  const resolve = readRepo(
    'apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-country-resolve.service.ts',
  );
  assert.match(resolve, /COUNTRY_MISMATCH/);
  assert.match(resolve, /Entity-first country resolution/);
  assert.match(resolve, /loadCountryFromRow\('tax_sources'/);
  assert.match(resolve, /loadCountryFromRow\('tax_rule_versions'/);
});

test('schema is owner-side and does not reuse tenant RBAC', () => {
  const migration = readRepo('supabase/migrations/620_owner_country_legal_access.sql');
  assert.match(migration, /owner_country_legal_assignments/);
  assert.match(migration, /legal_knowledge.activate/);
  assert.doesNotMatch(migration, /create table.*organization_memberships/i);
  assert.doesNotMatch(migration, /create table.*user_invitations/i);
  assert.doesNotMatch(migration, /insert into auth\.users/i);
  assert.match(migration, /revoke all on table public.owner_country_legal_assignments from anon, authenticated/i);
});
