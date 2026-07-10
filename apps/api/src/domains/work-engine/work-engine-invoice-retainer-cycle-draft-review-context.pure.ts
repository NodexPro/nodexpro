/**
 * Retainer cycle draft review — income issue command context (command payload only).
 */

export type RecurringCycleReviewCommandContext = {
  represented_client_id: string;
  profile_id: string;
  cycle_id: string;
  generated_draft_id: string;
  period_key?: string | null;
  linked_work_item_id?: string | null;
};

export function parseRecurringCycleReviewCommandContext(
  body: Record<string, unknown>,
): RecurringCycleReviewCommandContext | null {
  const raw = body.recurring_cycle_review;
  if (!raw || typeof raw !== 'object') return null;
  const ctx = raw as Record<string, unknown>;
  const represented_client_id = String(ctx.represented_client_id ?? '').trim();
  const profile_id = String(ctx.profile_id ?? '').trim();
  const cycle_id = String(ctx.cycle_id ?? '').trim();
  const generated_draft_id = String(ctx.generated_draft_id ?? '').trim();
  if (!represented_client_id || !profile_id || !cycle_id || !generated_draft_id) return null;
  return {
    represented_client_id,
    profile_id,
    cycle_id,
    generated_draft_id,
    period_key: ctx.period_key != null ? String(ctx.period_key) : null,
    linked_work_item_id:
      ctx.linked_work_item_id != null ? String(ctx.linked_work_item_id) : null,
  };
}
