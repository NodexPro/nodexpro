-- Client Operations CO-175 — atomic current/open period applicability snapshot replacement.
-- Persistence only: DELETE exact grain + INSERT supplied complete row in ONE plpgsql transaction.
-- Applicability business logic stays in API (computeOperationalPeriodApplicability).
-- DO NOT APPLY until release approval. Migrations 172–174 already PROD — do not reapply.

create or replace function public.replace_client_operations_period_applicability_snapshot(
  p_organization_id uuid,
  p_client_id uuid,
  p_operational_period_key text,
  p_vat_type text,
  p_vat_frequency text,
  p_payroll_flag boolean,
  p_income_tax_advance_enabled boolean,
  p_income_tax_advance_frequency text,
  p_income_tax_deductions_enabled boolean,
  p_income_tax_deductions_frequency text,
  p_national_insurance_type text,
  p_national_insurance_monthly_amount numeric,
  p_national_insurance_deductions_file_number text,
  p_vat_applicable boolean,
  p_payroll_applicable boolean,
  p_income_tax_advance_applicable boolean,
  p_income_tax_deductions_applicable boolean,
  p_national_insurance_applicable boolean,
  p_national_insurance_deductions_applicable boolean,
  p_row_visible boolean,
  p_client_created_at timestamptz,
  p_expected_tax_settings_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_tax_updated_at timestamptz;
begin
  if p_organization_id is null then
    raise exception 'organization_id required' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'client_id required' using errcode = '22023';
  end if;
  if p_operational_period_key is null
     or p_operational_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'operational_period_key must be YYYY-MM' using errcode = '22023';
  end if;
  if p_vat_applicable is null
     or p_payroll_applicable is null
     or p_income_tax_advance_applicable is null
     or p_income_tax_deductions_applicable is null
     or p_national_insurance_applicable is null
     or p_national_insurance_deductions_applicable is null
     or p_row_visible is null then
    raise exception 'applicability booleans required' using errcode = '22023';
  end if;

  -- Tenant boundary: client must belong to the supplied organization.
  select c.id
    into v_client_id
  from public.clients c
  where c.id = p_client_id
    and c.organization_id = p_organization_id
  for update;

  if v_client_id is null then
    raise exception 'CLIENT_OPERATIONS_SNAPSHOT_REPLACE_TENANT_MISMATCH'
      using errcode = 'P0001';
  end if;

  -- Serialize same-client tax-settings-driven reconciliations (does not block other clients).
  -- Prefer locking the tax-settings row when present; otherwise advisory lock on grain.
  select t.updated_at
    into v_tax_updated_at
  from public.client_tax_settings t
  where t.organization_id = p_organization_id
    and t.client_id = p_client_id
  for update;

  if not found then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_organization_id::text || ':' || p_client_id::text || ':' || p_operational_period_key,
        0
      )
    );
    v_tax_updated_at := null;
  end if;

  -- Stale precomputed payload guard: snapshot must match current canonical tax settings revision.
  if p_expected_tax_settings_updated_at is distinct from v_tax_updated_at then
    raise exception 'CLIENT_OPERATIONS_SNAPSHOT_REPLACE_STALE_TAX_SETTINGS'
      using errcode = 'P0001';
  end if;

  delete from public.client_operations_period_applicability_snapshots s
  where s.organization_id = p_organization_id
    and s.client_id = p_client_id
    and s.operational_period_key = p_operational_period_key;

  insert into public.client_operations_period_applicability_snapshots (
    organization_id,
    client_id,
    operational_period_key,
    vat_type,
    vat_frequency,
    payroll_flag,
    income_tax_advance_enabled,
    income_tax_advance_frequency,
    income_tax_deductions_enabled,
    income_tax_deductions_frequency,
    national_insurance_type,
    national_insurance_monthly_amount,
    national_insurance_deductions_file_number,
    vat_applicable,
    payroll_applicable,
    income_tax_advance_applicable,
    income_tax_deductions_applicable,
    national_insurance_applicable,
    national_insurance_deductions_applicable,
    row_visible,
    client_created_at,
    captured_at
  ) values (
    p_organization_id,
    p_client_id,
    p_operational_period_key,
    p_vat_type,
    p_vat_frequency,
    p_payroll_flag,
    p_income_tax_advance_enabled,
    p_income_tax_advance_frequency,
    p_income_tax_deductions_enabled,
    p_income_tax_deductions_frequency,
    p_national_insurance_type,
    p_national_insurance_monthly_amount,
    p_national_insurance_deductions_file_number,
    p_vat_applicable,
    p_payroll_applicable,
    p_income_tax_advance_applicable,
    p_income_tax_deductions_applicable,
    p_national_insurance_applicable,
    p_national_insurance_deductions_applicable,
    p_row_visible,
    p_client_created_at,
    now()
  );
end;
$$;

comment on function public.replace_client_operations_period_applicability_snapshot(
  uuid, uuid, text, text, text, boolean, boolean, text, boolean, text, text, numeric, text,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean, timestamptz, timestamptz
) is
  'CO-175: atomically replace one Client Operations period applicability snapshot grain. Persistence only; applicability computed by API.';

revoke all on function public.replace_client_operations_period_applicability_snapshot(
  uuid, uuid, text, text, text, boolean, boolean, text, boolean, text, text, numeric, text,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean, timestamptz, timestamptz
) from public;

revoke all on function public.replace_client_operations_period_applicability_snapshot(
  uuid, uuid, text, text, text, boolean, boolean, text, boolean, text, text, numeric, text,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean, timestamptz, timestamptz
) from anon, authenticated;

grant execute on function public.replace_client_operations_period_applicability_snapshot(
  uuid, uuid, text, text, text, boolean, boolean, text, boolean, text, text, numeric, text,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean, timestamptz, timestamptz
) to service_role;
