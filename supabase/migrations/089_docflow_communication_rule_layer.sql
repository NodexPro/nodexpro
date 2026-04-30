-- DocFlow Phase 11: operational storage for communication rule runs and drafts.
-- Global templates remain in country_legal_values / country_legal_value_versions (Owner Panel).

create table if not exists public.communication_rule_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source_legal_value_id uuid not null references public.country_legal_values(id) on delete restrict,
  source_value_key text not null,
  source_ruleset_id uuid not null references public.country_pack_rulesets(id) on delete restrict,
  module_key text not null,
  run_date date not null,
  run_context_key text not null default '',
  status text not null default 'completed' check (status in ('started', 'completed', 'failed')),
  generated_count int not null default 0,
  skipped_count int not null default 0,
  skipped_detail jsonb null,
  created_at timestamptz not null default now(),
  check (btrim(source_value_key) <> ''),
  check (btrim(module_key) <> '')
);

create unique index if not exists uq_communication_rule_runs_idempotency
  on public.communication_rule_runs (org_id, source_legal_value_id, source_ruleset_id, run_date, run_context_key);

create index if not exists idx_communication_rule_runs_org_created
  on public.communication_rule_runs (org_id, created_at desc);

create table if not exists public.communication_draft_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rule_run_id uuid not null references public.communication_rule_runs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  thread_id uuid null references public.client_message_threads(id) on delete set null,
  module_key text not null,
  message_body text not null,
  message_type text not null check (message_type in ('system', 'reminder')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'cancelled')),
  idempotency_key text not null,
  generated_at timestamptz not null default now(),
  reviewed_by uuid null references public.users(id) on delete set null,
  sent_at timestamptz null,
  cancelled_at timestamptz null,
  check (btrim(module_key) <> ''),
  check (btrim(message_body) <> ''),
  check (btrim(idempotency_key) <> '')
);

create unique index if not exists uq_communication_draft_messages_idempotency
  on public.communication_draft_messages (org_id, idempotency_key);

create index if not exists idx_communication_drafts_run
  on public.communication_draft_messages (rule_run_id, status);

create index if not exists idx_communication_drafts_org_client
  on public.communication_draft_messages (org_id, client_id);

alter table public.communication_rule_runs enable row level security;
alter table public.communication_draft_messages enable row level security;

create policy "communication_rule_runs_select_org_member"
  on public.communication_rule_runs for select to authenticated
  using (org_id in (select public.organizations_for_current_auth_user()));

create policy "communication_drafts_select_org_member"
  on public.communication_draft_messages for select to authenticated
  using (org_id in (select public.organizations_for_current_auth_user()));
