/**
 * Retainer schedule row — primary interaction (read-model only).
 */

export type ScheduleRowInteractionKind = 'generated_draft_review';

export type WorkEngineInvoiceRetainerScheduleRowPrimaryAction = {
  command: 'open_recurring_cycle_draft_for_review';
  payload: {
    represented_client_id: string;
    profile_id: string;
    cycle_id: string;
    generated_draft_id: string;
    period_key: string;
    linked_work_item_id: string | null;
  };
};

export function resolveScheduleRowPrimaryAction(params: {
  status_key: string;
  represented_client_id: string;
  profile_id: string;
  cycle_id: string | null;
  generated_draft_id: string | null;
  period_key: string;
  linked_work_item_id: string | null;
}): {
  row_interaction_kind: ScheduleRowInteractionKind | null;
  primary_action: WorkEngineInvoiceRetainerScheduleRowPrimaryAction | null;
} {
  if (
    params.status_key !== 'waiting_review' ||
    !params.cycle_id ||
    !params.generated_draft_id
  ) {
    return { row_interaction_kind: null, primary_action: null };
  }

  return {
    row_interaction_kind: 'generated_draft_review',
    primary_action: {
      command: 'open_recurring_cycle_draft_for_review',
      payload: {
        represented_client_id: params.represented_client_id,
        profile_id: params.profile_id,
        cycle_id: params.cycle_id,
        generated_draft_id: params.generated_draft_id,
        period_key: params.period_key,
        linked_work_item_id: params.linked_work_item_id,
      },
    },
  };
}
