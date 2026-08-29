/**
 * WE invoices CDM report catalogs + period normalization (Phase 1 scaffold).
 * Bodies remain disabled until canonical AB / Income report aggregates exist.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIncomeClientDocumentReportCatalog,
  normalizeIncomeClientDocumentReportPeriod,
} from '../../src/domains/income/income-client-document-management-panel.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);
const panelFe = readFileSync(
  join(dir, '../../../web/src/components/income/IncomeClientDocumentManagementPanel.tsx'),
  'utf8',
);
const weShell = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentManagementShell.tsx'),
  'utf8',
);

test('issuer catalog includes income_summary and four shared reports', () => {
  const catalog = buildIncomeClientDocumentReportCatalog('issuer');
  assert.deepEqual(
    catalog.map((item) => item.key),
    [
      'income_summary',
      'unpaid_outstanding',
      'receipts',
      'documents',
      'cancelled_documents',
    ],
  );
  assert.equal(catalog.find((i) => i.key === 'income_summary')?.label, 'דוח הכנסות');
  assert.ok(catalog.every((item) => item.enabled === false));
  assert.ok(catalog.every((item) => typeof item.disabled_reason === 'string' && item.disabled_reason.length > 0));
});

test('recipient catalog excludes income_summary', () => {
  const catalog = buildIncomeClientDocumentReportCatalog('recipient');
  assert.deepEqual(
    catalog.map((item) => item.key),
    ['unpaid_outstanding', 'receipts', 'documents', 'cancelled_documents'],
  );
  assert.equal(catalog.some((item) => item.key === 'income_summary'), false);
  assert.ok(catalog.every((item) => item.enabled === false));
});

test('issuer and recipient open_reports payloads carry backend available_reports', () => {
  const groupFnStart = panelSource.indexOf('function buildIssuerCustomerGroupActions');
  const groupFnEnd = panelSource.indexOf('function buildEndCustomerRowActions');
  const groupFn = panelSource.slice(groupFnStart, groupFnEnd);
  const endFnStart = panelSource.indexOf('function buildEndCustomerRowActions');
  const endFnEnd = panelSource.indexOf('function formatMoneyReference');
  const endFn = panelSource.slice(endFnStart, endFnEnd);

  assert.match(groupFn, /report_scope: 'issuer'/);
  assert.match(groupFn, /available_reports: buildIncomeClientDocumentReportCatalog\('issuer'\)/);
  assert.match(endFn, /report_scope: 'recipient'/);
  assert.match(endFn, /available_reports: buildIncomeClientDocumentReportCatalog\('recipient'\)/);
  assert.match(panelSource, /buildIncomeClientDocumentReportCatalog/);
});

test('month period normalization uses UTC calendar bounds', () => {
  const period = normalizeIncomeClientDocumentReportPeriod({
    mode: 'month',
    month: 8,
    year: 2026,
  });
  assert.equal(period.mode, 'month');
  assert.equal(period.normalized_from, '2026-08-01');
  assert.equal(period.normalized_to, '2026-08-31');
  assert.equal(period.from_month, 8);
  assert.equal(period.to_year, 2026);
});

test('range period normalization spans inclusive month ends', () => {
  const period = normalizeIncomeClientDocumentReportPeriod({
    mode: 'range',
    from_month: 1,
    from_year: 2026,
    to_month: 8,
    to_year: 2026,
  });
  assert.equal(period.normalized_from, '2026-01-01');
  assert.equal(period.normalized_to, '2026-08-31');
});

test('reversed range is rejected', () => {
  assert.throws(
    () =>
      normalizeIncomeClientDocumentReportPeriod({
        mode: 'range',
        from_month: 9,
        from_year: 2026,
        to_month: 8,
        to_year: 2026,
      }),
    /from must be <= to/,
  );
});

test('invalid month is rejected', () => {
  assert.throws(
    () =>
      normalizeIncomeClientDocumentReportPeriod({
        mode: 'month',
        month: 13,
        year: 2026,
      }),
    /month must be 1–12/,
  );
});

test('frontend renders backend catalog; no FE income-scope invent / totals', () => {
  assert.match(panelFe, /parseReportsCatalogFromPayload/);
  assert.match(panelFe, /available_reports/);
  assert.match(panelFe, /reportScope/);
  assert.doesNotMatch(panelFe, /if\s*\(.*report_scope.*issuer.*\)[\s\S]{0,120}income_summary/);
  assert.doesNotMatch(panelFe, /reduce\s*\(.*amount/);
  assert.doesNotMatch(panelFe, /sum\s*\+\s*/);
  assert.match(weShell, /result\.catalog \?\? panel\.report_catalog/);
  assert.match(weShell, /reportScope=\{reportsScope\}/);
});
