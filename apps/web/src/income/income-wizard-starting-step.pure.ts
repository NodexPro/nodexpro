/** Resolve which Income wizard step to show from backend workspace truth. */

export function resolveIncomeWizardStartingStepKey(input: {
  steps: ReadonlyArray<{ key: string }>;
  wizard_starting_step_key?: string | null;
  active_wizard_draft_id?: string | null;
  has_document_details_step?: boolean;
}): string | null {
  const requested = input.wizard_starting_step_key?.trim() || null;
  if (requested && input.steps.some((step) => step.key === requested)) {
    return requested;
  }
  if (input.active_wizard_draft_id && input.has_document_details_step) {
    if (input.steps.some((step) => step.key === 'document_details')) {
      return 'document_details';
    }
  }
  return null;
}
