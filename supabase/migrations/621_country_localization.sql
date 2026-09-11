-- Country-owned localization (default_locale + supported_locales).
-- Tax Brain reserved migration range: 600–699.
-- Does not seed Fact Dictionary, laws, or legal values.
-- Canonical fact identity remains locale-neutral.

alter table public.countries
  add column if not exists default_locale text,
  add column if not exists supported_locales text[] not null default '{}'::text[];

comment on column public.countries.default_locale is
  'BCP-47-like locale (xx or xx-yy). Human presentation default for this country. Not part of canonical fact identity.';

comment on column public.countries.supported_locales is
  'Locales this country may present. default_locale must be included when set. Canada may list en and fr.';

alter table public.countries drop constraint if exists countries_default_locale_format;
alter table public.countries
  add constraint countries_default_locale_format
  check (
    default_locale is null
    or (
      default_locale = lower(default_locale)
      and default_locale ~ '^[a-z]{2}(-[a-z]{2})?$'
      and default_locale = any (supported_locales)
    )
  );

update public.countries
  set default_locale = 'he', supported_locales = array['he']::text[]
  where code = 'IL' and default_locale is null;

update public.countries
  set default_locale = 'en', supported_locales = array['en']::text[]
  where code = 'US' and default_locale is null;

update public.countries
  set default_locale = 'en', supported_locales = array['en', 'fr']::text[]
  where code = 'CA' and default_locale is null;

update public.countries
  set default_locale = 'lv', supported_locales = array['lv']::text[]
  where code = 'LV' and default_locale is null;
