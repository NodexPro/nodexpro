/**
 * Retainer schedule row — primary interaction (read-model only).
 */
export function resolveScheduleRowPrimaryAction(params) {
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
        };
    }
    const projectedNextDocumentDate = params.projected_next_document_date;
    if (!projectedNextDocumentDate) {
        return { row_interaction_kind: null, primary_action: null };
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
        };
    }
    if (!params.generated_draft_id &&
        params.status_key === 'scheduled' &&
        params.scheduled_document_date > projectedNextDocumentDate) {
        return {
            row_interaction_kind: 'future_projection',
            primary_action: null,
        };
    }
    return { row_interaction_kind: null, primary_action: null };
}
