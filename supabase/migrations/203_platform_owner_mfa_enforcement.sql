-- Prepared only. Do not apply to production in this task.
-- One-way Platform Owner MFA activation. Tables 200-201 do not activate enforcement.
-- Do not rerun 200-202.
-- After this migration is applied, a missing enforcement row is not "off":
-- schema lock + activation receipt + audit witness keep fail-closed if the table is dropped.

create table if not exists public.platform_owner_mfa_schema (
  id text primary key check (id = 'schema'),
  migration_id text not null check (migration_id = '203'),
  installed_at timestamptz not null default now()
);

create table if not exists public.platform_owner_mfa_enforcement (
  id text primary key check (id = 'platform_owner'),
  state text not null check (state in ('NOT_ACTIVATED', 'PERMANENTLY_ACTIVE')),
  activated_at timestamptz,
  activated_by_user_id uuid references public.users (id),
  recovery_verified_at timestamptz,
  activation_request_id uuid unique,
  constraint platform_owner_mfa_enforcement_state_fields check (
    (
      state = 'NOT_ACTIVATED'
      and activated_at is null
      and activated_by_user_id is null
      and recovery_verified_at is null
      and activation_request_id is null
    )
    or (
      state = 'PERMANENTLY_ACTIVE'
      and activated_at is not null
      and activated_by_user_id is not null
      and recovery_verified_at is not null
      and activation_request_id is not null
    )
  )
);

create table if not exists public.platform_owner_mfa_activation_receipt (
  id text primary key check (id = 'platform_owner'),
  activated_at timestamptz not null default now(),
  activated_by_user_id uuid not null references public.users (id),
  activation_request_id uuid not null unique
);

create table if not exists public.platform_owner_mfa_recovery_drills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  consumed_code_id uuid not null unique,
  verified_at timestamptz not null default now()
);

create table if not exists public.platform_owner_mfa_recovery_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  purpose text not null check (purpose = 'reenroll_totp'),
  grant_hash text not null unique,
  grant_salt text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint platform_owner_mfa_recovery_grants_hash_len check (char_length(grant_hash) between 20 and 200),
  constraint platform_owner_mfa_recovery_grants_salt_len check (char_length(grant_salt) between 8 and 200)
);

create index if not exists platform_owner_mfa_recovery_drills_user_idx
  on public.platform_owner_mfa_recovery_drills (user_id, verified_at desc);

create index if not exists platform_owner_mfa_recovery_grants_user_idx
  on public.platform_owner_mfa_recovery_grants (user_id, consumed_at, expires_at);

create or replace function public.platform_owner_mfa_enforcement_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'platform_owner_mfa_enforcement cannot be deleted';
  end if;
  if old.state = 'PERMANENTLY_ACTIVE' then
    raise exception 'platform_owner_mfa_enforcement cannot revert PERMANENTLY_ACTIVE';
  end if;
  if new.state is distinct from 'PERMANENTLY_ACTIVE' then
    raise exception 'platform_owner_mfa_enforcement can only move to PERMANENTLY_ACTIVE';
  end if;
  return new;
end;
$$;

create or replace function public.platform_owner_mfa_witness_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is immutable', tg_table_name;
end;
$$;

drop trigger if exists platform_owner_mfa_enforcement_no_downgrade on public.platform_owner_mfa_enforcement;
create trigger platform_owner_mfa_enforcement_no_downgrade
  before update or delete on public.platform_owner_mfa_enforcement
  for each row execute function public.platform_owner_mfa_enforcement_immutable();

drop trigger if exists platform_owner_mfa_schema_immutable on public.platform_owner_mfa_schema;
create trigger platform_owner_mfa_schema_immutable
  before update or delete on public.platform_owner_mfa_schema
  for each row execute function public.platform_owner_mfa_witness_immutable();

drop trigger if exists platform_owner_mfa_receipt_immutable on public.platform_owner_mfa_activation_receipt;
create trigger platform_owner_mfa_receipt_immutable
  before update or delete on public.platform_owner_mfa_activation_receipt
  for each row execute function public.platform_owner_mfa_witness_immutable();

insert into public.platform_owner_mfa_schema (id, migration_id)
values ('schema', '203')
on conflict (id) do nothing;

insert into public.platform_owner_mfa_enforcement (id, state)
values ('platform_owner', 'NOT_ACTIVATED')
on conflict (id) do nothing;

alter table public.platform_owner_mfa_schema enable row level security;
alter table public.platform_owner_mfa_schema force row level security;
alter table public.platform_owner_mfa_enforcement enable row level security;
alter table public.platform_owner_mfa_enforcement force row level security;
alter table public.platform_owner_mfa_activation_receipt enable row level security;
alter table public.platform_owner_mfa_activation_receipt force row level security;
alter table public.platform_owner_mfa_recovery_drills enable row level security;
alter table public.platform_owner_mfa_recovery_drills force row level security;
alter table public.platform_owner_mfa_recovery_grants enable row level security;
alter table public.platform_owner_mfa_recovery_grants force row level security;

revoke all on table public.platform_owner_mfa_schema from public, anon, authenticated;
revoke all on table public.platform_owner_mfa_enforcement from public, anon, authenticated;
revoke all on table public.platform_owner_mfa_activation_receipt from public, anon, authenticated;
revoke all on table public.platform_owner_mfa_recovery_drills from public, anon, authenticated;
revoke all on table public.platform_owner_mfa_recovery_grants from public, anon, authenticated;
revoke all on function public.platform_owner_mfa_enforcement_immutable() from public, anon, authenticated;
revoke all on function public.platform_owner_mfa_witness_immutable() from public, anon, authenticated;

grant select, insert on table public.platform_owner_mfa_schema to service_role;
grant select, insert, update on table public.platform_owner_mfa_enforcement to service_role;
grant select, insert on table public.platform_owner_mfa_activation_receipt to service_role;
grant select, insert on table public.platform_owner_mfa_recovery_drills to service_role;
grant select, insert, update on table public.platform_owner_mfa_recovery_grants to service_role;

comment on table public.platform_owner_mfa_schema is
  'Witness that migration 203 was applied. Missing enforcement after this row exists is not treated as pre-install.';
comment on table public.platform_owner_mfa_enforcement is
  'Singleton Platform Owner MFA state. Seeded NOT_ACTIVATED. One-way UPDATE to PERMANENTLY_ACTIVE only.';
comment on table public.platform_owner_mfa_activation_receipt is
  'Independent activation witness. Survives a dropped enforcement row.';
comment on table public.platform_owner_mfa_recovery_grants is
  'Hashed short-lived reenroll grants issued after a recovery code. Not a privileged session.';
