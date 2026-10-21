/**
 * Clients CSV import/export contract. Source + route checks only — no rewrite of working logic.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const readRepo = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const svc = readRepo('apps/api/src/domains/clients/client-import-export.service.ts');
const routes = readRepo('apps/api/src/domains/clients/clients.routes.ts');
const clientsPage = readRepo('apps/web/src/pages/Clients.tsx');
const endpoints = readRepo('apps/web/src/api/endpoints.ts');

const parseCsv = svc.slice(svc.indexOf('export function parseCsv'), svc.indexOf('function parseCsvLine'));
const validateRow = svc.slice(svc.indexOf('function validateRow'), svc.indexOf('async function findDuplicateRowIndices'));
const findDups = svc.slice(svc.indexOf('async function findDuplicateRowIndices'), svc.indexOf('export interface PreviewRow'));
const preview = svc.slice(svc.indexOf('export async function previewImport'), svc.indexOf('function toPreviewRow'));
const execute = svc.slice(svc.indexOf('export async function executeImport'), svc.indexOf('export async function exportClientsCsv'));
const exportAll = svc.slice(
  svc.indexOf('export async function exportClientsCsv'),
  svc.indexOf('export async function exportSelectedClientsCsv'),
);

test('Import CSV is a real file → preview → command path, not a placeholder', () => {
  assert.match(endpoints, /orgClientsImportPreview/);
  assert.match(endpoints, /orgClientsImport/);
  assert.match(clientsPage, /type="file" accept="\.csv"/);
  assert.match(clientsPage, /handleImportFile/);
  assert.match(clientsPage, /readAsText\(file, 'utf-8'\)/);
  assert.match(clientsPage, /orgClientsImportPreview\(orgId\)/);
  assert.match(clientsPage, /orgClientsImport\(orgId\)/);
  assert.match(clientsPage, /body: JSON\.stringify\(\{ csv: importCsv \}\)/);
  assert.match(clientsPage, /setRefreshTrigger/);
  assert.match(routes, /clients\/import\/preview[\s\S]{0,220}requirePermission\('clients:write'\)[\s\S]{0,80}requireOfficeAdministration/);
  assert.match(routes, /clients\/import'[\s\S]{0,220}requirePermission\('clients:write'\)[\s\S]{0,80}requireOfficeAdministration/);
});

test('Import parsing, required fields, duplicates, and invalid rows stay backend-owned', () => {
  assert.match(parseCsv, /toLowerCase\(\)/);
  assert.match(parseCsv, /company_name/);
  assert.match(parseCsv, /inQuotes/);
  assert.match(validateRow, /name is required/);
  assert.match(validateRow, /invalid email format/);
  assert.match(validateRow, /EMAIL_REGEX/);
  assert.match(findDups, /\.eq\('organization_id', orgId\)/);
  assert.match(findDups, /existingEmails|existingPhones|existingTaxIds/);
  assert.match(preview, /assertOrg/);
  assert.match(preview, /assertClientsWrite/);
  assert.match(preview, /assertOfficeAdministration/);
  assert.match(preview, /valid_rows/);
  assert.match(preview, /duplicates/);
  assert.match(preview, /invalid_rows/);
  assert.match(execute, /if \(!valid\) \{[\s\S]*errors\.push[\s\S]*continue/);
  assert.match(execute, /if \(duplicateIndices\.has\(i\)\) continue/);
  assert.match(execute, /organization_id: orgId/);
  assert.match(execute, /AUDIT_ACTIONS\.CLIENTS_IMPORT/);
  assert.match(execute, /tax_id/);
  assert.match(execute, /Client must have at least one contact method/);
});

test('Export CSV downloads org-scoped UTF-8 with escaped fields and no extra secrets', () => {
  assert.match(endpoints, /orgClientsExport/);
  assert.match(clientsPage, /apiFetch\(orgClientsExport\(orgId\)\)/);
  assert.match(clientsPage, /a\.download = 'clients-export\.csv'/);
  assert.match(routes, /clients\/export'[\s\S]{0,180}requirePermission\('clients:write'\)/);
  assert.match(routes, /text\/csv; charset=utf-8/);
  assert.match(exportAll, /assertOrg/);
  assert.match(exportAll, /assertClientsWrite/);
  assert.match(exportAll, /resolveOrganizationClientAccessScopeFromContext/);
  assert.match(exportAll, /filterAuthorizedClientIds/);
  assert.match(exportAll, /\.eq\('organization_id', orgId\)/);
  assert.match(exportAll, /name,email,phone,company_name,tax_id,address,city,country,notes/);
  assert.match(exportAll, /replace\(\/"\/g/);
  assert.doesNotMatch(exportAll, /password|service_role|access_token|secret/i);
  assert.doesNotMatch(exportAll, /select\('\*'\)/);
});
