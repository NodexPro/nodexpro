-- Extended רכבים model for הגדרות הנה״ח (ownership kinds, VAT offsets, status, etc.)

alter table public.client_accounting_vehicle_fleet
  add column if not exists ownership_kind text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists manufacturer text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists model text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists vehicle_owner_name text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists assigned_to text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists recognized_in_business text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists current_value_ils numeric(14, 2)
    check (current_value_ils is null or current_value_ils >= 0);

alter table public.client_accounting_vehicle_fleet
  add column if not exists acquisition_method text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists business_use_percent int
    check (business_use_percent is null or (business_use_percent >= 0 and business_use_percent <= 100));

alter table public.client_accounting_vehicle_fleet
  add column if not exists fuel_vat_offset_mode text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists fuel_vat_offset_custom_percent numeric(6, 2)
    check (fuel_vat_offset_custom_percent is null or (fuel_vat_offset_custom_percent >= 0 and fuel_vat_offset_custom_percent <= 100));

alter table public.client_accounting_vehicle_fleet
  add column if not exists has_additional_vehicle_expenses boolean not null default false;

alter table public.client_accounting_vehicle_fleet
  add column if not exists vehicle_exp_vat_offset_mode text;

alter table public.client_accounting_vehicle_fleet
  add column if not exists vehicle_exp_vat_offset_custom_percent numeric(6, 2)
    check (vehicle_exp_vat_offset_custom_percent is null or (vehicle_exp_vat_offset_custom_percent >= 0 and vehicle_exp_vat_offset_custom_percent <= 100));

alter table public.client_accounting_vehicle_fleet
  add column if not exists vehicle_status text not null default 'active';

-- Backfill ownership_kind from legacy ownership
update public.client_accounting_vehicle_fleet
set ownership_kind = case ownership
  when 'private' then 'private_vehicle'
  else 'business_vehicle'
end
where ownership_kind is null;

update public.client_accounting_vehicle_fleet
set ownership_kind = 'business_vehicle'
where ownership_kind is null;

alter table public.client_accounting_vehicle_fleet
  alter column ownership_kind set not null;

alter table public.client_accounting_vehicle_fleet
  add constraint client_accounting_vehicle_fleet_ownership_kind_chk
    check (ownership_kind in (
      'business_vehicle', 'private_vehicle', 'leasing', 'rental', 'other'
    ));

alter table public.client_accounting_vehicle_fleet
  add constraint client_accounting_vehicle_fleet_assigned_to_chk
    check (assigned_to is null or assigned_to in (
      'business_owner', 'spouse', 'employee', 'company', 'other'
    ));

alter table public.client_accounting_vehicle_fleet
  add constraint client_accounting_vehicle_fleet_recognized_chk
    check (recognized_in_business is null or recognized_in_business in (
      'yes', 'no', 'partial'
    ));

alter table public.client_accounting_vehicle_fleet
  add constraint client_accounting_vehicle_fleet_acquisition_chk
    check (acquisition_method is null or acquisition_method in (
      'purchased', 'leasing', 'rental', 'transferred_private', 'other'
    ));

alter table public.client_accounting_vehicle_fleet
  add constraint client_accounting_vehicle_fleet_fuel_vat_mode_chk
    check (fuel_vat_offset_mode is null or fuel_vat_offset_mode in (
      'full', 'two_thirds', 'other'
    ));

alter table public.client_accounting_vehicle_fleet
  add constraint client_accounting_vehicle_fleet_exp_vat_mode_chk
    check (vehicle_exp_vat_offset_mode is null or vehicle_exp_vat_offset_mode in (
      'full', 'two_thirds', 'none', 'other'
    ));

alter table public.client_accounting_vehicle_fleet
  add constraint client_accounting_vehicle_fleet_status_chk
    check (vehicle_status in ('active', 'sold', 'inactive'));

update public.client_accounting_vehicle_fleet
set vehicle_status = 'sold'
where sale_date is not null and vehicle_status = 'active';

comment on column public.client_accounting_vehicle_fleet.ownership_kind is 'סוג בעלות (מורחב) — מקור אמת לתצוגה; ownership legacy נשמר לתאימות';
