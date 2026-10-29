/**
 * Case GET runs annual_report + capital_declaration ensureProfile in parallel.
 * Unique index uq_client_annual_report_profiles_org_client_scope is (org, client, tab_scope).
 * Probe must hit the real table; 23505 must re-select, not leak to the UI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const annualSrc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-annual-report-tab.service.ts'),
  'utf8',
);
const caseSrc = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const indexSrc = readFileSync(join(dir, '../../src/index.ts'), 'utf8');

test('case GET hydrates both annual scopes in parallel through ensureProfile', () => {
  assert.match(caseSrc, /getAnnualTabReadModel\(ctx, clientId\)/);
  assert.match(caseSrc, /getAnnualTabReadModel\(ctx, clientId, 'capital_declaration'\)/);
  assert.match(annualSrc, /async function ensureProfile/);
  assert.match(annualSrc, /isSupabaseUniqueViolation\(error\)/);
  assert.match(annualSrc, /tab_scope: scope/);
});

test('tab_scope support is probed on the real table, not information_schema', () => {
  assert.match(annualSrc, /from\('client_annual_report_profiles'\)\.select\('tab_scope'\)\.limit\(0\)/);
  assert.doesNotMatch(annualSrc, /\.from\(['"]information_schema/);
  assert.match(annualSrc, /isSupabaseMissingColumnError\(error, 'tab_scope'\)/);
});

test('unique violation on profile insert re-selects the existing row instead of failing the case', () => {
  assert.match(annualSrc, /if \(error && isSupabaseUniqueViolation\(error\)\)/);
  assert.match(annualSrc, /const raced = await loadAnnualProfile/);
  assert.match(annualSrc, /if \(insertErr && isSupabaseUniqueViolation\(insertErr\)\) return/);
  assert.match(annualSrc, /throw annualDbError\(/);
  assert.doesNotMatch(
    annualSrc,
    /throw new AppError\(500, error\.message/,
  );
});

test('HTTP middleware sanitizes Postgres messages and strips pg_* details', () => {
  assert.match(indexSrc, /publicSafeErrorMessage\(err\.message\)/);
  assert.match(indexSrc, /publicErrorDetails\(err\.details\)/);
  assert.match(indexSrc, /\[api\]\[DB_ERROR_SANITIZED\]/);
  assert.match(indexSrc, /looksLikePostgresErrorMessage\(raw\)/);
});

test('create_core_client is an allowed_action gated by office role + clients:write', () => {
  assert.match(caseSrc, /actions\.push\('create_core_client'\)/);
  assert.match(caseSrc, /roleHasOfficeClientAccess\(ctx\.membership\?\.roleCode\)/);
  assert.match(caseSrc, /permissions\.includes\('clients:write'\)/);
  assert.match(caseSrc, /coalesceContactField/);
  assert.match(caseSrc, /email: client\.email \?\? null/);
  assert.match(caseSrc, /phone: client\.phone \?\? null/);
});
