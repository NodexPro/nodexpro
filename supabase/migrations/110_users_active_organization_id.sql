-- Backend-owned active organization preference (Core). NULL = no persisted selection.
alter table public.users
  add column if not exists active_organization_id uuid null references public.organizations(id) on delete set null;

create index if not exists idx_users_active_organization_id on public.users(active_organization_id);
