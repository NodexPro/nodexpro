-- Country Pack Foundation schema (Phase 7 / Prompt 2).
-- Scope: schema + constraints + indexes + RLS baseline only.
-- No services, no commands, no API/UI, no module integration.

create extension if not exists btree_gist;

-- ==================================================
-- 1) countries
-- ==================================================
create table if not exists public.countries (
  code char(2) primary key,
  name text not null,
  status text not null check (status in ('active', 'disabled')),
  default_timezone text null,
  created_at timestamptz not null default now(),
  check (btrim(code::text) <> ''),
  check (btrim(name) <> '')
);

create index if not exists idx_countries_status
  on public.countries (status);

-- ==================================================
-- 2) country_packs
-- ==================================================
create table if not exists public.country_packs (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  pack_code text not null,
  name text not null,
  status text not null check (status in ('draft', 'enabled', 'disabled')),
  module_code text null,
  framework_version text not null,
  code_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(pack_code) <> ''),
  check (btrim(name) <> ''),
  check (btrim(framework_version) <> ''),
  check (btrim(code_version) <> '')
);

create unique index if not exists uq_country_packs_country_pack_code
  on public.country_packs (country_code, pack_code);

create unique index if not exists uq_country_packs_id_country
  on public.country_packs (id, country_code);

create index if not exists idx_country_packs_country_code
  on public.country_packs (country_code);

create index if not exists idx_country_packs_status
  on public.country_packs (status);

create trigger country_packs_updated_at
  before update on public.country_packs
  for each row execute function public.set_updated_at();

-- ==================================================
-- 3) country_pack_rulesets
-- ==================================================
create table if not exists public.country_pack_rulesets (
  id uuid primary key default gen_random_uuid(),
  country_pack_id uuid not null references public.country_packs(id) on delete cascade,
  ruleset_code text not null,
  ruleset_version text not null,
  legal_basis_reference text null,
  effective_from date not null,
  effective_to date null,
  status text not null check (status in ('draft', 'active', 'deprecated', 'disabled')),
  checksum text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(ruleset_code) <> ''),
  check (btrim(ruleset_version) <> ''),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists uq_country_pack_rulesets_pack_code
  on public.country_pack_rulesets (country_pack_id, ruleset_code);

create unique index if not exists uq_country_pack_rulesets_pack_version
  on public.country_pack_rulesets (country_pack_id, ruleset_version);

create unique index if not exists uq_country_pack_rulesets_id_pack
  on public.country_pack_rulesets (id, country_pack_id);

create index if not exists idx_country_pack_rulesets_pack_id
  on public.country_pack_rulesets (country_pack_id);

create index if not exists idx_country_pack_rulesets_pack_status
  on public.country_pack_rulesets (country_pack_id, status);

create index if not exists idx_country_pack_rulesets_effective_dates
  on public.country_pack_rulesets (country_pack_id, effective_from, effective_to);

create trigger country_pack_rulesets_updated_at
  before update on public.country_pack_rulesets
  for each row execute function public.set_updated_at();

-- DB-level ACTIVE overlap protection for same pack.
alter table public.country_pack_rulesets
  add constraint country_pack_rulesets_no_active_overlap
  exclude using gist (
    country_pack_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
  where (status = 'active');

-- ==================================================
-- 4) organization_country_settings
-- ==================================================
create table if not exists public.organization_country_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  country_code char(2) not null references public.countries(code) on delete restrict,
  active_country_pack_id uuid null,
  active_ruleset_id uuid null,
  settings_status text not null check (settings_status in ('not_configured', 'active', 'disabled', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id),
  check (
    (active_country_pack_id is null and active_ruleset_id is null)
    or
    (active_country_pack_id is not null and active_ruleset_id is not null)
  )
);

alter table public.organization_country_settings
  add constraint organization_country_settings_pack_country_fk
  foreign key (active_country_pack_id, country_code)
  references public.country_packs (id, country_code)
  on delete restrict;

alter table public.organization_country_settings
  add constraint organization_country_settings_active_ruleset_pack_fk
  foreign key (active_ruleset_id, active_country_pack_id)
  references public.country_pack_rulesets (id, country_pack_id)
  on delete restrict;

create index if not exists idx_org_country_settings_org_id
  on public.organization_country_settings (organization_id);

create index if not exists idx_org_country_settings_country_code
  on public.organization_country_settings (country_code);

create index if not exists idx_org_country_settings_active_pack
  on public.organization_country_settings (active_country_pack_id);

create index if not exists idx_org_country_settings_active_ruleset
  on public.organization_country_settings (active_ruleset_id);

create trigger organization_country_settings_updated_at
  before update on public.organization_country_settings
  for each row execute function public.set_updated_at();

-- ==================================================
-- 5) country_extension_capabilities
-- ==================================================
create table if not exists public.country_extension_capabilities (
  id uuid primary key default gen_random_uuid(),
  country_pack_id uuid not null references public.country_packs(id) on delete cascade,
  capability_code text not null,
  status text not null check (status in ('enabled', 'disabled')),
  created_at timestamptz not null default now(),
  check (btrim(capability_code) <> ''),
  unique (country_pack_id, capability_code)
);

create index if not exists idx_country_extension_capabilities_pack
  on public.country_extension_capabilities (country_pack_id);

create index if not exists idx_country_extension_capabilities_status
  on public.country_extension_capabilities (status);

