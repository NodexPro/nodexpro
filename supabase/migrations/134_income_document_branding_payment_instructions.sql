-- Payment instructions text on income document branding profiles.

alter table public.income_document_branding_profiles
  add column if not exists payment_instructions text null;

comment on column public.income_document_branding_profiles.payment_instructions is
  'Free-text payment instructions shown on branded documents when bank/payment details are enabled.';
