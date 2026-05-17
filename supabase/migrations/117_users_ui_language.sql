-- Core: per-user UI language preference (sidebar / session aggregate).
alter table public.users
  add column if not exists ui_language text null;

alter table public.users
  drop constraint if exists users_ui_language_check;

alter table public.users
  add constraint users_ui_language_check check (ui_language is null or ui_language in ('en', 'he'));
