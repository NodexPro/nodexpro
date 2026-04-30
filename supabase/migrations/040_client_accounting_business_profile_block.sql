-- Block: "פרופיל עסקי" (business profile) inside "הגדרות הנה״ח"
-- Single row per org+client (client_accounting_settings) extended with business-operational context.

alter table public.client_accounting_settings
  add column if not exists business_domain text null,
  add column if not exists business_activity_description text null,
  add column if not exists business_operation_mode text null,
  add column if not exists primary_customer_type text null,
  add column if not exists is_seasonal_business boolean not null default false,
  add column if not exists peak_months int[] null,
  add column if not exists business_open_date date null,
  add column if not exists business_close_date date null,
  add column if not exists has_business_vehicles boolean not null default false,
  add column if not exists version int not null default 0,
  add column if not exists created_by uuid null references public.users(id) on delete set null,
  add column if not exists updated_by uuid null references public.users(id) on delete set null;

-- Text length guards (backend also validates; DB helps enforce correctness).
alter table public.client_accounting_settings
  drop constraint if exists client_accounting_settings_business_domain_len,
  drop constraint if exists client_accounting_settings_business_activity_desc_len;

alter table public.client_accounting_settings
  add constraint client_accounting_settings_business_domain_len
    check (business_domain is null or char_length(business_domain) <= 200),
  add constraint client_accounting_settings_business_activity_desc_len
    check (business_activity_description is null or char_length(business_activity_description) <= 1000);

-- Enums (kept as text + check constraints for portability).
alter table public.client_accounting_settings
  drop constraint if exists client_accounting_settings_business_operation_mode_enum,
  drop constraint if exists client_accounting_settings_primary_customer_type_enum;

alter table public.client_accounting_settings
  add constraint client_accounting_settings_business_operation_mode_enum
    check (
      business_operation_mode is null
      or business_operation_mode in ('services', 'trade', 'online', 'freelancer', 'manufacturing', 'mixed')
    ),
  add constraint client_accounting_settings_primary_customer_type_enum
    check (
      primary_customer_type is null
      or primary_customer_type in ('private', 'business', 'mixed')
    );

-- peak_months: allowed values 1..12 and must be empty when not seasonal.
alter table public.client_accounting_settings
  drop constraint if exists client_accounting_settings_peak_months_empty_when_not_seasonal,
  drop constraint if exists client_accounting_settings_peak_months_value_range;

alter table public.client_accounting_settings
  add constraint client_accounting_settings_peak_months_value_range
    check (
      peak_months is null
      or peak_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]
    ),
  add constraint client_accounting_settings_peak_months_empty_when_not_seasonal
    check (
      is_seasonal_business = true
      or array_length(peak_months, 1) is null
    );

-- business_close_date can't be earlier than open date (if both exist).
alter table public.client_accounting_settings
  drop constraint if exists client_accounting_settings_close_after_open;

alter table public.client_accounting_settings
  add constraint client_accounting_settings_close_after_open
    check (
      business_open_date is null
      or business_close_date is null
      or business_close_date >= business_open_date
    );

