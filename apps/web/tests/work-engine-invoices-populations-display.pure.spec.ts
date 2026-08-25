import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORK_ENGINE_INVOICES_POPULATIONS_BOTH_LABEL,
  WORK_ENGINE_INVOICES_POPULATIONS_DISPLAY_DEFAULT,
  incomeClientDocumentManagementRowReactKey,
  resolveWorkEngineInvoicesPopulationsVisibility,
} from '../src/income/income-client-document-management-populations-display.pure.ts';
import { resolveIncomeClientDocumentManagementPanel } from '../src/income/income-workspace-types.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(
  join(dir, '../src/components/income/IncomeClientDocumentManagementPanel.tsx'),
  'utf8',
);
const shellSource = readFileSync(
  join(dir, '../src/components/work-engine/WorkEngineClientDocumentManagementShell.tsx'),
  'utf8',
);
const queueCss = readFileSync(join(dir, '../src/styles/nx-work-engine-queue.css'), 'utf8');
const cdmCss = readFileSync(
  join(dir, '../src/styles/nx-work-engine-client-documents.css'),
  'utf8',
);

test('default display mode is both', () => {
  assert.equal(WORK_ENGINE_INVOICES_POPULATIONS_DISPLAY_DEFAULT, 'both');
  assert.equal(WORK_ENGINE_INVOICES_POPULATIONS_BOTH_LABEL, 'שניהם');
});

test('office mode shows only office section', () => {
  const v = resolveWorkEngineInvoicesPopulationsVisibility('office');
  assert.deepEqual(v, { showOfficeClients: true, showOfficeClientCustomers: false });
});

test('both mode shows both sections', () => {
  const v = resolveWorkEngineInvoicesPopulationsVisibility('both');
  assert.deepEqual(v, { showOfficeClients: true, showOfficeClientCustomers: true });
});

test('customers mode shows only customers section', () => {
  const v = resolveWorkEngineInvoicesPopulationsVisibility('office_client_customers');
  assert.deepEqual(v, { showOfficeClients: false, showOfficeClientCustomers: true });
});

test('row react key uses backend identity fields without FE classification', () => {
  assert.equal(
    incomeClientDocumentManagementRowReactKey({ represented_client_id: 'c1' }),
    'represented_client:c1',
  );
  assert.equal(
    incomeClientDocumentManagementRowReactKey({
      represented_client_id: 'c1',
      income_customer_id: 'ec9',
    }),
    'income_customer:ec9',
  );
});

test('resolver uses explicit sections and does not invent customers from rows', () => {
  const resolved = resolveIncomeClientDocumentManagementPanel({
    aggregate_key: 'income_client_document_management_panel',
    visible: true,
    title: 't',
    description: null,
    columns: [],
    rows: [
      {
        represented_client_id: 'office-1',
        client_display_name: 'Office',
        client_logo_url: null,
        client_initials: 'O',
        tax_id: null,
        email: null,
        total_documents_count: 0,
        quote_count: 0,
        deal_count: 0,
        tax_invoice_count: 0,
        receipt_count: 0,
        credit_count: 0,
        unpaid_amount_reference: null,
        unpaid_amount_display: '—',
        last_document_date: null,
        last_document_date_display: '—',
        last_activity_at: null,
        last_activity_display: '—',
        status_label: 'פעיל',
        actions: [],
      },
    ],
    office_clients_section: {
      section_key: 'office_clients',
      title: 'לקוחות המשרד',
      total_count: 1,
      rows: [
        {
          represented_client_id: 'office-1',
          client_display_name: 'Office',
          client_logo_url: null,
          client_initials: 'O',
          tax_id: null,
          email: null,
          total_documents_count: 0,
          quote_count: 0,
          deal_count: 0,
          tax_invoice_count: 0,
          receipt_count: 0,
          credit_count: 0,
          unpaid_amount_reference: null,
          unpaid_amount_display: '—',
          last_document_date: null,
          last_document_date_display: '—',
          last_activity_at: null,
          last_activity_display: '—',
          status_label: 'פעיל',
          actions: [],
        },
      ],
      groups: null,
      page: { limit: null, offset: 0, has_more: false },
      empty_state: { visible: false, title: '', description: null },
    },
    office_client_customers_section: {
      section_key: 'office_client_customers',
      title: 'לקוחות של לקוחות המשרד',
      total_count: 1,
      rows: [
        {
          represented_client_id: 'office-1',
          income_customer_id: 'ec-1',
          parent_represented_client_id: 'office-1',
          parent_client_display_name: 'Office',
          client_display_name: 'End',
          client_logo_url: null,
          client_initials: 'E',
          tax_id: null,
          email: null,
          total_documents_count: 0,
          quote_count: 0,
          deal_count: 0,
          tax_invoice_count: 0,
          receipt_count: 0,
          credit_count: 0,
          unpaid_amount_reference: null,
          unpaid_amount_display: '—',
          last_document_date: null,
          last_document_date_display: '—',
          last_activity_at: null,
          last_activity_display: '—',
          status_label: 'פעיל',
          actions: [],
        },
      ],
      groups: [
        {
          parent_represented_client_id: 'office-1',
          parent_client_display_name: 'Office',
          total_customers: 1,
          rows: [
            {
              represented_client_id: 'office-1',
              income_customer_id: 'ec-1',
              parent_represented_client_id: 'office-1',
              parent_client_display_name: 'Office',
              client_display_name: 'End',
              client_logo_url: null,
              client_initials: 'E',
              tax_id: null,
              email: null,
              total_documents_count: 0,
              quote_count: 0,
              deal_count: 0,
              tax_invoice_count: 0,
              receipt_count: 0,
              credit_count: 0,
              unpaid_amount_reference: null,
              unpaid_amount_display: '—',
              last_document_date: null,
              last_document_date_display: '—',
              last_activity_at: null,
              last_activity_display: '—',
              status_label: 'פעיל',
              actions: [],
            },
          ],
        },
      ],
      page: { limit: null, offset: 0, has_more: false },
      empty_state: { visible: false, title: '', description: null },
    },
    report_catalog: [],
    empty_state: { visible: false, title: '', description: null },
  });

  assert.equal(resolved.office_clients_section.rows.length, 1);
  assert.equal(resolved.office_client_customers_section.groups?.[0]?.parent_client_display_name, 'Office');
  assert.equal(resolved.office_client_customers_section.rows[0]?.income_customer_id, 'ec-1');
});

