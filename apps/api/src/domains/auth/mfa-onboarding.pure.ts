/** Optional authenticator prompt. This is not a liability waiver and it is not an MFA policy. */

export const MFA_PROMPT_WARNING_VERSION = 'mfa-optional-prompt-v1';

export const MFA_PROMPT_ACTION = 'security.mfa_prompt_acknowledged';

export type MfaPromptDecision = 'accept' | 'decline';

export function mfaPromptVisibility(input: { verifiedFactor: boolean; recordedWarningVersion: string | null }): boolean {
  if (input.verifiedFactor) return false;
  return input.recordedWarningVersion !== MFA_PROMPT_WARNING_VERSION;
}

export function parseMfaPromptDecision(value: unknown): MfaPromptDecision | null {
  return value === 'accept' || value === 'decline' ? value : null;
}

/** Accept starts enrollment. It does not mark the factor verified. Decline stores the decision and stops. */
export function nextCommandsForMfaPrompt(decision: MfaPromptDecision): Array<'enroll_mfa'> {
  return decision === 'accept' ? ['enroll_mfa'] : [];
}

export function mfaPromptCopy(): {
  warning_version: typeof MFA_PROMPT_WARNING_VERSION;
  title_he: string;
  body_he: string;
  accept_label_he: string;
  decline_label_he: string;
  section_he: string;
  active_status_he: string;
  inactive_status_he: string;
  enroll_label_he: string;
  liability_waiver: false;
} {
  return {
    warning_version: MFA_PROMPT_WARNING_VERSION,
    title_he: 'מומלץ להפעיל אימות דו־שלבי',
    body_he: 'אימות דו־שלבי מוסיף שכבת הגנה לחשבון. אפשר להפעיל אותו עכשיו, או מאוחר יותר במסך האבטחה.',
    accept_label_he: 'הפעלת אימות דו־שלבי',
    decline_label_he: 'לא עכשיו',
    section_he: 'אבטחה',
    active_status_he: 'אימות דו־שלבי פעיל',
    inactive_status_he: 'אימות דו־שלבי לא פעיל',
    enroll_label_he: 'הפעלת אימות דו־שלבי',
    liability_waiver: false,
  };
}

export function mfaSecurityCopy(): {
  settings_title_he: string;
  qr_title_he: string;
  code_label_he: string;
  verify_label_he: string;
  cancel_label_he: string;
  remove_label_he: string;
  replace_label_he: string;
  recovery_unavailable_he: string;
  trusted_unavailable_he: string;
  suspicious_unavailable_he: string;
  optional_he: string;
  mandatory_inactive_he: string;
  mandatory_active_he: string;
  pending_he: string;
} {
  return {
    settings_title_he: 'הגדרות חשבון',
    qr_title_he: 'סרקו את הקוד באפליקציית האימות',
    code_label_he: 'קוד בן 6 ספרות',
    verify_label_he: 'אימות',
    cancel_label_he: 'ביטול',
    remove_label_he: 'הסרת אימות דו־שלבי',
    replace_label_he: 'החלפת מאמת',
    recovery_unavailable_he: 'קודי שחזור עדיין לא זמינים',
    trusted_unavailable_he: 'זיהוי מכשיר מהימן עדיין לא זמין',
    suspicious_unavailable_he: 'כמה ניסיונות כניסה כושלים דורשים אימות נוסף מבעל הפלטפורמה. כתובת IP לבדה לא חוסמת.',
    optional_he: 'האימות רשות. אפשר לדחות עכשיו ולהפעיל אחר כך.',
    mandatory_inactive_he: 'לבעל הפלטפורמה האימות נדרש, אבל הנעילה עדיין לא פעילה.',
    mandatory_active_he: 'בעל הפלטפורמה נכנס לפקודות רגישות רק אחרי אימות דו־שלבי. לא ניתן לכבות את ההפעלה.',
    pending_he: 'ההפעלה מחכה לאימות הקוד. האימות עדיין לא פעיל.',
  };
}

export function mfaPolicyView(input: {
  platformOwner: boolean;
  activationState: 'not_activated' | 'permanently_active' | 'unreadable';
  recoveryReady: boolean;
  trustedDevicesReady: boolean;
}): {
  requirement: 'mandatory' | 'optional';
  decline_allowed: boolean;
  enforcement: 'off' | 'blocked_not_ready' | 'enforce';
  enforcement_active: boolean;
  suspicious_sign_in_detection: 'failure_burst';
  trusted_devices: 'storage_not_ready' | 'ready';
  recovery: 'storage_not_ready' | 'ready';
} {
  const enforcementActive = input.platformOwner && input.activationState === 'permanently_active';
  const failClosed = input.platformOwner && input.activationState === 'unreadable';
  const requirement = enforcementActive || failClosed ? 'mandatory' : 'optional';
  return {
    requirement,
    decline_allowed: !enforcementActive && !failClosed,
    enforcement: enforcementActive || failClosed ? 'enforce' : 'off',
    enforcement_active: enforcementActive,
    suspicious_sign_in_detection: 'failure_burst',
    trusted_devices: input.trustedDevicesReady ? 'ready' : 'storage_not_ready',
    recovery: input.recoveryReady ? 'ready' : 'storage_not_ready',
  };
}

/** The screen renders backend fields only. Role and tenant are not inputs. */
export function mfaOnboardingView(aggregate: {
  prompt: { show: boolean; accept_label_he: string; decline_label_he: string; title_he: string; body_he: string };
  account_security: { section_he: string; status_he: string; enroll_enabled: boolean; enroll_label_he: string };
}): {
  showPrompt: boolean;
  title: string;
  body: string;
  acceptLabel: string;
  declineLabel: string;
  section: string;
  status: string;
  showEnroll: boolean;
  enrollLabel: string;
} {
  return {
    showPrompt: aggregate.prompt.show,
    title: aggregate.prompt.title_he,
    body: aggregate.prompt.body_he,
    acceptLabel: aggregate.prompt.accept_label_he,
    declineLabel: aggregate.prompt.decline_label_he,
    section: aggregate.account_security.section_he,
    status: aggregate.account_security.status_he,
    showEnroll: aggregate.account_security.enroll_enabled,
    enrollLabel: aggregate.account_security.enroll_label_he,
  };
}
