-- INC-8.5 — Work Engine wizard document details: delivery snapshot + document settings.

alter table public.income_document_drafts
  add column if not exists delivery_contact_json jsonb null,
  add column if not exists document_settings_json jsonb null;
