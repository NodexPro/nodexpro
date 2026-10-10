/**
 * Stage 5.6 — Users & Roles owner management.
 * Pure rules + source contracts (no live Supabase env). Database behaviour of migration 187 is
 * validated separately on a disposable PostgreSQL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildClientAccessProjection,
  buildModuleAccessProjection,
  computeMemberActions,
  hasCloseAccessBlockers,
  normalizeMemberProfileInput,
  normalizeOptionalText,
  resolveInvitationStatus,
  resolveMemberDisplayName,
  resolveMemberStatus,
  resolveRoleLabel,
  toDateOnly,
} from '../../src/domains/memberships/users-roles.pure.js';
import {
  classifyModule,
  projectModuleAssignability,
  type ModuleCatalogRow,
} from '../../src/domains/modules/member-module-assignability.pure.js';
import {
  buildClientAccessPayload,
  buildModuleAccessPayload,
  fillCount,
  filterCatalogClients,
  initialModuleDraft,
  toggleSelected,
  uiText,
} from '../../../web/src/components/users-roles/users-roles-selection.pure.js';
import {
  buildUsersRolesUi,
  closeAccessBlockedMessageFor,
  resolveUsersRolesPresentation,
  USERS_ROLES_TEXT,
} from '../../src/domains/memberships/users-roles-locale.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readRepo = (rel: string): string => readFileSync(join(root, rel), 'utf8');
const api = (rel: string): string => readRepo(`apps/api/src/${rel}`);
const web = (rel: string): string => readRepo(`apps/web/src/${rel}`);

const OWNER = { actorRoleCode: 'owner', actorCanWriteMembers: true, actorCanRevokeAccess: true, actorUserId: 'u-owner' };
const ADMIN = { actorRoleCode: 'admin', actorCanWriteMembers: true, actorCanRevokeAccess: false, actorUserId: 'u-admin' };
const STAFF = { actorRoleCode: 'staff', actorCanWriteMembers: false, actorCanRevokeAccess: false, actorUserId: 'u-staff' };
const VIEWER = { actorRoleCode: 'viewer', actorCanWriteMembers: false, actorCanRevokeAccess: false, actorUserId: 'u-viewer' };
const target = (role: string, status = 'active', userId = 'u-target') => ({
  targetRoleCode: role,
  targetStatus: status,
  targetUserId: userId,
});

// 1–2. Authorization: Owner/Admin manage, Staff/Viewer denied.
test('1. Owner manages employees', () => {
  const a = computeMemberActions({ ...OWNER, ...target('staff') });
  assert.deepEqual(a, {
    edit_profile: true,
    manage_clients: true,
    manage_modules: true,
    close_access: true,
    change_role: false,
  });
});

test('2. Admin manages employees but cannot close access; Staff/Viewer get no actions', () => {
  const admin = computeMemberActions({ ...ADMIN, ...target('viewer') });
  assert.equal(admin.manage_clients, true);
  assert.equal(admin.manage_modules, true);
  assert.equal(admin.edit_profile, true);
  assert.equal(admin.close_access, false);
  for (const actor of [STAFF, VIEWER]) {
    const none = computeMemberActions({ ...actor, ...target('staff') });
    assert.ok(Object.values(none).every((v) => v === false));
  }
});

test('3. Owner/Admin targets: no client/module checkboxes; Admin cannot edit the Owner; Owner cannot be closed', () => {
  const ownerOnAdmin = computeMemberActions({ ...OWNER, ...target('admin') });
  assert.equal(ownerOnAdmin.manage_clients, false);
  assert.equal(ownerOnAdmin.manage_modules, false);
  assert.equal(ownerOnAdmin.edit_profile, true);
  assert.equal(ownerOnAdmin.close_access, true);
  const adminOnOwner = computeMemberActions({ ...ADMIN, ...target('owner') });
  assert.equal(adminOnOwner.edit_profile, false);
  const ownerOnOwner = computeMemberActions({ ...OWNER, ...target('owner', 'active', 'u-owner') });
  assert.equal(ownerOnOwner.close_access, false);
});

test('4. Cannot close own access; closed members get no management actions', () => {
  assert.equal(computeMemberActions({ ...OWNER, ...target('staff', 'active', 'u-owner') }).close_access, false);
  const closed = computeMemberActions({ ...OWNER, ...target('staff', 'revoked') });
  assert.ok(Object.values(closed).every((v) => v === false));
});

// Profile editing + display fallback.
test('5. Profile input is normalized: whitespace collapsed, empty → null, unchanged fields omitted', () => {
  assert.equal(normalizeOptionalText('  Yossi   Levi \n'), 'Yossi Levi');
  assert.equal(normalizeOptionalText('   '), null);
  const r = normalizeMemberProfileInput({ first_name: '  Dana ', last_name: '', phone: ' 050 123 4567 ' });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.patch.first_name, 'Dana');
    assert.equal(r.patch.last_name, null);
    assert.equal(r.patch.phone, '050 123 4567');
  }
  const partial = normalizeMemberProfileInput({ first_name: 'Dana' });
  assert.ok(partial.ok);
  if (partial.ok) assert.equal(partial.patch.phone, undefined);
});

test('6. Profile validation mirrors migration 187 limits', () => {
  assert.equal(normalizeMemberProfileInput({}).ok, false);
  assert.equal(normalizeMemberProfileInput({ first_name: 'a'.repeat(81) }).ok, false);
  assert.equal(normalizeMemberProfileInput({ first_name: 'a'.repeat(80) }).ok, true);
  assert.equal(normalizeMemberProfileInput({ phone: '123' }).ok, false);
  assert.equal(normalizeMemberProfileInput({ phone: '1'.repeat(33) }).ok, false);
  assert.equal(normalizeMemberProfileInput({ phone: 'abc12345' }).ok, false);
  assert.equal(normalizeMemberProfileInput({ phone: '+972-50-123-4567' }).ok, true);
});

test('7. Display name fallback: structured → users.full_name → email; never parses full_name', () => {
  assert.equal(
    resolveMemberDisplayName({ firstName: 'Yossi', lastName: 'Levi', fullName: 'Someone Else', email: 'a@b.c' }),
    'Yossi Levi',
  );
  assert.equal(resolveMemberDisplayName({ firstName: 'Yossi', fullName: 'Yossi Levi Mizrahi', email: 'a@b.c' }), 'Yossi');
  assert.equal(resolveMemberDisplayName({ fullName: 'Dana Cohen', email: 'a@b.c' }), 'Dana Cohen');
  assert.equal(resolveMemberDisplayName({ fullName: '  ', email: 'a@b.c' }), 'a@b.c');
  const pure = api('domains/memberships/users-roles.pure.ts');
  assert.doesNotMatch(pure, /full_?name\s*\.\s*split|split\(\s*['"`]\s/);
});

test('8. Start date is date-only (organization timezone) and membership status is labelled by backend', () => {
  assert.equal(toDateOnly('2026-03-05T22:30:00.000Z', 'Asia/Jerusalem'), '2026-03-06');
  assert.equal(toDateOnly('2026-03-05T22:30:00.000Z', 'UTC'), '2026-03-05');
  assert.equal(toDateOnly(null), null);
  assert.equal(toDateOnly('not-a-date'), null);
  assert.deepEqual(resolveMemberStatus('active'), { code: 'active', label: 'Active' });
  assert.deepEqual(resolveMemberStatus('invited'), { code: 'invited', label: 'Invited' });
  assert.deepEqual(resolveMemberStatus('revoked'), { code: 'access_closed', label: 'Access closed' });
  assert.equal(resolveRoleLabel('staff'), 'Employee');
  assert.equal(resolveInvitationStatus('pending').label, 'Invited');
});

// Client access.
test('9. Client access projection: ALL, SELECTED, empty SELECTED, missing policy fails closed', () => {
  assert.deepEqual(buildClientAccessProjection({ applicable: true, policyMode: 'all', activeGrantCount: 7 }), {
    applicable: true,
    mode: 'all',
    selected_count: 0,
    summary: 'All clients',
  });
  const selected = buildClientAccessProjection({ applicable: true, policyMode: 'selected', activeGrantCount: 3 });
  assert.equal(selected.mode, 'selected');
  assert.equal(selected.selected_count, 3);
  const empty = buildClientAccessProjection({ applicable: true, policyMode: 'selected', activeGrantCount: 0 });
  assert.equal(empty.selected_count, 0);
  const missing = buildClientAccessProjection({ applicable: true, policyMode: null, activeGrantCount: 5 });
  assert.equal(missing.mode, 'selected');
  const office = buildClientAccessProjection({ applicable: false, policyMode: 'selected', activeGrantCount: 9 });
  assert.equal(office.applicable, false);
});

test('10. Client access payload: SELECTED empty is valid; ALL sends no ids; search is only a visual filter', () => {
  assert.deepEqual(buildClientAccessPayload('selected', new Set()), { access_mode: 'selected', selected_client_ids: [] });
  assert.deepEqual(buildClientAccessPayload('all', new Set(['c1'])), { access_mode: 'all', selected_client_ids: [] });
  assert.deepEqual(buildClientAccessPayload('selected', new Set(['c1', 'c2'])).selected_client_ids, ['c1', 'c2']);
  const clients = [
    { client_id: '1', display_name: 'Alpha Ltd', tax_id: '515' },
    { client_id: '2', display_name: 'Beta', tax_id: '999' },
  ];
  assert.equal(filterCatalogClients(clients, 'alp').length, 1);
  assert.equal(filterCatalogClients(clients, '999')[0]?.client_id, '2');
  assert.equal(filterCatalogClients(clients, '').length, 2);
  assert.deepEqual([...toggleSelected(new Set(['a']), 'a')], []);
});

// Module access.
const catalog = (rows: Partial<ModuleCatalogRow>[]): ModuleCatalogRow[] =>
  rows.map((r, i) => ({
    id: `m${i}`,
    code: `m${i}`,
    name: `Module ${i}`,
    route: `/m/${i}`,
    is_system: false,
    ...r,
  })) as unknown as ModuleCatalogRow[];

test('11. Module assignability: only user-facing modules are assignable; Work Engine never gets a checkbox', () => {
  const rows = catalog([
    { id: 'income', code: 'income', name: 'Income', route: '/m/income' },
    { id: 'we', code: 'work-engine', name: 'Work Engine', route: null, is_system: true },
  ]);
  assert.equal(classifyModule(rows[0]!), 'user_facing');
  assert.equal(classifyModule(rows[1]!), 'infrastructure');
  assert.deepEqual(buildModuleAccessPayload(
    [
      { module_id: 'income', member_assignable: true },
      { module_id: 'we', member_assignable: false },
    ],
    new Set(['income', 'we']),
  ), ['income']);
  assert.deepEqual([...initialModuleDraft([
    { module_id: 'a', member_assignable: true, member_enabled: true },
    { module_id: 'b', member_assignable: false, member_enabled: true },
    { module_id: 'c', member_assignable: true, member_enabled: false },
  ])], ['a']);
  void projectModuleAssignability;
});

test('12. Module access projection: summary names only enabled assignable modules; Owner/Admin show office modules', () => {
  const p = buildModuleAccessProjection({ applicable: true, enabledModules: [{ module_id: 'i', name: 'Income' }] });
  assert.equal(p.summary, 'Income');
  assert.equal(buildModuleAccessProjection({ applicable: true, enabledModules: [] }).summary, 'No modules');
  const office = buildModuleAccessProjection({ applicable: false, enabledModules: [{ module_id: 'i', name: 'Income' }] });
  assert.equal(office.applicable, false);
  assert.deepEqual(office.enabled_modules, []);
});

// Close access.
test('13. Close-access blockers are counted by the backend and rendered, never cleaned up by the UI', () => {
  assert.equal(hasCloseAccessBlockers({ handler_client_count: 0, open_todo_count: 0 }), false);
  assert.equal(hasCloseAccessBlockers({ handler_client_count: 2, open_todo_count: 0 }), true);
  assert.equal(hasCloseAccessBlockers({ handler_client_count: 0, open_todo_count: 1 }), true);
  // The sentence is built by the backend (localized); the UI renders `close_access.message` as-is.
  assert.equal(closeAccessBlockedMessageFor({ handler_client_count: 0, open_todo_count: 0 }, 'en'), null);
  assert.match(
    closeAccessBlockedMessageFor({ handler_client_count: 2, open_todo_count: 1 }, 'en')!,
    /2 clients.*1 open task\b/,
  );

  const rbac = api('domains/memberships/memberships-rbac.service.ts');
  assert.match(rbac, /assertNoCloseAccessBlockers\(orgId, targetUserId\)/);
  assert.match(rbac, /status === 'revoked'\) return \{ success: true \}/);
  const blockers = api('domains/memberships/member-close-access-blockers.service.ts');
  assert.match(blockers, /MEMBER_HAS_ACTIVE_RESPONSIBILITIES/);
  assert.doesNotMatch(blockers, /\.delete\(\)/); // history is never deleted
  assert.doesNotMatch(blockers, /\.update\(/); // no silent reassignment
});

// Route + command contracts.
test('14. Routes: office administration + permission on every users-roles read/command', () => {
  const routes = api('domains/memberships/memberships.routes.ts');
  assert.match(routes, /const withViewUsers = \[authMiddleware, requireOrg, requireOfficeAdministration, requirePermission\('view_users', 'members:read'\)\]/);
  for (const path of ['aggregates/users-roles', 'commands/set_member_profile', 'commands/close_member_access', 'commands/set_member_client_access', 'commands/set_member_module_access']) {
    assert.ok(routes.includes(path), `missing route ${path}`);
  }
  assert.match(routes, /requirePermission\('revoke_user_access', 'members:revoke'\)/);
  // Every route in the file is behind one of the guarded bundles.
  const bare = routes.match(/router\.(get|post|patch|delete)\(\s*'[^']+',\s*async/g) ?? [];
  assert.equal(bare.length, 0);
});

test('15. Commands return the refreshed aggregate; profile command audits and is org-scoped', () => {
  const routes = api('domains/memberships/memberships.routes.ts');
  assert.match(routes, /users_roles_aggregate = await buildUsersRolesAggregate/);
  const svc = api('domains/memberships/users-roles-aggregate.service.ts');
  assert.match(svc, /return buildUsersRolesAggregate\(ctx, orgId\);/);
  assert.match(svc, /AUDIT_ACTIONS\.MEMBER_PROFILE_SET/);
  assert.match(svc, /changed_fields/);
  assert.match(svc, /target_membership_id/);
  assert.match(svc, /target_user_id/);
  assert.match(svc, /\.eq\('organization_id', orgId\)\s*\.eq\('id', targetId\)/); // cross-org membership id never resolves
  assert.match(svc, /onConflict: 'membership_id'/);
  assert.match(svc, /maskPhone/); // phone is masked in audit payloads
  assert.match(api('shared/audit-events.ts'), /MEMBER_PROFILE_SET/);
});

test('16. Aggregate separates pending invitations from members and has no self-profile command', () => {
  const svc = api('domains/memberships/users-roles-aggregate.service.ts');
  assert.match(svc, /members: rows,\s*invitations,/);
  const routes = api('domains/memberships/memberships.routes.ts');
  assert.doesNotMatch(routes, /set_my_member_profile/);
  assert.doesNotMatch(svc, /set_my_member_profile/);
});

test('17. Role change stays display-only: no UI action, backend flag false, old route still office-guarded', () => {
  assert.equal(computeMemberActions({ ...OWNER, ...target('staff') }).change_role, false);
  const routes = api('domains/memberships/memberships.routes.ts');
  assert.match(routes, /const withChangeRole = \[[^\]]*requireOfficeAdministration[^\]]*requirePermission\('change_user_role', 'members:write'\)/s);
  const page = web('pages/UsersRoles.tsx');
  assert.doesNotMatch(page, /\/role['"`]/);
  assert.doesNotMatch(page, /change_role/);
});

// Migration 187 contract (database behaviour is validated on disposable PostgreSQL).
test('18. Migration 187 contract: composite FK, lengths, RLS forced, service_role only, no backfill', () => {
  const sql = readRepo('supabase/migrations/187_organization_member_profiles.sql');
  assert.match(sql, /membership_id uuid primary key/);
  assert.match(sql, /foreign key \(membership_id, organization_id\)\s+references public\.organization_memberships \(id, organization_id\)/);
  assert.match(sql, /unique \(id, organization_id\)/);
  assert.match(sql, /between 1 and 80/);
  assert.match(sql, /between 5 and 32/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on table public\.organization_member_profiles from anon, authenticated/);
  assert.match(sql, /to service_role/);
  assert.doesNotMatch(sql, /\binsert\s+into\b/i); // no backfill
  assert.doesNotMatch(sql, /alter table public\.(users|user_invitations)\b/i);
  assert.doesNotMatch(sql, /update\s+public\.users/i);
});

// Frontend must stay dumb.
test('19. Web has no authorization matrix, no role logic, no ids shown, no duplicate endpoints', () => {
  const files = [
    web('pages/UsersRoles.tsx'),
    web('components/users-roles/UsersRolesModals.tsx'),
    web('api/users-roles.ts'),
    web('components/users-roles/users-roles-selection.pure.ts'),
  ].join('\n');
  assert.doesNotMatch(files, /role\s*(===|!==|==|!=)\s*['"`]/);
  assert.doesNotMatch(files, /\.role\.code\s*(===|!==)/);
  assert.doesNotMatch(files, /permissions?\.(includes|has)\(/);
  assert.doesNotMatch(files, /['"`](staff|viewer|owner)['"`]\s*\)?\s*(\?|&&|\|\|)/);
  // Actions come from backend available_actions only.
  const page = web('pages/UsersRoles.tsx');
  assert.match(page, /available_actions\.edit_profile/);
  assert.match(page, /available_actions\.manage_clients/);
  assert.match(page, /available_actions\.manage_modules/);
  assert.match(page, /available_actions\.close_access/);
  // Ids are keys/params only, never rendered text.
  assert.doesNotMatch(page, />\s*\{[^}]*\b(member_id|user_id)\b[^}]*\}\s*</);
  // endpoints.ts (local WIP) is not used for the new endpoints.
  assert.match(web('api/users-roles.ts'), /commands\/set_member_profile/);
  assert.match(web('api/users-roles.ts'), /commands\/close_member_access/);
});

test('20. Web renders from returned truth: every command result replaces the aggregate', () => {
  const modals = web('components/users-roles/UsersRolesModals.tsx');
  assert.match(modals, /onSaved\(aggregate\)|onSaved\(/);
  assert.match(modals, /onClosed\(/);
  const page = web('pages/UsersRoles.tsx');
  assert.match(page, /setData\(/);
  assert.doesNotMatch(page, /setData\(\(prev\)[^)]*\.map\(/); // no local row mutation
});

test('21. Manage Modules uses the 5.5 assignability aggregate; no prices/plans/internal ids shown', () => {
  const m = web('components/users-roles/UsersRolesModals.tsx');
  assert.match(m, /fetchMemberModuleAssignability/);
  assert.match(m, /member_assignable/);
  assert.doesNotMatch(m, /price|plan_code|billing/i);
});

test('22. Invitations: invite / resend / cancel preserved; user_invitations migration untouched', () => {
  const page = web('pages/UsersRoles.tsx');
  assert.match(page, /orgMembersInvite/);
  assert.match(page, /orgInviteResend/);
  assert.match(page, /orgInviteRevoke/);
  const mig = readRepo('supabase/migrations/187_organization_member_profiles.sql');
  assert.doesNotMatch(mig, /(alter table|update|insert into|delete from)\s+public\.user_invitations/i);
});

test('23. Migrations 184-186 exist and 187 is the next additive migration', () => {
  const names = readdirSync(join(root, 'supabase/migrations'));
  for (const prefix of ['184', '185', '186', '187']) {
    assert.ok(names.some((n) => n.startsWith(`${prefix}_`)), `missing migration ${prefix}`);
  }
  assert.equal(names.filter((n) => n.startsWith('187_')).length, 1);
});

// Israel localization / RTL (backend-owned) and Manage Clients latency.
test('25. Presentation comes from the organization country only: Israel = Hebrew + RTL, others English + LTR', () => {
  assert.deepEqual(resolveUsersRolesPresentation('IL'), { locale: 'he', direction: 'rtl' });
  assert.deepEqual(resolveUsersRolesPresentation(' il '), { locale: 'he', direction: 'rtl' });
  for (const other of ['US', 'GB', 'DE', '', null, undefined]) {
    assert.deepEqual(resolveUsersRolesPresentation(other), { locale: 'en', direction: 'ltr' });
  }
  const il = buildUsersRolesUi('IL');
  assert.equal(il.direction, 'rtl');
  assert.equal(il.text.title, 'משתמשים והרשאות');
  assert.equal(buildUsersRolesUi('US').text.title, 'Users & Roles');

  const agg = api('domains/memberships/users-roles-aggregate.service.ts');
  assert.match(agg, /select\('timezone, country_code'\)/);
  assert.match(agg, /buildUsersRolesUi\(orgRow\?\.country_code\)/);
  for (const rel of ['pages/UsersRoles.tsx', 'components/users-roles/UsersRolesModals.tsx']) {
    const src = web(rel);
    assert.doesNotMatch(src, /navigator\.language|Accept-Language|i18n|\bcountry/i, `${rel}: no client-side locale truth`);
  }
  assert.match(web('pages/UsersRoles.tsx'), /dir=\{ui\?\.direction \?\? 'ltr'\}/);
  assert.match(web('components/users-roles/UsersRolesModals.tsx'), /dir=\{props\.ui\.direction\}/);
});

test('26. Hebrew and English dictionaries are complete, and the screens only use keys that exist', () => {
  const en = Object.keys(USERS_ROLES_TEXT.en).sort();
  const he = Object.keys(USERS_ROLES_TEXT.he).sort();
  assert.deepEqual(he, en);
  for (const value of Object.values(USERS_ROLES_TEXT.he)) assert.ok(value.trim().length > 0);

  const expectedHe: Record<string, string> = {
    title: 'משתמשים והרשאות',
    invite_member: 'הזמנת משתמש',
    name: 'שם',
    role: 'תפקיד',
    clients: 'לקוחות',
    modules: 'מודולים',
    start_date: 'תאריך התחלה',
    status: 'סטטוס',
    edit_details: 'עריכת פרטים',
    manage_clients: 'לקוחות',
    manage_modules: 'מודולים',
    close_access: 'סגירת גישה',
    invitations: 'הזמנות',
    first_name: 'שם פרטי',
    last_name: 'שם משפחה',
    phone: 'טלפון',
    save: 'שמירה',
    close: 'סגירה',
    all_clients: 'כל הלקוחות',
    selected_clients: 'לקוחות נבחרים',
    search_placeholder: 'חיפוש לפי שם או מספר מזהה',
  };
  for (const [key, text] of Object.entries(expectedHe)) assert.equal(USERS_ROLES_TEXT.he[key], text, key);
  assert.equal(resolveMemberStatus('active', 'he').label, 'פעיל');
  assert.equal(resolveRoleLabel('owner', 'he'), 'בעלים');
  assert.equal(buildClientAccessProjection({ applicable: false, policyMode: null, activeGrantCount: 0, locale: 'he' }).summary, 'כל הלקוחות');
  assert.equal(
    buildClientAccessProjection({ applicable: true, policyMode: 'selected', activeGrantCount: 3, locale: 'he' }).summary,
    'לקוחות נבחרים · 3',
  );
  assert.match(closeAccessBlockedMessageFor({ handler_client_count: 2, open_todo_count: 1 }, 'he')!, /2 לקוחות.*משימה פתוחה אחת/);

  const used = new Set<string>();
  for (const rel of ['pages/UsersRoles.tsx', 'components/users-roles/UsersRolesModals.tsx']) {
    const src = web(rel);
    for (const m of src.matchAll(/\b(?:T|t)\('([a-z_]+)'\)/g)) used.add(m[1]);
    for (const m of src.matchAll(/uiText\(\w+, '([a-z_]+)'\)/g)) used.add(m[1]);
  }
  assert.ok(used.size > 20);
  for (const key of used) assert.ok(key in USERS_ROLES_TEXT.en, `unknown ui text key: ${key}`);
  assert.equal(uiText({ locale: 'en', direction: 'ltr', text: { a: 'x' } }, 'a'), 'x');
  assert.equal(fillCount('{count} selected', 4), '4 selected');
  // The screens carry no hard-coded English labels any more.
  const page = web('pages/UsersRoles.tsx');
  for (const literal of ['Invite member', 'Edit details', 'Manage clients', 'Close access', 'Start date', 'Invitations']) {
    assert.ok(!page.includes(`>${literal}<`) && !page.includes(`${literal}\n`), `hard-coded: ${literal}`);
  }
});

test('27. Manage Clients editor reads its independent parts concurrently within the same aggregate', () => {
  const agg = api('domains/memberships/users-roles-aggregate.service.ts');
  const editor = agg.slice(agg.indexOf('export async function buildMemberClientAccessEditorAggregate'));
  assert.match(editor, /await Promise\.all\(\[\s*resolveOrganizationClientAccessScope\(/);
  assert.match(editor, /loadClientCatalog\(orgId\)/);
  // Authorization/target resolution still happens first and the catalog stays organization-scoped.
  assert.ok(editor.indexOf('loadTargetMembership') < editor.indexOf('Promise.all'));
  assert.match(agg, /\.eq\('organization_id', orgId\)\s*\.eq\('is_archived', false\)/);
});

test('24. organization_memberships has two FKs to users (user_id, invited_by): embeds must name user_id', () => {
  const migration021 = readRepo('supabase/migrations/021_rbac_organization_memberships.sql');
  assert.match(migration021, /user_id uuid not null references public\.users\(id\)/);
  assert.match(migration021, /invited_by uuid references public\.users\(id\)/);
  for (const rel of [
    'apps/api/src/domains/memberships/users-roles-aggregate.service.ts',
    'apps/api/src/domains/modules/member-module-access.service.ts',
    'apps/api/src/domains/memberships/memberships-rbac.service.ts',
  ]) {
    const src = readRepo(rel);
    assert.match(src, /users!organization_memberships_user_id_fkey\(/, `${rel}: explicit user_id relation`);
    // An unhinted `users(...)` embed on organization_memberships is ambiguous in PostgREST (PGRST201 -> 500).
    assert.doesNotMatch(
      src,
      /from\('organization_memberships'\)\s*\.select\(\s*'[^']*[ ,]users\(/,
      `${rel}: ambiguous users(...) embed on organization_memberships`,
    );
  }
});
