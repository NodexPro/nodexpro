-- INC-4: Issued income documents + backend-only numbering (document snapshot — not Accounting Base truth).

create table if not exists public.income_document_numbering_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  represented_client_id uuid null references public.clients(id) on delete set null,
  issuer_business_id uuid not null,
  document_type text not null check (
    document_type in (
      'receipt',
      'tax_invoice',
      'tax_invoice_receipt',
      'credit_tax_invoice',
      'deal_invoice',
      'quote'
    )
  ),
  year int not null,
  current_number int not null default 0,
  prefix text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint income_document_numbering_sequences_unique
    unique nulls not distinct (organization_id, issuer_business_id, document_type, year, represented_client_id)
);

create index if not exists idx_income_doc_numbering_org_issuer
  on public.income_document_numbering_sequences (organization_id, issuer_business_id);

drop trigger if exists income_document_numbering_sequences_updated_at on public.income_document_numbering_sequences;
create trigger income_document_numbering_sequences_updated_at
  before update on public.income_document_numbering_sequences
  for each row execute function public.set_updated_at();

alter table public.income_document_numbering_sequences enable row level security;

drop policy if exists "income_document_numbering_sequences_select_org_member" on public.income_document_numbering_sequences;
create policy "income_document_numbering_sequences_select_org_member"
  on public.income_document_numbering_sequences for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.income_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  represented_client_id uuid null references public.clients(id) on delete set null,
  issuer_business_id uuid not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  acting_mode text not null check (acting_mode in ('self', 'office_representative')),
  income_customer_id uuid null references public.income_customers(id) on delete set null,
  customer_snapshot_json jsonb not null default '{}'::jsonb,
  document_type text not null check (
    document_type in (
      'receipt',
      'tax_invoice',
      'tax_invoice_receipt',
      'credit_tax_invoice',
      'deal_invoice',
      'quote'
    )
  ),
  document_number text not null,
  document_status text not null default 'issued' check (document_status in ('issued', 'cancelled_future')),
  issue_date date not null,
  currency text not null default 'ILS',
  language text not null default 'he',
  lines_snapshot_json jsonb not null default '[]'::jsonb,
  totals_snapshot_json jsonb not null default '{}'::jsonb,
  legal_snapshot_json jsonb not null default '{}'::jsonb,
  issuer_snapshot_json jsonb not null default '{}'::jsonb,
  source_draft_id uuid null references public.income_document_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_income_documents_org_document_number
  on public.income_documents (organization_id, issuer_business_id, document_number);

create index if not exists idx_income_documents_org_issuer
  on public.income_documents (organization_id, issuer_business_id);

create index if not exists idx_income_documents_org_status
  on public.income_documents (organization_id, document_status);

create index if not exists idx_income_documents_source_draft
  on public.income_documents (source_draft_id)
  where source_draft_id is not null;

drop trigger if exists income_documents_updated_at on public.income_documents;
create trigger income_documents_updated_at
  before update on public.income_documents
  for each row execute function public.set_updated_at();

create or replace function public.income_documents_immutable_after_issue()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    raise exception 'income_documents are immutable after issue';
  end if;
  return NEW;
end;
$$;

drop trigger if exists income_documents_immutable on public.income_documents;
create trigger income_documents_immutable
  before update on public.income_documents
  for each row execute function public.income_documents_immutable_after_issue();

alter table public.income_documents enable row level security;

drop policy if exists "income_documents_select_org_member" on public.income_documents;
create policy "income_documents_select_org_member"
  on public.income_documents for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_documents_insert_org_member" on public.income_documents;
create policy "income_documents_insert_org_member"
  on public.income_documents for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

alter table public.income_document_drafts
  drop constraint if exists income_document_drafts_status_check;

alter table public.income_document_drafts
  add column if not exists issued_document_id uuid null references public.income_documents(id) on delete set null,
  add column if not exists issued_at timestamptz null;

alter table public.income_document_drafts
  add constraint income_document_drafts_status_check
  check (status in ('draft', 'cancelled', 'issued'));

create or replace function public.allocate_income_document_number(
  p_organization_id uuid,
  p_issuer_business_id uuid,
  p_represented_client_id uuid,
  p_document_type text,
  p_year int,
  p_prefix text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
  v_document_number text;
begin
  insert into public.income_document_numbering_sequences (
    organization_id,
    issuer_business_id,
    represented_client_id,
    document_type,
    year,
    current_number,
    prefix
  )
  values (
    p_organization_id,
    p_issuer_business_id,
    p_represented_client_id,
    p_document_type,
    p_year,
    1,
    p_prefix
  )
  on conflict on constraint income_document_numbering_sequences_unique
  do update set
    current_number = public.income_document_numbering_sequences.current_number + 1,
    updated_at = now()
  returning current_number into v_seq;

  if p_prefix is not null and btrim(p_prefix) <> '' then
    v_document_number := btrim(p_prefix) || v_seq::text;
  else
    v_document_number := p_year::text || '-' || lpad(v_seq::text, 4, '0');
  end if;

  return jsonb_build_object(
    'sequence_number', v_seq,
    'year', p_year,
    'document_number', v_document_number
  );
end;
$$;

grant execute on function public.allocate_income_document_number(uuid, uuid, uuid, text, int, text) to service_role;
