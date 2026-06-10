-- Retainer profiles — link to income draft template + backend-owned snapshot.

alter table public.income_recurring_document_profiles
  add column if not exists source_draft_template_id uuid
    references public.income_document_drafts(id) on delete set null,
  add column if not exists document_template_snapshot jsonb;

create index if not exists idx_income_recurring_profiles_draft_template
  on public.income_recurring_document_profiles (source_draft_template_id)
  where source_draft_template_id is not null;
