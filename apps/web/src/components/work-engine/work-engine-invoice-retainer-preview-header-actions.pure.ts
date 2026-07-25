import type {
  WorkEngineRecurringCycleDraftReviewIssueAction,
  WorkEngineRecurringCycleDraftReviewIssueAndSendAction,
} from '../../income/income-workspace-types';

export type CycleDraftPreviewHeaderIconModel = {
  render: boolean;
  disabled: boolean;
  tooltip: string;
  disabled_reason: string | null;
  icon: 'issue' | 'send';
  test_id: string;
  confirmation_required: boolean;
  confirmation_title: string | null;
  confirmation_message: string | null;
  command_name: string;
};

function resolveHeaderIconModel(params: {
  action:
    | WorkEngineRecurringCycleDraftReviewIssueAction
    | WorkEngineRecurringCycleDraftReviewIssueAndSendAction
    | null
    | undefined;
  has_handler: boolean;
  test_id: string;
}): CycleDraftPreviewHeaderIconModel {
  const action = params.action;
  if (!action?.visible || !params.has_handler) {
    return {
      render: false,
      disabled: true,
      tooltip: action?.tooltip?.trim() || '',
      disabled_reason: action?.disabled_reason ?? null,
      icon: action?.icon ?? 'issue',
      test_id: params.test_id,
      confirmation_required: false,
      confirmation_title: null,
      confirmation_message: null,
      command_name: action?.command_name ?? '',
    };
  }

  const disabledReason = action.disabled_reason?.trim() || null;
  const enabled = action.enabled !== false && disabledReason == null;

  return {
    render: true,
    disabled: !enabled,
    tooltip: (enabled ? action.tooltip : disabledReason ?? action.tooltip)?.trim() || '',
    disabled_reason: disabledReason,
    icon: action.icon,
    test_id: params.test_id,
    confirmation_required: enabled && action.confirmation_required === true,
    confirmation_title: action.confirmation_title?.trim() || null,
    confirmation_message: action.confirmation_message?.trim() || null,
    command_name: action.command_name,
  };
}

/** Render-only mapping from backend issue_action — no frontend eligibility rules. */
export function resolveCycleDraftPreviewIssueIcon(params: {
  issue_action: WorkEngineRecurringCycleDraftReviewIssueAction | null | undefined;
  has_on_issue_handler: boolean;
}): CycleDraftPreviewHeaderIconModel {
  return resolveHeaderIconModel({
    action: params.issue_action,
    has_handler: params.has_on_issue_handler,
    test_id: 'we-cycle-draft-preview-issue',
  });
}

/** Render-only mapping from backend issue_and_send_action — no frontend eligibility rules. */
export function resolveCycleDraftPreviewIssueAndSendIcon(params: {
  issue_and_send_action: WorkEngineRecurringCycleDraftReviewIssueAndSendAction | null | undefined;
  has_on_issue_and_send_handler: boolean;
}): CycleDraftPreviewHeaderIconModel {
  return resolveHeaderIconModel({
    action: params.issue_and_send_action,
    has_handler: params.has_on_issue_and_send_handler,
    test_id: 'we-cycle-draft-preview-issue-send',
  });
}
