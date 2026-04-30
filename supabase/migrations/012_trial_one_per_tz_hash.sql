-- Enforce at most one active (trialing) full-platform trial per legal_identity_hash.
-- Multiple orgs can have the same hash with status blocked/trial_expired; only one can be trialing.
create unique index if not exists idx_org_trials_one_trialing_per_hash
  on public.organization_trials(legal_identity_hash)
  where trial_scope = 'full_platform' and status = 'trialing';
