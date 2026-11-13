-- Additive. Do not apply to production without explicit approval.
-- Privacy-safe, read-only usage observations for seven Core legacy PATCH/PUT routes.
-- Does not store request bodies, tokens, credentials, query strings, IP addresses,
-- user agents, organization ids, user ids, or path parameters.
-- Observation does not authorize, mutate, or replace those routes.
--
-- Retention: 90 days. Cleanup is scheduled in the API process and via
-- POST /api/v1/owner/internal/legacy-http-observations/purge (internal cron secret).
-- Inserts also delete rows older than 90 days. Service-role only.
-- Rollback:
--   drop table if exists public.legacy_http_observations;

create table if not exists public.legacy_http_observations (
  id uuid primary key default gen_random_uuid(),
  endpoint_key text not null,
  http_method text not null,
  http_status integer not null,
  observed_at timestamptz not null default now(),
  has_authorization boolean not null,
  origin_pull_verified boolean not null,
  constraint legacy_http_observations_http_method_check
    check (http_method in ('PATCH', 'PUT')),
  constraint legacy_http_observations_http_status_check
    check (http_status between 100 and 599),
  constraint legacy_http_observations_endpoint_key_check
    check (endpoint_key in (
      'PATCH /organizations/:orgId/clients/:clientId',
      'PATCH /organizations/:orgId/clients/:clientId/contacts/:contactId',
      'PUT /organizations/:orgId/clients/:clientId/contacts/:contactId/primary',
      'PATCH /organizations/:orgId/clients/:clientId/notes/:noteId',
      'PATCH /organizations/:orgId/documents/:documentId',
      'PATCH /organizations/:orgId/members/:memberId/role',
      'PATCH /organizations/:orgId/settings'
    ))
);

comment on table public.legacy_http_observations is
  'Privacy-safe counts of seven Core legacy PATCH/PUT routes. No bodies, tokens, query strings, IPs, or tenant identifiers. 90-day retention.';

comment on column public.legacy_http_observations.endpoint_key is
  'Stable route template. Never a concrete organization, client, or member id.';

comment on column public.legacy_http_observations.has_authorization is
  'Whether an Authorization header was present. Never the token value.';

comment on column public.legacy_http_observations.origin_pull_verified is
  'Whether the configured origin-pull secret matched. A transport fact, not an internal/external label.';

create index if not exists idx_legacy_http_observations_observed_at
  on public.legacy_http_observations (observed_at desc);

create index if not exists idx_legacy_http_observations_endpoint_observed
  on public.legacy_http_observations (endpoint_key, observed_at desc);

alter table public.legacy_http_observations enable row level security;
alter table public.legacy_http_observations force row level security;
revoke all on table public.legacy_http_observations from public, anon, authenticated;
grant select, insert, delete on table public.legacy_http_observations to service_role;
