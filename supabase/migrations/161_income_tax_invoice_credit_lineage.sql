-- Tax invoice → credit_tax_invoice lineage + atomic remaining-creditable control.
-- Does not mutate issued tax invoices. Credit notes remain separate income_documents.

create table if not exists public.income_document_credit_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  issuer_business_id uuid not null,
  represented_client_id uuid,
  source_invoice_id uuid not null references public.income_documents (id) on delete restrict,
  credit_draft_id uuid not null references public.income_document_drafts (id) on delete restrict,
  credit_document_id uuid references public.income_documents (id) on delete restrict,
  credit_mode text not null check (credit_mode in ('full', 'partial')),
  reason_key text not null,
  reason_note text,
  status text not null check (status in ('draft', 'issued')),
  source_invoice_number text,
  lines_json jsonb not null default '[]'::jsonb,
  credited_amount_reference numeric(14, 2),
  idempotency_key text,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  unique (credit_draft_id),
  unique (organization_id, idempotency_key)
);

create unique index if not exists income_document_credit_links_credit_document_uidx
  on public.income_document_credit_links (credit_document_id)
  where credit_document_id is not null;

create index if not exists income_document_credit_links_source_issued_idx
  on public.income_document_credit_links (organization_id, source_invoice_id, status);

create table if not exists public.income_invoice_credit_control (
  source_invoice_id uuid primary key references public.income_documents (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  original_amount_reference numeric(14, 2) not null,
  credited_amount_reference numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now(),
  check (credited_amount_reference >= 0),
  check (credited_amount_reference <= original_amount_reference + 0.009)
);

create table if not exists public.income_invoice_credit_line_control (
  source_invoice_id uuid not null references public.income_documents (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_line_identity text not null,
  original_quantity numeric(14, 4) not null,
  original_amount_reference numeric(14, 2) not null,
  credited_quantity numeric(14, 4) not null default 0,
  credited_amount_reference numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (source_invoice_id, source_line_identity),
  check (credited_quantity >= 0),
  check (credited_amount_reference >= 0),
  check (credited_quantity <= original_quantity + 0.0009),
  check (credited_amount_reference <= original_amount_reference + 0.009)
);

alter table public.income_document_credit_links enable row level security;
alter table public.income_invoice_credit_control enable row level security;
alter table public.income_invoice_credit_line_control enable row level security;
