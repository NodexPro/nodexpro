-- Retainer scheduler runtime — cycle idempotency + generation audit columns.

alter table public.income_recurring_document_profiles
  add column if not exists last_generated_at timestamptz null,
  add column if not exists last_scheduler_cycle_key text null,
  add column if not exists last_generation_failed_at timestamptz null,
  add column if not exists last_generation_error_code text null,
  add column if not exists last_generation_error_message text null;

create index if not exists idx_income_recurring_profiles_scheduler_cycle
  on public.income_recurring_document_profiles (organization_id, last_scheduler_cycle_key)
  where last_scheduler_cycle_key is not null;
