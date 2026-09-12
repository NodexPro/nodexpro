-- TAX-622 — Legal Library foundation.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- Canonical hierarchy (backend-owned):
--   Country → Tax Domain → Legal Source → Legal Node tree
--     → tax_rules (many-to-many via tax_rule_legal_nodes)
--     → tax_rule_versions
--     → tax_rule_version_sources (citation / provenance pin, not hierarchy)
--
-- Distinctions preserved:
--   Legal Node = structure of the authoritative legal source
--   Tax Rule = canonical machine-usable legal/tax rule
--   Tax Rule Version = versioned legal meaning/logic
--   Citation/Provenance = evidence/source pin (existing tax_rule_version_sources)
--
-- A tax rule may relate to more than one legal node, so this is NOT
-- tax_rules.legal_node_id. Existing tax_rule_version_sources stay citations.
--
-- Does not seed Israeli laws, fake סעיפים, domains, nodes, or node kinds.
-- Does not assign existing tax_sources / tax_rules to invented domains/nodes.
-- Future Knowledge Trainer may insert DRAFT nodes/rules/links; 622 does not
-- auto-activate or extract from uploads.

-- ==================================================
-- 1) tax_domains
-- ==================================================
create table if not exists public.tax_domains (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  domain_code text not null,
  title text not null,
  status text not null check (status in ('draft', 'active', 'retired')),
  owner_note text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(domain_code) <> ''),
  check (btrim(title) <> '')
);

comment on table public.tax_domains is
  'TAX-622 country tax domain (e.g. income tax). Human title is primary; domain_code is a backend-generated machine id. No tenant organization_id.';

create unique index if not exists uq_tax_domains_country_domain_code
  on public.tax_domains (country_code, domain_code);

create unique index if not exists uq_tax_domains_id_country
  on public.tax_domains (id, country_code);

create index if not exists idx_tax_domains_country
  on public.tax_domains (country_code, sort_order, title);

drop trigger if exists tax_domains_updated_at on public.tax_domains;
create trigger tax_domains_updated_at
  before update on public.tax_domains
  for each row execute function public.set_updated_at();

-- ==================================================
-- 2) nullable tax_sources.tax_domain_id (legacy sources stay unassigned)
-- ==================================================
alter table public.tax_sources
  add column if not exists tax_domain_id uuid null;

comment on column public.tax_sources.tax_domain_id is
  'TAX-622 optional tax domain. Null means unassigned legacy/technical source. Not backfilled.';

alter table public.tax_sources drop constraint if exists tax_sources_domain_country_fk;
alter table public.tax_sources
  add constraint tax_sources_domain_country_fk
  foreign key (tax_domain_id, country_code)
  references public.tax_domains (id, country_code)
  on delete restrict;

create index if not exists idx_tax_sources_tax_domain_id
  on public.tax_sources (tax_domain_id)
  where tax_domain_id is not null;

-- ==================================================
-- 3) tax_legal_node_kinds — country-scoped, data-driven catalog
-- ==================================================
create table if not exists public.tax_legal_node_kinds (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  kind_code text not null,
  label text not null,
  status text not null check (status in ('draft', 'active', 'retired')),
  owner_note text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(kind_code) <> ''),
  check (btrim(label) <> '')
);

comment on table public.tax_legal_node_kinds is
  'TAX-622 country-scoped legal node kind catalog (Owner-authored labels such as חלק / פרק / סעיף). Not hardcoded per country in application code. Empty until Owner creates kinds. No Israeli law seed.';

create unique index if not exists uq_tax_legal_node_kinds_country_kind_code
  on public.tax_legal_node_kinds (country_code, kind_code);

create unique index if not exists uq_tax_legal_node_kinds_country_label
  on public.tax_legal_node_kinds (country_code, lower(btrim(label)));

create unique index if not exists uq_tax_legal_node_kinds_id_country
  on public.tax_legal_node_kinds (id, country_code);

create index if not exists idx_tax_legal_node_kinds_country
  on public.tax_legal_node_kinds (country_code, sort_order, label);

drop trigger if exists tax_legal_node_kinds_updated_at on public.tax_legal_node_kinds;
create trigger tax_legal_node_kinds_updated_at
  before update on public.tax_legal_node_kinds
  for each row execute function public.set_updated_at();

