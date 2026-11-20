-- ITD payment/filing evidence reuses the NI deductions folder.
-- Does not move physical files. Does not change filing/payment status.

alter table public.client_documents
  drop constraint if exists client_documents_filing_kind_check;

alter table public.client_documents
  add constraint client_documents_filing_kind_check
  check (
    filing_kind is null
    or filing_kind in (
      'vat',
      'income_tax_advance',
      'national_insurance_deductions',
      'income_tax_deductions'
    )
  );

update public.client_document_folders
set name_he = 'דיווחים מ"ה וב"ל ניכויים'
where system_key = 'ni_deductions_filings'
  and archived_at is null
  and name_he in (
    'דיווחי ב״ל',
    'דיווחי ב"ל',
    'דיווחי ביטוח לאומי'
  );

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
  elsif new.obligation_id is not null and new.filing_kind = 'income_tax_deductions' then
    if not exists (
      select 1
      from public.client_income_tax_deductions_period p
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

  if new.filing_kind = 'income_tax_deductions'
     and (
       new.obligation_canonical_id is distinct from 'income_tax_deductions::' || new.reporting_period_key
       or new.operational_period_key is distinct from new.reporting_period_key
       or new.reporting_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$'
     ) then
    raise exception 'filing evidence period does not match the income-tax deductions obligation';
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
