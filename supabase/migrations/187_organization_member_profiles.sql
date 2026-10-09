-- Stage 5.6: organization-specific member profile (first name, last name, phone).
-- Additive. Sparse: one row per membership, created only when an Owner/Admin saves a profile.
--
-- Owned by the organization membership, not by the login identity. The same user can belong to
-- two offices with different contact details.
--
-- Does NOT parse or backfill from users.full_name. users.full_name is untouched.
-- Does NOT touch user_invitations or organization_memberships columns/data.
-- Existing grants stay when a membership is revoked; the history is not deleted.

-- Explicit, additive unique key so a profile can reference the exact membership AND organization.
-- (organization_memberships.id is already the primary key, so this cannot conflict with data.)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_memberships_id_org_key'
  ) then
    alter table public.organization_memberships
      add constraint organization_memberships_id_org_key unique (id, organization_id);
  end if;
end $$;

create table if not exists public.organization_member_profiles (
  membership_id uuid primary key,
  organization_id uuid not null,
  first_name text null,
  last_name text null,
  phone text null,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_member_profiles_membership_org_fk
    foreign key (membership_id, organization_id)
    references public.organization_memberships (id, organization_id)
    on delete cascade,
  constraint organization_member_profiles_first_name_len
    check (first_name is null or char_length(btrim(first_name)) between 1 and 80),
  constraint organization_member_profiles_last_name_len
    check (last_name is null or char_length(btrim(last_name)) between 1 and 80),
  constraint organization_member_profiles_phone_len
    check (phone is null or char_length(btrim(phone)) between 5 and 32)
);

create index if not exists idx_organization_member_profiles_org
  on public.organization_member_profiles (organization_id);

drop trigger if exists organization_member_profiles_updated_at
  on public.organization_member_profiles;
create trigger organization_member_profiles_updated_at
  before update on public.organization_member_profiles
  for each row execute function public.set_updated_at();

comment on table public.organization_member_profiles is
  'Organization-specific member profile. Sparse; structured names are entered, never guessed from users.full_name.';

alter table public.organization_member_profiles enable row level security;
alter table public.organization_member_profiles force row level security;
revoke all on table public.organization_member_profiles from anon, authenticated;
grant select, insert, update, delete on table public.organization_member_profiles to service_role;
