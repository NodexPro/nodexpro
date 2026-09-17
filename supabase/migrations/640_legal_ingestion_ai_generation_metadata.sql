-- TAX-640A — Layer B2 AI generation reproducibility metadata (additive).
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
-- Do not apply in this ticket. Contract + tests only.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or edit migrations 620–636.
-- Does not alter proposal_json. proposal_json remains pure tax_knowledge_proposal_v1
-- legal semantics. Reproducibility metadata lives in generation_metadata_json only.
--
-- Does not INSERT/UPDATE/DELETE Owner Drafts, candidates, proposals, or canonical law.
-- Does not fabricate generation metadata for historical rows.
-- Does not implement AI gateway, provider SDK, env secrets, prompts, commands, or UI.
-- Does not store PDF bytes. Does not grant worker/detector ownership.
-- Does not implement F2B/F2C, publication, or activation.
-- No migration trigger may create tax_rules / tax_rule_versions / tax_legal_nodes.
--
-- DEV compatibility audit (read-only, 2026-09-17, project jgxezhjctrgfbmmkqqhn):
--   legal_ingestion_tax_knowledge_proposals total rows = 0
--   creation_origin = ai_proposal rows = 0
--   creation_origin = owner_corrected rows = 0
-- Therefore NOT-NULL-by-origin is safe. No historical metadata fabricated.
-- Apply-time DO block re-checks and STOPs if TAX-637 created ai_proposal rows
-- without metadata in the meantime.

alter table public.legal_ingestion_tax_knowledge_proposals
  add column if not exists generation_metadata_json jsonb null;

comment on column public.legal_ingestion_tax_knowledge_proposals.generation_metadata_json is
  'TAX-640A AI reproducibility metadata. OUTSIDE proposal_json. NULL for owner_corrected. REQUIRED for ai_proposal. Closed keys only: schema_version, provider, model, prompt_contract_version, output_contract, output_schema_version, generated_at, input_context_digest. NEVER store API key, secrets, raw prompt, raw completion, raw legal text, tenant/client financial data, or statutory amounts/rates. Immutable after INSERT. Not tax_knowledge_proposal_v1 legal semantics.';

do $$
declare
  n_ai_missing integer;
begin
  select count(*)::integer
    into n_ai_missing
  from public.legal_ingestion_tax_knowledge_proposals
  where creation_origin = 'ai_proposal'
    and generation_metadata_json is null;

  if n_ai_missing > 0 then
    raise exception
      'TAX-640A STOP: % existing ai_proposal row(s) have NULL generation_metadata_json. Do not fabricate historical metadata. Do not weaken NOT-NULL-by-origin. Do not apply.',
      n_ai_missing;
  end if;
end
$$;

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tkp_generation_metadata_obj;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tkp_generation_metadata_obj
  check (
    generation_metadata_json is null
    or jsonb_typeof(generation_metadata_json) = 'object'
  );

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tkp_generation_metadata_origin;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tkp_generation_metadata_origin
  check (
    (
      creation_origin = 'ai_proposal'
      and generation_metadata_json is not null
    )
    or (
      creation_origin = 'owner_corrected'
      and generation_metadata_json is null
    )
  );

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tkp_generation_metadata_contract;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tkp_generation_metadata_contract
  check (
    generation_metadata_json is null
    or (
      generation_metadata_json ?& array[
        'schema_version',
        'provider',
        'model',
        'prompt_contract_version',
        'output_contract',
        'output_schema_version',
        'generated_at',
        'input_context_digest'
      ]
      and not (
        generation_metadata_json ?| array[
          'api_key',
          'secret',
          'secrets',
          'prompt',
          'raw_prompt',
          'system_prompt',
          'user_prompt',
          'messages',
          'completion',
          'raw_completion',
          'legal_text',
          'draft_legal_text',
          'source_text',
          'tenant',
          'client',
          'amount',
          'rate',
          'ceiling',
          'statutory_amount',
          'statutory_rate'
        ]
      )
      and generation_metadata_json->'schema_version' = '1'::jsonb
      and jsonb_typeof(generation_metadata_json->'provider') = 'string'
      and length(btrim(generation_metadata_json->>'provider')) > 0
      and jsonb_typeof(generation_metadata_json->'model') = 'string'
      and length(btrim(generation_metadata_json->>'model')) > 0
      and btrim(generation_metadata_json->>'model') is distinct from 'latest'
      and generation_metadata_json->>'prompt_contract_version' = 'tax_knowledge_proposal_extract_v1'
      and generation_metadata_json->>'output_contract' = 'tax_knowledge_proposal_v1'
      and generation_metadata_json->'output_schema_version' = '1'::jsonb
      and jsonb_typeof(generation_metadata_json->'generated_at') = 'string'
      and (generation_metadata_json->>'generated_at')::timestamptz is not null
      and jsonb_typeof(generation_metadata_json->'input_context_digest') = 'string'
      and generation_metadata_json->>'input_context_digest' ~ '^[0-9a-f]{64}$'
    )
  );

create or replace function public.legal_ingestion_tkp_assert_generation_metadata(meta jsonb)
returns void
language plpgsql
immutable
as $$
declare
  k text;
  allowed constant text[] := array[
    'schema_version',
    'provider',
    'model',
    'prompt_contract_version',
    'output_contract',
    'output_schema_version',
    'generated_at',
    'input_context_digest'
  ];
