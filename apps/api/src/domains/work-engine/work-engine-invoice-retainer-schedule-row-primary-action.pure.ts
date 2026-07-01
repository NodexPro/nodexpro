/**
 * Retainer schedule row — primary interaction (read-model only).
 */

export type ScheduleRowInteractionKind =
  | 'generated_draft_review'
  | 'next_document_projection'
  | 'future_projection';

export type RecurringCycleOverrideScope = 'single_cycle' | 'this_and_future';

export type WorkEngineInvoiceRetainerScheduleRowPreviewAction = {
  visible: boolean;
  label: string;
  disabled_reason: string | null;
};

export type WorkEngineInvoiceRetainerScheduleOpenCycleDraftPrimaryAction = {
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

export type WorkEngineInvoiceRetainerScheduleOpenNextDocumentTabPrimaryAction = {
  command: 'open_next_document_tab';
  payload: {
    target_tab: 'next_document';
    scheduled_document_date: string;
    period_key: string;
  };
};

export type WorkEngineInvoiceRetainerScheduleOpenCycleOverridePrimaryAction = {
  command: 'open_recurring_cycle_override_for_edit';
  payload: {
    represented_client_id: string;
    profile_id: string;
    cycle_date: string;
    period_key: string;
    cycle_index: number;
  };
};

export type WorkEngineInvoiceRetainerScheduleRowPrimaryAction =
  | WorkEngineInvoiceRetainerScheduleOpenCycleDraftPrimaryAction
  | WorkEngineInvoiceRetainerScheduleOpenNextDocumentTabPrimaryAction
  | WorkEngineInvoiceRetainerScheduleOpenCycleOverridePrimaryAction;

export function resolveScheduleRowPrimaryAction(params: {
  status_key: string;
  scheduled_document_date: string;
  projected_next_document_date: string | null;
  represented_client_id: string;
  profile_id: string;
  cycle_id: string | null;
  generated_draft_id: string | null;
  period_key: string;
  linked_work_item_id: string | null;
  cycle_index: number;
  override_exists: boolean;
  override_scope: RecurringCycleOverrideScope | null;
}): {
  row_interaction_kind: ScheduleRowInteractionKind | null;
  primary_action: WorkEngineInvoiceRetainerScheduleRowPrimaryAction | null;
  preview_action: WorkEngineInvoiceRetainerScheduleRowPreviewAction | null;
  override_exists: boolean;
  override_scope: RecurringCycleOverrideScope | null;
  cycle_date: string;
} {
  const cycleDate = params.scheduled_document_date;
  if (
    params.status_key === 'waiting_review' &&
    params.cycle_id &&
    params.generated_draft_id
  ) {
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
      preview_action: null,
      override_exists: params.override_exists,
      override_scope: params.override_scope,
      cycle_date: cycleDate,
    };
  }

  const projectedNextDocumentDate = params.projected_next_document_date;
  if (!projectedNextDocumentDate) {
    return {
      row_interaction_kind: null,
      primary_action: null,
      preview_action: null,
      override_exists: params.override_exists,
      override_scope: params.override_scope,
      cycle_date: cycleDate,
    };
  }

  if (
    !params.generated_draft_id &&
    params.scheduled_document_date === projectedNextDocumentDate
  ) {
    return {
      row_interaction_kind: 'next_document_projection',
      primary_action: {
        command: 'open_next_document_tab',
        payload: {
          target_tab: 'next_document',
          scheduled_document_date: params.scheduled_document_date,
          period_key: params.period_key,
        },
      },
      preview_action: null,
      override_exists: params.override_exists,
      override_scope: params.override_scope,
      cycle_date: cycleDate,
    };
  }

  if (
    !params.generated_draft_id &&
    params.status_key === 'scheduled' &&
    params.scheduled_document_date > projectedNextDocumentDate
  ) {
    return {
      row_interaction_kind: 'future_projection',
      primary_action: {
        command: 'open_recurring_cycle_override_for_edit',
        payload: {
          represented_client_id: params.represented_client_id,
          profile_id: params.profile_id,
          cycle_date: params.scheduled_document_date,
          period_key: params.period_key,
          cycle_index: params.cycle_index,
        },
      },
      preview_action: {
        visible: true,
        label: 'תצוגה מקדימה',
        disabled_reason: null,
      },
      override_exists: params.override_exists,
      override_scope: params.override_scope,
      cycle_date: cycleDate,
    };
  }

  return {
    row_interaction_kind: null,
    primary_action: null,
    preview_action: null,
    override_exists: params.override_exists,
    override_scope: params.override_scope,
    cycle_date: cycleDate,
  };
}
