/**
 * Retainer cycle draft review — income issue command context (command payload only).
 */
export function parseRecurringCycleReviewCommandContext(body) {
    const raw = body.recurring_cycle_review;
    if (!raw || typeof raw !== 'object')
        return null;
    const ctx = raw;
    const represented_client_id = String(ctx.represented_client_id ?? '').trim();
    const profile_id = String(ctx.profile_id ?? '').trim();
    const cycle_id = String(ctx.cycle_id ?? '').trim();
    const generated_draft_id = String(ctx.generated_draft_id ?? '').trim();
    if (!represented_client_id || !profile_id || !cycle_id || !generated_draft_id)
        return null;
    return {
        represented_client_id,
        profile_id,
        cycle_id,
        generated_draft_id,
        period_key: ctx.period_key != null ? String(ctx.period_key) : null,
        linked_work_item_id: ctx.linked_work_item_id != null ? String(ctx.linked_work_item_id) : null,
    };
}
