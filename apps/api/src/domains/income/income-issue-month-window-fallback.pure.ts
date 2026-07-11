/**
 * Income issue month window — IL fallback values (pure, no IO).
 * TEMPORARY_COUNTRY_PACK_PENDING: fallback until owner seeds `il_income_issue_month_window`
 * in Country Pack legal values. Single home of the fallback window; do not duplicate.
 */

export type IncomeIssueMonthWindow = {
  months_back: number;
  months_ahead: number;
};

export type IncomeIssueMonthWindowResolution = IncomeIssueMonthWindow & {
  source: 'country_pack' | 'fallback_il';
  legal_value_key: string | null;
};

export const IL_ISSUE_MONTH_WINDOW_FALLBACK: IncomeIssueMonthWindow = {
  months_back: 1,
  months_ahead: 3,
};

export function issueMonthWindowFallbackResolution(): IncomeIssueMonthWindowResolution {
  return {
    ...IL_ISSUE_MONTH_WINDOW_FALLBACK,
    source: 'fallback_il',
    legal_value_key: null,
  };
}

/** Accepts `{ months_back, months_ahead }` payloads from Country Pack legal values. */
export function parseIssueMonthWindowFromLegalPayload(
  payload: unknown,
): IncomeIssueMonthWindow | null {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const o = payload as Record<string, unknown>;
  const back = Number(o.months_back);
  const ahead = Number(o.months_ahead);
  if (!Number.isInteger(back) || !Number.isInteger(ahead)) return null;
  if (back < 0 || ahead < 0 || back > 24 || ahead > 24) return null;
  return { months_back: back, months_ahead: ahead };
}
