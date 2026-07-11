/**
 * Income issue month window — resolved from Country Pack legal values with IL fallback.
 * Mirrors income-draft-vat-resolver.ts: Country Pack is the source of truth; the
 * fallback constant lives in income-issue-month-window-fallback.pure.ts only.
 */
import { resolveCountryContext } from '../country-pack/country-pack-resolver.service.js';
import { resolveLegalValue } from '../country-pack/legal-value.service.js';
import { issueMonthWindowFallbackResolution, parseIssueMonthWindowFromLegalPayload, } from './income-issue-month-window-fallback.pure.js';
/** Canonical IL legal value key for the allowed issue/accounting month window. */
export const IL_ISSUE_MONTH_WINDOW_LEGAL_VALUE_KEY = 'il_income_issue_month_window';
export async function resolveIncomeIssueMonthWindowForOrg(orgId, countryCode, date) {
    const cc = countryCode.trim().toUpperCase() || 'IL';
    const day = date.trim() || new Date().toISOString().slice(0, 10);
    try {
        const ctx = await resolveCountryContext(orgId, day);
        if (ctx.ruleset_id) {
            const version = await resolveLegalValue(cc, IL_ISSUE_MONTH_WINDOW_LEGAL_VALUE_KEY, day, ctx.ruleset_id);
            const fromVersion = parseIssueMonthWindowFromLegalPayload(version?.value_payload_json);
            if (fromVersion) {
                return {
                    ...fromVersion,
                    source: 'country_pack',
                    legal_value_key: IL_ISSUE_MONTH_WINDOW_LEGAL_VALUE_KEY,
                };
            }
            const fromMap = parseIssueMonthWindowFromLegalPayload(ctx.resolved_values_map[IL_ISSUE_MONTH_WINDOW_LEGAL_VALUE_KEY]);
            if (fromMap) {
                return {
                    ...fromMap,
                    source: 'country_pack',
                    legal_value_key: IL_ISSUE_MONTH_WINDOW_LEGAL_VALUE_KEY,
                };
            }
        }
    }
    catch {
        /* fall through to IL fallback */
    }
    return issueMonthWindowFallbackResolution();
}
