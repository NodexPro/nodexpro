-- Client Operations ToDo — optional progress note (שלב טיפול) + optional completion reason (סיבת סגירה).
-- Additive + backward compatible. DO NOT RUN until release approval.
-- Release order: MIGRATION -> API -> WEB (the API selects the new columns).
--
-- progress_note      free text describing the current handling stage. Editable / clearable at any time while the
--                    ToDo is active. It is NOT a status: no enum, no workflow transition, never affects
--                    completion or priority.
-- completion_reason  optional free text recorded atomically by the existing completion command. It describes the
--                    CURRENT completion only: reopening clears it (same UPDATE), and the check below makes it
--                    impossible to store a reason on an active ToDo, so an old reason can never be shown for a
--                    later completion.
--
-- Existing rows: both columns are NULL -> they satisfy every check below, so no backfill is needed.

alter table public.client_operations_todos
  add column if not exists progress_note text null,
  add column if not exists completion_reason text null;

comment on column public.client_operations_todos.progress_note is
  'Optional free-text handling stage (שלב טיפול). Not a status; never drives completion or priority.';
comment on column public.client_operations_todos.completion_reason is
  'Optional free-text closure reason (סיבת סגירה) of the CURRENT completion. Cleared on reopen; NULL while active.';

-- Trimmed, non-empty, single bounded text (mirrors the API normalization; blank is stored as NULL).
alter table public.client_operations_todos
  drop constraint if exists client_operations_todos_progress_note_valid;
alter table public.client_operations_todos
  add constraint client_operations_todos_progress_note_valid
  check (
    progress_note is null
    or (
      progress_note = btrim(progress_note)
      and length(btrim(progress_note)) > 0
      and char_length(progress_note) <= 300
    )
  );

alter table public.client_operations_todos
  drop constraint if exists client_operations_todos_completion_reason_valid;
alter table public.client_operations_todos
  add constraint client_operations_todos_completion_reason_valid
  check (
    completion_reason is null
    or (
      completion_reason = btrim(completion_reason)
      and length(btrim(completion_reason)) > 0
      and char_length(completion_reason) <= 300
    )
  );

-- A closure reason exists only for a completed ToDo.
alter table public.client_operations_todos
  drop constraint if exists client_operations_todos_completion_reason_requires_completed;
alter table public.client_operations_todos
  add constraint client_operations_todos_completion_reason_requires_completed
  check (completion_reason is null or completed_at is not null);
