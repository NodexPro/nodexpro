/**
 * Users & Roles invite row + Clients toolbar: Create Client Deep Ocean V3 presentation.
 * Does not invent a second invite flow or rewrite CSV import/export.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const usersRolesSrc = read('../src/pages/UsersRoles.tsx');
const usersRolesCss = read('../src/components/users-roles/UsersRoles.css');
const clientsSrc = read('../src/pages/Clients.tsx');
const clientsCss = read('../src/styles/nx-clients.css');
const createOceanCss = read('../src/styles/nx-client-create-deep-ocean-glass.css');

test('Users & Roles keeps the existing invite command and aggregate', () => {
  assert.match(usersRolesSrc, /orgMembersInvite\(orgId\)/);
  assert.match(usersRolesSrc, /role_code: inviteRole \|\| data\?\.invite_roles\[0\]\?\.code/);
  assert.match(usersRolesSrc, /fetchUsersRolesAggregate/);
  assert.match(usersRolesSrc, /available_actions\.invite_member/);
  assert.match(usersRolesSrc, /orgInviteResend/);
  assert.match(usersRolesSrc, /orgInviteRevoke/);
  assert.doesNotMatch(usersRolesSrc, /method: 'PATCH'/);
  assert.equal((usersRolesSrc.match(/className="nx-ur-invite-form"/g) ?? []).length, 1);
});

test('Users & Roles invite row is compact: narrow email, wide role, stack on narrow', () => {
  assert.match(usersRolesSrc, /nx-ur-invite-form__email/);
  assert.match(usersRolesSrc, /nx-ur-invite-form__role/);
  assert.match(usersRolesSrc, /nx-ur-invite-form__actions/);
  assert.doesNotMatch(usersRolesSrc, /flex: '1 1 240px'/);
  assert.match(usersRolesCss, /\.nx-ur-invite-form__email \{[\s\S]*max-width:\s*220px/);
  assert.match(usersRolesCss, /\.nx-ur-invite-form__role \{[\s\S]*min-width:\s*240px/);
  assert.match(usersRolesCss, /\.nx-ur-invite-form \{[\s\S]*flex-wrap:\s*nowrap/);
  assert.match(usersRolesCss, /@media \(max-width: 860px\)/);
  assert.match(usersRolesCss, /\.nx-ur-invite-form__email,[\s\S]*max-width:\s*100%/);
});

test('Users & Roles invite controls reuse Create Client Deep Ocean V3 tokens', () => {
  assert.match(createOceanCss, /#102[Dd]49|#ffffff/);
  assert.match(createOceanCss, /rgba\(19, 191, 208, 0\.78\)/);
  assert.match(usersRolesCss, /\.nx-ur-btn--primary[\s\S]*color:\s*#ffffff/);
  assert.match(usersRolesCss, /\.nx-ur-btn--primary[\s\S]*rgba\(19, 191, 208, 0\.78\)/);
  assert.match(usersRolesCss, /\.nx-ur-btn--secondary[\s\S]*rgba\(54, 169, 198, 0\.58\)/);
  assert.match(usersRolesCss, /\.nx-ur-invite-form \.nx-ur-field option \{[\s\S]*background:\s*#102d49[\s\S]*color:\s*#ffffff/);
  assert.match(usersRolesCss, /\.nx-ur-invite-form \.nx-ur-field input:focus-visible[\s\S]*rgba\(19, 191, 208, 0\.92\)/);
  assert.match(usersRolesSrc, /nx-ur-btn--secondary/);
  assert.match(usersRolesCss, /rgba\(128, 116, 242, 0\.42\)/);
});

test('Clients toolbar applies Deep Ocean V3 without rewriting the table or CSV flow', () => {
  assert.match(clientsSrc, /nx-clients--deep-ocean/);
  assert.match(clientsSrc, /orgClientsImportPreview/);
  assert.match(clientsSrc, /orgClientsImport/);
  assert.match(clientsSrc, /orgClientsExport/);
  assert.match(clientsSrc, /accept="\.csv"/);
  assert.match(clientsSrc, /a\.download = 'clients-export\.csv'/);
  assert.match(clientsSrc, /setRefreshTrigger/);
  assert.doesNotMatch(clientsSrc, /method: 'PATCH'/);
  assert.match(clientsCss, /\.nx-clients-table/);
  assert.match(clientsCss, /\.nx-clients--deep-ocean \.nx-clients-toolbar \.nx-glass-btn--purple[\s\S]*#ffffff/);
  assert.match(clientsCss, /\.nx-clients--deep-ocean \.nx-clients-toolbar \.nx-glass-btn--secondary[\s\S]*rgba\(54, 169, 198, 0\.58\)/);
  assert.match(clientsCss, /\.nx-clients--deep-ocean \.nx-clients-toolbar \.nx-glass-input[\s\S]*#102d49/);
  assert.doesNotMatch(clientsCss, /\.nx-clients--deep-ocean \.nx-clients-table/);
});
