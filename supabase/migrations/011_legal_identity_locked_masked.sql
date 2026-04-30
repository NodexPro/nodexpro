-- Immutable owner identity: masked display, locked after trial start. No raw TZ in UI.

-- ========== ORGANIZATION_LEGAL_IDENTITIES: masked + locked ==========
alter table public.organization_legal_identities
  add column if not exists legal_identity_masked text,
  add column if not exists is_locked boolean not null default false,
  add column if not exists locked_at timestamptz;

comment on column public.organization_legal_identities.legal_identity_masked is 'Display-only masked value for UI (e.g. ***1234); never full TZ';
comment on column public.organization_legal_identities.is_locked is 'True after trial start; ordinary users cannot change identity';
comment on column public.organization_legal_identities.locked_at is 'When identity was locked (trial start)';
