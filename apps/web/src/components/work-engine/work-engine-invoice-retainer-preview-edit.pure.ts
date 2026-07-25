import type { WorkEngineRecurringCycleDraftReviewEditAction } from '../../income/income-workspace-types';

export type CycleDraftPreviewEditButtonModel = {
  render: boolean;
  disabled: boolean;
  label: string;
  disabled_reason: string | null;
};

/** Render-only mapping from backend edit_action — no frontend eligibility rules. */
export function resolveCycleDraftPreviewEditButton(params: {
  edit_action: WorkEngineRecurringCycleDraftReviewEditAction | null | undefined;
  has_on_edit_handler: boolean;
}): CycleDraftPreviewEditButtonModel {
  const action = params.edit_action;
  if (!action?.visible || !params.has_on_edit_handler) {
    return {
      render: false,
      disabled: true,
      label: action?.label?.trim() || 'עריכה',
      disabled_reason: action?.disabled_reason ?? null,
    };
  }

  const disabledReason = action.disabled_reason?.trim() || null;
  const enabled = action.enabled !== false && disabledReason == null;

  return {
    render: true,
    disabled: !enabled,
    label: action.label?.trim() || 'עריכה',
    disabled_reason: disabledReason,
  };
}
