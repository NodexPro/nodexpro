/**
 * Platform delivery ledger — module-agnostic types.
 * Callers supply source identity and snapshots; Delivery never interprets business documents.
 */

export const DELIVERY_CHANNELS = ['email', 'docflow'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_ATTEMPT_RESULTS = ['pending', 'sent', 'failed'] as const;
export type DeliveryAttemptResult = (typeof DELIVERY_ATTEMPT_RESULTS)[number];

export type DeliveryAttachmentRef = {
  asset_id?: string | null;
  storage_ref?: string | null;
  filename?: string | null;
  content_type?: string | null;
};

export type BeginDeliveryAttemptInput = {
  organizationId: string;
  representedClientId: string;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  channel: DeliveryChannel;
  recipientEmail?: string | null;
  senderSnapshotJson: Record<string, unknown>;
  messageSnapshotJson: Record<string, unknown>;
  attachmentRefsJson?: DeliveryAttachmentRef[];
  idempotencyKey: string;
  sentByUserId?: string | null;
};

export type FinalizeDeliveryAttemptInput = {
  attemptId: string;
  organizationId: string;
  result: 'sent' | 'failed';
  failureReason?: string | null;
  providerMessageId?: string | null;
  docflowThreadId?: string | null;
  docflowMessageId?: string | null;
};

export type ListDeliveryAttemptsFilter = {
  organizationId: string;
  representedClientId?: string;
  sourceModule?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  channel?: DeliveryChannel;
  limit?: number;
};

export type DeliveryAttemptRecord = {
  id: string;
  organizationId: string;
  representedClientId: string;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  channel: DeliveryChannel;
  recipientEmail: string | null;
  result: DeliveryAttemptResult;
  failureReason: string | null;
  senderSnapshotJson: Record<string, unknown>;
  messageSnapshotJson: Record<string, unknown>;
  attachmentRefsJson: DeliveryAttachmentRef[];
  providerMessageId: string | null;
  docflowThreadId: string | null;
  docflowMessageId: string | null;
  idempotencyKey: string;
  sentByUserId: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};
