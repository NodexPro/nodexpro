-- Income document branding profile — per issuer (self org profile or office client).
-- Source of truth for preview / PDF / email presentation (not financial truth).

create table if not exists public.income_document_branding_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  issuer_business_id uuid not null,
  represented_client_id uuid null references public.clients(id) on delete cascade,

  logo_file_asset_id uuid null references public.file_assets(id) on delete set null,
  signature_file_asset_id uuid null references public.file_assets(id) on delete set null,

  company_subtitle text null,

  primary_color text not null default '#1f4b99',
  secondary_color text not null default '#e8eef7',
  table_header_color text not null default '#1f4b99',
  totals_color text not null default '#1f4b99',

  client_block_position text not null default 'right'
    check (client_block_position in ('left', 'right')),

  footer_text text null,

  bank_name text null,
  bank_branch text null,
  bank_account text null,
  swift text null,
  iban text null,

  email_subject_template text null,
  email_body_template text null,

  customer_notes text null,
  terms_and_conditions text null,

  display_options jsonb not null default '{}'::jsonb,
  payment_methods jsonb not null default '[]'::jsonb,
  document_attachments jsonb not null default '[]'::jsonb,
  default_payment_terms jsonb null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, issuer_business_id)
);

create index if not exists idx_income_doc_branding_org_issuer
  on public.income_document_branding_profiles (organization_id, issuer_business_id);

comment on table public.income_document_branding_profiles is
  'Per-issuer document branding: logo, colors, display flags, footer/bank, email templates.';

drop trigger if exists trg_income_document_branding_profiles_updated_at on public.income_document_branding_profiles;
create trigger trg_income_document_branding_profiles_updated_at
  before update on public.income_document_branding_profiles
  for each row execute function public.set_updated_at();

alter table public.income_document_branding_profiles enable row level security;

drop policy if exists income_document_branding_profiles_select on public.income_document_branding_profiles;
create policy income_document_branding_profiles_select on public.income_document_branding_profiles
  for select using (
    organization_id in (select public.organizations_for_current_auth_user())
  );

drop policy if exists income_document_branding_profiles_insert on public.income_document_branding_profiles;
create policy income_document_branding_profiles_insert on public.income_document_branding_profiles
  for insert with check (
    organization_id in (select public.organizations_for_current_auth_user())
  );

drop policy if exists income_document_branding_profiles_update on public.income_document_branding_profiles;
create policy income_document_branding_profiles_update on public.income_document_branding_profiles
  for update using (
    organization_id in (select public.organizations_for_current_auth_user())
  );
