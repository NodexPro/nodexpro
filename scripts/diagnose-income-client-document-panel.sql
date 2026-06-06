-- Diagnose Income Client Document Management panel (run in Supabase SQL editor).
-- Replace :org_id with your organization UUID.

-- 1) Issued income_documents totals
select
  count(*) as issued_total,
  count(*) filter (where represented_client_id is not null) as issued_with_represented_client,
  count(*) filter (where represented_client_id is null and acting_mode = 'self') as issued_self_mode_excluded,
  count(*) filter (where acting_mode = 'office_representative') as issued_office_mode,
  count(*) filter (
    where document_type in ('quote', 'deal_invoice', 'tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_tax_invoice')
  ) as issued_panel_document_types
from public.income_documents
where organization_id = :org_id
  and document_status = 'issued';

-- 1b) Self-mode drafts (excluded from panel)
select count(*) as self_mode_draft_count
from public.income_document_drafts
where organization_id = :org_id
  and status = 'draft'
  and acting_mode = 'self';

-- 2) Issued documents grouped by represented_client_id (panel primary key)
select
  represented_client_id,
  acting_mode,
  count(*) as issued_count,
  array_agg(distinct document_type order by document_type) as document_types,
  max(issue_date) as last_issue_date
from public.income_documents
where organization_id = :org_id
  and document_status = 'issued'
  and document_type in ('quote', 'deal_invoice', 'tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_tax_invoice')
group by represented_client_id, acting_mode
order by issued_count desc;

-- 3) Office issued fallback grouping by issuer_business_id when represented_client_id is null
select
  issuer_business_id,
  count(*) as issued_count,
  array_agg(distinct document_type order by document_type) as document_types
from public.income_documents
where organization_id = :org_id
  and document_status = 'issued'
  and acting_mode = 'office_representative'
  and represented_client_id is null
group by issuer_business_id;

-- 4) Active drafts with office client (included in panel after fix)
select
  represented_client_id,
  count(*) as draft_count,
  array_agg(distinct document_type order by document_type) as document_types,
  max(updated_at) as last_draft_activity
from public.income_document_drafts
where organization_id = :org_id
  and status = 'draft'
  and represented_client_id is not null
group by represented_client_id
order by draft_count desc;

-- 5) Combined client keys (issued + drafts) — expected panel row count
with issued_clients as (
  select coalesce(represented_client_id, issuer_business_id) as client_id
  from public.income_documents
  where organization_id = :org_id
    and document_status = 'issued'
    and document_type in ('quote', 'deal_invoice', 'tax_invoice', 'tax_invoice_receipt', 'receipt', 'credit_tax_invoice')
    and (represented_client_id is not null or acting_mode = 'office_representative')
),
draft_clients as (
  select represented_client_id as client_id
  from public.income_document_drafts
  where organization_id = :org_id
    and status = 'draft'
    and represented_client_id is not null
)
select client_id, count(*) as sources
from (
  select client_id from issued_clients
  union all
  select client_id from draft_clients
) u
group by client_id
order by sources desc;