test('legacy panel without sections keeps rows as office only (no FE reclassification)', () => {
  const resolved = resolveIncomeClientDocumentManagementPanel({
    aggregate_key: 'income_client_document_management_panel',
    visible: true,
    title: 't',
    description: null,
    columns: [],
    rows: [
      {
        represented_client_id: 'office-1',
        client_display_name: 'Office',
        client_logo_url: null,
        client_initials: 'O',
        tax_id: null,
        email: null,
        total_documents_count: 0,
        quote_count: 0,
        deal_count: 0,
        tax_invoice_count: 0,
        receipt_count: 0,
        credit_count: 0,
        unpaid_amount_reference: null,
        unpaid_amount_display: '—',
        last_document_date: null,
        last_document_date_display: '—',
        last_activity_at: null,
        last_activity_display: '—',
        status_label: 'פעיל',
        actions: [],
      },
    ],
    report_catalog: [],
    empty_state: { visible: false, title: '', description: null },
  });

  assert.equal(resolved.office_clients_section.rows.length, 1);
  assert.equal(resolved.office_client_customers_section.rows.length, 0);
  assert.equal(resolved.office_client_customers_section.groups?.length ?? 0, 0);
});

test('panel reuses one row renderer path for both populations', () => {
  assert.match(panelSource, /function renderClientDocumentManagementDataRows/);
  assert.match(panelSource, /function ClientDocumentManagementRowsTable/);
  assert.match(panelSource, /renderDataCell\(/);
  assert.equal(panelSource.includes('Draft/Sent/Paid'), false);
  assert.match(panelSource, /PopulationsSegmentedControl/);
  assert.match(panelSource, /office_clients_section/);
  assert.match(panelSource, /office_client_customers_section/);
});

test('shell enables populations layout with local UI state only (no API on mode change)', () => {
  assert.match(shellSource, /populationsLayoutEnabled/);
  assert.match(shellSource, /setPopulationsDisplayMode/);
  assert.match(shellSource, /WORK_ENGINE_INVOICES_POPULATIONS_DISPLAY_DEFAULT/);
  assert.doesNotMatch(
    shellSource,
    /onPopulationsDisplayModeChange=\{\(mode\) => \{[\s\S]*fetch/,
  );
});

test('invoices-tab-only whitespace and 50/50 layout CSS exist', () => {
  assert.match(queueCss, /\.nx-we-invoices-tab\s*\{/);
  assert.match(queueCss, /margin-inline:\s*-22px/);
  assert.match(queueCss, /width:\s*calc\(100%\s*\+\s*44px\)/);
  assert.match(cdmCss, /nx-we-invoices-cdm-populations--both/);
  assert.match(cdmCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/);
  assert.match(cdmCss, /@media \(max-width: 1100px\)/);
  assert.match(cdmCss, /\.nx-we-invoices-cdm-population\s*\{[\s\S]*?border:\s*1px solid #cbd5e1/);
  assert.match(cdmCss, /\.nx-we-invoices-cdm-population\s+\.nx-income-cdm__cell--client/);
});
