-- Income block access fields (עריכת הכנסות modal)

alter table public.client_accounting_settings
  add column if not exists income_user_code text null,
  add column if not exists income_password_encrypted text null,
  add column if not exists income_software_open_link text null;

alter table public.client_accounting_settings
  drop constraint if exists client_accounting_settings_income_user_code_len,
  drop constraint if exists client_accounting_settings_income_software_open_link_len;

alter table public.client_accounting_settings
  add constraint client_accounting_settings_income_user_code_len
    check (income_user_code is null or char_length(income_user_code) <= 200),
  add constraint client_accounting_settings_income_software_open_link_len
    check (income_software_open_link is null or char_length(income_software_open_link) <= 1000);

