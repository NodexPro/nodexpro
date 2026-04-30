-- Phase 4: Private bucket for document file uploads.
insert into storage.buckets (id, name, public)
values ('document-files', 'document-files', false)
on conflict (id) do nothing;
