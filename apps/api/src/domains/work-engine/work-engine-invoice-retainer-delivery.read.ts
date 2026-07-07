/**
 * Retainer document delivery truth — read-only Delivery ledger queries.
 *
 * Work Engine reads delivery_attempts to decide send-follow-up eligibility.
 * Delivery owns the ledger; Income emits facts; Work Engine owns work_items.
 */

import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';

const INCOME_DELIVERY_SOURCE_MODULE = 'income' as const;
const INCOME_DELIVERY_ENTITY_TYPE = 'income_document' as const;
const SENT_DELIVERY_CHANNELS = ['email', 'docflow'] as const;

export async function hasSentIncomeDocumentDelivery(params: {
  organizationId: string;
  incomeDocumentId: string;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('delivery_attempts')
    .select('id')
    .eq('organization_id', params.organizationId)
    .eq('source_module', INCOME_DELIVERY_SOURCE_MODULE)
    .eq('source_entity_type', INCOME_DELIVERY_ENTITY_TYPE)
    .eq('source_entity_id', params.incomeDocumentId)
    .in('channel', [...SENT_DELIVERY_CHANNELS])
    .eq('result', 'sent')
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function resolveIssuedIncomeDocumentIdForCycle(params: {
  organizationId: string;
  generatedDraftId: string | null;
  generatedDocumentId: string | null;
}): Promise<string | null> {
  if (params.generatedDocumentId) {
    return params.generatedDocumentId;
  }
  if (!params.generatedDraftId) {
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id')
    .eq('organization_id', params.organizationId)
    .eq('source_draft_id', params.generatedDraftId)
    .eq('document_status', 'issued')
    .maybeSingle();
  throwIfSupabaseError(error, 'resolveIssuedIncomeDocumentForCycle');
  return (data as { id: string } | null)?.id ?? null;
}

export async function hasRecurringDocumentDeliveryRecord(params: {
  organizationId: string;
  representedClientId: string;
  generatedDraftId: string | null;
  generatedDocumentId: string | null;
}): Promise<boolean> {
  void params.representedClientId;
  const incomeDocumentId = await resolveIssuedIncomeDocumentIdForCycle({
    organizationId: params.organizationId,
    generatedDraftId: params.generatedDraftId,
    generatedDocumentId: params.generatedDocumentId,
  });
  if (!incomeDocumentId) {
    return false;
  }
  return hasSentIncomeDocumentDelivery({
    organizationId: params.organizationId,
    incomeDocumentId,
  });
}
