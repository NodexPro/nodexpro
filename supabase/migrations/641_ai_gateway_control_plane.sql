-- TAX-641A — AI Gateway Control Plane database foundation.
-- Tax Brain reserved migration range: 600–699.
-- Next available number after 640.
-- DEV-only apply later: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
-- Do not apply in this ticket. Contract + tests only.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or edit migrations 620–640.
-- Does not alter Owner Drafts, candidates, Layer B2 proposals, or canonical tax tables.
-- Does not INSERT provider/routing rows.
-- Does not migrate TAX_KNOWLEDGE_AI_* env credentials into the database.
-- Env bootstrap remains untouched. Later Control Plane routing supersedes env
-- only when a valid Owner-managed routing target exists.
--
-- Does not implement:
--   Owner UI, named Owner commands, Shared AI Gateway failover, circuit breaker,
--   provider connection tests, real AI/LLM calls, F2B/F2C, worker, PDF, rebuild,
--   canonical tax writes, or B2 writes.
--
-- Domain:
--   AI Provider Control Plane owns provider INSTANCE configuration and routing order.
--   Shared AI Gateway owns execution / timeout / retry / in-memory circuit.
--   Tax Brain owns TAX-639 legal validation and canonical law.
--   Canonical audit_log remains the only configuration audit system.
--
-- Adapter types:
--   Executable adapters live in API code registry, not this database.
--   adapter_type is a stable identifier string. Format is constrained; the closed
--   executable set is NOT enumerated here so a future adapter does not require
--   table redesign. First shipped adapter: openai_compatible.
--   Enablement still requires the application registry to accept the type.
--
-- Secrets:
--   credential_ciphertext only (AES-256-GCM via existing CLIENT_DATA_ENCRYPTION_KEY).
--   Never plaintext API keys. Never a raw key fingerprint column.
--   Aggregates must NOT select credential_ciphertext.
--   Expose later: credential_configured + credential_updated_at only.
--
-- SSRF:
--   base_url is configuration only. This database does not decide network safety.
--   Later backend command validation must enforce HTTPS and block
--   private / localhost / link-local / metadata destinations, including redirect
--   revalidation. Do not copy the custom-email URL fetch pattern.
--
-- Health:
--   Bounded snapshot columns only. No per-request health/event table.
--   Circuit breaker state is NOT stored here.
--
-- Environment isolation:
--   Rows live only in the current environment database.
--   No provider config/credential promotion through Tax Knowledge artifacts.

create table if not exists public.ai_gateway_providers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  adapter_type text not null default 'openai_compatible',
  base_url text null,
  enabled boolean not null default false,
  pinned_model text null,
  credential_ciphertext text null,
  structured_output_certified boolean not null default false,
  compatibility_status text not null default 'not_tested',
  last_success_at timestamptz null,
  last_failure_at timestamptz null,
  last_failure_category text null,
  last_test_at timestamptz null,
  last_test_outcome text null,
  last_test_configuration_digest text null,
  credential_updated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint ai_gateway_providers_display_name_present
    check (char_length(btrim(display_name)) between 1 and 120),
  constraint ai_gateway_providers_adapter_type_format
    check (adapter_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint ai_gateway_providers_base_url_present
    check (base_url is null or char_length(btrim(base_url)) > 0),
  constraint ai_gateway_providers_pinned_model_safe
    check (
      pinned_model is null
      or (
        char_length(btrim(pinned_model)) > 0
        and lower(btrim(pinned_model)) not in ('latest', 'current', 'default')
        and lower(btrim(pinned_model)) not like '%-latest'
        and lower(btrim(pinned_model)) not like '%/latest'
        and position(':latest' in lower(btrim(pinned_model))) = 0
      )
    ),
  constraint ai_gateway_providers_compatibility_status_closed
    check (compatibility_status in ('not_tested', 'compatible', 'incompatible', 'stale')),
  constraint ai_gateway_providers_last_failure_category_closed
    check (
      last_failure_category is null
      or last_failure_category in (
        'not_configured',
        'provider_unavailable',
        'timeout',
        'rate_limited',
        'malformed_output',
        'structured_output_invalid',
        'auth_rejected',
        'incompatible',
        'endpoint_blocked'
      )
    ),
  constraint ai_gateway_providers_last_test_outcome_closed
    check (last_test_outcome is null or last_test_outcome in ('passed', 'failed')),
  constraint ai_gateway_providers_test_digest_format
    check (
      last_test_configuration_digest is null
      or last_test_configuration_digest ~ '^[0-9a-f]{64}$'
    ),
  constraint ai_gateway_providers_certified_requires_current_pass
    check (
      structured_output_certified = false
      or (
        last_test_outcome = 'passed'
        and last_test_configuration_digest is not null
        and compatibility_status = 'compatible'
      )
    ),
  constraint ai_gateway_providers_enabled_requires_gate
    check (
      enabled = false
      or (
        credential_ciphertext is not null
        and char_length(btrim(credential_ciphertext)) > 0
        and pinned_model is not null
        and structured_output_certified = true
        and compatibility_status = 'compatible'
        and last_test_outcome = 'passed'
        and last_test_configuration_digest is not null
      )
    )
);

