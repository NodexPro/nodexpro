/**
 * Directional document counter scope: office-client vs end-customer.
 * Test3 / Chicago / Unilever fixtures (no DB).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateDirectionalDocumentCounters,
  classifyDocumentPopulationForCounters,
  endCustomerPopulationKey,
  resolveOfficeClientCounterGroupKey,
  resolveOfficeClientGroupKey,
} from '../../src/domains/income/income-client-document-management-panel.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const migration166 = readFileSync(
  join(dir, '../../../../supabase/migrations/166_income_client_panel_stats_exclude_end_customer_docs.sql'),
  'utf8',
);
const migration165 = readFileSync(
  join(dir, '../../../../supabase/migrations/165_income_client_document_management_end_customer_stats.sql'),
  'utf8',
);
const panelSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);

const TEST3 = 'test3-client-id';
const CHICAGO = 'chicago-customer-id';
const UNILEVER = 'unilever-customer-id';

function officeRepDoc(params: {
  income_customer_id: string | null;
  document_type: string;
  represented_client_id?: string;
}) {
  const clientId = params.represented_client_id ?? TEST3;
  return {
    represented_client_id: clientId,
    issuer_business_id: clientId,
    acting_mode: 'office_representative',
    income_customer_id: params.income_customer_id,
    document_type: params.document_type,
  };
}

test('case 1 — Test3→Chicago/Unilever must not inflate Test3 office-client counters', () => {
  const docs = [
    officeRepDoc({ income_customer_id: CHICAGO, document_type: 'quote' }),
    officeRepDoc({ income_customer_id: CHICAGO, document_type: 'tax_invoice' }),
    officeRepDoc({ income_customer_id: UNILEVER, document_type: 'tax_invoice' }),
    officeRepDoc({ income_customer_id: UNILEVER, document_type: 'tax_invoice' }),
  ];

  const { office_clients, office_client_customers } = aggregateDirectionalDocumentCounters(docs);

  assert.equal(office_clients.has(TEST3), false);
  assert.deepEqual(office_clients.get(TEST3), undefined);

  const chicagoKey = endCustomerPopulationKey({
    representedClientId: TEST3,
    incomeCustomerId: CHICAGO,
  });
  const unileverKey = endCustomerPopulationKey({
    representedClientId: TEST3,
    incomeCustomerId: UNILEVER,
  });

  assert.deepEqual(office_client_customers.get(chicagoKey), {
    quote: 1,
    deal_invoice: 0,
    tax_invoice: 1,
    receipt: 0,
    credit_tax_invoice: 0,
  });
  assert.deepEqual(office_client_customers.get(unileverKey), {
    quote: 0,
    deal_invoice: 0,
    tax_invoice: 2,
    receipt: 0,
    credit_tax_invoice: 0,
  });
});

test('case 2 — office-client-scoped docs (income_customer_id null) stay on Test3 office row only', () => {
  const docs = [
    officeRepDoc({ income_customer_id: null, document_type: 'quote' }),
    officeRepDoc({ income_customer_id: null, document_type: 'deal_invoice' }),
    officeRepDoc({ income_customer_id: CHICAGO, document_type: 'quote' }),
    officeRepDoc({ income_customer_id: CHICAGO, document_type: 'tax_invoice' }),
    officeRepDoc({ income_customer_id: UNILEVER, document_type: 'tax_invoice' }),
    officeRepDoc({ income_customer_id: UNILEVER, document_type: 'tax_invoice' }),
  ];

  const { office_clients, office_client_customers } = aggregateDirectionalDocumentCounters(docs);

  assert.deepEqual(office_clients.get(TEST3), {
    quote: 1,
    deal_invoice: 1,
    tax_invoice: 0,
    receipt: 0,
    credit_tax_invoice: 0,
  });

  const chicagoKey = endCustomerPopulationKey({
    representedClientId: TEST3,
    incomeCustomerId: CHICAGO,
  });
  assert.deepEqual(office_client_customers.get(chicagoKey), {
    quote: 1,
    deal_invoice: 0,
    tax_invoice: 1,
    receipt: 0,
    credit_tax_invoice: 0,
  });
});

test('same represented_client_id as issuer elsewhere does not contaminate office counters when customer set', () => {
  assert.equal(
    resolveOfficeClientCounterGroupKey({
      represented_client_id: TEST3,
      issuer_business_id: TEST3,
      acting_mode: 'office_representative',
      income_customer_id: CHICAGO,
    }),
    null,
  );
  assert.equal(
    resolveOfficeClientGroupKey({
      represented_client_id: TEST3,
      issuer_business_id: TEST3,
      acting_mode: 'office_representative',
    }),
    TEST3,
  );
  assert.deepEqual(
    classifyDocumentPopulationForCounters({
      represented_client_id: TEST3,
      issuer_business_id: TEST3,
      acting_mode: 'office_representative',
      income_customer_id: CHICAGO,
    }),
    {
      population: 'office_client_customer',
      represented_client_id: TEST3,
      income_customer_id: CHICAGO,
    },
  );
});

test('Chicago and Unilever remain isolated under same parent Test3', () => {
  const a = endCustomerPopulationKey({ representedClientId: TEST3, incomeCustomerId: CHICAGO });
  const b = endCustomerPopulationKey({ representedClientId: TEST3, incomeCustomerId: UNILEVER });
  assert.notEqual(a, b);
});

test('migration 166 excludes end-customer docs from office panel_stats; 165 keeps customer scope', () => {
  assert.match(migration166, /income_customer_id is null/);
  assert.match(migration166, /create or replace function public\.income_client_document_management_panel_stats/);
  assert.match(migration166, /from public\.income_document_drafts d[\s\S]*income_customer_id is null/);
  assert.match(migration165, /income_customer_id is not null/);
  assert.match(migration165, /group by oi\.client_id, oi\.income_customer_id/);
  assert.match(panelSource, /166_income_client_panel_stats_exclude_end_customer_docs\.sql/);
  assert.doesNotMatch(panelSource, /population_key === 'office_client'/);
});

test('zero-document office client stays empty when only end-customer docs exist', () => {
  const { office_clients } = aggregateDirectionalDocumentCounters([
    officeRepDoc({ income_customer_id: CHICAGO, document_type: 'tax_invoice' }),
  ]);
  assert.equal(office_clients.size, 0);
});
