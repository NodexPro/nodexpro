-- Adds end date for client treatments (used by client-operations "פרטי לקוח" tab).
-- Idempotent: safe to run multiple times.

alter table public.clients
  add column if not exists ended_at timestamptz;

comment on column public.clients.ended_at is 'End date for client treatment (client workspace UI)';