comment on table public.ai_gateway_providers is
  'TAX-641A Platform Owner AI provider INSTANCE records. Not executable adapters. Not Tax Brain. Not tenant-scoped. Created disabled. credential_ciphertext is AES-256-GCM only; never select it in aggregates. Circuit breaker is runtime, not stored. Canonical audit_log owns configuration audit.';

comment on column public.ai_gateway_providers.display_name is
  'Owner-visible name. Not a protocol id.';
comment on column public.ai_gateway_providers.adapter_type is
  'Code-registry adapter id. Format-constrained only. Executable adapters are NOT this table. First shipped adapter: openai_compatible. Future adapters add code + registry + tests without redesigning these tables.';
comment on column public.ai_gateway_providers.base_url is
  'Optional endpoint configuration only. SSRF/network safety is NOT enforced in SQL. Later backend commands must require HTTPS and block private/localhost/link-local/metadata destinations, including redirect revalidation.';
comment on column public.ai_gateway_providers.enabled is
  'Routing eligibility flag. Default false. Application later also verifies adapter registry and endpoint policy. Changing adapter_type/base_url/pinned_model/credential invalidates certification and forces disabled.';
comment on column public.ai_gateway_providers.pinned_model is
  'Explicit pinned model id. Aliases latest/current/default are rejected. Application later forbids enablement without a pin.';
comment on column public.ai_gateway_providers.credential_ciphertext is
  'AES-256-GCM ciphertext from existing field-encryption / CLIENT_DATA_ENCRYPTION_KEY. NEVER plaintext. NEVER returned in aggregates. Aggregates expose credential_configured + credential_updated_at only.';
comment on column public.ai_gateway_providers.structured_output_certified is
  'True only after a current-configuration structured-output test pass. Stale after adapter_type/base_url/pinned_model/credential change.';
comment on column public.ai_gateway_providers.compatibility_status is
  'not_tested | compatible | incompatible | stale. stale means a previous test must not enable the changed configuration.';
comment on column public.ai_gateway_providers.last_success_at is
  'Bounded Owner UI snapshot. Not a per-request health log.';
comment on column public.ai_gateway_providers.last_failure_at is
  'Bounded Owner UI snapshot. Not a per-request health log.';
comment on column public.ai_gateway_providers.last_failure_category is
  'Sanitized failure category for Owner UI. Never raw provider body, prompt, completion, or API key.';
comment on column public.ai_gateway_providers.last_test_at is
  'When test_ai_provider_connection last ran. Historical; enablement uses digest + certified, not this timestamp alone.';
comment on column public.ai_gateway_providers.last_test_outcome is
  'passed | failed | null. A passed outcome without a matching current digest cannot enable.';
