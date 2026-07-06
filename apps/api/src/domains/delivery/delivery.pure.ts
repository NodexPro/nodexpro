import { badRequest } from '../../shared/errors.js';
import {
  DELIVERY_CHANNELS,
  type BeginDeliveryAttemptInput,
  type DeliveryAttemptRecord,
  type DeliveryAttachmentRef,
  type DeliveryChannel,
  type FinalizeDeliveryAttemptInput,
  type ListDeliveryAttemptsFilter,
} from './delivery.types.js';

export function isDeliveryChannel(value: string): value is DeliveryChannel {
  return (DELIVERY_CHANNELS as readonly string[]).includes(value);
}

export function validateBeginDeliveryAttemptInput(input: BeginDeliveryAttemptInput): void {
  if (!String(input.organizationId ?? '').trim()) {
    throw badRequest('organization_id is required');
  }
  if (!String(input.representedClientId ?? '').trim()) {
    throw badRequest('represented_client_id is required');
  }
  if (!String(input.sourceModule ?? '').trim()) {
    throw badRequest('source_module is required');
  }
  if (!String(input.sourceEntityType ?? '').trim()) {
    throw badRequest('source_entity_type is required');
  }
  if (!String(input.sourceEntityId ?? '').trim()) {
    throw badRequest('source_entity_id is required');
  }
  if (!isDeliveryChannel(input.channel)) {
    throw badRequest('channel is invalid');
  }
  if (!String(input.idempotencyKey ?? '').trim()) {
    throw badRequest('idempotency_key is required');
  }
  if (!input.senderSnapshotJson || typeof input.senderSnapshotJson !== 'object') {
    throw badRequest('sender_snapshot_json is required');
  }
  if (!input.messageSnapshotJson || typeof input.messageSnapshotJson !== 'object') {
    throw badRequest('message_snapshot_json is required');
  }
}

export function validateFinalizeDeliveryAttemptInput(input: FinalizeDeliveryAttemptInput): void {
  if (!String(input.attemptId ?? '').trim()) {
    throw badRequest('attempt_id is required');
  }
  if (!String(input.organizationId ?? '').trim()) {
    throw badRequest('organization_id is required');
  }
  if (input.result !== 'sent' && input.result !== 'failed') {
    throw badRequest('result must be sent or failed');
  }
}

export function normalizeAttachmentRefs(
  value: DeliveryAttachmentRef[] | undefined,
): DeliveryAttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ ...item }));
}

export function listDeliveryAttemptsFilterLimit(filter: ListDeliveryAttemptsFilter): number {
  const raw = filter.limit ?? 100;
  if (!Number.isFinite(raw) || raw < 1) return 100;
  return Math.min(Math.floor(raw), 500);
}

type DeliveryAttemptRow = {
  id: string;
  organization_id: string;
  represented_client_id: string;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  channel: string;
  recipient_email: string | null;
  result: string;
  failure_reason: string | null;
  sender_snapshot_json: Record<string, unknown> | null;
  message_snapshot_json: Record<string, unknown> | null;
  attachment_refs_json: unknown;
  provider_message_id: string | null;
  docflow_thread_id: string | null;
  docflow_message_id: string | null;
  idempotency_key: string;
  sent_by_user_id: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export function mapDeliveryAttemptRow(row: DeliveryAttemptRow): DeliveryAttemptRecord {
  if (!isDeliveryChannel(row.channel)) {
    throw badRequest('delivery attempt channel is invalid');
  }
  const attachmentRefs = Array.isArray(row.attachment_refs_json)
    ? (row.attachment_refs_json as DeliveryAttachmentRef[])
    : [];
  return {
    id: row.id,
    organizationId: row.organization_id,
    representedClientId: row.represented_client_id,
    sourceModule: row.source_module,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    channel: row.channel,
    recipientEmail: row.recipient_email,
    result: row.result as DeliveryAttemptRecord['result'],
    failureReason: row.failure_reason,
    senderSnapshotJson: row.sender_snapshot_json ?? {},
    messageSnapshotJson: row.message_snapshot_json ?? {},
    attachmentRefsJson: attachmentRefs,
    providerMessageId: row.provider_message_id,
    docflowThreadId: row.docflow_thread_id,
    docflowMessageId: row.docflow_message_id,
    idempotencyKey: row.idempotency_key,
    sentByUserId: row.sent_by_user_id,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fields that must never change after insert (enforced in DB trigger and repository). */
export const DELIVERY_ATTEMPT_IMMUTABLE_FIELDS = [
  'organization_id',
  'represented_client_id',
  'source_module',
  'source_entity_type',
  'source_entity_id',
  'channel',
  'recipient_email',
  'sender_snapshot_json',
  'message_snapshot_json',
  'attachment_refs_json',
  'idempotency_key',
  'sent_by_user_id',
  'created_at',
] as const;