-- ==================================================
-- 6) country_legal_values
-- ==================================================
create table if not exists public.country_legal_values (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  value_key text not null,
  label text not null,
  category text not null check (
    category in (
      'VAT',
      'Income Tax',
      'National Insurance',
      'Credit Points',
      'Pricing',
      'Reports',
      'Calendar',
      'Modules'
    )
  ),
  module_scope text not null,
  usage_hint text null,
  owner_note text null,
  value_type text not null check (
    value_type in ('number', 'percentage', 'boolean', 'string', 'json', 'money', 'date')
  ),
  status text not null check (status in ('draft', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(value_key) <> ''),
  check (btrim(label) <> ''),
  check (btrim(module_scope) <> '')
);

create unique index if not exists uq_country_legal_values_country_key
  on public.country_legal_values (country_code, value_key);

create unique index if not exists uq_country_legal_values_id_country
  on public.country_legal_values (id, country_code);

create index if not exists idx_country_legal_values_country
  on public.country_legal_values (country_code);

create index if not exists idx_country_legal_values_key
  on public.country_legal_values (value_key);

create index if not exists idx_country_legal_values_category
  on public.country_legal_values (category);

create index if not exists idx_country_legal_values_status
  on public.country_legal_values (status);

create trigger country_legal_values_updated_at
  before update on public.country_legal_values
  for each row execute function public.set_updated_at();

-- ==================================================
-- 7) country_legal_value_versions
-- ==================================================
create table if not exists public.country_legal_value_versions (
  id uuid primary key default gen_random_uuid(),
  legal_value_id uuid not null references public.country_legal_values(id) on delete cascade,
  country_pack_ruleset_id uuid not null references public.country_pack_rulesets(id) on delete cascade,
  value_payload_json jsonb not null,
  effective_from date not null,
  effective_to date null,
  status text not null check (status in ('draft', 'active', 'deprecated', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(value_payload_json) in ('object', 'array', 'string', 'number', 'boolean')),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_country_legal_value_versions_legal_value
  on public.country_legal_value_versions (legal_value_id);

create index if not exists idx_country_legal_value_versions_ruleset
  on public.country_legal_value_versions (country_pack_ruleset_id);

create index if not exists idx_country_legal_value_versions_effective_dates
  on public.country_legal_value_versions (legal_value_id, effective_from, effective_to);

create index if not exists idx_country_legal_value_versions_status
  on public.country_legal_value_versions (status);

create trigger country_legal_value_versions_updated_at
  before update on public.country_legal_value_versions
  for each row execute function public.set_updated_at();

-- DB-level ACTIVE overlap protection for same legal value.
alter table public.country_legal_value_versions
  add constraint country_legal_value_versions_no_active_overlap
  exclude using gist (
    legal_value_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
  where (status = 'active');

-- Ensure legal value country is eligible for selected ruleset's pack country.
create or replace function public.country_legal_value_versions_guard_country_scope()
returns trigger
language plpgsql
as $$
begin
  if (
    select lv.country_code
    from public.country_legal_values lv
    where lv.id = new.legal_value_id
  ) is null or (
    select cp.country_code
    from public.country_pack_rulesets rs
    join public.country_packs cp on cp.id = rs.country_pack_id
    where rs.id = new.country_pack_ruleset_id
  ) is null then
    raise exception 'Invalid legal value or ruleset reference for country scope';
  end if;

  if (
    select lv.country_code
    from public.country_legal_values lv
    where lv.id = new.legal_value_id
  ) <> (
    select cp.country_code
    from public.country_pack_rulesets rs
    join public.country_packs cp on cp.id = rs.country_pack_id
    where rs.id = new.country_pack_ruleset_id
  ) then
    raise exception 'Cross-country legal value version binding is forbidden';
  end if;

  return new;
end;
$$;

drop trigger if exists country_legal_value_versions_country_scope_guard
  on public.country_legal_value_versions;

create trigger country_legal_value_versions_country_scope_guard
  before insert or update on public.country_legal_value_versions
  for each row execute function public.country_legal_value_versions_guard_country_scope();

-- ==================================================
-- RLS baseline
-- ==================================================
alter table public.countries enable row level security;
alter table public.country_packs enable row level security;
alter table public.country_pack_rulesets enable row level security;
alter table public.organization_country_settings enable row level security;
alter table public.country_extension_capabilities enable row level security;
alter table public.country_legal_values enable row level security;
alter table public.country_legal_value_versions enable row level security;

-- Platform-governed registries: authenticated read-only baseline (writes only through backend service_role + platform-owner guard later).
create policy "countries_select_authenticated"
  on public.countries for select to authenticated
  using (true);

create policy "country_packs_select_authenticated"
  on public.country_packs for select to authenticated
  using (true);

create policy "country_pack_rulesets_select_authenticated"
  on public.country_pack_rulesets for select to authenticated
  using (true);

create policy "country_extension_capabilities_select_authenticated"
  on public.country_extension_capabilities for select to authenticated
  using (true);

-- Legal values are platform-governed; do not expose to tenant direct reads at this stage.
-- Reads will be exposed through backend aggregate contracts only.
-- No select policy on purpose.

-- Org country settings: tenant-scoped read visibility only.
create policy "organization_country_settings_select_org_member"
  on public.organization_country_settings for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- No insert/update/delete policies are added in this migration for any country_pack* table.
-- Reason: writes must be command-driven and platform-owner guarded in backend layer (to be implemented later).

