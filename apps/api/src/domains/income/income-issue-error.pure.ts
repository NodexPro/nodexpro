/**
 * Map technical issuer-scope / pipeline failures to accountant-facing Hebrew during issue.
 */

export const HEBREW_ISSUER_SCOPE_MISMATCH =
  'לא ניתן להפיק את המסמך משום שזהות מנפיק המסמך אינה תואמת ללקוח המיוצג.';

export const HEBREW_ISSUE_GENERIC = 'לא ניתן להפיק את המסמך כעת. נסו שוב.';

const ENGLISH_ISSUER_SCOPE_MESSAGES = new Set([
  'Resource is outside active issuer scope',
  'Resource is outside active represented client scope',
  'Resource is outside organization scope',
]);

/** Stage → short Hebrew (support tag with stage key appended by resolve). */
const FAILING_STAGE_HEBREW: Record<string, string> = {
  draft_id_validation: 'לא ניתן להפיק — מזהה טיוטה אינו תקין.',
  recurring_issuer_scope_resolve: 'לא ניתן להפיק — לא ניתן ליישר את זהות המנפיק.',
  issuer_scope_load: 'לא ניתן להפיק — לא ניתן לטעון את הקשר המנפיק.',
  permission_check: 'לא ניתן להפיק — אין הרשאה להפקת מסמך.',
  draft_load: 'לא ניתן להפיק — לא ניתן לטעון את הטיוטה.',
  existing_issued_document_check: 'לא ניתן להפיק — בדיקת מסמך קיים נכשלה.',
  numbering: 'לא ניתן להפיק — כשל בהקצאת מספר מסמך.',
  issued_document_insert: 'לא ניתן להפיק — כשל בשמירת המסמך שהופק.',
  accounting_posting: 'לא ניתן להפיק — כשל ברישום בחשבונאות.',
  draft_mark_issued: 'לא ניתן להפיק — כשל בעדכון סטטוס הטיוטה.',
  recurring_cycle_link: 'לא ניתן להפיק — כשל בקישור למחזור הרטנר.',
  issue_command: HEBREW_ISSUE_GENERIC,
};

function hasHebrew(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text);
}

export function mapIncomeIssueUserFacingMessage(message: string | null | undefined): string | null {
  const trimmed = String(message ?? '').trim();
  if (!trimmed) return null;
  if (ENGLISH_ISSUER_SCOPE_MESSAGES.has(trimmed)) return HEBREW_ISSUER_SCOPE_MISMATCH;
  return null;
}

export function mapIncomeIssueFailingStageMessage(
  failingStage: string | null | undefined,
): string | null {
  const stage = String(failingStage ?? '').trim();
  if (!stage) return null;
  return FAILING_STAGE_HEBREW[stage] ?? null;
}

/**
 * Prefer mapped issuer Hebrew, then existing Hebrew AppError text, then stage Hebrew.
 * Always appends [failing_stage] when stage is known so Network/UI triage works without logs.
 */
export function resolveIncomeIssueUserFacingMessage(params: {
  message: string | null | undefined;
  failingStage: string | null | undefined;
}): string {
  const trimmed = String(params.message ?? '').trim();
  const mapped = mapIncomeIssueUserFacingMessage(trimmed);
  const stage = String(params.failingStage ?? '').trim();
  const stageHebrew = mapIncomeIssueFailingStageMessage(stage);

  let base: string;
  if (mapped) {
    base = mapped;
  } else if (trimmed && hasHebrew(trimmed)) {
    base = trimmed;
  } else if (stageHebrew) {
    base = stageHebrew;
  } else {
    base = HEBREW_ISSUE_GENERIC;
  }

  if (stage && !base.includes(`[${stage}]`)) {
    return `${base} [${stage}]`;
  }
  return base;
}

/** Extract message from Error, Postgrest-like plain objects, or string. */
export function extractIncomeIssueThrownMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return 'Issue failed';
}
