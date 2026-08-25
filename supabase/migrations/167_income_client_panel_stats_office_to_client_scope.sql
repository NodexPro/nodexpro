-- Canonical correction: office_clients_section must NOT count office_representative documents.
--
-- Domain truth (income-issuer-context):
--   office_representative ⇒ issuer_business_id = represented_client_id
--   = document issued AS the Core client (Client → recipient)
--   NEVER Accounting Office → Core client.
--
-- Migration 166's `income_customer_id IS NULL` filter was insufficient:
-- one-time recipients keep income_customer_id NULL + customer snapshot and still
-- belong to Client → recipient, not Office → client.
--
-- True Office → Core-client recipient FK does not exist yet (self-mode recipients
-- are income_customers with represented_client_id NULL; no link to clients.id).
-- Until that schema exists, office panel_stats intentionally returns no document rows.
-- End-customer counters remain in income_client_document_management_end_customer_stats (165).
-- Does not edit migrations 163/165/166.

create or replace function public.income_client_document_management_panel_stats(
  p_org_id uuid
)
returns table (
  represented_client_id uuid,
  total_documents_count integer,
  draft_documents_count integer,
  quote_count integer,
  deal_count integer,
  tax_invoice_count integer,
  receipt_count integer,
  credit_count integer,
  quote_issued_count integer,
  deal_issued_count integer,
  tax_invoice_issued_count integer,
  tax_invoice_receipt_issued_count integer,
  receipt_issued_count integer,
  credit_issued_count integer,
  last_document_date date,
  last_activity_at timestamptz,
  unpaid_reference numeric,
  currency text
)
language sql
stable
as $$
  -- No classifiable OFFICE → Core-client documents in current schema.
  -- Keep signature/contract; return empty set (org scoped no-op uses p_org_id).
  select
    null::uuid as represented_client_id,
    0::integer as total_documents_count,
    0::integer as draft_documents_count,
    0::integer as quote_count,
    0::integer as deal_count,
    0::integer as tax_invoice_count,
    0::integer as receipt_count,
    0::integer as credit_count,
    0::integer as quote_issued_count,
    0::integer as deal_issued_count,
    0::integer as tax_invoice_issued_count,
    0::integer as tax_invoice_receipt_issued_count,
    0::integer as receipt_issued_count,
    0::integer as credit_issued_count,
    null::date as last_document_date,
    null::timestamptz as last_activity_at,
    0::numeric as unpaid_reference,
    'ILS'::text as currency
  where false
    and p_org_id is not null;
$$;

grant execute on function public.income_client_document_management_panel_stats(uuid) to service_role;

comment on function public.income_client_document_management_panel_stats(uuid) is
  'Office-client cubes: empty until Office→Core-client recipient linkage exists. office_representative docs are Client→recipient (see end_customer_stats).';
