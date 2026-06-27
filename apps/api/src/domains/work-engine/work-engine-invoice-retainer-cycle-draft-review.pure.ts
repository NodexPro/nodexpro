/**
 * Recurring cycle draft review — validation helpers (pure).
 */

export type CycleDraftReviewValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateCycleDraftReviewRefs(params: {
  profile_id: string;
  cycle_profile_id: string;
  cycle_id: string;
  requested_cycle_id: string;
  cycle_generated_draft_id: string | null;
  requested_draft_id: string;
  draft_organization_id: string;
  expected_organization_id: string;
  draft_represented_client_id: string | null;
  expected_represented_client_id: string;
  period_key?: string | null;
  linked_work_item_id?: string | null;
  work_item_period_key?: string | null;
  work_item_source_entity_id?: string | null;
}): CycleDraftReviewValidationResult {
  if (params.profile_id !== params.cycle_profile_id) {
    return { ok: false, reason: 'cycle_profile_mismatch' };
  }
  if (params.cycle_id !== params.requested_cycle_id) {
    return { ok: false, reason: 'cycle_id_mismatch' };
  }
  if (!params.cycle_generated_draft_id || params.cycle_generated_draft_id !== params.requested_draft_id) {
    return { ok: false, reason: 'cycle_draft_mismatch' };
  }
  if (params.draft_organization_id !== params.expected_organization_id) {
    return { ok: false, reason: 'draft_org_mismatch' };
  }
  if (params.draft_represented_client_id !== params.expected_represented_client_id) {
    return { ok: false, reason: 'draft_client_mismatch' };
  }
  if (params.linked_work_item_id) {
    if (!params.period_key) {
      return { ok: false, reason: 'period_key_required_for_work_item' };
    }
    if (params.work_item_period_key !== params.period_key) {
      return { ok: false, reason: 'work_item_period_mismatch' };
    }
    if (params.work_item_source_entity_id !== params.profile_id) {
      return { ok: false, reason: 'work_item_profile_mismatch' };
    }
  }
  return { ok: true };
}
