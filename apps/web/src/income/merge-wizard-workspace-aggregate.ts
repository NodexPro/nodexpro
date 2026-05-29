import type { IncomeWorkspaceAggregate } from './income-workspace-types';

/** Merge lightweight wizard_patch command responses into existing wizard workspace truth. */
export function mergeIncomeWorkspaceWizardPatch(
  previous: IncomeWorkspaceAggregate | null,
  patch: IncomeWorkspaceAggregate,
): IncomeWorkspaceAggregate {
  if (!previous) return patch;

  const preserveRecipient =
    patch.recipient_search.selected == null && previous.recipient_search.selected != null;

  return {
    ...previous,
    issuer_context: patch.issuer_context,
    available_document_types:
      patch.available_document_types.length > 0
        ? patch.available_document_types
        : previous.available_document_types,
    document_creation_schema:
      patch.document_creation_schema.steps.length > 0
        ? patch.document_creation_schema
        : previous.document_creation_schema,
    warnings: patch.warnings.length > 0 ? patch.warnings : previous.warnings,
    allowed_actions: patch.allowed_actions,
    document_details_step: patch.document_details_step,
    active_wizard_draft_id: patch.active_wizard_draft_id,
    document_branding_profile:
      patch.document_branding_profile ?? previous.document_branding_profile ?? null,
    document_branding_settings_entrypoint:
      patch.document_branding_settings_entrypoint ??
      previous.document_branding_settings_entrypoint ??
      null,
    recipient_search: preserveRecipient ? previous.recipient_search : patch.recipient_search,
  };
}
