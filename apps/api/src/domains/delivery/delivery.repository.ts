import { supabaseAdmin } from '../../db/client.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { mapDeliveryAttemptRow } from './delivery.pure.js';
import type {
  BeginDeliveryAttemptInput,
  DeliveryAttemptRecord,
  FinalizeDeliveryAttemptInput,
  ListDeliveryAttemptsFilter,
} from './delivery.types.js';
import { listDeliveryAttemptsFilterLimit, normalizeAttachmentRefs } from './delivery.pure.js';

export type DeliveryAttemptRepository = {
  insertAttempt(input: BeginDeliveryAttemptInput): Promise<DeliveryAttemptRecord>;
  findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<DeliveryAttemptRecord | null>;
  findById(organizationId: string, attemptId: string): Promise<DeliveryAttemptRecord | null>;
  finalizeAttempt(input: FinalizeDeliveryAttemptInput): Promise<DeliveryAttemptRecord>;
  listAttempts(filter: ListDeliveryAttemptsFilter): Promise<DeliveryAttemptRecord[]>;
};

function buildInsertRow(input: BeginDeliveryAttemptInput) {
  return {
    organization_id: input.organizationId,
    represented_client_id: input.representedClientId,
    source_module: input.sourceModule.trim(),
    source_entity_type: input.sourceEntityType.trim(),
    source_entity_id: input.sourceEntityId,
    channel: input.channel,
    recipient_email: input.recipientEmail?.trim() || null,
    result: 'pending',
    sender_snapshot_json: input.senderSnapshotJson,
    message_snapshot_json: input.messageSnapshotJson,
    attachment_refs_json: normalizeAttachmentRefs(input.attachmentRefsJson),
    idempotency_key: input.idempotencyKey.trim(),
    sent_by_user_id: input.sentByUserId ?? null,
  };
}

export class SupabaseDeliveryAttemptRepository implements DeliveryAttemptRepository {
  async insertAttempt(input: BeginDeliveryAttemptInput): Promise<DeliveryAttemptRecord> {
    const { data, error } = await supabaseAdmin
      .from('delivery_attempts')
      .insert(buildInsertRow(input))
      .select('*')
      .single();
    if (error?.code === '23505') {
      const existing = await this.findByIdempotencyKey(input.organizationId, input.idempotencyKey);
      if (existing) return existing;
    }
    throwIfSupabaseError(error, 'insertDeliveryAttempt', {
      migrationHint: 'Apply migration 145_delivery_attempts_foundation.sql',
    });
    if (!data) throw badRequest('Failed to create delivery attempt');
    return mapDeliveryAttemptRow(data);
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<DeliveryAttemptRecord | null> {
    const { data, error } = await supabaseAdmin
      .from('delivery_attempts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('idempotency_key', idempotencyKey.trim())
      .maybeSingle();
    throwIfSupabaseError(error, 'findDeliveryAttemptByIdempotencyKey');
    return data ? mapDeliveryAttemptRow(data) : null;
  }

  async findById(organizationId: string, attemptId: string): Promise<DeliveryAttemptRecord | null> {
    const { data, error } = await supabaseAdmin
      .from('delivery_attempts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', attemptId)
      .maybeSingle();
    throwIfSupabaseError(error, 'findDeliveryAttemptById');
    return data ? mapDeliveryAttemptRow(data) : null;
  }

  async finalizeAttempt(input: FinalizeDeliveryAttemptInput): Promise<DeliveryAttemptRecord> {
    const sentAt = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('delivery_attempts')
      .update({
        result: input.result,
        failure_reason: input.failureReason?.trim() || null,
        provider_message_id: input.providerMessageId?.trim() || null,
        docflow_thread_id: input.docflowThreadId ?? null,
        docflow_message_id: input.docflowMessageId ?? null,
        sent_at: sentAt,
      })
      .eq('organization_id', input.organizationId)
      .eq('id', input.attemptId)
      .eq('result', 'pending')
      .select('*')
      .maybeSingle();
    throwIfSupabaseError(error, 'finalizeDeliveryAttempt');
    if (!data) {
      const existing = await this.findById(input.organizationId, input.attemptId);
      if (!existing) throw notFound('Delivery attempt not found');
      if (existing.result !== 'pending') return existing;
      throw badRequest('Delivery attempt could not be finalized');
    }
    return mapDeliveryAttemptRow(data);
  }

  async listAttempts(filter: ListDeliveryAttemptsFilter): Promise<DeliveryAttemptRecord[]> {
    const limit = listDeliveryAttemptsFilterLimit(filter);
    let query = supabaseAdmin
      .from('delivery_attempts')
      .select('*')
      .eq('organization_id', filter.organizationId)
      .order('sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (filter.representedClientId) {
      query = query.eq('represented_client_id', filter.representedClientId);
    }
    if (filter.sourceModule) {
      query = query.eq('source_module', filter.sourceModule);
    }
    if (filter.sourceEntityType) {
      query = query.eq('source_entity_type', filter.sourceEntityType);
    }
    if (filter.sourceEntityId) {
      query = query.eq('source_entity_id', filter.sourceEntityId);
    }
    if (filter.channel) {
      query = query.eq('channel', filter.channel);
    }
    const { data, error } = await query;
    throwIfSupabaseError(error, 'listDeliveryAttempts');
    return (data ?? []).map((row) => mapDeliveryAttemptRow(row));
  }
}

export const defaultDeliveryAttemptRepository: DeliveryAttemptRepository =
  new SupabaseDeliveryAttemptRepository();
