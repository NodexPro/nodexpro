-- Document style key — business-facing theme selection (replaces ad-hoc color editing in UI).

alter table public.income_document_branding_profiles
  add column if not exists document_style_key text not null default 'classic_blue';

comment on column public.income_document_branding_profiles.document_style_key is
  'Selected document style preset key; backend resolves to colors/gradient for preview and PDF.';
