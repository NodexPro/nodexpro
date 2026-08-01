/**
 * Map technical issuer-scope failures to accountant-facing Hebrew during issue.
 */

export const HEBREW_ISSUER_SCOPE_MISMATCH =
  'לא ניתן להפיק את המסמך משום שזהות מנפיק המסמך אינה תואמת ללקוח המיוצג.';

const ENGLISH_ISSUER_SCOPE_MESSAGES = new Set([
  'Resource is outside active issuer scope',
  'Resource is outside active represented client scope',
  'Resource is outside organization scope',
]);

export function mapIncomeIssueUserFacingMessage(message: string | null | undefined): string | null {
  const trimmed = String(message ?? '').trim();
  if (!trimmed) return null;
  if (ENGLISH_ISSUER_SCOPE_MESSAGES.has(trimmed)) return HEBREW_ISSUER_SCOPE_MISMATCH;
  return null;
}
