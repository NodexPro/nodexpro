-- Client Operations CO-176 — one-shot repair of legacy מ״ה ניכויים applicability bits.
--
-- Root cause: historical snapshots frozen under pre-9b1c4104 formula used
--   enabled && isIncomeTaxFrequencyApplicable (bi_monthly = ODD months).
-- Correct cadence (aligned with דו-חודשי מע״מ): bi_monthly = EVEN operational months.
--
-- Repair uses ONLY frozen snapshot columns:
--   operational_period_key, income_tax_deductions_enabled, income_tax_deductions_frequency
-- Does NOT read client_tax_settings / live configuration.
-- Updates ONLY income_tax_deductions_applicable.
-- Does NOT touch completion/progress tables (client_income_tax_deductions_period, etc.).
--
-- 172–175 already PROD — do not reapply.
-- DO NOT APPLY this migration until release approval.

-- Narrow, temporary freeze relaxation: allow ONLY income_tax_deductions_applicable
-- to change. All other frozen fields remain immutable. Restored at end of migration.
create or replace function public.client_operations_period_applicability_snapshots_freeze()
returns trigger
language plpgsql
as $$
declare
  v_other_changed boolean;
begin
  if TG_OP = 'UPDATE' then
    v_other_changed :=
         NEW.vat_type is distinct from OLD.vat_type
      or NEW.vat_frequency is distinct from OLD.vat_frequency
      or NEW.payroll_flag is distinct from OLD.payroll_flag
      or NEW.income_tax_advance_enabled is distinct from OLD.income_tax_advance_enabled
      or NEW.income_tax_advance_frequency is distinct from OLD.income_tax_advance_frequency
      or NEW.income_tax_deductions_enabled is distinct from OLD.income_tax_deductions_enabled
      or NEW.income_tax_deductions_frequency is distinct from OLD.income_tax_deductions_frequency
      or NEW.national_insurance_type is distinct from OLD.national_insurance_type
      or NEW.national_insurance_monthly_amount is distinct from OLD.national_insurance_monthly_amount
      or NEW.national_insurance_deductions_file_number is distinct from OLD.national_insurance_deductions_file_number
      or NEW.vat_applicable is distinct from OLD.vat_applicable
      or NEW.payroll_applicable is distinct from OLD.payroll_applicable
      or NEW.income_tax_advance_applicable is distinct from OLD.income_tax_advance_applicable
      or NEW.national_insurance_applicable is distinct from OLD.national_insurance_applicable
      or NEW.national_insurance_deductions_applicable is distinct from OLD.national_insurance_deductions_applicable
      or NEW.row_visible is distinct from OLD.row_visible
      or NEW.client_created_at is distinct from OLD.client_created_at
      or NEW.captured_at is distinct from OLD.captured_at
      or NEW.operational_period_key is distinct from OLD.operational_period_key
      or NEW.client_id is distinct from OLD.client_id
      or NEW.organization_id is distinct from OLD.organization_id;

    -- CO-176 one-shot: allow income_tax_deductions_applicable alone to be corrected.
    if v_other_changed then
      raise exception 'CLIENT_OPERATIONS_PERIOD_SNAPSHOT_IMMUTABLE'
        using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

comment on function public.client_operations_period_applicability_snapshots_freeze() is
  'CO-176 temporary: allows only income_tax_deductions_applicable updates; restored to full freeze below.';

-- Deterministic repair from frozen snapshot inputs only (no live tax settings).
update public.client_operations_period_applicability_snapshots as s
set income_tax_deductions_applicable = (
  case
    when coalesce(s.income_tax_deductions_enabled, false) is not true then false
    when lower(btrim(coalesce(s.income_tax_deductions_frequency, ''))) = 'monthly' then true
    when lower(btrim(coalesce(s.income_tax_deductions_frequency, ''))) = 'bi_monthly' then
      -- EVEN operational months only (same as דו-חודשי מע״מ)
      (substring(s.operational_period_key from 6 for 2)::int % 2) = 0
    when lower(btrim(coalesce(s.income_tax_deductions_frequency, ''))) = 'semi_annual' then
      -- January + June only (YYYY-01 / YYYY-06)
      substring(s.operational_period_key from 6 for 2) in ('01', '06')
    else false
  end
)
where s.income_tax_deductions_applicable is distinct from (
  case
    when coalesce(s.income_tax_deductions_enabled, false) is not true then false
    when lower(btrim(coalesce(s.income_tax_deductions_frequency, ''))) = 'monthly' then true
    when lower(btrim(coalesce(s.income_tax_deductions_frequency, ''))) = 'bi_monthly' then
      (substring(s.operational_period_key from 6 for 2)::int % 2) = 0
    when lower(btrim(coalesce(s.income_tax_deductions_frequency, ''))) = 'semi_annual' then
      substring(s.operational_period_key from 6 for 2) in ('01', '06')
    else false
  end
);

-- Restore full freeze protection (identical to migration 171 contract).
create or replace function public.client_operations_period_applicability_snapshots_freeze()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.vat_type is distinct from OLD.vat_type
      or NEW.vat_frequency is distinct from OLD.vat_frequency
      or NEW.payroll_flag is distinct from OLD.payroll_flag
      or NEW.income_tax_advance_enabled is distinct from OLD.income_tax_advance_enabled
      or NEW.income_tax_advance_frequency is distinct from OLD.income_tax_advance_frequency
      or NEW.income_tax_deductions_enabled is distinct from OLD.income_tax_deductions_enabled
      or NEW.income_tax_deductions_frequency is distinct from OLD.income_tax_deductions_frequency
      or NEW.national_insurance_type is distinct from OLD.national_insurance_type
      or NEW.national_insurance_monthly_amount is distinct from OLD.national_insurance_monthly_amount
      or NEW.national_insurance_deductions_file_number is distinct from OLD.national_insurance_deductions_file_number
      or NEW.vat_applicable is distinct from OLD.vat_applicable
      or NEW.payroll_applicable is distinct from OLD.payroll_applicable
      or NEW.income_tax_advance_applicable is distinct from OLD.income_tax_advance_applicable
      or NEW.income_tax_deductions_applicable is distinct from OLD.income_tax_deductions_applicable
      or NEW.national_insurance_applicable is distinct from OLD.national_insurance_applicable
      or NEW.national_insurance_deductions_applicable is distinct from OLD.national_insurance_deductions_applicable
      or NEW.row_visible is distinct from OLD.row_visible
      or NEW.client_created_at is distinct from OLD.client_created_at
      or NEW.captured_at is distinct from OLD.captured_at
      or NEW.operational_period_key is distinct from OLD.operational_period_key
      or NEW.client_id is distinct from OLD.client_id
      or NEW.organization_id is distinct from OLD.organization_id
    then
      raise exception 'CLIENT_OPERATIONS_PERIOD_SNAPSHOT_IMMUTABLE'
        using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

comment on function public.client_operations_period_applicability_snapshots_freeze() is
  'Rejects updates that rewrite frozen Client Operations period applicability snapshot inputs/results.';
