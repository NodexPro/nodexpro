-- Document Branding Studio keys — style archetype, color theme, optional layout override, logo size.
-- Repurpose document_style_key (131) from legacy color keys to layout archetype keys.

alter table public.income_document_branding_profiles
  add column if not exists color_theme_key text not null default 'modern_blue',
  add column if not exists layout_template_key text null,
  add column if not exists logo_size_key text not null default 'medium';

comment on column public.income_document_branding_profiles.document_style_key is
  'Document layout archetype: classic | modern | elegant | minimal.';

comment on column public.income_document_branding_profiles.color_theme_key is
  'Print-safe color theme key; backend resolves gradient/table/totals/recipient accent tokens.';

comment on column public.income_document_branding_profiles.layout_template_key is
  'Optional layout override; NULL = default from document_style_key preset.';

comment on column public.income_document_branding_profiles.logo_size_key is
  'Logo display size in preview/PDF: small | medium | large.';

-- Migrate legacy color keys stored in document_style_key (pre-studio) into color_theme_key.
update public.income_document_branding_profiles
set color_theme_key = case document_style_key
  when 'classic_blue' then 'modern_blue'
  when 'soft_green' then 'emerald'
  when 'elegant_purple' then 'royal_purple'
  when 'professional_teal' then 'emerald'
  when 'soft_gold' then 'elegant_gold'
  when 'business_gray' then 'clean_gray'
  when 'calm_red' then 'executive_navy'
  when 'nodexpro_gradient' then 'nodexpro_gradient'
  else color_theme_key
end
where document_style_key in (
  'classic_blue', 'soft_green', 'elegant_purple', 'professional_teal',
  'soft_gold', 'business_gray', 'calm_red', 'nodexpro_gradient'
);

-- Repurpose document_style_key to layout archetype.
update public.income_document_branding_profiles
set document_style_key = 'classic'
where document_style_key is null
   or document_style_key not in ('classic', 'modern', 'elegant', 'minimal');

alter table public.income_document_branding_profiles
  alter column document_style_key set default 'classic';