begin
  if meta is null or jsonb_typeof(meta) is distinct from 'object' then
    raise exception 'generation_metadata_json must be a JSON object for ai_proposal';
  end if;
  if not (meta ?& allowed) then
    raise exception 'generation_metadata_json is missing required closed-contract keys';
  end if;
  for k in select jsonb_object_keys(meta)
  loop
    if not (k = any (allowed)) then
      raise exception 'generation_metadata_json contains a key outside the closed contract: %', k;
    end if;
  end loop;
end;
$$;

comment on function public.legal_ingestion_tkp_assert_generation_metadata(jsonb) is
  'TAX-640A closed generation_metadata_json key set. Rejects extra keys including prompt/completion/secrets. Does not inspect or store raw legal text.';

create or replace function public.legal_ingestion_tax_knowledge_proposals_guard_insert()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from 'proposed' then
    raise exception 'legal_ingestion_tax_knowledge_proposals must be inserted as proposed';
  end if;
  if new.published_tax_rule_id is not null
    or new.published_tax_rule_version_id is not null
    or new.published_tax_legal_node_id is not null then
    raise exception 'publication trace must remain null until a future Owner publish-to-canonical-draft command';
  end if;
  if new.creation_origin = 'ai_proposal' then
    perform public.legal_ingestion_tkp_assert_generation_metadata(new.generation_metadata_json);
  elsif new.generation_metadata_json is not null then
    raise exception 'owner_corrected generation_metadata_json must be null';
  end if;
  return new;
end;
$$;

comment on function public.legal_ingestion_tax_knowledge_proposals_guard_insert() is
  'TAX-636A INSERT is proposed only. published_* stay null. No canonical objects are created. TAX-640A also requires closed generation_metadata_json for ai_proposal and forbids it for owner_corrected.';

create or replace function public.legal_ingestion_tax_knowledge_proposals_protect_history()
returns trigger
language plpgsql
as $$
begin
  if new.created_at is distinct from old.created_at then
    raise exception 'proposal created_at is immutable';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'proposal created_by is immutable';
  end if;
  if new.legal_text_draft_id is distinct from old.legal_text_draft_id
    or new.country_code is distinct from old.country_code
    or new.document_id is distinct from old.document_id
    or new.tax_source_id is distinct from old.tax_source_id then
    raise exception 'proposal Owner Draft / country / document / tax_source provenance is immutable';
  end if;
  if new.creation_origin is distinct from old.creation_origin then
    raise exception 'creation_origin is durable and cannot be changed';
  end if;
  if new.revision_no is distinct from old.revision_no then
    raise exception 'proposal revision_no is immutable';
  end if;
  if new.supersedes_proposal_id is distinct from old.supersedes_proposal_id then
    raise exception 'supersedes_proposal_id is immutable after insert';
  end if;
  if new.proposal_json is distinct from old.proposal_json then
    raise exception 'proposal_json is immutable after insert; create a new revision';
  end if;
  if new.generation_metadata_json is distinct from old.generation_metadata_json then
    raise exception 'generation_metadata_json is immutable after insert; create a new revision';
  end if;
  if new.structure_run_id is distinct from old.structure_run_id
    and not (old.structure_run_id is not null and new.structure_run_id is null) then
    raise exception 'structure_run_id is provenance and cannot be rebound';
  end if;

  if old.status in ('rejected', 'published_to_canonical_draft') then
    if new.status is distinct from old.status then
      raise exception 'rejected/published proposal status is frozen';
    end if;
  elsif old.status is distinct from new.status then
    if new.status = 'published_to_canonical_draft' and old.status is distinct from 'owner_approved' then
      raise exception 'proposal may be published_to_canonical_draft only from owner_approved';
    end if;
    if not (
      (
        old.status in ('proposed', 'needs_review', 'owner_approved')
        and new.status in ('proposed', 'needs_review', 'owner_approved', 'rejected')
      )
      or (old.status = 'owner_approved' and new.status = 'published_to_canonical_draft')
    ) then
      raise exception 'Invalid proposal status transition: % → %', old.status, new.status;
    end if;
  end if;

  if old.status = 'rejected' then
    if new.published_tax_rule_id is distinct from old.published_tax_rule_id
      or new.published_tax_rule_version_id is distinct from old.published_tax_rule_version_id
      or new.published_tax_legal_node_id is distinct from old.published_tax_legal_node_id then
      raise exception 'rejected proposal publication trace is frozen';
    end if;
  else
    if old.published_tax_rule_id is not null
      and new.published_tax_rule_id is distinct from old.published_tax_rule_id then
      raise exception 'published_tax_rule_id cannot be changed once set';
    end if;
    if old.published_tax_rule_version_id is not null
      and new.published_tax_rule_version_id is distinct from old.published_tax_rule_version_id then
      raise exception 'published_tax_rule_version_id cannot be changed once set';
    end if;
    if old.published_tax_legal_node_id is not null
      and new.published_tax_legal_node_id is distinct from old.published_tax_legal_node_id then
      raise exception 'published_tax_legal_node_id cannot be changed once set';
    end if;
    if old.status is distinct from 'published_to_canonical_draft'
      and new.status is distinct from 'published_to_canonical_draft'
      and (
        new.published_tax_rule_id is not null
        or new.published_tax_rule_version_id is not null
        or new.published_tax_legal_node_id is not null
      ) then
      raise exception 'publication trace must remain null until published_to_canonical_draft';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.legal_ingestion_tax_knowledge_proposals_protect_history() is
  'TAX-636A freeze provenance and proposal_json after insert. TAX-640A also freezes generation_metadata_json. rejected/published rows cannot be silently overwritten. Re-analysis must INSERT a new revision.';
