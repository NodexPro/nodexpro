-- Phase 11 safe-send statuses for DocFlow communication drafts
-- Keep legacy values for backward compatibility.

alter table public.client_message_deliveries
  drop constraint if exists client_message_deliveries_delivery_status_check;

alter table public.client_message_deliveries
  add constraint client_message_deliveries_delivery_status_check
  check (
    delivery_status in (
      'pending',
      'sent',
      'failed',
      'read',
      'pending_client_access',
      'sent_internal'
    )
  );

