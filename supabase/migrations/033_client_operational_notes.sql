-- Client Operations: operational notes (הערות) per client — types from DB, optional reminders.

create table if not exists public.client_operational_note_types (
  code text primary key,
  label_he text not null,
  sort_order int not null default 0,
  allows_reminder boolean not null default true
);

insert into public.client_operational_note_types (code, label_he, sort_order, allows_reminder) values
  ('call', 'שיחה', 10, true),
  ('note_no_date', 'הערה ללא תאריך', 20, false),
  ('reminder', 'תזכורת', 30, true),
  ('congratulate', 'ברכה', 40, true),
  ('action', 'פעולה', 50, true)
on conflict (code) do update set
  label_he = excluded.label_he,
  sort_order = excluded.sort_order,
  allows_reminder = excluded.allows_reminder;

create table if not exists public.client_operational_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  type_code text not null references public.client_operational_note_types(code),
  body text not null,
  reminder_at timestamptz null,
  created_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_operational_notes_org_client
  on public.client_operational_notes(organization_id, client_id);
create index if not exists idx_client_operational_notes_org_reminder
  on public.client_operational_notes(organization_id, reminder_at)
  where reminder_at is not null;

create trigger client_operational_notes_updated_at
  before update on public.client_operational_notes
  for each row execute function public.set_updated_at();

alter table public.client_operational_notes enable row level security;

create policy "client_operational_notes_select_org_member" on public.client_operational_notes
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_operational_notes_insert_org_member" on public.client_operational_notes
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_operational_notes_update_org_member" on public.client_operational_notes
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_operational_notes_delete_org_member" on public.client_operational_notes
  for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Types are reference data: readable by any authenticated user (for RLS if queried from client)
alter table public.client_operational_note_types enable row level security;

create policy "client_operational_note_types_select_authenticated" on public.client_operational_note_types
  for select to authenticated
  using (true);
