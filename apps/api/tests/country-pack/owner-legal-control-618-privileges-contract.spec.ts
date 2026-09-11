import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/618_owner_legal_control_service_role_privileges.sql';
const sqlRaw = readFileSync(join(repoRoot, migrationRel), 'utf8');
const sql = sqlRaw.replace(/--[^\n]*/g, '');

const FROZEN = [
  'supabase/migrations/616_tax_advisory_runtime_core_privileges.sql',
  'supabase/migrations/617_tax_advisory_entitlement_runtime_privileges.sql',
] as const;

function gitDiff(rel: string): string {
  return execSync(`git diff -- ${rel}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function normalizeSql(input: string): string {
  return input.replace(/\s+/g, ' ').trim().toLowerCase();
}

function grantStatements(input: string): string[] {
  return [...input.matchAll(/grant\s+[\s\S]*?;/gi)].map((match) => normalizeSql(match[0]));
}

const grants = grantStatements(sql);

test('Owner Legal Control 618: file exists; 616-617 remain unchanged', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(
    readdirSync(join(repoRoot, 'supabase/migrations')).includes(
      '618_owner_legal_control_service_role_privileges.sql',
    ),
    true,
  );
  for (const file of FROZEN) {
    assert.equal(existsSync(join(repoRoot, file)), true, `${file} must still exist`);
    assert.equal(gitDiff(file), '', `${file} must remain unchanged`);
  }
});

test('Owner Legal Control 618: exact service_role SELECT grants for legal-control read', () => {
  assert.deepEqual(grants, [
    'grant select on table public.organizations to service_role;',
    'grant select on table public.module_plans to service_role;',
    'grant select on table public.audit_log to service_role;',
  ]);
});

test('Owner Legal Control 618: least privilege — no extra DML or tenant roles', () => {
  assert.equal(grants.length, 3);
  assert.doesNotMatch(sql, /grant\s+all\b/i);
  assert.doesNotMatch(sql, /grant\s+insert\b/i);
  assert.doesNotMatch(sql, /grant\s+update\b/i);
  assert.doesNotMatch(sql, /grant\s+delete\b/i);
  assert.doesNotMatch(sql, /grant\s+truncate\b/i);
  assert.doesNotMatch(sql, /\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql, /\bto\s+public\b/i);
});

test('Owner Legal Control 618: privileges only — no schema or RLS mutation', () => {
  assert.doesNotMatch(sql, /row level security/i);
  assert.doesNotMatch(sql, /create\s+policy/i);
  assert.doesNotMatch(sql, /alter\s+default\s+privileges/i);
  assert.doesNotMatch(sql, /create\s+table/i);
  assert.doesNotMatch(sql, /alter\s+table/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});
