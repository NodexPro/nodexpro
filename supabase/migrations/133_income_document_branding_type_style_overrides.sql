-- Per document-type-group style overrides + default black & white theme

alter table public.income_document_branding_profiles
  add column if not exists document_type_style_overrides jsonb not null default '{}'::jsonb;

comment on column public.income_document_branding_profiles.document_type_style_overrides is
  'Per document-type-group overrides: quote_deal, tax_group, receipt, credit';

update public.income_document_branding_profiles
set color_theme_key = case color_theme_key
  when 'modern_blue' then 'dark_blue'
  when 'executive_navy' then 'dark_blue'
  when 'elegant_gold' then 'yellow'
  when 'emerald' then 'teal'
  when 'royal_purple' then 'pastel_purple'
  when 'clean_gray' then 'gray'
  when 'minimal_light' then 'pale_blue'
  when 'nodexpro_gradient' then 'bright_blue'
  else color_theme_key
end
where color_theme_key in (
  'modern_blue',
  'executive_navy',
  'elegant_gold',
  'emerald',
  'royal_purple',
  'clean_gray',
  'minimal_light',
  'nodexpro_gradient'
);

update public.income_document_branding_profiles
set color_theme_key = 'black_white'
where color_theme_key is null or trim(color_theme_key) = '';

alter table public.income_document_branding_profiles
  alter column color_theme_key set default 'black_white';
