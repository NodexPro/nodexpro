-- DocFlow structured document requests (MVP): owner templates + document_request messages.

-- 1) Owner-global template definitions (country-scoped)
create table if not exists public.docflow_request_template_definitions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (char_length(trim(country_code)) >= 2),
  name text not null check (char_length(trim(name)) > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_docflow_req_tpl_def_country
  on public.docflow_request_template_definitions (country_code)
  where archived_at is null;

create table if not exists public.docflow_request_template_definition_items (
  id uuid primary key default gen_random_uuid(),
  template_definition_id uuid not null references public.docflow_request_template_definitions(id) on delete cascade,
  sort_order int not null default 0,
  label text not null check (char_length(trim(label)) > 0),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_docflow_req_tpl_items_template
  on public.docflow_request_template_definition_items (template_definition_id, sort_order);

create trigger docflow_request_template_definitions_updated_at
  before update on public.docflow_request_template_definitions
  for each row execute function public.set_updated_at();

create trigger docflow_request_template_definition_items_updated_at
  before update on public.docflow_request_template_definition_items
  for each row execute function public.set_updated_at();

alter table public.docflow_request_template_definitions enable row level security;
alter table public.docflow_request_template_definition_items enable row level security;

-- 2) Messages: document_request + snapshot JSON
alter table public.client_messages drop constraint if exists client_messages_message_type_check;
alter table public.client_messages add constraint client_messages_message_type_check
  check (message_type in ('text', 'file', 'system', 'request', 'reminder', 'document_request'));

alter table public.client_messages
  add column if not exists request_snapshot_json jsonb;

comment on column public.client_messages.request_snapshot_json is
  'Immutable snapshot for message_type=document_request (template + selected items + note).';
