create table if not exists public.client_portal_invite_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  invitation_id uuid not null references public.client_portal_invitations(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  delivery_status text not null check (delivery_status in ('not_sent', 'sending', 'sent', 'failed')),
  delivery_error text null,
  provider_message_id text null,
  delivered_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_docflow_invite_deliveries_scope
  on public.client_portal_invite_deliveries(org_id, client_id, invitation_id, created_at desc);

alter table public.client_portal_invite_deliveries enable row level security;

create policy "docflow_invite_deliveries_select_org_member" on public.client_portal_invite_deliveries
for select using (org_id in (select public.organizations_for_current_auth_user()));

create policy "docflow_invite_deliveries_insert_org_member" on public.client_portal_invite_deliveries
for insert with check (org_id in (select public.organizations_for_current_auth_user()));

create policy "docflow_invite_deliveries_update_org_member" on public.client_portal_invite_deliveries
for update using (org_id in (select public.organizations_for_current_auth_user()));

