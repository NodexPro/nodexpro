-- DocFlow: allow client-initiated threads for portal "start first conversation" command.
-- Contract: truth in backend; UI cannot fake threads.

do $$
begin
  -- thread_type check: extend with 'client_initiated'
  begin
    alter table public.client_message_threads
      drop constraint if exists client_message_threads_thread_type_check;
  exception when undefined_object then
    -- ignore
  end;

  alter table public.client_message_threads
    add constraint client_message_threads_thread_type_check
    check (thread_type in ('document_request', 'question', 'reminder', 'task_followup', 'client_initiated'));

  -- created_by_type check: extend with 'client'
  begin
    alter table public.client_message_threads
      drop constraint if exists client_message_threads_created_by_type_check;
  exception when undefined_object then
    -- ignore
  end;

  alter table public.client_message_threads
    add constraint client_message_threads_created_by_type_check
    check (created_by_type in ('office', 'system', 'client'));
end $$;