comment on column public.ai_gateway_providers.last_test_configuration_digest is
  'SHA-256 hex of the tested adapter_type + base_url + pinned_model + credential_updated_at. Does NOT include plaintext or ciphertext. Null after config change so a stale test cannot enable.';
comment on column public.ai_gateway_providers.credential_updated_at is
  'Set when credential_ciphertext changes. Used in the test digest. Not a secret fingerprint.';

create table if not exists public.ai_gateway_routing (
  position integer not null,
  provider_id uuid not null references public.ai_gateway_providers (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_gateway_routing_pkey primary key (position),
  constraint ai_gateway_routing_provider_unique unique (provider_id),
  constraint ai_gateway_routing_position_positive check (position >= 1)
);

comment on table public.ai_gateway_routing is
  'TAX-641A backend-owned ordered AI routing. position 1 = Primary, 2 = Fallback 1, 3 = Fallback 2, ... Unique provider_id prevents duplicates. FK to ai_gateway_providers. Atomic replacement is later owned by set_ai_provider_routing. Not JSON. Not Tax Brain. Circuit breaker is not stored here.';

comment on column public.ai_gateway_routing.position is
  '1 = Primary. 2 = Fallback 1. 3 = Fallback 2. Gaps are allowed; order is by position ascending.';
comment on column public.ai_gateway_routing.provider_id is
  'FK to ai_gateway_providers. ON DELETE RESTRICT: remove from routing before deleting a provider.';

create or replace function public.ai_gateway_providers_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.enabled := false;
    if new.credential_ciphertext is not null and btrim(new.credential_ciphertext) <> '' then
      new.credential_updated_at := coalesce(new.credential_updated_at, now());
    else
      new.credential_ciphertext := null;
      new.credential_updated_at := null;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'ai_gateway_providers.id is immutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'ai_gateway_providers.created_at is immutable';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'ai_gateway_providers.created_by is immutable';
  end if;

  if new.credential_ciphertext is distinct from old.credential_ciphertext then
    if new.credential_ciphertext is null or btrim(new.credential_ciphertext) = '' then
      new.credential_ciphertext := null;
    end if;
    new.credential_updated_at := now();
  end if;

  if new.adapter_type is distinct from old.adapter_type
     or new.base_url is distinct from old.base_url
     or new.pinned_model is distinct from old.pinned_model
     or new.credential_ciphertext is distinct from old.credential_ciphertext then
    new.structured_output_certified := false;
    new.compatibility_status := 'stale';
    new.last_test_configuration_digest := null;
    new.enabled := false;
  end if;

  return new;
end;
$$;

comment on function public.ai_gateway_providers_before_write() is
  'TAX-641A: new providers insert disabled. Changing adapter_type, base_url, pinned_model, or credential clears certification/digest and disables so a stale test cannot enable the new configuration. Does not perform network calls.';

drop trigger if exists ai_gateway_providers_before_write on public.ai_gateway_providers;
create trigger ai_gateway_providers_before_write
  before insert or update on public.ai_gateway_providers
  for each row execute function public.ai_gateway_providers_before_write();

drop trigger if exists ai_gateway_providers_set_updated_at on public.ai_gateway_providers;
create trigger ai_gateway_providers_set_updated_at
  before update on public.ai_gateway_providers
  for each row execute function public.set_updated_at();

drop trigger if exists ai_gateway_routing_set_updated_at on public.ai_gateway_routing;
create trigger ai_gateway_routing_set_updated_at
  before update on public.ai_gateway_routing
  for each row execute function public.set_updated_at();

alter table public.ai_gateway_providers enable row level security;
alter table public.ai_gateway_providers force row level security;
alter table public.ai_gateway_routing enable row level security;
alter table public.ai_gateway_routing force row level security;

revoke all on table public.ai_gateway_providers from anon, authenticated, public;
revoke all on table public.ai_gateway_routing from anon, authenticated, public;

grant select, insert, update on table public.ai_gateway_providers to service_role;
grant select, insert, update, delete on table public.ai_gateway_routing to service_role;
