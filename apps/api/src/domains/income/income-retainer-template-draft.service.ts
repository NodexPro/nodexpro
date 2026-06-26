/**
 * Detect income drafts used as Work Engine retainer document templates.
 */

import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';

export function hasRetainerTemplateMarker(documentSettingsJson: unknown): boolean {
  if (!documentSettingsJson || typeof documentSettingsJson !== 'object' || Array.isArray(documentSettingsJson)) {
    return false;
  }
  return (documentSettingsJson as Record<string, unknown>).retainer_template === true;
}

export async function isIncomeRetainerTemplateDraft(params: {
  orgId: string;
  draftId: string;
  documentSettingsJson?: unknown;
}): Promise<boolean> {
  if (hasRetainerTemplateMarker(params.documentSettingsJson)) return true;

  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_profiles')
    .select('id')
    .eq('organization_id', params.orgId)
    .eq('source_draft_template_id', params.draftId)
    .limit(1);
  throwIfSupabaseError(error, 'isIncomeRetainerTemplateDraft');
  return (data ?? []).length > 0;
}
