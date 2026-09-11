import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const migrationRel = 'supabase/migrations/619_owner_legal_control_missing_read_objects.sql';
const sqlRaw = readFileSync(join(repoRoot, migrationRel), 'utf8');
const sql = sqlRaw.replace(/--[^\n]*/g, '');

const FROZEN = [
  'supabase/migrations/618_owner_legal_control_service_role_privileges.sql',
  'supabase/migrations/097_platform_settings_email_provider.sql',
  'supabase/migrations/104_docflow_structured_document_requests.sql',
  'supabase/migrations/105_owner_commercial_controls.sql',
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

test('Owner Legal Control 619: file exists; 097/104/105/618 remain unchanged', () => {
  assert.equal(existsSync(join(repoRoot, migrationRel)), true);
  assert.equal(
    readdirSync(join(repoRoot, 'supabase/migrations')).includes(
      '619_owner_legal_control_missing_read_objects.sql',
    ),
    true,
  );
  for (const file of FROZEN) {
    assert.equal(existsSync(join(repoRoot, file)), true, `${file} must still exist`);
    assert.equal(gitDiff(file), '', `${file} must remain unchanged`);
  }
});

test('Owner Legal Control 619: creates the four missing legal-control read tables', () => {
  assert.match(sql, /create table if not exists public\.platform_settings/i);
  assert.match(sql, /create table if not exists public\.docflow_request_template_definitions/i);
  assert.match(sql, /create table if not exists public\.docflow_request_template_definition_items/i);
  assert.match(sql, /create table if not exists public\.org_module_pricing_adjustments/i);
  assert.doesNotMatch(sql, /client_messages/);
});

test('Owner Legal Control 619: exact service_role SELECT grants', () => {
  assert.deepEqual(grants, [
    'grant select on table public.platform_settings to service_role;',
    'grant select on table public.docflow_request_template_definitions to service_role;',
    'grant select on table public.docflow_request_template_definition_items to service_role;',
    'grant select on table public.org_module_pricing_adjustments to service_role;',
  ]);
});

test('Owner Legal Control 619: least privilege and no tenant roles', () => {
  assert.equal(grants.length, 4);
  assert.doesNotMatch(sql, /grant\s+all\b/i);
  assert.doesNotMatch(sql, /grant\s+insert\b/i);
  assert.doesNotMatch(sql, /grant\s+update\b/i);
  assert.doesNotMatch(sql, /grant\s+delete\b/i);
  assert.doesNotMatch(sql, /\bto\s+anon\b/i);
  assert.doesNotMatch(sql, /\bto\s+authenticated\b/i);
  assert.doesNotMatch(sql, /\bto\s+public\b/i);
  assert.match(sql, /notify pgrst/i);
});
