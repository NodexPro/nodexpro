-- Client Operations setup-warning dismiss marker (organization + user)
-- plus Core-owned monotonic clients-added generation.
-- Reuses client_operations_user_sheet_preferences — no second preferences table.
-- Generation lives on organizations (Core). Incremented only by AFTER INSERT on clients.
-- Archive, restore, and edit do not change it. DO NOT APPLY until release approval.

alter table public.organizations
  add column if not exists clients_added_generation bigint not null default 0;

comment on column public.organizations.clients_added_generation is
  'Monotonic count of client INSERTs for this organization. Bumped only by AFTER INSERT on clients; archive, restore, and edit do not change it.';

update public.organizations o
set clients_added_generation = src.added_count
from (
  select organization_id, count(*)::bigint as added_count
  from public.clients
  group by organization_id
) src
where o.id = src.organization_id
  and o.clients_added_generation = 0
  and src.added_count > 0;

create or replace function public.bump_organization_clients_added_generation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organizations
  set clients_added_generation = clients_added_generation + 1
  where id = new.organization_id;
  return new;
end;
$$;

drop trigger if exists clients_bump_added_generation on public.clients;
create trigger clients_bump_added_generation
  after insert on public.clients
  for each row execute function public.bump_organization_clients_added_generation();

revoke all on function public.bump_organization_clients_added_generation() from public, anon, authenticated;

alter table public.client_operations_user_sheet_preferences
  add column if not exists setup_warning_dismissed_clients_added_token text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_operations_setup_warning_token_len'
  ) then
    alter table public.client_operations_user_sheet_preferences
      add constraint client_operations_setup_warning_token_len
      check (char_length(setup_warning_dismissed_clients_added_token) <= 160);
  end if;
end
$$;

comment on column public.client_operations_user_sheet_preferences.setup_warning_dismissed_clients_added_token is
  'organizations.clients_added_generation captured when the user hides the Client Operations setup warning until a new client is added.';

create or replace function public.apply_client_operations_setup_warning_dismissed(
  p_organization_id uuid,
  p_user_id uuid,
  p_clients_added_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_generation bigint;
begin
  if p_organization_id is null or p_user_id is null then
    raise exception 'organization_id and user_id required' using errcode = '22023';
  end if;
  v_token := btrim(coalesce(p_clients_added_token, ''));
  if char_length(v_token) > 160 then
    raise exception 'clients_added_token invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and m.status = 'active'
  ) then
    raise exception 'user is not an active member of organization' using errcode = '42501';
  end if;

  if v_token <> '' then
    select o.clients_added_generation
      into v_generation
    from public.organizations o
    where o.id = p_organization_id;
    if v_generation is null then
      raise exception 'organization not found' using errcode = '22023';
    end if;
    v_token := v_generation::text;
  end if;

  insert into public.client_operations_user_sheet_preferences (
    organization_id,
    user_id,
    hidden_column_keys,
    system_column_widths,
    setup_warning_dismissed_clients_added_token,
    updated_at,
    updated_by
  ) values (
    p_organization_id,
    p_user_id,
    '{}'::text[],
    '{}'::jsonb,
    v_token,
    now(),
    p_user_id
  )
  on conflict (organization_id, user_id) do update
  set
    setup_warning_dismissed_clients_added_token = excluded.setup_warning_dismissed_clients_added_token,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

comment on function public.apply_client_operations_setup_warning_dismissed(uuid, uuid, text) is
  'Upsert the personal Client Operations setup-warning dismiss generation for one user+organization. Non-empty token is replaced with the live organizations.clients_added_generation.';

revoke all on function public.apply_client_operations_setup_warning_dismissed(uuid, uuid, text) from public;
revoke all on function public.apply_client_operations_setup_warning_dismissed(uuid, uuid, text) from anon, authenticated;
grant execute on function public.apply_client_operations_setup_warning_dismissed(uuid, uuid, text) to service_role;
