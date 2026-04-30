-- Phase 6: DocFlow backend foundation schema.
-- Command/aggregate architecture; no generic chat model.

-- Optional module registry seed (commercial module by default)
insert into public.modules (code, name, description, scope_type, is_active, is_sellable, default_visibility, is_system)
values ('docflow', 'DocFlow', 'Client work communication module', 'global', true, true, 'hidden', false)
on conflict (code) do nothing;

-- 1) client_portal_users
create table if not exists public.client_portal_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  email_normalized text not null,
  display_name text,
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked', 'locked')),
  last_login_at timestamptz,
  auth_method text not null default 'magic_link' check (auth_method in ('magic_link', 'otp', 'password', 'external')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, client_id, email_normalized)
);

create index if not exists idx_docflow_portal_users_scope on public.client_portal_users(org_id, client_id, status);

-- 2) client_portal_invitations
create table if not exists public.client_portal_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  portal_user_id uuid references public.client_portal_users(id) on delete set null,
  invite_email_normalized text not null,
  invite_token_hash text not null unique,
  token_expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  issued_by_user_id uuid references public.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_docflow_invites_scope on public.client_portal_invitations(org_id, client_id, status);
create index if not exists idx_docflow_invites_email on public.client_portal_invitations(invite_email_normalized, status);

-- 3) client_portal_sessions
create table if not exists public.client_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  portal_user_id uuid not null references public.client_portal_users(id) on delete cascade,
  session_token_hash text not null unique,
  refresh_token_hash text,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists idx_docflow_sessions_scope on public.client_portal_sessions(org_id, client_id, status);
create index if not exists idx_docflow_sessions_user on public.client_portal_sessions(portal_user_id, status);

-- 4) client_message_threads
create table if not exists public.client_message_threads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  module_key text not null,
  thread_type text not null check (thread_type in ('document_request', 'question', 'reminder', 'task_followup')),
  thread_status text not null check (thread_status in ('open', 'waiting_client', 'waiting_office', 'resolved', 'archived')),
  assigned_user_id uuid references public.users(id) on delete set null,
  deadline_at timestamptz,
  created_by_type text not null check (created_by_type in ('office', 'system')),
  created_by_user_id uuid references public.users(id) on delete set null,
  title text,
  resolved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_docflow_threads_scope on public.client_message_threads(org_id, client_id, module_key, thread_status);
create index if not exists idx_docflow_threads_assigned on public.client_message_threads(org_id, assigned_user_id, thread_status);
create index if not exists idx_docflow_threads_updated on public.client_message_threads(org_id, client_id, updated_at desc);

-- 5) client_messages
create table if not exists public.client_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  thread_id uuid not null references public.client_message_threads(id) on delete cascade,
  message_type text not null check (message_type in ('text', 'file', 'system', 'request', 'reminder')),
  created_by_type text not null check (created_by_type in ('office', 'client', 'system')),
  created_by_user_id uuid references public.users(id) on delete set null,
  created_by_portal_user_id uuid references public.client_portal_users(id) on delete set null,
  body text not null,
  message_status text not null default 'published' check (message_status in ('draft', 'published', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_docflow_messages_thread_created on public.client_messages(thread_id, created_at);
create index if not exists idx_docflow_messages_scope_created on public.client_messages(org_id, client_id, created_at desc);

-- 6) client_message_attachments
create table if not exists public.client_message_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  thread_id uuid not null references public.client_message_threads(id) on delete cascade,
  message_id uuid not null references public.client_messages(id) on delete cascade,
  file_asset_id uuid not null references public.file_assets(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (message_id, file_asset_id)
);

create index if not exists idx_docflow_attach_thread_created on public.client_message_attachments(thread_id, created_at);
create index if not exists idx_docflow_attach_file on public.client_message_attachments(file_asset_id);

-- 7) client_message_deliveries
create table if not exists public.client_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  thread_id uuid not null references public.client_message_threads(id) on delete cascade,
  message_id uuid not null references public.client_messages(id) on delete cascade,
  channel text not null check (channel in ('docflow', 'sms_later', 'email_later')),
  delivery_status text not null check (delivery_status in ('pending', 'sent', 'failed', 'read')),
  provider_message_id text,
  attempt_count int not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  failure_code text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, channel)
);

create index if not exists idx_docflow_delivery_scope_status on public.client_message_deliveries(org_id, client_id, delivery_status, channel);

-- 8) client_message_events
create table if not exists public.client_message_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  thread_id uuid references public.client_message_threads(id) on delete set null,
  message_id uuid references public.client_messages(id) on delete set null,
  event_type text not null,
  actor_type text not null check (actor_type in ('office', 'client', 'system')),
  actor_user_id uuid references public.users(id) on delete set null,
  actor_portal_user_id uuid references public.client_portal_users(id) on delete set null,
  payload_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_docflow_events_scope_created on public.client_message_events(org_id, client_id, created_at desc);
create index if not exists idx_docflow_events_thread_created on public.client_message_events(thread_id, created_at);
create index if not exists idx_docflow_events_message_created on public.client_message_events(message_id, created_at);

-- updated_at triggers
create trigger client_portal_users_updated_at before update on public.client_portal_users
  for each row execute function public.set_updated_at();
create trigger client_message_threads_updated_at before update on public.client_message_threads
  for each row execute function public.set_updated_at();
create trigger client_messages_updated_at before update on public.client_messages
  for each row execute function public.set_updated_at();
create trigger client_message_deliveries_updated_at before update on public.client_message_deliveries
  for each row execute function public.set_updated_at();

-- RLS baseline (read policies; backend uses service role for writes)
alter table public.client_portal_users enable row level security;
alter table public.client_portal_invitations enable row level security;
alter table public.client_portal_sessions enable row level security;
alter table public.client_message_threads enable row level security;
alter table public.client_messages enable row level security;
alter table public.client_message_attachments enable row level security;
alter table public.client_message_deliveries enable row level security;
alter table public.client_message_events enable row level security;

create policy "docflow_portal_users_select_org_member" on public.client_portal_users for select
  using (org_id in (select public.organizations_for_current_auth_user()));
create policy "docflow_invitations_select_org_member" on public.client_portal_invitations for select
  using (org_id in (select public.organizations_for_current_auth_user()));
create policy "docflow_sessions_select_org_member" on public.client_portal_sessions for select
  using (org_id in (select public.organizations_for_current_auth_user()));
create policy "docflow_threads_select_org_member" on public.client_message_threads for select
  using (org_id in (select public.organizations_for_current_auth_user()));
create policy "docflow_messages_select_org_member" on public.client_messages for select
  using (org_id in (select public.organizations_for_current_auth_user()));
create policy "docflow_attachments_select_org_member" on public.client_message_attachments for select
  using (org_id in (select public.organizations_for_current_auth_user()));
create policy "docflow_deliveries_select_org_member" on public.client_message_deliveries for select
  using (org_id in (select public.organizations_for_current_auth_user()));
create policy "docflow_events_select_org_member" on public.client_message_events for select
  using (org_id in (select public.organizations_for_current_auth_user()));

