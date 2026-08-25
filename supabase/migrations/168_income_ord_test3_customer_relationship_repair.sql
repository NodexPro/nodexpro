-- Forward-only repair: Ord (אורד בע״מ) under Test3 — create canonical income_customer
-- and link proven one_time_snapshot documents 1000 / 2000 / 2001.
--
-- Does NOT edit migration 167.
-- Does NOT change financial/legal document content or customer_snapshot_json.
-- Temporarily allows NULL → non-null income_customer_id fill (metadata only), then
-- restores income_documents_immutable_after_issue() to the 164 contract.

-- ---------------------------------------------------------------------------
-- 1) Narrow temporary exception: fill missing income_customer_id only
-- ---------------------------------------------------------------------------
create or replace function public.income_documents_immutable_after_issue()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    -- Temporary metadata repair (migration 168 only; removed when function restored below):
    -- allow filling NULL income_customer_id while leaving all other business fields unchanged.
    if (
      OLD.income_customer_id is null
      and NEW.income_customer_id is not null
      and OLD.organization_id is not distinct from NEW.organization_id
      and OLD.represented_client_id is not distinct from NEW.represented_client_id
      and OLD.issuer_business_id is not distinct from NEW.issuer_business_id
      and OLD.actor_user_id is not distinct from NEW.actor_user_id
      and OLD.acting_mode is not distinct from NEW.acting_mode
      and OLD.customer_snapshot_json is not distinct from NEW.customer_snapshot_json
      and OLD.document_type is not distinct from NEW.document_type
      and OLD.document_number is not distinct from NEW.document_number
      and OLD.document_status is not distinct from NEW.document_status
      and OLD.issue_date is not distinct from NEW.issue_date
      and OLD.currency is not distinct from NEW.currency
      and OLD.language is not distinct from NEW.language
      and OLD.lines_snapshot_json is not distinct from NEW.lines_snapshot_json
      and OLD.totals_snapshot_json is not distinct from NEW.totals_snapshot_json
      and OLD.legal_snapshot_json is not distinct from NEW.legal_snapshot_json
      and OLD.issuer_snapshot_json is not distinct from NEW.issuer_snapshot_json
      and OLD.source_draft_id is not distinct from NEW.source_draft_id
      and coalesce(OLD.customer_po_reference, '') is not distinct from coalesce(NEW.customer_po_reference, '')
    ) then
      return NEW;
    end if;

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

-- ---------------------------------------------------------------------------
-- 2) Idempotent create + link for Ord under Test3
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid := '31e8d298-054d-49c0-86c4-1b9045500f8e';
  v_test3_id uuid := '8b1a4555-4359-48a9-83f1-804d6d4473b3';
  v_tax_id text := '366588544';
  v_display_name text := E'אורד בע"מ';
  v_email text := 'marinator02@walla.com';
  v_customer_id uuid;
begin
  select c.id
    into v_customer_id
  from public.income_customers c
  where c.organization_id = v_org_id
    and c.represented_client_id = v_test3_id
    and c.issuer_business_id = v_test3_id
    and c.is_one_time = false
    and c.tax_id = v_tax_id
  order by c.created_at asc
  limit 1;

  if v_customer_id is null then
    insert into public.income_customers (
      organization_id,
      represented_client_id,
      issuer_business_id,
      display_name,
      phone,
      email,
      tax_id,
      address_json,
      default_payment_terms,
      is_one_time,
      status
    ) values (
      v_org_id,
      v_test3_id,
      v_test3_id,
      v_display_name,
      null,
      v_email,
      v_tax_id,
      null,
      'eom_plus_30',
      false,
      'active'
    )
    returning id into v_customer_id;
  end if;

  update public.income_documents d
  set income_customer_id = v_customer_id
  where d.organization_id = v_org_id
    and d.represented_client_id = v_test3_id
    and d.issuer_business_id = v_test3_id
    and d.acting_mode = 'office_representative'
    and d.income_customer_id is null
    and coalesce(d.customer_snapshot_json->>'source', '') = 'one_time_snapshot'
    and coalesce(d.customer_snapshot_json->>'tax_id', '') = v_tax_id
    and (
      (d.document_type = 'quote' and d.document_number = '1000')
      or (d.document_type = 'deal_invoice' and d.document_number in ('2000', '2001'))
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Restore immutability to migration 164 contract (no permanent NULL-fill hole)
-- ---------------------------------------------------------------------------
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

comment on function public.income_documents_immutable_after_issue() is
  'Issued income_documents immutability (164 contract). Migration 168 used a temporary NULL→FK fill then restored this body.';
