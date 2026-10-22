import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(dir, '../../../../supabase/migrations/191_postgrest_rls_tenant_hardening.sql'),
  'utf8',
);

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
