-- INC issue hardening: one issued document per draft (org-scoped) + command idempotency leases.

-- ---------------------------------------------------------------------------
-- 1) DB invariant: at most one income_document per (organization_id, source_draft_id)
-- ---------------------------------------------------------------------------
drop index if exists public.idx_income_documents_source_draft;

create unique index if not exists uq_income_documents_org_source_draft
  on public.income_documents (organization_id, source_draft_id)
  where source_draft_id is not null;

comment on index public.uq_income_documents_org_source_draft is
  'Legal/accounting invariant: one issued income document per draft within an organization.';

-- ---------------------------------------------------------------------------
-- 2) Command idempotency leases for issue_income_document (service role writes)
-- ---------------------------------------------------------------------------
create table if not exists public.income_command_idempotency (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) > 0),
  command_type text not null check (char_length(btrim(command_type)) > 0),
  source_draft_id uuid null references public.income_document_drafts(id) on delete set null,
  income_document_id uuid null references public.income_documents(id) on delete set null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index if not exists idx_income_command_idempotency_org_completed
  on public.income_command_idempotency (organization_id, completed_at);

alter table public.income_command_idempotency enable row level security;

create policy "income_command_idempotency_select_org_member"
  on public.income_command_idempotency
  for select
  to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
