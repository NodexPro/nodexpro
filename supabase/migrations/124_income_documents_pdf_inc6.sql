-- INC-6: Income issued document PDF rendering metadata.

alter table public.income_documents
  add column if not exists pdf_asset_id uuid null references public.file_assets(id) on delete set null,
  add column if not exists pdf_render_status text not null default 'pending'
    check (pdf_render_status in ('pending', 'rendered', 'failed')),
  add column if not exists pdf_render_error text null,
  add column if not exists pdf_rendered_at timestamptz null,
  add column if not exists render_snapshot_json jsonb null,
  add column if not exists pdf_template_key text null;

create index if not exists idx_income_documents_pdf_render_status
  on public.income_documents (organization_id, pdf_render_status);

create or replace function public.income_documents_immutable_after_issue()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
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
    ) then
      raise exception 'income_documents business fields are immutable after issue';
    end if;
    return NEW;
  end if;
  return NEW;
end;
$$;
