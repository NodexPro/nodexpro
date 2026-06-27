/**
 * Retainer document delivery truth seam (DocFlow integration pending).
 *
 * TEMPORARY_DOCFLOW_DELIVERY_PENDING: Income recurring drafts do not yet have a
 * stable cross-module delivery record keyed by draft_id. Until DocFlow exposes
 * that link, this returns false and send-follow-up eligibility uses approval age only.
 */

import { supabaseAdmin } from '../../db/client.js';

export async function hasRecurringDocumentDeliveryRecord(params: {
  organizationId: string;
  representedClientId: string;
  generatedDraftId: string | null;
  generatedDocumentId: string | null;
}): Promise<boolean> {
  if (params.generatedDocumentId) {
    const { data, error } = await supabaseAdmin
      .from('income_documents')
      .select('id, document_status')
      .eq('id', params.generatedDocumentId)
      .eq('organization_id', params.organizationId)
      .maybeSingle();
    if (error) throw error;
    // Issued document exists but does not prove DocFlow/email delivery.
    void data;
  }

  if (!params.generatedDraftId) return false;

  // Future: join DocFlow delivery / communication tables by income draft reference.
  void params.representedClientId;
  return false;
}
