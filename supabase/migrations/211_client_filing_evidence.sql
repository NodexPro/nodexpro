-- Optional filing/payment evidence on the existing client documents workspace.
-- Does not create a second storage bucket. Not applied by this change.
-- VAT reporting_period_key is the obligation period: YYYY-MM monthly, or
-- YYYY-MM-MM for a bimonthly pair (09-10). The selected tab is the end month.

alter table public.client_documents
  add column if not exists evidence_kind text null,
  add column if not exists obligation_id uuid null,
  add column if not exists obligation_canonical_id text null,
  add column if not exists operational_period_key text null,
  add column if not exists reporting_period_key text null,
  add column if not exists filing_kind text null;

alter table public.client_documents
  drop constraint if exists client_documents_evidence_kind_check;

alter table public.client_documents
  add constraint client_documents_evidence_kind_check
  check (evidence_kind is null or evidence_kind in ('filing', 'payment'));

alter table public.client_documents
  drop constraint if exists client_documents_filing_kind_check;

alter table public.client_documents
  add constraint client_documents_filing_kind_check
  check (
    filing_kind is null
    or filing_kind in ('vat', 'income_tax_advance', 'national_insurance_deductions')
  );

create index if not exists idx_client_documents_filing_evidence
  on public.client_documents (organization_id, client_id, obligation_canonical_id)
  where deleted_at is null and obligation_canonical_id is not null;

-- Evidence rows must stay inside the same organization and client as their folder,
-- private file and obligation. Ordinary documents without evidence columns are unchanged.
-- VAT and income-tax obligation_id must be that client's client_obligations row
-- for the same period. NI deductions obligation_id must be that client's
-- client_ni_deductions_period row. There is no foreign key to only one table.
create or replace function public.client_documents_evidence_same_tenant()
returns trigger
language plpgsql
as $$
declare
  folder_org uuid;
  folder_client uuid;
  asset_org uuid;
  asset_key text;
  vat_start_month int;
  vat_end_month int;
  vat_end_key text;
begin
  if new.evidence_kind is null
     and new.obligation_id is null
     and new.obligation_canonical_id is null
     and new.filing_kind is null
     and new.reporting_period_key is null
     and new.operational_period_key is null then
    return new;
  end if;

  if new.evidence_kind is null
     or new.filing_kind is null
     or new.obligation_canonical_id is null
     or new.operational_period_key is null
     or new.reporting_period_key is null then
    raise exception 'filing evidence is incomplete';
  end if;

  select organization_id, client_id into folder_org, folder_client
  from public.client_document_folders
  where id = new.folder_id;
  if folder_org is distinct from new.organization_id
     or folder_client is distinct from new.client_id then
    raise exception 'filing evidence folder is outside this client';
  end if;

  select organization_id, storage_key into asset_org, asset_key
  from public.file_assets
  where id = new.file_asset_id;
  if asset_org is distinct from new.organization_id
     or asset_key is null
     or asset_key not like new.organization_id::text || '/client-documents/' || new.client_id::text || '/%' then
    raise exception 'filing evidence file is outside this client';
  end if;

  if new.obligation_id is not null and new.filing_kind = 'national_insurance_deductions' then
    if not exists (
      select 1
      from public.client_ni_deductions_period p
      where p.id = new.obligation_id
        and p.organization_id = new.organization_id
        and p.client_id = new.client_id
        and p.period_key = new.reporting_period_key
    ) then
      raise exception 'filing evidence obligation is outside this client';
    end if;
  elsif new.obligation_id is not null then
    if not exists (
      select 1
      from public.client_obligations o
      where o.id = new.obligation_id
        and o.organization_id = new.organization_id
        and o.client_id = new.client_id
        and o.period_key = new.reporting_period_key
        and (
          (new.filing_kind = 'vat' and o.obligation_type = 'vat_report')
          or (new.filing_kind = 'income_tax_advance' and o.obligation_type = 'income_tax_advance')
        )
    ) then
      raise exception 'filing evidence obligation is outside this client';
    end if;
  end if;

  if new.filing_kind = 'national_insurance_deductions'
     and (
       new.obligation_canonical_id is distinct from 'national_insurance_deductions::' || new.reporting_period_key
       or new.operational_period_key is distinct from new.reporting_period_key
       or new.reporting_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$'
     ) then
    raise exception 'filing evidence period does not match the NI deductions obligation';
  end if;

  if new.filing_kind = 'income_tax_advance'
     and (
       new.obligation_canonical_id is distinct from 'income_tax_advance::' || new.reporting_period_key
       or new.operational_period_key is distinct from new.reporting_period_key
       or new.reporting_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$'
     ) then
    raise exception 'filing evidence period does not match the income-tax advance obligation';
  end if;

  if new.filing_kind = 'vat' then
    if new.obligation_canonical_id is distinct from 'vat_report::' || new.reporting_period_key then
      raise exception 'filing evidence period does not match the VAT obligation';
    end if;
    if new.reporting_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$' then
      if new.operational_period_key is distinct from new.reporting_period_key then
        raise exception 'filing evidence period does not match the VAT obligation';
      end if;
    elsif new.reporting_period_key ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|1[0-2])$' then
      vat_start_month := substring(new.reporting_period_key from 6 for 2)::int;
      vat_end_month := substring(new.reporting_period_key from 9 for 2)::int;
      vat_end_key := substring(new.reporting_period_key from 1 for 4) || '-' || substring(new.reporting_period_key from 9 for 2);
      if vat_start_month % 2 = 0
         or vat_end_month <> vat_start_month + 1
         or new.operational_period_key is distinct from vat_end_key then
        raise exception 'filing evidence period does not match the VAT obligation';
      end if;
    else
      raise exception 'filing evidence period does not match the VAT obligation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists client_documents_evidence_same_tenant on public.client_documents;

create trigger client_documents_evidence_same_tenant
  before insert or update on public.client_documents
  for each row execute function public.client_documents_evidence_same_tenant();
