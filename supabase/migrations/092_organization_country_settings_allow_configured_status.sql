-- Allow command/settings flow to persist `configured` lifecycle state
-- while keeping backward compatibility with existing `active` rows.

alter table public.organization_country_settings
  drop constraint if exists organization_country_settings_settings_status_check;

alter table public.organization_country_settings
  add constraint organization_country_settings_settings_status_check
  check (settings_status in ('not_configured', 'configured', 'active', 'disabled', 'error'));

