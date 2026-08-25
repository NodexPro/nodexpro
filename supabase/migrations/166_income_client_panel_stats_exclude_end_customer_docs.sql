-- Fix office-client panel counters: do not mix represented-client → end-customer documents.
-- Office-client row (לקוחות המשרד) counts only documents in office-representative scope
-- for that Core client WITH no income_customer recipient (income_customer_id IS NULL).
-- End-customer docs (Test3 → Chicago/Unilever) remain exclusively in
-- income_client_document_management_end_customer_stats (migration 165).
-- Does not edit migrations 163/165. unpaid/credit rules unchanged from 163.

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
  with office_issued as (
    select
      d.id as income_document_id,
      case
        when d.acting_mode = 'self' then null
        when d.represented_client_id is not null
          and d.issuer_business_id = d.represented_client_id
          and (d.acting_mode = 'office_representative' or d.acting_mode is null)
          then d.represented_client_id
        when d.represented_client_id is null
          and d.acting_mode = 'office_representative'
          then d.issuer_business_id
        else null
      end as client_id,
      d.document_type,
      d.issue_date,
      d.updated_at,
      coalesce(nullif(d.currency, ''), 'ILS') as currency,
      case
        when d.document_type in ('tax_invoice', 'tax_invoice_receipt', 'deal_invoice') then
          public.accounting_base_income_invoice_original_amount(d.totals_snapshot_json)
        else 0::numeric
      end as original_amount
    from public.income_documents d
    where d.organization_id = p_org_id
      and d.document_status = 'issued'
      -- Office-client row only: no end-customer recipient (not Test3 → Chicago).
      and d.income_customer_id is null
      and d.document_type in (
        'quote',
        'deal_invoice',
        'tax_invoice',
        'tax_invoice_receipt',
        'receipt',
        'credit_tax_invoice'
      )
      and (d.acting_mode = 'office_representative' or d.acting_mode is null)
  ),
  paid as (
    select
      a.source_entity_id as income_document_id,
      round(coalesce(sum(a.allocated_amount), 0)::numeric, 2) as paid_amount
    from public.accounting_payment_allocations a
    where a.organization_id = p_org_id
      and a.source_module = 'income'
      and a.status = 'posted'
      and a.reversal_of_allocation_id is null
      and a.source_entity_id in (select income_document_id from office_issued)
    group by a.source_entity_id
  ),
  issued_credits as (
    select
      l.source_invoice_id as income_document_id,
      round(coalesce(sum(l.credited_amount_reference), 0)::numeric, 2) as credited_amount
    from public.income_document_credit_links l
    where l.organization_id = p_org_id
      and l.status = 'issued'
      and l.source_invoice_id in (select income_document_id from office_issued)
    group by l.source_invoice_id
  ),
  issued_agg as (
    select
      oi.client_id,
      count(*)::integer as total_documents_count,
      count(*) filter (where oi.document_type = 'quote')::integer as quote_issued_count,
      count(*) filter (where oi.document_type = 'deal_invoice')::integer as deal_issued_count,
      count(*) filter (where oi.document_type = 'tax_invoice')::integer as tax_invoice_issued_count,
      count(*) filter (where oi.document_type = 'tax_invoice_receipt')::integer as tax_invoice_receipt_issued_count,
      count(*) filter (where oi.document_type = 'receipt')::integer as receipt_issued_count,
      count(*) filter (where oi.document_type = 'credit_tax_invoice')::integer as credit_issued_count,
      max(oi.issue_date) as last_document_date,
      max(oi.updated_at) as last_activity_at,
      coalesce(
        sum(
          greatest(
            0::numeric,
            round(oi.original_amount, 2)
              - round(coalesce(p.paid_amount, 0::numeric), 2)
              - round(coalesce(c.credited_amount, 0::numeric), 2)
          )
        ),
        0::numeric
      ) as unpaid_reference,
      max(oi.currency) as currency
    from office_issued oi
    left join paid p on p.income_document_id = oi.income_document_id
    left join issued_credits c on c.income_document_id = oi.income_document_id
    where oi.client_id is not null
    group by oi.client_id
  ),
  office_drafts as (
    select
      case
        when d.acting_mode = 'self' then null
        when d.represented_client_id is not null
          and d.issuer_business_id = d.represented_client_id
          and (d.acting_mode = 'office_representative' or d.acting_mode is null)
          then d.represented_client_id
        when d.represented_client_id is null
          and d.acting_mode = 'office_representative'
          then d.issuer_business_id
        else null
      end as client_id,
      d.document_type,
      d.updated_at
    from public.income_document_drafts d
    where d.organization_id = p_org_id
      and d.status = 'draft'
      and d.user_saved_at is not null
      and d.income_customer_id is null
      and (d.acting_mode = 'office_representative' or d.acting_mode is null)
  ),
  draft_agg as (
    select
      client_id,
      count(*)::integer as draft_documents_count,
      count(*) filter (where document_type = 'quote')::integer as quote_draft_count,
      count(*) filter (where document_type = 'deal_invoice')::integer as deal_draft_count,
      count(*) filter (where document_type in ('tax_invoice', 'tax_invoice_receipt'))::integer as tax_invoice_draft_count,
      count(*) filter (where document_type = 'receipt')::integer as receipt_draft_count,
      count(*) filter (where document_type = 'credit_tax_invoice')::integer as credit_draft_count,
      max(updated_at) as last_activity_at
    from office_drafts
    where client_id is not null
    group by client_id
  ),
  client_ids as (
    select client_id from issued_agg
    union
    select client_id from draft_agg
  )
  select
    c.client_id as represented_client_id,
    coalesce(i.total_documents_count, 0) as total_documents_count,
    coalesce(d.draft_documents_count, 0) as draft_documents_count,
    coalesce(i.quote_issued_count, 0) + coalesce(d.quote_draft_count, 0) as quote_count,
    coalesce(i.deal_issued_count, 0) + coalesce(d.deal_draft_count, 0) as deal_count,
    coalesce(i.tax_invoice_issued_count, 0)
      + coalesce(i.tax_invoice_receipt_issued_count, 0)
      + coalesce(d.tax_invoice_draft_count, 0) as tax_invoice_count,
    coalesce(i.receipt_issued_count, 0) + coalesce(d.receipt_draft_count, 0) as receipt_count,
    coalesce(i.credit_issued_count, 0) + coalesce(d.credit_draft_count, 0) as credit_count,
    coalesce(i.quote_issued_count, 0) as quote_issued_count,
    coalesce(i.deal_issued_count, 0) as deal_issued_count,
    coalesce(i.tax_invoice_issued_count, 0) as tax_invoice_issued_count,
    coalesce(i.tax_invoice_receipt_issued_count, 0) as tax_invoice_receipt_issued_count,
    coalesce(i.receipt_issued_count, 0) as receipt_issued_count,
    coalesce(i.credit_issued_count, 0) as credit_issued_count,
    i.last_document_date,
    greatest(i.last_activity_at, d.last_activity_at) as last_activity_at,
    coalesce(i.unpaid_reference, 0::numeric) as unpaid_reference,
    coalesce(i.currency, 'ILS') as currency
  from client_ids c
  left join issued_agg i on i.client_id = c.client_id
  left join draft_agg d on d.client_id = c.client_id;
$$;

grant execute on function public.income_client_document_management_panel_stats(uuid) to service_role;

comment on function public.income_client_document_management_panel_stats(uuid) is
  'Office-client counters: office-representative docs for Core client with income_customer_id IS NULL only. End-customer docs stay in end_customer_stats. unpaid = original − allocations − issued credits.';
