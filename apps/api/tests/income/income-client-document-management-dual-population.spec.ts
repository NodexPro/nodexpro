/**
 * Dual-population invoices panel: office clients vs end customers.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  endCustomerPopulationKey,
  groupEndCustomerRowsByParent,
  incomeCdmActionKeysMatchCanonical,
  incomeCdmCanonicalActionSlotKeys,
  incomeCdmEndCustomerRowActionSlotKeys,
  INCOME_CDM_ISSUER_GROUP_ACTION_SLOT_KEYS,
  mergeOfficeClientsWithDocumentStats,
  zeroOfficeClientDocumentStat,
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
const invoicesTabSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-tab.read-model.service.ts'),
  'utf8',
);
const migration165 = readFileSync(
  join(dir, '../../../../supabase/migrations/165_income_client_document_management_end_customer_stats.sql'),
  'utf8',
);

test('1 — office clients section is backend-defined and separate from end customers', () => {
  assert.match(typesSource, /office_clients_section/);
  assert.match(typesSource, /office_client_customers_section/);
  assert.match(panelSource, /section_key: 'office_clients'/);
  assert.match(panelSource, /section_key: 'office_client_customers'/);
  assert.match(panelSource, /population_key: 'office_client'/);
  assert.match(panelSource, /population_key: 'office_client_customer'/);
});

test('2/3 — end-customer rows carry explicit parent represented-client context', () => {
  assert.match(typesSource, /parent_represented_client_id/);
  assert.match(typesSource, /parent_client_display_name/);
  assert.match(typesSource, /income_customer_id/);
  assert.match(panelSource, /parent_represented_client_id: representedClientId/);
  assert.match(panelSource, /income_customer_id: incomeCustomerId/);
  assert.match(panelSource, /row_context/);
});

test('4 — dual identity key distinguishes same name under two parents', () => {
  const a = endCustomerPopulationKey({
    representedClientId: 'office-a',
    incomeCustomerId: 'cust-same-name',
  });
  const b = endCustomerPopulationKey({
    representedClientId: 'office-b',
    incomeCustomerId: 'cust-same-name',
  });
  assert.notEqual(a, b);
  assert.equal(a, 'office-a::cust-same-name');
});

test('5 — end-customer SQL stats group by parent + income_customer_id', () => {
  assert.match(migration165, /group by oi\.client_id, oi\.income_customer_id/);
  assert.match(migration165, /income_customer_id is not null/);
  assert.match(migration165, /accounting_payment_allocations/);
  assert.match(migration165, /income_document_credit_links/);
  assert.match(panelSource, /income_client_document_management_end_customer_stats/);
  assert.match(panelSource, /action_params/);
});

test('6 — direct office rows remain in backward-compatible rows list', () => {
  assert.match(panelSource, /rows: officeRows/);
  assert.match(typesSource, /Backward-compatible flat list = office_clients_section\.rows/);
});

test('7 — no FE inference hooks in panel service', () => {
  assert.doesNotMatch(panelSource, /if \(.*name.*\)/);
  assert.match(panelSource, /parentDisplayName:/);
  assert.match(panelSource, /clientMetaById\.get\(representedClientId\)/);
});

test('8 — no N+1: both RPCs + meta loads are batched / parallel', () => {
  assert.match(panelSource, /Promise\.all\(\[/);
  assert.match(panelSource, /income_client_document_management_panel_stats/);
  assert.match(panelSource, /income_client_document_management_end_customer_stats/);
  assert.match(panelSource, /mergeEndCustomersWithDocumentStats/);
  assert.match(panelSource, /from\('income_customers'\)/);
  assert.doesNotMatch(panelSource, /for \(.*of .*\) \{\s*await/);
});

test('9/11 — invoices tab still one composed read via panel builder', () => {
  assert.match(invoicesTabSource, /buildIncomeClientDocumentManagementPanel/);
  assert.match(invoicesTabSource, /Promise\.all\(/);
  assert.equal((invoicesTabSource.match(/buildIncomeClientDocumentManagementPanel/g) ?? []).length, 2);
});

test('10 — permissions still gate visibility via issue_on_behalf', () => {
  assert.match(panelSource, /perms\.issue_on_behalf/);
  assert.match(panelSource, /emptyPanel\(false\)/);
});

test('grouping helper nests end customers under parent labels', () => {
  const groups = groupEndCustomerRowsByParent([
    {
      parent_represented_client_id: 'p1',
      parent_client_display_name: 'Parent One',
      client_display_name: 'Cust B',
    },
    {
      parent_represented_client_id: 'p1',
      parent_client_display_name: 'Parent One',
      client_display_name: 'Cust A',
    },
    {
      parent_represented_client_id: 'p2',
      parent_client_display_name: 'Parent Two',
      client_display_name: 'Cust C',
    },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].parent_represented_client_id, 'p1');
  assert.equal(groups[0].total_customers, 2);
  assert.equal(groups[1].parent_represented_client_id, 'p2');
});

test('end-customer WE rows omit issuer settings/customers; /m/income keeps disabled placeholders', () => {
  assert.match(panelSource, /buildEndCustomerRowActions/);
  assert.match(panelSource, /buildIssuerCustomerGroupActions/);
  assert.match(panelSource, /workEngineInvoicesFunctionalParity/);
  const endFnStart = panelSource.indexOf('function buildEndCustomerRowActions');
  const endFnEnd = panelSource.indexOf('function formatMoneyReference');
  const endFn = panelSource.slice(endFnStart, endFnEnd);
  const groupFnStart = panelSource.indexOf('function buildIssuerCustomerGroupActions');
  const groupFnEnd = panelSource.indexOf('function buildEndCustomerRowActions');
  const groupFn = panelSource.slice(groupFnStart, groupFnEnd);

  assert.match(endFn, /key: 'open_reports'/);
  assert.match(endFn, /key: 'open_income_ledger_card'/);
  assert.match(endFn, /key: 'open_email_history'/);
  assert.match(endFn, /key: 'more'/);
  assert.match(endFn, /key: 'open_new_income_document'/);
  assert.match(endFn, /report_scope: 'recipient'/);
  // Legacy (/m/income) branch still carries artificial disablement reasons.
  assert.match(endFn, /הגדרות מסמך שייכות ללקוח המשרד/);
  assert.match(endFn, /ניהול לקוחות קצה זמין משורת לקוח המשרד בלבד/);
  assert.match(endFn, /דוחות לפי לקוח קצה — בקרוב/);
  assert.match(endFn, /היסטוריית מייל לפי לקוח קצה — בקרוב/);
  assert.match(endFn, /end_customer_id: incomeCustomerId/);
  assert.match(endFn, /income_customer_id: incomeCustomerId/);
  assert.doesNotMatch(endFn, /open_end_customer_settings/);
  // WE recipient rows do not own issuer Branding Studio / customer-list.
  assert.doesNotMatch(endFn, /open_document_branding_studio:\s*true/);
  assert.doesNotMatch(endFn, /focus_income_customer_id:\s*incomeCustomerId/);

  // Issuer group owns settings + customers + issuer reports.
  assert.match(groupFn, /key: 'open_branding_studio'/);
  assert.match(groupFn, /key: 'open_end_customers'/);
  assert.match(groupFn, /key: 'open_reports'/);
  assert.match(groupFn, /open_document_branding_studio:\s*true/);
  assert.match(groupFn, /open_end_customers_panel:\s*true/);
  assert.match(groupFn, /report_scope: 'issuer'/);
  assert.match(groupFn, /available_reports: buildIncomeClientDocumentReportCatalog\('issuer'\)/);
  assert.match(endFn, /report_scope: 'recipient'/);
  assert.match(endFn, /available_reports: buildIncomeClientDocumentReportCatalog\('recipient'\)/);
  assert.match(panelSource, /actions: buildIssuerCustomerGroupActions/);
});

test('WE invoices tab enables end-customer functional parity; income issuer context does not', () => {
  const invoicesTabSource = readFileSync(
    join(dir, '../../src/domains/work-engine/work-engine-invoices-tab.read-model.service.ts'),
    'utf8',
  );
  const issuerContextSource = readFileSync(
    join(dir, '../../src/domains/income/income-issuer-context.service.ts'),
    'utf8',
  );
  assert.match(invoicesTabSource, /workEngineInvoicesFunctionalParity:\s*true/);
  assert.match(invoicesTabSource, /newDocumentInsteadOfMore:\s*true/);
  assert.match(invoicesTabSource, /omitDraftDocumentTypeCounter:\s*true/);
  assert.doesNotMatch(issuerContextSource, /workEngineInvoicesFunctionalParity:\s*true/);
  assert.doesNotMatch(issuerContextSource, /newDocumentInsteadOfMore:\s*true/);
  assert.doesNotMatch(issuerContextSource, /omitDraftDocumentTypeCounter:\s*true/);
});

test('WE invoices office_clients omits last_activity column + open_end_customers; issuer group keeps לקוחות', () => {
  assert.match(panelSource, /PANEL_COLUMNS_WE_INVOICES/);
  assert.match(panelSource, /col\.key !== 'last_activity_display'/);
  assert.match(
    panelSource,
    /workEngineInvoicesFunctionalParity === true\s*\?\s*PANEL_COLUMNS_WE_INVOICES/,
  );
  assert.match(
    panelSource,
    /omitEndCustomersAction:\s*params\.workEngineInvoicesFunctionalParity === true/,
  );
  assert.match(
    panelSource,
    /omitBrandingStudioAction:\s*params\.workEngineInvoicesFunctionalParity === true/,
  );
  const groupFnStart = panelSource.indexOf('function buildIssuerCustomerGroupActions');
  const groupFnEnd = panelSource.indexOf('function buildEndCustomerRowActions');
  const groupFn = panelSource.slice(groupFnStart, groupFnEnd);
  assert.match(groupFn, /key: 'open_end_customers'/);
  assert.match(groupFn, /label: 'לקוחות'/);
  assert.doesNotMatch(groupFn, /omitEndCustomersAction/);
});

test('WE invoices office_clients moves open_branding_studio to section.header_actions', () => {
  assert.match(panelSource, /function buildOfficeClientsPopulationHeaderActions/);
  assert.match(panelSource, /header_actions: officeClientsHeaderActions/);
  assert.match(panelSource, /header_actions: \[\]/);
  const headerFnStart = panelSource.indexOf('function buildOfficeClientsPopulationHeaderActions');
  const headerFnEnd = panelSource.indexOf('function buildIssuerCustomerGroupActions');
  const headerFn = panelSource.slice(headerFnStart, headerFnEnd);
  assert.match(headerFn, /key: 'open_branding_studio'/);
  assert.match(headerFn, /label: 'הגדרות מסמך'/);
  assert.match(headerFn, /icon_key: 'settings'/);
  assert.match(headerFn, /acting_mode: 'self'/);
  assert.match(headerFn, /open_document_branding_studio:\s*true/);
  assert.match(headerFn, /represented_client_id: null/);
  const officeFnStart = panelSource.indexOf('function buildOfficeClientRowActions');
  const officeFnEnd = panelSource.indexOf('function buildOfficeClientsPopulationHeaderActions');
  const officeFn = panelSource.slice(officeFnStart, officeFnEnd);
  assert.match(officeFn, /omitBrandingStudioAction/);
  assert.match(officeFn, /if \(!options\?\.omitBrandingStudioAction\)/);
});

test('end-customer WE parity actions are permission-gated not population-gated', () => {
  const endFnStart = panelSource.indexOf('function buildEndCustomerRowActions');
  const endFnEnd = panelSource.indexOf('function formatMoneyReference');
  const endFn = panelSource.slice(endFnStart, endFnEnd);
  const groupFnStart = panelSource.indexOf('function buildIssuerCustomerGroupActions');
  const groupFnEnd = panelSource.indexOf('function buildEndCustomerRowActions');
  const groupFn = panelSource.slice(groupFnStart, groupFnEnd);
  assert.match(groupFn, /enabled: canEdit/);
  assert.match(endFn, /weParity \? perms\.view : false/);
  assert.match(endFn, /weParity \? canEmail : false/);
  assert.doesNotMatch(endFn, /open_end_customer_settings/);
  assert.doesNotMatch(endFn, /population_key\s*===/);
});

test('office canonical slots stay issuer-complete; WE recipient rows use recipient slots', () => {
  const withRetainer = incomeCdmCanonicalActionSlotKeys(true);
  const withoutRetainer = incomeCdmCanonicalActionSlotKeys(false);
  assert.deepEqual(withRetainer, [
    'open_branding_studio',
    'open_end_customers',
    'open_reports',
    'open_income_ledger_card',
    'open_email_history',
    'open_invoice_retainer_setup',
    'more',
  ]);
  assert.deepEqual(withoutRetainer, [
    'open_branding_studio',
    'open_end_customers',
    'open_reports',
    'open_income_ledger_card',
    'open_email_history',
    'more',
  ]);
  // /m/income-style WE trailing without omitting customers (legacy slot helper).
  assert.deepEqual(incomeCdmCanonicalActionSlotKeys(true, { newDocumentInsteadOfMore: true }), [
    'open_branding_studio',
    'open_end_customers',
    'open_reports',
    'open_income_ledger_card',
    'open_email_history',
    'open_invoice_retainer_setup',
    'open_new_income_document',
  ]);
  // Work Engine invoices office_clients: omit customers + row branding (header owns settings).
  assert.deepEqual(
    incomeCdmCanonicalActionSlotKeys(true, {
      newDocumentInsteadOfMore: true,
      omitEndCustomersAction: true,
      omitBrandingStudioAction: true,
    }),
    [
      'open_reports',
      'open_income_ledger_card',
      'open_email_history',
      'open_invoice_retainer_setup',
      'open_new_income_document',
    ],
  );
  assert.deepEqual(incomeCdmEndCustomerRowActionSlotKeys(false, { newDocumentInsteadOfMore: true }), [
    'open_reports',
    'open_income_ledger_card',
    'open_email_history',
    'open_new_income_document',
  ]);
  assert.deepEqual([...INCOME_CDM_ISSUER_GROUP_ACTION_SLOT_KEYS], [
    'open_branding_studio',
    'open_end_customers',
    'open_reports',
  ]);
  assert.equal(incomeCdmActionKeysMatchCanonical(withRetainer, true), true);
  assert.equal(incomeCdmActionKeysMatchCanonical(withoutRetainer, false), true);
  assert.equal(
    incomeCdmActionKeysMatchCanonical(['open_reports', 'open_income_ledger_card', 'more'], false),
    false,
  );
  assert.equal(
    incomeCdmActionKeysMatchCanonical(
      incomeCdmCanonicalActionSlotKeys(true, {
        newDocumentInsteadOfMore: true,
        omitEndCustomersAction: true,
        omitBrandingStudioAction: true,
      }),
      true,
      {
        newDocumentInsteadOfMore: true,
        omitEndCustomersAction: true,
        omitBrandingStudioAction: true,
      },
    ),
    true,
  );

  const officeFnStart = panelSource.indexOf('function buildOfficeClientRowActions');
  const officeFnEnd = panelSource.indexOf('function buildOfficeClientsPopulationHeaderActions');
  const officeFn = panelSource.slice(officeFnStart, officeFnEnd === -1
    ? panelSource.indexOf('function buildIssuerCustomerGroupActions')
    : officeFnEnd);
  const endFnStart = panelSource.indexOf('function buildEndCustomerRowActions');
  const endFnEnd = panelSource.indexOf('function formatMoneyReference');
  const endFn = panelSource.slice(endFnStart, endFnEnd);

  for (const key of withoutRetainer) {
    assert.match(officeFn, new RegExp(`key: '${key}'`));
  }
  assert.match(officeFn, /omitEndCustomersAction/);
  assert.match(officeFn, /if \(!options\?\.omitEndCustomersAction\)/);
  for (const key of incomeCdmEndCustomerRowActionSlotKeys(false, { newDocumentInsteadOfMore: true })) {
    assert.match(endFn, new RegExp(`key: '${key}'`));
  }
  assert.match(officeFn, /key: 'open_new_income_document'/);
  assert.match(endFn, /key: 'open_new_income_document'/);
});

test('ledger/retainer end-customer payloads keep parent + income_customer_id', () => {
  const endFnStart = panelSource.indexOf('function buildEndCustomerRowActions');
  const endFnEnd = panelSource.indexOf('function formatMoneyReference');
  const endFn = panelSource.slice(endFnStart, endFnEnd);
  assert.match(endFn, /represented_client_id: representedClientId/);
  assert.match(endFn, /end_customer_id: incomeCustomerId/);
  assert.match(endFn, /income_customer_id: incomeCustomerId/);
});

test('frontend action cell does not filter by population; group renders backend actions', () => {
  const panelFe = readFileSync(
    join(dir, '../../../web/src/components/income/IncomeClientDocumentManagementPanel.tsx'),
    'utf8',
  );
  assert.match(panelFe, /\(row\.actions \?\? \[\]\)\.map/);
  assert.match(panelFe, /\(group\.actions \?\? \[\]\)\.map/);
  assert.doesNotMatch(panelFe, /population_key\s*===/);
  assert.doesNotMatch(panelFe, /if\s*\(.*income_customer_id.*\)\s*\{[\s\S]*hide/);
  assert.doesNotMatch(panelFe, /actions\.filter\(/);
  assert.match(panelFe, /function ActionButton/);
  assert.match(panelFe, /kind: 'email_history'/);
  assert.match(panelFe, /initialEditCustomerId/);
  assert.match(panelFe, /case 'plus'/);
});

test('WE shell wires document settings + new document; Income shell stays unscoped', () => {
  const weShell = readFileSync(
    join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentManagementShell.tsx'),
    'utf8',
  );
  const incomeShell = readFileSync(
    join(dir, '../../../web/src/components/income/IncomeClientDocumentManagementShell.tsx'),
    'utf8',
  );
  assert.doesNotMatch(weShell, /open_end_customer_settings/);
  assert.match(weShell, /open_document_branding_studio/);
  assert.match(weShell, /open_new_income_document/);
  assert.match(weShell, /select_income_recipient/);
  assert.match(weShell, /onOpenNewDocument/);
  assert.match(weShell, /endCustomersInitialEditId/);
  assert.match(weShell, /emailHistoryEndCustomerId/);
  assert.match(weShell, /incomeCustomerId=\{emailHistoryEndCustomerId\}/);
  assert.doesNotMatch(incomeShell, /open_end_customer_settings/);
  assert.doesNotMatch(incomeShell, /open_new_income_document/);
  assert.doesNotMatch(incomeShell, /endCustomersInitialEditId/);
  assert.doesNotMatch(incomeShell, /emailHistoryEndCustomerId/);
});

test('WE invoices omits draft cube from counters; draft domain key still exists in builder', () => {
  assert.match(panelSource, /omitDraftDocumentTypeCounter/);
  assert.match(panelSource, /key: 'draft'/);
  assert.match(panelSource, /label: 'טיוטות'/);
  const counterFnStart = panelSource.indexOf('function buildDocumentTypeCounters');
  const counterFnEnd = panelSource.indexOf('function statusLabelFromStat');
  const counterFn = panelSource.slice(counterFnStart, counterFnEnd);
  assert.match(counterFn, /omitDraftDocumentTypeCounter/);
  assert.match(counterFn, /key: 'draft'/);
});

test('WE + action payloads carry exact row context for office and end customer', () => {
  const officeFnStart = panelSource.indexOf('function buildOfficeClientRowActions');
  const officeFnEnd = panelSource.indexOf('function buildIssuerCustomerGroupActions');
  const officeFn = panelSource.slice(officeFnStart, officeFnEnd);
  const endFnStart = panelSource.indexOf('function buildEndCustomerRowActions');
  const endFnEnd = panelSource.indexOf('function formatMoneyReference');
  const endFn = panelSource.slice(endFnStart, endFnEnd);
  assert.match(officeFn, /open_new_income_document:\s*true/);
  assert.match(officeFn, /represented_client_id: clientId/);
  assert.match(endFn, /open_new_income_document:\s*true/);
  assert.match(endFn, /represented_client_id: representedClientId/);
  assert.match(endFn, /income_customer_id: incomeCustomerId/);
  assert.match(endFn, /issuer_business_id: representedClientId/);
});

test('A/B — office section starts from Core clients and left-joins stats (zero-doc clients included)', () => {
  assert.match(panelSource, /\.from\('clients'\)/);
  assert.match(panelSource, /is_archived',\s*false/);
  assert.match(panelSource, /mergeOfficeClientsWithDocumentStats/);
  assert.match(panelSource, /zeroOfficeClientDocumentStat/);
  assert.doesNotMatch(
    panelSource,
    /const officeRows: IncomeClientDocumentManagementRow\[\] = stats\s*\.map/,
  );
});

test('C — zeroOfficeClientDocumentStat yields all-zero counters', () => {
  const z = zeroOfficeClientDocumentStat('client-zero');
  assert.equal(z.represented_client_id, 'client-zero');
  assert.equal(z.total_documents_count, 0);
  assert.equal(z.draft_documents_count, 0);
  assert.equal(z.quote_issued_count, 0);
  assert.equal(z.deal_issued_count, 0);
  assert.equal(z.tax_invoice_issued_count, 0);
  assert.equal(z.tax_invoice_receipt_issued_count, 0);
  assert.equal(z.receipt_issued_count, 0);
  assert.equal(z.credit_issued_count, 0);
  assert.equal(z.unpaid_reference, null);
  assert.equal(z.last_document_date, null);
});

test('D — office actions still built via buildOfficeClientRowActions (backend-driven)', () => {
  assert.match(panelSource, /buildOfficeClientRowActions\(/);
  assert.match(panelSource, /actions: buildOfficeClientRowActions/);
});

test('E/F — populations stay separated (end customers from canonical income_customers + stats)', () => {
  assert.match(panelSource, /const endCustomerRows: IncomeClientDocumentManagementRow\[\] = mergeEndCustomersWithDocumentStats/);
  assert.match(panelSource, /section_key: 'office_clients'/);
  assert.match(panelSource, /section_key: 'office_client_customers'/);
  assert.match(panelSource, /population_key: 'office_client'/);
  assert.match(panelSource, /population_key: 'office_client_customer'/);
});

test('mergeOfficeClientsWithDocumentStats includes clients missing from stats', () => {
  const statsByClientId = new Map([
    [
      'with-docs',
      {
        represented_client_id: 'with-docs',
        total_documents_count: 3,
      },
    ],
  ]);
  const merged = mergeOfficeClientsWithDocumentStats(
    [{ id: 'with-docs' }, { id: 'zero-docs' }],
    statsByClientId,
    (id) => zeroOfficeClientDocumentStat(id),
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0].clientId, 'with-docs');
  assert.equal(merged[0].stat.total_documents_count, 3);
  assert.equal(merged[1].clientId, 'zero-docs');
  assert.equal(merged[1].stat.total_documents_count, 0);
});

test('J — no FE population inference hooks added for office membership', () => {
  assert.doesNotMatch(panelSource, /shouldIncludeOfficeClient/);
  assert.doesNotMatch(panelSource, /classifyPopulation/);
  assert.match(panelSource, /Paginated eligible office clients/);
});
