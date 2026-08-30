/**
 * P4.1 — CDM population pagination contracts (limit+1 / has_more / bounds).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CDM_POPULATION_DEFAULT_LIMIT,
  CDM_POPULATION_MAX_LIMIT,
  clampCdmPopulationPagination,
  takeCdmPopulationPage,
} from '../../src/domains/income/income-client-document-management-panel.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);
const typesSource = readFileSync(
  join(dir, '../../src/domains/income/income.types.ts'),
  'utf8',
);
const weRoutesSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.routes.ts'),
  'utf8',
);
const weTabSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-tab.read-model.service.ts'),
  'utf8',
);
const fePanelSource = readFileSync(
  join(
    dir,
    '../../../../apps/web/src/components/income/IncomeClientDocumentManagementPanel.tsx',
  ),
  'utf8',
);
const feTabHostSource = readFileSync(
  join(dir, '../../../../apps/web/src/components/work-engine/WorkEngineTabHost.tsx'),
  'utf8',
);

test('1 — default/max page sizes are bounded (not 500/5000)', () => {
  assert.equal(CDM_POPULATION_DEFAULT_LIMIT, 50);
  assert.equal(CDM_POPULATION_MAX_LIMIT, 100);
  assert.ok(CDM_POPULATION_DEFAULT_LIMIT < 500);
  assert.ok(CDM_POPULATION_MAX_LIMIT < 5000);
});

test('2 — clamp rejects unbounded caller limits', () => {
  assert.deepEqual(clampCdmPopulationPagination(undefined, undefined), {
    limit: 50,
    offset: 0,
  });
  assert.deepEqual(clampCdmPopulationPagination(9999, -5), { limit: 100, offset: 0 });
  assert.deepEqual(clampCdmPopulationPagination(25, 50), { limit: 25, offset: 50 });
});

test('3 — has_more true when another row exists (limit+1)', () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: `c${i}` }));
  const { page, has_more } = takeCdmPopulationPage(rows, 50);
  assert.equal(has_more, true);
  assert.equal(page.length, 50);
  assert.equal(page[0].id, 'c0');
  assert.equal(page[49].id, 'c49');
});

test('4 — has_more false on final page', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}` }));
  const { page, has_more } = takeCdmPopulationPage(rows, 50);
  assert.equal(has_more, false);
  assert.equal(page.length, 12);
});

test('5 — page 2 continuation is stable (no overlap with page 1 slice)', () => {
  const all = Array.from({ length: 75 }, (_, i) => ({ id: `c${String(i).padStart(3, '0')}` }));
  const page1Fetched = all.slice(0, 51);
  const page2Fetched = all.slice(50, 101);
  const p1 = takeCdmPopulationPage(page1Fetched, 50);
  const p2 = takeCdmPopulationPage(page2Fetched, 50);
  assert.equal(p1.has_more, true);
  assert.equal(p2.page[0].id, 'c050');
  const p1Ids = new Set(p1.page.map((r) => r.id));
  for (const row of p2.page) {
    assert.equal(p1Ids.has(row.id), false);
  }
});

test('6 — service uses range pagination + takeCdmPopulationPage (not .limit(500/5000))', () => {
  assert.match(panelSource, /takeCdmPopulationPage/);
  assert.match(panelSource, /clampCdmPopulationPagination/);
  assert.match(panelSource, /\.range\(officePageReq\.offset/);
  assert.match(panelSource, /\.range\(customersPageReq\.offset/);
  assert.doesNotMatch(panelSource, /\.limit\(500\)/);
  assert.doesNotMatch(panelSource, /\.limit\(5000\)/);
  assert.match(panelSource, /order\('id'/);
});

test('7 — portal enrichment scoped to officeClientIds of returned page', () => {
  assert.match(panelSource, /Portal enrichment scoped to the returned office_clients page/);
  assert.match(panelSource, /\.in\('client_id', officeClientIds\)/);
  assert.match(panelSource, /buildEndCustomerQuickCard/);
  assert.match(panelSource, /buildOfficeClientQuickCard/);
});

test('8 — counters remain RPC population truth (not page-local recompute)', () => {
  assert.match(panelSource, /income_client_document_management_panel_stats/);
  assert.match(panelSource, /income_client_document_management_end_customer_stats/);
  assert.match(panelSource, /Row document counters remain population\/global RPC truth/);
});

test('9 — FE does not slice/infer has_more; requests aggregate page only', () => {
  assert.match(fePanelSource, /page\?\.has_more === true/);
  assert.match(fePanelSource, /onRequestPopulationPage/);
  assert.doesNotMatch(fePanelSource, /rows\.slice\(/);
  assert.match(feTabHostSource, /office_clients_offset/);
  assert.match(feTabHostSource, /handleRequestPopulationPage/);
  assert.doesNotMatch(feTabHostSource, /has_more\s*=\s*/);
});

test('10 — WE populations remain isolated; pagination passed through invoices-tab', () => {
  assert.match(typesSource, /section_key: 'office_clients' \| 'office_client_customers'/);
  assert.match(weRoutesSource, /office_clients_limit/);
  assert.match(weRoutesSource, /office_client_customers_offset/);
  assert.match(weTabSource, /pagination: params\.pagination/);
  assert.match(panelSource, /clients!inner/);
});
