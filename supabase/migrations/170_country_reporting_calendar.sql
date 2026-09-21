-- Country Pack Reporting Calendar (Phase 1).
-- Canonical statutory filing dates by country + obligation + reporting period.
-- LEGAL OWNER: Country Pack / Owner Legal Control.
-- Client Operations / Work Engine / frontend must NOT invent statutory days.
-- Seed 2026 IL rows as DRAFT only — Platform Owner retains publication control.
-- National Insurance deductions are intentionally NOT seeded from Tax Authority source.

create table if not exists public.country_reporting_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  country_pack_ruleset_id uuid null references public.country_pack_rulesets(id) on delete restrict,
  obligation_key text not null
    check (
      obligation_key in (
        'vat_regular_income_tax_advances',
        'income_tax_deductions',
        'vat_detailed'
      )
    ),
  reporting_period_key text not null
    check (reporting_period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  filing_due_date date not null,
  explanation_code text null,
  owner_note text null,
  legal_basis_reference text null,
  status text not null
    check (status in ('draft', 'active', 'deprecated', 'disabled')),
  replaces_entry_id uuid null references public.country_reporting_calendar_entries(id) on delete set null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.country_reporting_calendar_entries is
  'Country Pack statutory reporting calendar entries (versioned). reporting_period_key is the reporting period (YYYY-MM), not the filing month. Only status=active is runtime legal truth.';

comment on column public.country_reporting_calendar_entries.obligation_key is
  'vat_regular_income_tax_advances = regular VAT + income-tax advances; vat_detailed = PCN/מפורט; income_tax_deductions = מס הכנסה ניכויים. National Insurance is out of scope for this Tax Authority seed.';

comment on column public.country_reporting_calendar_entries.reporting_period_key is
  'Canonical reporting period YYYY-MM (e.g. 2026-01). Distinct from filing_due_date month.';

comment on column public.country_reporting_calendar_entries.explanation_code is
  'Source explanation reference from official calendar (e.g. 4, 7, 4+7). Provenance only — not used for date calculation.';

-- One ACTIVE runtime truth per country + obligation + reporting period.
-- Ruleset is NOT part of this uniqueness: concurrent active truths across rulesets
-- would make runtime resolution ambiguous. Historical ruleset lineages remain as
-- deprecated/disabled rows (reproducible via replaces_entry_id / status history).
create unique index if not exists uq_country_reporting_calendar_active_period_obligation
  on public.country_reporting_calendar_entries (country_code, obligation_key, reporting_period_key)
  where (status = 'active');

-- At most one DRAFT per country + obligation + reporting period (prevents ambiguous publish).
create unique index if not exists uq_country_reporting_calendar_draft_period_obligation
  on public.country_reporting_calendar_entries (country_code, obligation_key, reporting_period_key)
  where (status = 'draft');

create index if not exists idx_country_reporting_calendar_country_period
  on public.country_reporting_calendar_entries (country_code, reporting_period_key);

create index if not exists idx_country_reporting_calendar_country_year_status
  on public.country_reporting_calendar_entries (country_code, status, reporting_period_key);

create index if not exists idx_country_reporting_calendar_obligation
  on public.country_reporting_calendar_entries (country_code, obligation_key, status);

create index if not exists idx_country_reporting_calendar_ruleset
  on public.country_reporting_calendar_entries (country_pack_ruleset_id);

create trigger country_reporting_calendar_entries_updated_at
  before update on public.country_reporting_calendar_entries
  for each row execute function public.set_updated_at();

-- Guard: ruleset country must match entry country when ruleset is bound.
create or replace function public.country_reporting_calendar_entries_guard_country_scope()
returns trigger
language plpgsql
as $$
begin
  if new.country_pack_ruleset_id is null then
    return new;
  end if;

  if (
    select cp.country_code
    from public.country_pack_rulesets rs
    join public.country_packs cp on cp.id = rs.country_pack_id
    where rs.id = new.country_pack_ruleset_id
  ) is distinct from new.country_code then
    raise exception 'Cross-country reporting calendar ruleset binding is forbidden';
  end if;

  return new;
end;
$$;

drop trigger if exists country_reporting_calendar_entries_country_scope_guard
  on public.country_reporting_calendar_entries;

create trigger country_reporting_calendar_entries_country_scope_guard
  before insert or update on public.country_reporting_calendar_entries
  for each row execute function public.country_reporting_calendar_entries_guard_country_scope();

-- Guard: replaces_entry_id must reference same country + obligation + reporting period.
create or replace function public.country_reporting_calendar_entries_guard_replacement()
returns trigger
language plpgsql
as $$
declare
  prev record;
begin
  if new.replaces_entry_id is null then
    return new;
  end if;

  if new.replaces_entry_id = new.id then
    raise exception 'Reporting calendar entry cannot replace itself';
  end if;

  select country_code, obligation_key, reporting_period_key
    into prev
  from public.country_reporting_calendar_entries
  where id = new.replaces_entry_id;

  if not found then
    raise exception 'replaces_entry_id must reference an existing calendar entry';
  end if;

  if prev.country_code is distinct from new.country_code
     or prev.obligation_key is distinct from new.obligation_key
     or prev.reporting_period_key is distinct from new.reporting_period_key then
    raise exception 'Replacement must preserve country_code, obligation_key, and reporting_period_key';
  end if;

  return new;
end;
$$;

drop trigger if exists country_reporting_calendar_entries_replacement_guard
  on public.country_reporting_calendar_entries;

create trigger country_reporting_calendar_entries_replacement_guard
  before insert or update on public.country_reporting_calendar_entries
  for each row execute function public.country_reporting_calendar_entries_guard_replacement();

alter table public.country_reporting_calendar_entries enable row level security;

-- Platform-governed legal truth: no tenant direct select/write policies.
-- Backend service_role + Platform Owner commands are the write path.

-- Ensure Israel country row exists for seed binding.
insert into public.countries (code, name, status, default_timezone)
values ('IL', 'Israel', 'active', 'Asia/Jerusalem')
on conflict (code) do nothing;

-- 2026 IL official Tax Authority adjusted calendar — DRAFT only.
-- Provenance: Income Tax Ordinance §173ב, §175(ו); VAT Law §67(ב1);
-- adjustments for business days / weekly rest / professional-body comments.
-- Stored filing_due_date is authoritative; do NOT derive from base days 15/16/23 at runtime.

with seed(reporting_period_key, obligation_key, filing_due_date, explanation_code) as (
  values
    -- 2026-01
    ('2026-01', 'vat_regular_income_tax_advances', date '2026-02-16', '4'),
    ('2026-01', 'income_tax_deductions',            date '2026-02-16', null),
    ('2026-01', 'vat_detailed',                     date '2026-02-23', null),
    -- 2026-02
    ('2026-02', 'vat_regular_income_tax_advances', date '2026-03-16', '4'),
    ('2026-02', 'income_tax_deductions',            date '2026-03-16', null),
    ('2026-02', 'vat_detailed',                     date '2026-03-26', '7'),
    -- 2026-03
    ('2026-03', 'vat_regular_income_tax_advances', date '2026-04-27', '7'),
    ('2026-03', 'income_tax_deductions',            date '2026-04-27', '7'),
    ('2026-03', 'vat_detailed',                     date '2026-04-27', '7'),
    -- 2026-04
    ('2026-04', 'vat_regular_income_tax_advances', date '2026-05-18', '4'),
    ('2026-04', 'income_tax_deductions',            date '2026-05-18', '4'),
    ('2026-04', 'vat_detailed',                     date '2026-05-26', '4+7'),
    -- 2026-05
    ('2026-05', 'vat_regular_income_tax_advances', date '2026-06-15', null),
    ('2026-05', 'income_tax_deductions',            date '2026-06-16', null),
    ('2026-05', 'vat_detailed',                     date '2026-06-23', null),
    -- 2026-06
    ('2026-06', 'vat_regular_income_tax_advances', date '2026-07-15', null),
    ('2026-06', 'income_tax_deductions',            date '2026-07-16', null),
    ('2026-06', 'vat_detailed',                     date '2026-07-27', '7'),
    -- 2026-07
    ('2026-07', 'vat_regular_income_tax_advances', date '2026-08-17', '4'),
    ('2026-07', 'income_tax_deductions',            date '2026-08-17', '4'),
    ('2026-07', 'vat_detailed',                     date '2026-08-24', '4'),
    -- 2026-08
    ('2026-08', 'vat_regular_income_tax_advances', date '2026-09-24', '7'),
    ('2026-08', 'income_tax_deductions',            date '2026-09-24', '7'),
    ('2026-08', 'vat_detailed',                     date '2026-09-24', '7'),
    -- 2026-09
    ('2026-09', 'vat_regular_income_tax_advances', date '2026-10-19', '7'),
    ('2026-09', 'income_tax_deductions',            date '2026-10-19', '4'),
    ('2026-09', 'vat_detailed',                     date '2026-10-26', '4'),
    -- 2026-10
    ('2026-10', 'vat_regular_income_tax_advances', date '2026-11-16', '4'),
    ('2026-10', 'income_tax_deductions',            date '2026-11-16', null),
    ('2026-10', 'vat_detailed',                     date '2026-11-23', null),
    -- 2026-11
    ('2026-11', 'vat_regular_income_tax_advances', date '2026-12-15', null),
    ('2026-11', 'income_tax_deductions',            date '2026-12-16', null),
    ('2026-11', 'vat_detailed',                     date '2026-12-23', null),
    -- 2026-12
    ('2026-12', 'vat_regular_income_tax_advances', date '2027-01-18', '4'),
    ('2026-12', 'income_tax_deductions',            date '2027-01-18', '4'),
    ('2026-12', 'vat_detailed',                     date '2027-01-26', '7')
)
insert into public.country_reporting_calendar_entries (
  country_code,
  obligation_key,
  reporting_period_key,
  filing_due_date,
  explanation_code,
  legal_basis_reference,
  owner_note,
  status
)
select
  'IL',
  s.obligation_key,
  s.reporting_period_key,
  s.filing_due_date,
  s.explanation_code,
  'Income Tax Ordinance §173ב; Income Tax Ordinance §175(ו); VAT Law §67(ב1)',
  'Official 2026 Tax Authority adjusted reporting calendar (business/rest-day / professional-body adjustments). Seeded as DRAFT — not runtime legal truth until Platform Owner activates.',
  'draft'
from seed s
where not exists (
  select 1
  from public.country_reporting_calendar_entries e
  where e.country_code = 'IL'
    and e.obligation_key = s.obligation_key
    and e.reporting_period_key = s.reporting_period_key
    and e.status in ('draft', 'active')
);


-- Immutable legal dates: ACTIVE/DEPRECATED filing_due_date cannot be mutated in place.
create or replace function public.country_reporting_calendar_entries_guard_immutable_legal_date()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.country_code is distinct from new.country_code
       or old.obligation_key is distinct from new.obligation_key
       or old.reporting_period_key is distinct from new.reporting_period_key then
      raise exception 'Reporting calendar identity columns are immutable';
    end if;

    if old.status in ('active', 'deprecated')
       and new.filing_due_date is distinct from old.filing_due_date then
      raise exception 'Cannot mutate filing_due_date on active/deprecated legal truth; create a replacement version';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists country_reporting_calendar_entries_immutable_legal_date
  on public.country_reporting_calendar_entries;

create trigger country_reporting_calendar_entries_immutable_legal_date
  before update on public.country_reporting_calendar_entries
  for each row execute function public.country_reporting_calendar_entries_guard_immutable_legal_date();

-- Atomic year publish: validate complete intended set, then activate drafts in one transaction.
create or replace function public.publish_country_reporting_calendar_year(
  p_country_code char(2),
  p_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text;
  v_obligation text;
  v_draft_id uuid;
  v_active_id uuid;
  v_effective date;
  v_expected integer := 0;
  v_present integer := 0;
  v_published integer := 0;
  v_obligations text[] := array[
    'vat_regular_income_tax_advances',
    'income_tax_deductions',
    'vat_detailed'
  ];
  v_missing text[] := array[]::text[];
begin
  if p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid reporting calendar year';
  end if;

  foreach v_period in array array[
    lpad(p_year::text, 4, '0') || '-01',
    lpad(p_year::text, 4, '0') || '-02',
    lpad(p_year::text, 4, '0') || '-03',
    lpad(p_year::text, 4, '0') || '-04',
    lpad(p_year::text, 4, '0') || '-05',
    lpad(p_year::text, 4, '0') || '-06',
    lpad(p_year::text, 4, '0') || '-07',
    lpad(p_year::text, 4, '0') || '-08',
    lpad(p_year::text, 4, '0') || '-09',
    lpad(p_year::text, 4, '0') || '-10',
    lpad(p_year::text, 4, '0') || '-11',
    lpad(p_year::text, 4, '0') || '-12'
  ]
  loop
    foreach v_obligation in array v_obligations
    loop
      v_expected := v_expected + 1;
      select e.id into v_draft_id
      from public.country_reporting_calendar_entries e
      where e.country_code = p_country_code
        and e.obligation_key = v_obligation
        and e.reporting_period_key = v_period
        and e.status = 'draft'
      limit 1;

      select e.id, e.filing_due_date into v_active_id, v_effective
      from public.country_reporting_calendar_entries e
      where e.country_code = p_country_code
        and e.obligation_key = v_obligation
        and e.reporting_period_key = v_period
        and e.status = 'active'
      limit 1;

      if v_draft_id is not null then
        select e.filing_due_date into v_effective
        from public.country_reporting_calendar_entries e
        where e.id = v_draft_id;
      end if;

      if (v_draft_id is null and v_active_id is null) or v_effective is null then
        v_missing := array_append(v_missing, v_period || ':' || v_obligation);
      else
        v_present := v_present + 1;
      end if;
    end loop;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'Cannot publish incomplete reporting calendar year %: missing %', p_year, array_to_string(v_missing, ',');
  end if;

  foreach v_period in array array[
    lpad(p_year::text, 4, '0') || '-01',
    lpad(p_year::text, 4, '0') || '-02',
    lpad(p_year::text, 4, '0') || '-03',
    lpad(p_year::text, 4, '0') || '-04',
    lpad(p_year::text, 4, '0') || '-05',
    lpad(p_year::text, 4, '0') || '-06',
    lpad(p_year::text, 4, '0') || '-07',
    lpad(p_year::text, 4, '0') || '-08',
    lpad(p_year::text, 4, '0') || '-09',
    lpad(p_year::text, 4, '0') || '-10',
    lpad(p_year::text, 4, '0') || '-11',
    lpad(p_year::text, 4, '0') || '-12'
  ]
  loop
    foreach v_obligation in array v_obligations
    loop
      select e.id into v_draft_id
      from public.country_reporting_calendar_entries e
      where e.country_code = p_country_code
        and e.obligation_key = v_obligation
        and e.reporting_period_key = v_period
        and e.status = 'draft'
      limit 1;

      if v_draft_id is null then
        continue;
      end if;

      select e.id into v_active_id
      from public.country_reporting_calendar_entries e
      where e.country_code = p_country_code
        and e.obligation_key = v_obligation
        and e.reporting_period_key = v_period
        and e.status = 'active'
      limit 1;

      if v_active_id is not null then
        update public.country_reporting_calendar_entries
           set status = 'deprecated',
               updated_at = now()
         where id = v_active_id;
      end if;

      update public.country_reporting_calendar_entries
         set status = 'active',
             replaces_entry_id = coalesce(v_active_id, replaces_entry_id),
             updated_at = now()
       where id = v_draft_id;

      v_published := v_published + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'country_code', p_country_code,
    'year', p_year,
    'expected_count', v_expected,
    'present_count', v_present,
    'published_count', v_published
  );
end;
$$;

revoke all on function public.publish_country_reporting_calendar_year(char, integer) from public;
grant execute on function public.publish_country_reporting_calendar_year(char, integer) to service_role;
