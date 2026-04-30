alter table public.owner_email_provider_configs
  drop constraint if exists owner_email_provider_configs_provider_type_check;

alter table public.owner_email_provider_configs
  add constraint owner_email_provider_configs_provider_type_check
  check (provider_type in ('resend', 'sendgrid', 'smtp', 'custom_api'));

alter table public.owner_email_provider_configs
  add column if not exists provider_display_name text null,
  add column if not exists api_endpoint_url text null,
  add column if not exists http_method text null,
  add column if not exists auth_type text null,
  add column if not exists auth_header_name text null,
  add column if not exists recipient_field text null,
  add column if not exists subject_field text null,
  add column if not exists html_body_field text null,
  add column if not exists text_body_field text null,
  add column if not exists static_headers_json jsonb null,
  add column if not exists static_payload_json jsonb null,
  add column if not exists success_response_path text null,
  add column if not exists error_response_path text null;

