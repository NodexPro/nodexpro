/**
 * Directional document counter scope: office-client vs end-customer.
 * Test3 / Chicago / Unilever / NewCustomer fixtures (no DB).
 *
 * Canonical rules after relationship audit:
 * - OFFICE → Core client: not classifiable until recipient FK exists → never office counters
 * - Client → saved income_customer: end-customer counters only
 * - Client → one-time / null income_customer_id: excluded (not Office→client)
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
  mergeEndCustomersWithDocumentStats,
  resolveOfficeClientCounterGroupKey,
  resolveOfficeClientGroupKey,
  zeroEndCustomerDocumentStat,
} from '../../src/domains/income/income-client-document-management-panel.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const migration166 = readFileSync(
  join(dir, '../../../../supabase/migrations/166_income_client_panel_stats_exclude_end_customer_docs.sql'),
  'utf8',
);
const migration167 = readFileSync(
  join(dir, '../../../../supabase/migrations/167_income_client_panel_stats_office_to_client_scope.sql'),
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
const documentsByTypeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts'),
  'utf8',
);

const TEST3 = 'test3-client-id';
const CHICAGO = 'chicago-customer-id';
const UNILEVER = 'unilever-customer-id';
const NEW_CUSTOMER = 'new-customer-id';

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

test('scenario 1 — zero OFFICE→Test3; Test3→Chicago/Unilever only on end-customer; NewCustomer zero row via merge', () => {
  const docs = [
    officeRepDoc({ income_customer_id: CHICAGO, document_type: 'quote' }),
    officeRepDoc({ income_customer_id: CHICAGO, document_type: 'deal_invoice' }),
    officeRepDoc({ income_customer_id: UNILEVER, document_type: 'quote' }),
  ];

  const { office_clients, office_client_customers } = aggregateDirectionalDocumentCounters(docs);

  assert.equal(office_clients.size, 0);

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
    deal_invoice: 1,
    tax_invoice: 0,
    receipt: 0,
    credit_tax_invoice: 0,
  });
  assert.deepEqual(office_client_customers.get(unileverKey), {
    quote: 1,
    deal_invoice: 0,
    tax_invoice: 0,
    receipt: 0,
    credit_tax_invoice: 0,
  });

  const merged = mergeEndCustomersWithDocumentStats(
    [
      { id: CHICAGO, represented_client_id: TEST3 },
      { id: UNILEVER, represented_client_id: TEST3 },
      { id: NEW_CUSTOMER, represented_client_id: TEST3 },
    ],
    new Map([
      [
        chicagoKey,
        {
          represented_client_id: TEST3,
          income_customer_id: CHICAGO,
          quote_issued_count: 1,
        },
      ],
      [
        unileverKey,
        {
          represented_client_id: TEST3,
          income_customer_id: UNILEVER,
          quote_issued_count: 1,
        },
      ],
    ]),
    zeroEndCustomerDocumentStat,
  );

  assert.equal(merged.length, 3);
  const newRow = merged.find((r) => r.incomeCustomerId === NEW_CUSTOMER);
  assert.ok(newRow);
  assert.equal(newRow.stat.quote_issued_count, 0);
  assert.equal(newRow.stat.deal_issued_count, 0);
});

test('scenario 3 — legacy null income_customer_id under office_representative is NOT Office→Test3', () => {
  const docs = [
    officeRepDoc({ income_customer_id: null, document_type: 'quote' }),
    officeRepDoc({ income_customer_id: null, document_type: 'deal_invoice' }),
    officeRepDoc({ income_customer_id: CHICAGO, document_type: 'quote' }),
  ];

  const { office_clients, office_client_customers } = aggregateDirectionalDocumentCounters(docs);

  assert.equal(office_clients.size, 0);
  assert.deepEqual(
    classifyDocumentPopulationForCounters(officeRepDoc({ income_customer_id: null, document_type: 'quote' })),
    { population: 'excluded' },
  );

  const chicagoKey = endCustomerPopulationKey({
    representedClientId: TEST3,
    incomeCustomerId: CHICAGO,
  });
  assert.deepEqual(office_client_customers.get(chicagoKey), {
    quote: 1,
    deal_invoice: 0,
    tax_invoice: 0,
    receipt: 0,
    credit_tax_invoice: 0,
  });
});

test('office_representative never yields office-client counter key (schema gap)', () => {
  assert.equal(
    resolveOfficeClientCounterGroupKey({
      represented_client_id: TEST3,
      issuer_business_id: TEST3,
      acting_mode: 'office_representative',
      income_customer_id: null,
    }),
    null,
  );
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

test('migration 167 empties office panel_stats; 165 keeps customer scope; panel + modal share customer scope', () => {
  assert.match(migration166, /income_customer_id is null/);
  assert.match(migration167, /create or replace function public\.income_client_document_management_panel_stats/);
  assert.match(migration167, /where false/);
  assert.match(migration167, /Office→Core-client/);
  assert.match(migration165, /income_customer_id is not null/);
  assert.match(migration165, /group by oi\.client_id, oi\.income_customer_id/);
  assert.match(panelSource, /167_income_client_panel_stats_office_to_client_scope\.sql/);
  assert.match(panelSource, /mergeEndCustomersWithDocumentStats/);
  assert.match(panelSource, /from\('income_customers'\)/);
  assert.match(panelSource, /eq\('is_one_time', false\)/);
  assert.doesNotMatch(panelSource, /population_key === 'office_client'/);
  assert.match(documentsByTypeSource, /incomeCustomerId/);
  assert.match(documentsByTypeSource, /if \(!params\.incomeCustomerId\) \{\s*return \[\];/);
});

test('scenario 4 — NewCustomer with zero docs still in canonical population merge', () => {
  const merged = mergeEndCustomersWithDocumentStats(
    [{ id: NEW_CUSTOMER, represented_client_id: TEST3 }],
    new Map(),
    zeroEndCustomerDocumentStat,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].incomeCustomerId, NEW_CUSTOMER);
  assert.equal(merged[0].stat.total_documents_count, 0);
});
