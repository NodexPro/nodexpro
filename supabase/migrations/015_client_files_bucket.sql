-- Create private bucket for client file attachments (Phase 3 secure file access).
-- Bucket is private; access only via backend-signed URLs after authorization.
-- Run this migration; if bucket already exists, the insert may fail (safe to ignore).
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;
