-- Organization settings: profile, document identity, signature, bank details.
-- Owner-only edit. Multi-tenant isolation via organization_id.

create table if not exists public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade unique,
  -- Organization profile
  organization_name text,
  legal_entity_type text check (legal_entity_type in ('exempt_dealer', 'registered_dealer', 'company', 'other_corporation', 'other')),
  legal_id_number text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postal_code text,
  country char(2),
  phone text,
  website text,
  logo_file_asset_id uuid references public.file_assets(id) on delete set null,
  -- Document identity
  display_name_on_documents text,
  display_phone_on_documents boolean not null default true,
  display_website_on_documents boolean not null default true,
  display_address_on_documents boolean not null default true,
  document_footer_note text,
  -- Signature
  signature_text text,
  signature_image_file_asset_id uuid references public.file_assets(id) on delete set null,
  -- Bank details (sensitive)
  bank_account_holder text,
  bank_name text,
  bank_branch text,
  bank_account_number text,
  iban text,
  swift text,
  display_bank_details_on_documents boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_organization_settings_org on public.organization_settings(organization_id);

create trigger organization_settings_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();

comment on column public.organization_settings.legal_entity_type is 'exempt_dealer=עוסק פטור, registered_dealer=עוסק מורשה, company=חברה, other_corporation=תאגיד אחר, other=אחר';
comment on column public.organization_settings.document_footer_note is 'Optional footer e.g. This business operates through NodexPro. Localizable.';
comment on column public.organization_settings.bank_account_number is 'SENSITIVE. Only returned to owner.';
