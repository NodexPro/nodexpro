-- Platform Owner currency/language registries + user account security / localization preferences.
-- Additive and backward compatible. Historical financial rows are not rewritten.

-- User display preferences (NOT accounting base currency, NOT legal jurisdiction).
alter table public.users
  add column if not exists timezone text null,
  add column if not exists date_format text null,
  add column if not exists display_currency_code text null;

alter table public.users
  drop constraint if exists users_ui_language_check;
alter table public.users
  add constraint users_ui_language_check
  check (ui_language is null or ui_language ~ '^[a-z]{2}(-[A-Z]{2})?$');

alter table public.users
  drop constraint if exists users_date_format_check;
alter table public.users
  add constraint users_date_format_check
  check (date_format is null or date_format in ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'));

alter table public.users
  drop constraint if exists users_display_currency_code_check;
alter table public.users
  add constraint users_display_currency_code_check
  check (display_currency_code is null or display_currency_code ~ '^[A-Z]{3}$');

comment on column public.users.timezone is
  'User interface IANA timezone. Does not rewrite stored timestamps.';
comment on column public.users.date_format is
  'User interface date display format. Does not change legal or accounting source dates.';
comment on column public.users.display_currency_code is
  'User/org display default currency preference. NOT Accounting Base base_currency.';

-- Additional login email (max one verified secondary per canonical user).
create table if not exists public.user_login_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  status text not null,
  verification_token_hash text null,
  verification_expires_at timestamptz null,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_login_emails_status_check
    check (status in ('pending_verification', 'pending_replacement', 'verified', 'revoked')),
  constraint user_login_emails_email_format
    check (email = lower(btrim(email)) and position('@' in email) > 1)
);

create unique index if not exists user_login_emails_email_unique
  on public.user_login_emails (email)
  where status <> 'revoked';

create unique index if not exists user_login_emails_one_verified_per_user
  on public.user_login_emails (user_id)
  where status = 'verified';

create unique index if not exists user_login_emails_one_pending_per_user
  on public.user_login_emails (user_id)
  where status in ('pending_verification', 'pending_replacement');

create index if not exists user_login_emails_user_id_idx
  on public.user_login_emails (user_id);

alter table public.user_login_emails enable row level security;

-- Platform currency registry (ISO 4217). Never delete historical codes.
create table if not exists public.platform_currencies (
  code text primary key,
  name_en text not null,
  symbol text not null,
  status text not null default 'draft',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid null references public.users(id) on delete set null,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  constraint platform_currencies_code_iso
    check (code ~ '^[A-Z]{3}$'),
  constraint platform_currencies_status_check
    check (status in ('draft', 'published', 'inactive'))
);

alter table public.platform_currencies enable row level security;

insert into public.platform_currencies (code, name_en, symbol, status, version)
values
  ('ILS', 'Israeli New Shekel', '₪', 'published', 1),
  ('USD', 'United States Dollar', '$', 'published', 1),
  ('EUR', 'Euro', '€', 'published', 1)
on conflict (code) do nothing;

-- Platform language + translation catalog.
create table if not exists public.platform_languages (
  locale_code text primary key,
  name text not null,
  direction text not null,
  status text not null default 'draft',
  version integer not null default 1,
  published_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid null references public.users(id) on delete set null,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  constraint platform_languages_locale_check
    check (locale_code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint platform_languages_direction_check
    check (direction in ('ltr', 'rtl')),
  constraint platform_languages_status_check
    check (status in ('draft', 'review', 'published'))
);

alter table public.platform_languages enable row level security;

insert into public.platform_languages (locale_code, name, direction, status, version, published_at)
values
  ('en', 'English', 'ltr', 'published', 1, now()),
  ('he', 'עברית', 'rtl', 'published', 1, now())
on conflict (locale_code) do nothing;

create table if not exists public.platform_translation_keys (
  key text primary key,
  source_en text not null,
  module_group text not null,
  created_at timestamptz not null default now()
);

alter table public.platform_translation_keys enable row level security;

create table if not exists public.platform_translation_values (
  id uuid primary key default gen_random_uuid(),
  locale_code text not null references public.platform_languages(locale_code) on delete cascade,
  key text not null references public.platform_translation_keys(key) on delete cascade,
  value text not null default '',
  status text not null default 'draft',
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null references public.users(id) on delete set null,
  constraint platform_translation_values_status_check
    check (status in ('draft', 'review', 'published')),
  unique (locale_code, key)
);

create index if not exists platform_translation_values_locale_idx
  on public.platform_translation_values (locale_code);

alter table public.platform_translation_values enable row level security;

create table if not exists public.platform_language_versions (
  id uuid primary key default gen_random_uuid(),
  locale_code text not null references public.platform_languages(locale_code) on delete cascade,
  version integer not null,
  status text not null,
  completeness_ratio numeric(6, 4) not null default 0,
  published_at timestamptz null,
  published_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (locale_code, version)
);

alter table public.platform_language_versions enable row level security;
