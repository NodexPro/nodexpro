/**
 * Retainer schedule row amount from Income generated draft totals (read-model only).
 */

export type ScheduleDraftAmount = {
  amount_display: string;
  grand_total_reference: number;
};

export function scheduleAmountFromDraftTotalsPreview(
  previewJson: unknown,
): ScheduleDraftAmount | null {
  if (!previewJson || typeof previewJson !== 'object') return null;
  const preview = previewJson as Record<string, unknown>;
  const display =
    typeof preview.grand_total_display === 'string' ? preview.grand_total_display.trim() : '';
  if (!display) return null;
  const ref = preview.grand_total_reference;
  if (typeof ref === 'number' && Number.isFinite(ref)) {
    return { amount_display: display, grand_total_reference: ref };
  }
  const parsed = Number(String(display).replace(/[^\d.-]/g, ''));
  return {
    amount_display: display,
    grand_total_reference: Number.isFinite(parsed) ? parsed : 0,
  };
}
