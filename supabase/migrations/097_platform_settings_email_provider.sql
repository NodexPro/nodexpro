create table if not exists public.platform_settings (
  setting_key text primary key,
  setting_value_json jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

create policy "platform_settings_select_org_member" on public.platform_settings
for select using (exists (select 1 from public.organizations_for_current_auth_user() limit 1));

create policy "platform_settings_insert_org_member" on public.platform_settings
for insert with check (exists (select 1 from public.organizations_for_current_auth_user() limit 1));

create policy "platform_settings_update_org_member" on public.platform_settings
for update using (exists (select 1 from public.organizations_for_current_auth_user() limit 1));

