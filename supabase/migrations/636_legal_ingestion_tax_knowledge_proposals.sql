-- TAX-636A — Knowledge Trainer Layer B2 Tax Knowledge Proposal foundation.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or edit migrations 620–635.
-- Does not alter ownership of:
--   tax_domains, tax_sources, tax_legal_nodes, tax_rules, tax_rule_versions,
--   country_legal_values, country_legal_value_versions, tax_fact_definitions,
--   tax_rule_relationships, tax_rule_unresolved_legal_references,
--   legal_ingestion_legal_text_drafts, legal_ingestion_owner_completeness,
--   legal_ingestion_candidates, legal_ingestion_structure_runs.
-- Does not INSERT/UPDATE/DELETE Owner Drafts, candidates, or canonical law.
-- Does not store PDF bytes. Does not grant worker/detector ownership.
-- Does not implement commands, UI, AI/LLM, prompts, F2B/F2C, or activation.
-- No migration trigger may create tax_rules / tax_rule_versions / tax_legal_nodes.
--
-- Layers:
--   A. immutable source evidence (PDF, page_text, 629 notes, detector candidates)
--   B. Owner-editable legal draft (legal_ingestion_legal_text_drafts)
--   B2. proposed structured Tax Knowledge  <-- this table
--   C. canonical legal knowledge (tax_legal_nodes / tax_rules / tax_rule_versions)
--
-- This is NOT a second canonical knowledge graph.
-- Owner approval of a proposal is NOT Tax Brain activation.
-- published_to_canonical_draft is a proposal workflow status only.
-- Canonical activation remains a future named Owner Tax Knowledge command.
--
-- Revision model (smallest durable, matches tax_rule_versions monotonic version_no):
--   one row = one immutable proposal snapshot
--   revision_no is monotonic per legal_text_draft_id
--   re-analysis / Owner correction INSERTs a new row
--   do not overwrite proposal_json
--   Not a parallel canonical version system

create table if not exists public.legal_ingestion_tax_knowledge_proposals (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  document_id uuid not null,
  tax_source_id uuid not null,
  legal_text_draft_id uuid not null,
  structure_run_id uuid null references public.legal_ingestion_structure_runs(id) on delete set null,
  creation_origin text not null,
  status text not null,
  revision_no integer not null,
  supersedes_proposal_id uuid null,
  proposal_json jsonb not null,
  published_tax_rule_id uuid null,
  published_tax_rule_version_id uuid null,
  published_tax_legal_node_id uuid null,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (revision_no >= 1),
  check (jsonb_typeof(proposal_json) = 'object'),
  check (creation_origin in ('ai_proposal', 'owner_corrected')),
  check (
    status in (
      'proposed',
      'needs_review',
      'owner_approved',
      'rejected',
      'published_to_canonical_draft'
    )
  ),
  check (supersedes_proposal_id is null or supersedes_proposal_id <> id),
  check (
    (
      published_tax_rule_id is null
      and published_tax_rule_version_id is null
      and published_tax_legal_node_id is null
    )
    or status = 'published_to_canonical_draft'
  ),
  foreign key (document_id, country_code)
    references public.legal_ingestion_documents (id, country_code)
    on delete restrict,
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict,
  foreign key (legal_text_draft_id)
    references public.legal_ingestion_legal_text_drafts (id)
    on delete restrict
);

comment on table public.legal_ingestion_tax_knowledge_proposals is
  'TAX-636A Layer B2 proposed structured Tax Knowledge. Knowledge Trainer / Owner Legal Control only. Not tax_rules, not tax_rule_versions, not tax_legal_nodes, not Layer B legal prose, not Tax Brain activation.';

comment on column public.legal_ingestion_tax_knowledge_proposals.legal_text_draft_id is
  'REQUIRED Layer B Owner Draft pin. A proposal cannot exist without this provenance. Not inferred from structure_run_id.';
comment on column public.legal_ingestion_tax_knowledge_proposals.structure_run_id is
  'Optional PROVENANCE only. Detector run associated with the Draft at proposal time. ON DELETE SET NULL. Not proposal identity. Cannot be rebound to another run.';
comment on column public.legal_ingestion_tax_knowledge_proposals.creation_origin is
  'Durable origin: ai_proposal | owner_corrected. Not inferred from nullable FKs. Cannot change after insert.';
comment on column public.legal_ingestion_tax_knowledge_proposals.status is
  'Proposal workflow only: proposed / needs_review / owner_approved / rejected / published_to_canonical_draft. Never active. Never canonical active. owner_approved is not Tax Brain activation.';
