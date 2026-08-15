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

export function resolveIncomeWizardStartingStepIndex(
  steps: ReadonlyArray<{ key: string }>,
  workspace: {
    wizard_starting_step_key?: string | null;
    active_wizard_draft_id?: string | null;
    document_details_step?: unknown;
  } | null,
): number {
  const key = resolveIncomeWizardStartingStepKey({
    steps,
    wizard_starting_step_key: workspace?.wizard_starting_step_key,
    active_wizard_draft_id: workspace?.active_wizard_draft_id,
    has_document_details_step: Boolean(workspace?.document_details_step),
  });
  if (!key) return 0;
  const idx = steps.findIndex((step) => step.key === key);
  return idx >= 0 ? idx : 0;
}
