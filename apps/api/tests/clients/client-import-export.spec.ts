/**
 * Clients CSV/Excel import/export: one existing mechanism, named command, codes not English copy.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyColumnMap, detectColumnMap, parseCsvGrid } from '../../src/domains/clients/client-import-mapping.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const readRepo = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const svc = readRepo('apps/api/src/domains/clients/client-import-export.service.ts');
const routes = readRepo('apps/api/src/domains/clients/clients.routes.ts');
const clientsPage = readRepo('apps/web/src/pages/Clients.tsx');
const endpoints = readRepo('apps/web/src/api/endpoints.ts');
const en = JSON.parse(readRepo('apps/web/src/i18n/en.json')) as {
  clients: { importCsv: string; importExcel: string; import: { title: string; hint: string; issues: Record<string, string> } };
};
const he = JSON.parse(readRepo('apps/web/src/i18n/he.json')) as {
  clients: { importCsv: string; importExcel: string; import: { title: string; hint: string; issues: Record<string, string> } };
};

test('Import is a file → preview → named command path, not a second mechanism', () => {
  assert.match(endpoints, /orgClientsImportPreview/);
  assert.match(endpoints, /orgClientsImportCommand/);
  assert.match(endpoints, /orgClientsImportTemplateCsv/);
  assert.match(endpoints, /orgClientsImportTemplateXlsx/);
  assert.doesNotMatch(endpoints, /orgClientsImport = /);
  assert.doesNotMatch(endpoints, /clients\/import`/);
  assert.match(clientsPage, /accept=\{importAccept\}/);
  assert.match(clientsPage, /openImportPanel\('\.csv'\)/);
  assert.match(clientsPage, /openImportPanel\('\.xlsx'\)/);
  assert.match(clientsPage, /clients\.importCsv/);
  assert.match(clientsPage, /clients\.importExcel/);
  assert.match(clientsPage, /clients\.import\.hint/);
  assert.match(clientsPage, /GlassFilePicker/);
  assert.match(clientsPage, /handleImportPickedFile/);
  assert.match(clientsPage, /readAsText\(file, 'utf-8'\)/);
  assert.match(clientsPage, /orgClientsImportPreview\(orgId\)/);
  assert.match(clientsPage, /orgClientsImportCommand\(orgId\)/);
  assert.doesNotMatch(clientsPage, /orgClientsImport\(/);
  assert.match(clientsPage, /column_map/);
  assert.match(clientsPage, /setRefreshTrigger/);
  assert.match(routes, /clients\/import\/preview[\s\S]{0,400}requirePermission\('clients:write'\)[\s\S]{0,80}requireOfficeAdministration/);
  assert.match(routes, /commands\/import_clients[\s\S]{0,400}requirePermission\('clients:write'\)[\s\S]{0,80}requireOfficeAdministration/);
  assert.doesNotMatch(routes, /router\.post\('\/:id\/clients\/import'/);
  assert.match(routes, /clients\/import\/template\.csv/);
  assert.match(routes, /clients\/import\/template\.xlsx/);
});

test('Backend owns validation, tax_id-only org duplicates, audit, and refreshed list', () => {
  assert.match(svc, /validateImportRow/);
  assert.match(svc, /findOrgDuplicateTaxIds/);
  assert.match(svc, /fileDuplicateTaxIdIndices/);
  assert.match(svc, /\.eq\('organization_id', orgId\)/);
  assert.match(svc, /assertOrg/);
  assert.match(svc, /assertClientsWrite/);
  assert.match(svc, /assertOfficeAdministration/);
  assert.match(svc, /reason_code/);
  assert.match(svc, /needs_column_mapping/);
  assert.match(svc, /AUDIT_ACTIONS\.CLIENTS_IMPORT/);
  assert.match(svc, /idempotency_key/);
  assert.match(svc, /clients_list/);
  assert.match(svc, /listClients/);
  assert.doesNotMatch(svc, /IMP-\$\{Date\.now/);
  assert.doesNotMatch(svc, /client_type: 'business_customer'/);
  assert.doesNotMatch(svc, /Client must have at least one contact method/);
  assert.doesNotMatch(svc, /Duplicate \(email, phone, or tax_id exists\)/);
});

test('Import never invents tax_id, business type, or contacts; re-import and tenant stay backend-owned', () => {
  const execute = svc.slice(svc.indexOf('export async function executeImport'), svc.indexOf('export function buildImportTemplate'));
  const insert = execute.slice(execute.indexOf('.insert({'), execute.indexOf('.select()'));
  assert.match(insert, /organization_id: orgId/);
  assert.match(insert, /tax_id: taxId/);
  assert.match(insert, /display_name: name/);
  assert.match(insert, /email: \(row\.email \?\? ''\)\.trim\(\) \|\| null/);
  assert.match(insert, /phone: \(row\.phone \?\? ''\)\.trim\(\) \|\| null/);
  assert.doesNotMatch(insert, /client_type/);
  assert.doesNotMatch(insert, /IMP-/);
  assert.doesNotMatch(insert, /@example\.|placeholder|invent|generated/i);
  assert.match(execute, /error\?\.code === '23505'/);
  assert.match(execute, /DUPLICATE_IN_ORGANIZATION/);
  assert.match(svc, /async function findOrgDuplicateTaxIds[\s\S]*\.eq\('organization_id', orgId\)[\s\S]*\.in\('tax_id'/);
  assert.match(routes, /req\.params\.id !== req\.context!\.organizationId/);
  assert.match(clientsPage, /nx-clients--deep-ocean/);
  assert.match(clientsPage, /nx-glass-btn nx-glass-btn--secondary/);
  assert.match(clientsPage, /nx-glass-btn nx-glass-btn--purple/);
});

test('CSV maps Hebrew and English headers without inventing values', () => {
  const parse = (csv: string) => {
    const grid = parseCsvGrid(csv);
    return applyColumnMap(grid.headers, grid.rows, detectColumnMap(grid.headers).map);
  };
  const heRows = parse('שם מלא,מספר עוסק\r\nדנה,123456782\r\n');
  assert.equal(heRows[0].name, 'דנה');
  assert.equal(heRows[0].tax_id, '123456782');
  assert.equal(heRows[0].email, '');
  const enRows = parse('name,tax_id,email\r\nDana,000000018,\r\n');
  assert.equal(enRows[0].name, 'Dana');
  assert.equal(enRows[0].tax_id, '000000018');
  assert.equal(enRows[0].email, '');
});

test('Import buttons and required-fields note stay HE/EN and share one importer', () => {
  assert.equal(en.clients.importCsv, 'Import CSV');
  assert.equal(en.clients.importExcel, 'Import Excel');
  assert.equal(en.clients.import.title, 'Import clients');
  assert.equal(
    en.clients.import.hint,
    'Client name and ID / company / business number are required. Files without these details cannot be imported.',
  );
  assert.equal(he.clients.importCsv, 'ייבוא CSV');
  assert.equal(he.clients.importExcel, 'ייבוא Excel');
  assert.equal(he.clients.import.title, 'ייבוא לקוחות');
  assert.equal(
    he.clients.import.hint,
    'חובה למלא שם לקוח ומספר זהות / ח.פ. / מספר עוסק. ללא נתונים אלה לא ניתן לייבא את הקובץ.',
  );
});

test('Import issue codes are localized in EN and HE without mixing alphabets', () => {
  const expected = {
    NAME_MISSING: { en: 'Client name is missing', he: 'שם הלקוח חסר' },
    TAX_ID_MISSING: { en: 'Identification number is missing', he: 'מספר זהות חסר' },
    DUPLICATE_IN_ORGANIZATION: { en: 'Client already exists', he: 'לקוח כבר קיים' },
    UNSUPPORTED_FILE_FORMAT: { en: 'Unsupported file format', he: 'פורמט הקובץ אינו נתמך' },
  };
  for (const [code, copy] of Object.entries(expected)) {
    assert.equal(en.clients.import.issues[code], copy.en);
    assert.equal(he.clients.import.issues[code], copy.he);
    assert.doesNotMatch(he.clients.import.issues[code], /[A-Za-z]{3,}/);
    assert.doesNotMatch(en.clients.import.issues[code], /[\u0590-\u05FF]/);
  }
  assert.match(he.clients.import.issues.NAME_MISSING, /[\u0590-\u05FF]/);
  assert.match(clientsPage, /importIssueLabel/);
  assert.match(clientsPage, /userFacingApiMessage/);
});

test('Export CSV downloads org-scoped UTF-8 with escaped fields and no extra secrets', () => {
  const exportAll = svc.slice(
    svc.indexOf('export async function exportClientsCsv'),
    svc.indexOf('export async function exportSelectedClientsCsv'),
  );
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
  assert.match(exportAll, /authorized_client_ids/);
  assert.match(exportAll, /name,email,phone,company_name,tax_id,address,city,country,notes/);
  assert.match(exportAll, /replace\(\/"\/g/);
  assert.doesNotMatch(exportAll, /password|service_role|access_token|secret/i);
  assert.doesNotMatch(exportAll, /select\('\*'\)/);
});