comment on column public.legal_ingestion_tax_knowledge_proposals.revision_no is
  'Monotonic per legal_text_draft_id. BEFORE INSERT trigger checks max+1; UNIQUE (legal_text_draft_id, revision_no) is the concurrency guard. New AI run or Owner correction INSERTs a new row. Not tax_rule_versions.version_no.';
comment on column public.legal_ingestion_tax_knowledge_proposals.supersedes_proposal_id is
  'Optional previous proposal for the same Owner Draft. Same-draft chain only. Not a canonical supersession graph.';
comment on column public.legal_ingestion_tax_knowledge_proposals.proposal_json is
  'Structured proposed Tax Knowledge semantics (nodes/rules/predicates/facts/relationships/citations/legal-value keys/calculation hooks). Immutable after INSERT. Does not replace Layer B draft_legal_text.';
comment on column public.legal_ingestion_tax_knowledge_proposals.published_tax_rule_id is
  'Future named Owner publish-to-canonical-DRAFT trace. NULL until that command. Not activation. Migration must not populate.';
comment on column public.legal_ingestion_tax_knowledge_proposals.published_tax_rule_version_id is
  'Future named Owner publish-to-canonical-DRAFT trace. NULL until that command. Target must remain draft canonical, not active.';
comment on column public.legal_ingestion_tax_knowledge_proposals.published_tax_legal_node_id is
  'Future named Owner publish-to-canonical-DRAFT trace. NULL until that command. Not a legal-node activation command.';

create unique index if not exists uq_legal_ingestion_tax_knowledge_proposals_id_country
  on public.legal_ingestion_tax_knowledge_proposals (id, country_code);

create unique index if not exists uq_legal_ingestion_tax_knowledge_proposals_id_document
  on public.legal_ingestion_tax_knowledge_proposals (id, document_id);

create unique index if not exists uq_legal_ingestion_tax_knowledge_proposals_id_draft
  on public.legal_ingestion_tax_knowledge_proposals (id, legal_text_draft_id);

create unique index if not exists uq_legal_ingestion_tax_knowledge_proposals_draft_revision
  on public.legal_ingestion_tax_knowledge_proposals (legal_text_draft_id, revision_no);

create index if not exists idx_legal_ingestion_tax_knowledge_proposals_document
  on public.legal_ingestion_tax_knowledge_proposals (document_id, created_at);

create index if not exists idx_legal_ingestion_tax_knowledge_proposals_draft
  on public.legal_ingestion_tax_knowledge_proposals (legal_text_draft_id, revision_no);

create index if not exists idx_legal_ingestion_tax_knowledge_proposals_source
  on public.legal_ingestion_tax_knowledge_proposals (tax_source_id);

