/**
 * Backend truth for טיוטות listability.
 * generated_for_review: draft with user_saved_at null (e.g. scheduler cycle workspace)
 * saved_draft: status='draft' AND user_saved_at IS NOT NULL
 */

export function isUserSavedDraftForList(params: {
  status: string | null | undefined;
  user_saved_at: string | null | undefined;
}): boolean {
  return (
    params.status === 'draft' &&
    params.user_saved_at != null &&
    String(params.user_saved_at).trim() !== ''
  );
}

export function clientSuppliedUserSavedAt(body: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(body, 'user_saved_at');
}
