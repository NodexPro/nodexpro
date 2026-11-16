-- Client Operations annual/capital filing: multiple files per submission,
-- capital instance link, immutable capital sequence.
-- Filing truth stays on client_annual_submission_rows.
-- Operational instances stay separate (not submitted_on).
-- Depends on 065/067/068/173. Does not invent statutory due dates.

alter table public.client_annual_submission_rows
  add column if not exists capital_declaration_instance_id uuid null
    references public.client_capital_declaration_instances (id) on delete set null;

create unique index if not exists uq_co_annual_submission_capital_instance
  on public.client_annual_submission_rows (organization_id, client_id, capital_declaration_instance_id)
  where capital_declaration_instance_id is not null;

create index if not exists idx_co_annual_submission_capital_instance
  on public.client_annual_submission_rows (organization_id, capital_declaration_instance_id)
  where capital_declaration_instance_id is not null;

comment on column public.client_annual_submission_rows.capital_declaration_instance_id is
  'Capital filing identity. Annual submissions keep tax_year as identity and leave this null.';

create table if not exists public.client_annual_submission_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  submission_id uuid not null references public.client_annual_submission_rows(id) on delete cascade,
  file_asset_id uuid not null references public.file_assets(id) on delete restrict,
  source_kind text not null
    check (source_kind in ('form_1301', 'additional', 'checklist')),
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id) on delete set null,
  unique (submission_id, file_asset_id),
  constraint client_annual_submission_files_client_org_fk
    foreign key (client_id, organization_id)
    references public.clients (id, organization_id)
    on delete cascade
);

comment on table public.client_annual_submission_files is
  'Logical file links for an annual/capital submission. Same file_asset may also remain on the collection checklist. No physical copies.';

create index if not exists idx_co_annual_submission_files_org_sub
  on public.client_annual_submission_files (organization_id, submission_id);

create index if not exists idx_co_annual_submission_files_org_client
  on public.client_annual_submission_files (organization_id, client_id);

alter table public.client_annual_submission_files enable row level security;

create policy "co_annual_submission_files_select_org_member"
  on public.client_annual_submission_files for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_annual_submission_files_insert_org_member"
  on public.client_annual_submission_files for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_annual_submission_files_update_org_member"
  on public.client_annual_submission_files for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_annual_submission_files_delete_org_member"
  on public.client_annual_submission_files for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

grant select, insert, update, delete on public.client_annual_submission_files to service_role;

alter table public.client_capital_declaration_instances
  add column if not exists sequence_no integer;

with numbered as (
  select
    id,
    row_number() over (
      partition by organization_id, client_id
      order by opened_at asc, id asc
    ) as seq
  from public.client_capital_declaration_instances
)
update public.client_capital_declaration_instances as inst
set sequence_no = numbered.seq
from numbered
where inst.id = numbered.id
  and inst.sequence_no is null;

update public.client_capital_declaration_instances
set sequence_no = 1
where sequence_no is null;

alter table public.client_capital_declaration_instances
  alter column sequence_no set not null;

alter table public.client_capital_declaration_instances
  drop constraint if exists client_capital_declaration_instances_sequence_no_chk;

alter table public.client_capital_declaration_instances
  add constraint client_capital_declaration_instances_sequence_no_chk
  check (sequence_no >= 1);

create unique index if not exists uq_co_capital_decl_inst_sequence
  on public.client_capital_declaration_instances (organization_id, client_id, sequence_no);

comment on column public.client_capital_declaration_instances.sequence_no is
  'Immutable per-client sequence assigned at insert. Display label הצהרת הון N. Not a filing date.';