-- ==================================================
-- 4) tax_legal_nodes — parent-child structure of a legal source
-- ==================================================
create table if not exists public.tax_legal_nodes (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  tax_source_id uuid not null,
  parent_node_id uuid null,
  tax_legal_node_kind_id uuid not null,
  node_code text not null,
  node_number text null,
  title text not null,
  status text not null check (status in ('draft', 'active', 'retired')),
  owner_note text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(node_code) <> ''),
  check (btrim(title) <> ''),
  check (node_number is null or btrim(node_number) <> ''),
  check (parent_node_id is null or parent_node_id <> id)
);

comment on table public.tax_legal_nodes is
  'TAX-622 hierarchical structure of an authoritative legal source. Not a tax rule. Future Trainer may insert draft rows; activation remains an explicit later capability.';

comment on column public.tax_legal_nodes.node_code is
  'Backend-generated machine identifier. Owner UX must not require humans to invent it.';

alter table public.tax_legal_nodes drop constraint if exists tax_legal_nodes_source_country_fk;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_source_country_fk
  foreign key (tax_source_id, country_code)
  references public.tax_sources (id, country_code)
  on delete restrict;

alter table public.tax_legal_nodes drop constraint if exists tax_legal_nodes_kind_country_fk;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_kind_country_fk
  foreign key (tax_legal_node_kind_id, country_code)
  references public.tax_legal_node_kinds (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_legal_nodes_id_country
  on public.tax_legal_nodes (id, country_code);

create unique index if not exists uq_tax_legal_nodes_id_source
  on public.tax_legal_nodes (id, tax_source_id);

create unique index if not exists uq_tax_legal_nodes_source_node_code
  on public.tax_legal_nodes (tax_source_id, node_code);

alter table public.tax_legal_nodes drop constraint if exists tax_legal_nodes_parent_same_source_fk;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_parent_same_source_fk
  foreign key (parent_node_id, tax_source_id)
  references public.tax_legal_nodes (id, tax_source_id)
  on delete restrict;

create index if not exists idx_tax_legal_nodes_source_parent
  on public.tax_legal_nodes (tax_source_id, parent_node_id, sort_order);

create index if not exists idx_tax_legal_nodes_country
  on public.tax_legal_nodes (country_code);

drop trigger if exists tax_legal_nodes_updated_at on public.tax_legal_nodes;
create trigger tax_legal_nodes_updated_at
  before update on public.tax_legal_nodes
  for each row execute function public.set_updated_at();

create or replace function public.tax_legal_nodes_guard_parent()
returns trigger
language plpgsql
as $$
declare
  walk uuid;
  hops integer := 0;
begin
  if new.parent_node_id is null then
    return new;
  end if;
  if new.parent_node_id = new.id then
    raise exception 'tax_legal_nodes parent_node_id cannot equal id';
  end if;
  walk := new.parent_node_id;
  while walk is not null loop
    hops := hops + 1;
    if hops > 64 then
      raise exception 'tax_legal_nodes parent chain is too deep';
    end if;
    if walk = new.id then
      raise exception 'tax_legal_nodes parent_node_id cannot create a cycle';
    end if;
    select n.parent_node_id into walk
    from public.tax_legal_nodes n
    where n.id = walk;
  end loop;
  return new;
end;
$$;

drop trigger if exists tax_legal_nodes_guard_parent on public.tax_legal_nodes;
create trigger tax_legal_nodes_guard_parent
  before insert or update of parent_node_id, id
  on public.tax_legal_nodes
  for each row execute function public.tax_legal_nodes_guard_parent();

-- ==================================================
-- 5) tax_rule_legal_nodes — canonical Rule ↔ Legal Node (many-to-many)
-- ==================================================
create table if not exists public.tax_rule_legal_nodes (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  tax_rule_id uuid not null,
  tax_legal_node_id uuid not null,
  created_at timestamptz not null default now(),
  check (tax_rule_id <> '00000000-0000-0000-0000-000000000000'::uuid),
  check (tax_legal_node_id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

comment on table public.tax_rule_legal_nodes is
  'TAX-622 canonical many-to-many: tax_rules interpret/implement tax_legal_nodes. Distinct from tax_rule_version_sources (citation/provenance). A rule may link to more than one node.';

create unique index if not exists uq_tax_rule_legal_nodes_pair
  on public.tax_rule_legal_nodes (tax_rule_id, tax_legal_node_id);

create unique index if not exists uq_tax_rule_legal_nodes_id_country
  on public.tax_rule_legal_nodes (id, country_code);

alter table public.tax_rule_legal_nodes drop constraint if exists tax_rule_legal_nodes_rule_country_fk;
alter table public.tax_rule_legal_nodes
  add constraint tax_rule_legal_nodes_rule_country_fk
  foreign key (tax_rule_id, country_code)
  references public.tax_rules (id, country_code)
  on delete restrict;

alter table public.tax_rule_legal_nodes drop constraint if exists tax_rule_legal_nodes_node_country_fk;
alter table public.tax_rule_legal_nodes
  add constraint tax_rule_legal_nodes_node_country_fk
  foreign key (tax_legal_node_id, country_code)
  references public.tax_legal_nodes (id, country_code)
  on delete restrict;

create index if not exists idx_tax_rule_legal_nodes_node
  on public.tax_rule_legal_nodes (tax_legal_node_id);

create index if not exists idx_tax_rule_legal_nodes_country
  on public.tax_rule_legal_nodes (country_code);

-- ==================================================
-- 6) No delete of structure rows (retirement later). Junction unlink is DELETE.
-- ==================================================
drop trigger if exists tax_domains_forbid_delete on public.tax_domains;
create trigger tax_domains_forbid_delete
  before delete on public.tax_domains
  for each row execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_domains_forbid_truncate on public.tax_domains;
create trigger tax_domains_forbid_truncate
  before truncate on public.tax_domains
  execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_legal_node_kinds_forbid_delete on public.tax_legal_node_kinds;
create trigger tax_legal_node_kinds_forbid_delete
  before delete on public.tax_legal_node_kinds
  for each row execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_legal_node_kinds_forbid_truncate on public.tax_legal_node_kinds;
create trigger tax_legal_node_kinds_forbid_truncate
  before truncate on public.tax_legal_node_kinds
  execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_legal_nodes_forbid_delete on public.tax_legal_nodes;
create trigger tax_legal_nodes_forbid_delete
  before delete on public.tax_legal_nodes
  for each row execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_legal_nodes_forbid_truncate on public.tax_legal_nodes;
create trigger tax_legal_nodes_forbid_truncate
  before truncate on public.tax_legal_nodes
  execute function public.tax_knowledge_forbid_delete();

-- ==================================================
-- 7) RLS + privileges — API service_role only. No tenant PostgREST access.
-- ==================================================
alter table public.tax_domains enable row level security;
alter table public.tax_domains force row level security;
revoke all on table public.tax_domains from anon, authenticated;

alter table public.tax_legal_node_kinds enable row level security;
alter table public.tax_legal_node_kinds force row level security;
revoke all on table public.tax_legal_node_kinds from anon, authenticated;

alter table public.tax_legal_nodes enable row level security;
alter table public.tax_legal_nodes force row level security;
revoke all on table public.tax_legal_nodes from anon, authenticated;

alter table public.tax_rule_legal_nodes enable row level security;
alter table public.tax_rule_legal_nodes force row level security;
revoke all on table public.tax_rule_legal_nodes from anon, authenticated;

grant select, insert, update on table
  public.tax_domains,
  public.tax_legal_node_kinds,
  public.tax_legal_nodes
  to service_role;

grant select, insert, update, delete on table public.tax_rule_legal_nodes to service_role;

grant execute on function public.tax_legal_nodes_guard_parent() to service_role;
revoke all on function public.tax_legal_nodes_guard_parent() from public;
revoke all on function public.tax_legal_nodes_guard_parent() from anon, authenticated;

-- No CREATE POLICY on purpose.
-- Tenant/office roles must not read or write Legal Library via PostgREST.
-- Backend service_role bypasses RLS for Platform Owner / Country Legal Maintainer commands.
