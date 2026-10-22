import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const migration191 = readFileSync(
  join(dir, '../../../../supabase/migrations/191_postgrest_rls_tenant_hardening.sql'),
  'utf8',
);
const migration192 = readFileSync(
  join(dir, '../../../../supabase/migrations/192_postgrest_select_lockdown.sql'),
  'utf8',
);
const migration = migration191;

test('RLS helper uses canonical organization_memberships and active users only', () => {
  assert.match(migration, /organization_memberships om/);
  assert.match(migration, /om\.status = 'active'/);
  assert.match(migration, /u\.status = 'active'/);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /not exists/);
});

test('recovery, idempotency, platform_settings and legal identity are locked from anon\/authenticated', () => {
  assert.match(migration, /platform_owner_password_recovery_challenges/);
  assert.match(migration, /work_engine_command_idempotency/);
  assert.match(migration, /revoke all on table public.platform_settings/);
  assert.match(migration, /organization_legal_identities/);
  assert.match(migration, /revoke insert, update, delete, truncate/);
});

test('first-party WEB has no PostgREST table client — Auth only', () => {
  const web = readFileSync(join(dir, '../../../web/src/lib/supabase.ts'), 'utf8');
  assert.match(web, /VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(web, /\.from\(/);
  const client = readFileSync(join(dir, '../../../web/src/api/client.ts'), 'utf8');
  assert.match(client, /Authorization.*Bearer/);
});

test('192 revokes leftover PostgREST SELECT and membership-helper EXECUTE', () => {
  assert.match(migration192, /revoke select on table public\.%I from anon, authenticated, public/);
  assert.match(migration192, /pg_views/);
  assert.match(
    migration192,
    /revoke all on function public\.organizations_for_current_auth_user\(\) from anon, authenticated, public/,
  );
  assert.doesNotMatch(migration192, /grant select/i);
  assert.doesNotMatch(migration192, /auth\.users/);
  assert.doesNotMatch(migration192, /storage\.objects/);
});