create index if not exists idx_legal_ingestion_tax_knowledge_proposals_structure_run
  on public.legal_ingestion_tax_knowledge_proposals (structure_run_id)
  where structure_run_id is not null;

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tax_knowledge_proposals_draft_country_fk;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tax_knowledge_proposals_draft_country_fk
  foreign key (legal_text_draft_id, country_code)
  references public.legal_ingestion_legal_text_drafts (id, country_code)
  on delete restrict;

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tax_knowledge_proposals_draft_document_fk;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tax_knowledge_proposals_draft_document_fk
  foreign key (legal_text_draft_id, document_id)
  references public.legal_ingestion_legal_text_drafts (id, document_id)
  on delete restrict;

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tax_knowledge_proposals_supersedes_same_draft_fk;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tax_knowledge_proposals_supersedes_same_draft_fk
  foreign key (supersedes_proposal_id, legal_text_draft_id)
  references public.legal_ingestion_tax_knowledge_proposals (id, legal_text_draft_id)
  on delete restrict;

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tax_knowledge_proposals_published_rule_country_fk;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tax_knowledge_proposals_published_rule_country_fk
  foreign key (published_tax_rule_id, country_code)
  references public.tax_rules (id, country_code)
  on delete restrict;

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tax_knowledge_proposals_published_version_country_fk;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tax_knowledge_proposals_published_version_country_fk
  foreign key (published_tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tax_knowledge_proposals_published_node_country_fk;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tax_knowledge_proposals_published_node_country_fk
  foreign key (published_tax_legal_node_id, country_code)
  references public.tax_legal_nodes (id, country_code)
  on delete restrict;

drop trigger if exists legal_ingestion_tax_knowledge_proposals_updated_at
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_updated_at
  before update on public.legal_ingestion_tax_knowledge_proposals
  for each row execute function public.set_updated_at();

create or replace function public.legal_ingestion_tax_knowledge_proposals_guard_scope()
returns trigger
language plpgsql
as $$
declare
  draft_country char(2);
  draft_document uuid;
  draft_source uuid;
  run_country char(2);
  run_document uuid;
  run_source uuid;
begin
  select d.country_code, d.document_id, d.tax_source_id
    into draft_country, draft_document, draft_source
  from public.legal_ingestion_legal_text_drafts d
  where d.id = new.legal_text_draft_id;
  if draft_country is null then
    raise exception 'legal_text_draft_id must reference an existing Owner Draft';
  end if;
  if draft_country is distinct from new.country_code then
    raise exception 'proposal country_code must match the Owner Draft';
  end if;
  if draft_document is distinct from new.document_id then
    raise exception 'proposal document_id must match the Owner Draft';
  end if;
  if draft_source is distinct from new.tax_source_id then
    raise exception 'proposal tax_source_id must match the Owner Draft';
  end if;

  if new.structure_run_id is null then
    return new;
  end if;
  select r.country_code, r.document_id, r.tax_source_id
    into run_country, run_document, run_source
  from public.legal_ingestion_structure_runs r
  where r.id = new.structure_run_id;
  if run_country is null then
    raise exception 'structure_run_id must reference an existing structure run';
  end if;
  if run_country is distinct from new.country_code
    or run_document is distinct from new.document_id
    or run_source is distinct from new.tax_source_id then
    raise exception 'structure_run_id provenance must match proposal country, document, and tax source';
  end if;
  return new;
end;
$$;

comment on function public.legal_ingestion_tax_knowledge_proposals_guard_scope() is
  'TAX-636A proposal country/document/tax_source must match the pinned Owner Draft. Optional structure_run_id is same-scope provenance only.';

drop trigger if exists legal_ingestion_tax_knowledge_proposals_guard_scope
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_guard_scope
  before insert or update of legal_text_draft_id, document_id, country_code, tax_source_id, structure_run_id
  on public.legal_ingestion_tax_knowledge_proposals
  for each row execute function public.legal_ingestion_tax_knowledge_proposals_guard_scope();

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
  return new;
end;
$$;

comment on function public.legal_ingestion_tax_knowledge_proposals_guard_insert() is
  'TAX-636A INSERT is proposed only. published_* stay null. No canonical objects are created.';

drop trigger if exists legal_ingestion_tax_knowledge_proposals_guard_insert
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_guard_insert
  before insert on public.legal_ingestion_tax_knowledge_proposals
  for each row execute function public.legal_ingestion_tax_knowledge_proposals_guard_insert();

create or replace function public.legal_ingestion_tax_knowledge_proposals_guard_revision_no()
returns trigger
language plpgsql
as $$
declare
  next_no integer;
begin
  select coalesce(max(p.revision_no), 0) + 1
    into next_no
    from public.legal_ingestion_tax_knowledge_proposals p
    where p.legal_text_draft_id = new.legal_text_draft_id;

  if new.revision_no <> next_no then
    raise exception
      'legal_ingestion_tax_knowledge_proposals.revision_no must be monotonic per legal_text_draft_id (expected %)',
      next_no;
  end if;
  return new;
end;
$$;

comment on function public.legal_ingestion_tax_knowledge_proposals_guard_revision_no() is
  'TAX-636A monotonic revision_no per Owner Draft. Same draft may have many revisions. History is retained by INSERT, not overwrite.';

drop trigger if exists legal_ingestion_tax_knowledge_proposals_guard_revision_no
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_guard_revision_no
  before insert on public.legal_ingestion_tax_knowledge_proposals
  for each row execute function public.legal_ingestion_tax_knowledge_proposals_guard_revision_no();

create or replace function public.legal_ingestion_tax_knowledge_proposals_guard_supersession()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid;
  hops integer := 0;
begin
  if new.supersedes_proposal_id is null then
    return new;
  end if;
  if new.supersedes_proposal_id = new.id then
    raise exception 'supersedes_proposal_id cannot equal id';
  end if;
  cursor_id := new.supersedes_proposal_id;
  while cursor_id is not null loop
    hops := hops + 1;
    if hops > 64 then
      raise exception 'proposal supersession chain is too deep';
    end if;
    if cursor_id = new.id then
      raise exception 'proposal supersession cannot create a cycle';
    end if;
    select p.supersedes_proposal_id into cursor_id
    from public.legal_ingestion_tax_knowledge_proposals p
    where p.id = cursor_id;
  end loop;
  return new;
end;
$$;

comment on function public.legal_ingestion_tax_knowledge_proposals_guard_supersession() is
  'TAX-636A supersedes_proposal_id is a same-draft history pointer. No cycle. Not canonical tax_rule_versions supersession.';

drop trigger if exists legal_ingestion_tax_knowledge_proposals_guard_supersession
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_guard_supersession
  before insert or update of supersedes_proposal_id, id
  on public.legal_ingestion_tax_knowledge_proposals
  for each row execute function public.legal_ingestion_tax_knowledge_proposals_guard_supersession();

create or replace function public.legal_ingestion_tax_knowledge_proposals_guard_published_pins()
returns trigger
language plpgsql
as $$
declare
  version_rule uuid;
  version_status text;
  node_status text;
begin
  if new.published_tax_rule_id is null
    and new.published_tax_rule_version_id is null
    and new.published_tax_legal_node_id is null then
    return new;
  end if;
  if new.status is distinct from 'published_to_canonical_draft' then
    raise exception 'publication trace is only valid when status is published_to_canonical_draft';
  end if;
  if new.published_tax_rule_version_id is not null then
    select v.tax_rule_id, v.status
      into version_rule, version_status
    from public.tax_rule_versions v
    where v.id = new.published_tax_rule_version_id;
    if version_rule is null then
      raise exception 'published_tax_rule_version_id must reference an existing tax_rule_version';
    end if;
    if new.published_tax_rule_id is not null
      and version_rule is distinct from new.published_tax_rule_id then
      raise exception 'published_tax_rule_version_id must belong to published_tax_rule_id';
    end if;
    if version_status is distinct from 'draft' then
      raise exception 'publication trace can only pin a draft canonical rule version, never active';
    end if;
  end if;
  if new.published_tax_legal_node_id is not null then
    select n.status into node_status
    from public.tax_legal_nodes n
    where n.id = new.published_tax_legal_node_id;
    if node_status is null then
      raise exception 'published_tax_legal_node_id must reference an existing tax_legal_node';
    end if;
    if node_status is distinct from 'draft' then
      raise exception 'publication trace can only pin a draft canonical legal node, never active';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.legal_ingestion_tax_knowledge_proposals_guard_published_pins() is
  'TAX-636A published_* are future draft-trace pins only. They must not point at canonical active rows. This function does not INSERT canonical objects.';

drop trigger if exists legal_ingestion_tax_knowledge_proposals_guard_published_pins
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_guard_published_pins
  before insert or update of
    status,
    published_tax_rule_id,
    published_tax_rule_version_id,
    published_tax_legal_node_id
  on public.legal_ingestion_tax_knowledge_proposals
  for each row execute function public.legal_ingestion_tax_knowledge_proposals_guard_published_pins();

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
  'TAX-636A freeze provenance and proposal_json after insert. rejected/published rows cannot be silently overwritten. Re-analysis must INSERT a new revision.';

drop trigger if exists legal_ingestion_tax_knowledge_proposals_protect_history
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_protect_history
  before update on public.legal_ingestion_tax_knowledge_proposals
  for each row execute function public.legal_ingestion_tax_knowledge_proposals_protect_history();

create or replace function public.legal_ingestion_tax_knowledge_proposals_forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is forbidden for legal_ingestion_tax_knowledge_proposals. Retain proposal history.';
end;
$$;

comment on function public.legal_ingestion_tax_knowledge_proposals_forbid_delete() is
  'TAX-636A proposal history is retained. No silent overwrite. No delete of rejected/published or in-progress rows.';

drop trigger if exists legal_ingestion_tax_knowledge_proposals_forbid_delete
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_forbid_delete
  before delete on public.legal_ingestion_tax_knowledge_proposals
  for each row execute function public.legal_ingestion_tax_knowledge_proposals_forbid_delete();

drop trigger if exists legal_ingestion_tax_knowledge_proposals_forbid_truncate
  on public.legal_ingestion_tax_knowledge_proposals;
create trigger legal_ingestion_tax_knowledge_proposals_forbid_truncate
  before truncate on public.legal_ingestion_tax_knowledge_proposals
  execute function public.legal_ingestion_tax_knowledge_proposals_forbid_delete();

alter table public.legal_ingestion_tax_knowledge_proposals enable row level security;
alter table public.legal_ingestion_tax_knowledge_proposals force row level security;

revoke all on table public.legal_ingestion_tax_knowledge_proposals from anon, authenticated, public;
grant select, insert, update on table public.legal_ingestion_tax_knowledge_proposals to service_role;
