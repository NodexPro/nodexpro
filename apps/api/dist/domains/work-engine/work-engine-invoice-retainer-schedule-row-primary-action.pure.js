/**
 * Retainer schedule row — primary interaction (read-model only).
 */
export function resolveScheduleRowPrimaryAction(params) {
    const cycleDate = params.scheduled_document_date;
    if (params.status_key === 'waiting_review' &&
        params.cycle_id &&
        params.generated_draft_id) {
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
    if (!params.generated_draft_id &&
        params.scheduled_document_date === projectedNextDocumentDate) {
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
    if (!params.generated_draft_id &&
        params.status_key === 'scheduled' &&
        params.scheduled_document_date > projectedNextDocumentDate) {
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
