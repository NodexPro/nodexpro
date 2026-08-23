-- Preliminary document open/closed lifecycle (quote / deal_invoice only).
-- Reopen keeps the same document id + number; conversion lineage is retained.

alter table public.income_documents
  add column if not exists preliminary_lifecycle_state text null
    check (
      preliminary_lifecycle_state is null
      or preliminary_lifecycle_state in ('open', 'closed')
    ),
  add column if not exists preliminary_closed_at timestamptz null,
  add column if not exists preliminary_closed_by_downstream_document_id uuid null
    references public.income_documents(id) on delete set null,
  add column if not exists preliminary_reopened_at timestamptz null,
  add column if not exists preliminary_reopened_by_user_id uuid null
    references public.users(id) on delete set null,
  add column if not exists preliminary_reopen_reason text null;

comment on column public.income_documents.preliminary_lifecycle_state is
  'Quote/deal only: open|closed. Null = open for preliminary; unused for tax/receipt/credit.';
comment on column public.income_documents.preliminary_closed_by_downstream_document_id is
  'Issued downstream document that closed this preliminary source (conversion lineage).';

-- Allow lifecycle metadata updates on issued quote/deal without touching legal/number truth.
create or replace function public.income_documents_immutable_after_issue()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    -- Preliminary cancel exception (quote / deal_invoice only).
    if (
      OLD.document_status = 'issued'
      and NEW.document_status = 'cancelled_future'
      and OLD.document_type in ('quote', 'deal_invoice')
      and OLD.organization_id is not distinct from NEW.organization_id
      and OLD.represented_client_id is not distinct from NEW.represented_client_id
      and OLD.issuer_business_id is not distinct from NEW.issuer_business_id
      and OLD.actor_user_id is not distinct from NEW.actor_user_id
      and OLD.acting_mode is not distinct from NEW.acting_mode
      and OLD.income_customer_id is not distinct from NEW.income_customer_id
      and OLD.customer_snapshot_json is not distinct from NEW.customer_snapshot_json
      and OLD.document_type is not distinct from NEW.document_type
      and OLD.document_number is not distinct from NEW.document_number
      and OLD.issue_date is not distinct from NEW.issue_date
      and OLD.currency is not distinct from NEW.currency
      and OLD.language is not distinct from NEW.language
      and OLD.lines_snapshot_json is not distinct from NEW.lines_snapshot_json
      and OLD.totals_snapshot_json is not distinct from NEW.totals_snapshot_json
      and OLD.legal_snapshot_json is not distinct from NEW.legal_snapshot_json
      and OLD.issuer_snapshot_json is not distinct from NEW.issuer_snapshot_json
      and OLD.source_draft_id is not distinct from NEW.source_draft_id
    ) then
      return NEW;
    end if;

    -- Preliminary open/closed lifecycle (same document id + number).
    if (
      OLD.document_status = 'issued'
      and NEW.document_status = 'issued'
      and OLD.document_type in ('quote', 'deal_invoice')
      and OLD.organization_id is not distinct from NEW.organization_id
      and OLD.represented_client_id is not distinct from NEW.represented_client_id
      and OLD.issuer_business_id is not distinct from NEW.issuer_business_id
      and OLD.actor_user_id is not distinct from NEW.actor_user_id
      and OLD.acting_mode is not distinct from NEW.acting_mode
      and OLD.income_customer_id is not distinct from NEW.income_customer_id
      and OLD.customer_snapshot_json is not distinct from NEW.customer_snapshot_json
      and OLD.document_type is not distinct from NEW.document_type
      and OLD.document_number is not distinct from NEW.document_number
      and OLD.issue_date is not distinct from NEW.issue_date
      and OLD.currency is not distinct from NEW.currency
      and OLD.language is not distinct from NEW.language
      and OLD.lines_snapshot_json is not distinct from NEW.lines_snapshot_json
      and OLD.totals_snapshot_json is not distinct from NEW.totals_snapshot_json
      and OLD.legal_snapshot_json is not distinct from NEW.legal_snapshot_json
      and OLD.issuer_snapshot_json is not distinct from NEW.issuer_snapshot_json
      and OLD.source_draft_id is not distinct from NEW.source_draft_id
      and coalesce(OLD.customer_po_reference, '') is not distinct from coalesce(NEW.customer_po_reference, '')
      and (
        OLD.preliminary_lifecycle_state is distinct from NEW.preliminary_lifecycle_state
        or OLD.preliminary_closed_at is distinct from NEW.preliminary_closed_at
        or OLD.preliminary_closed_by_downstream_document_id is distinct from NEW.preliminary_closed_by_downstream_document_id
        or OLD.preliminary_reopened_at is distinct from NEW.preliminary_reopened_at
        or OLD.preliminary_reopened_by_user_id is distinct from NEW.preliminary_reopened_by_user_id
        or OLD.preliminary_reopen_reason is distinct from NEW.preliminary_reopen_reason
      )
    ) then
      return NEW;
    end if;

    if (
      OLD.organization_id is distinct from NEW.organization_id
      or OLD.represented_client_id is distinct from NEW.represented_client_id
      or OLD.issuer_business_id is distinct from NEW.issuer_business_id
      or OLD.actor_user_id is distinct from NEW.actor_user_id
      or OLD.acting_mode is distinct from NEW.acting_mode
      or OLD.income_customer_id is distinct from NEW.income_customer_id
      or OLD.customer_snapshot_json is distinct from NEW.customer_snapshot_json
      or OLD.document_type is distinct from NEW.document_type
      or OLD.document_number is distinct from NEW.document_number
      or OLD.document_status is distinct from NEW.document_status
      or OLD.issue_date is distinct from NEW.issue_date
      or OLD.currency is distinct from NEW.currency
      or OLD.language is distinct from NEW.language
      or OLD.lines_snapshot_json is distinct from NEW.lines_snapshot_json
      or OLD.totals_snapshot_json is distinct from NEW.totals_snapshot_json
      or OLD.legal_snapshot_json is distinct from NEW.legal_snapshot_json
      or OLD.issuer_snapshot_json is distinct from NEW.issuer_snapshot_json
      or OLD.source_draft_id is distinct from NEW.source_draft_id
      or OLD.customer_po_reference is distinct from NEW.customer_po_reference
    ) then
      raise exception 'income_documents business fields are immutable after issue';
    end if;
    return NEW;
  end if;
  return NEW;
end;
$$;
