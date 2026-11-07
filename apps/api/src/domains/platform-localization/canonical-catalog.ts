/**
 * Canonical UI translation catalog for Owner Languages & Translations.
 * Account/settings keys stay explicit; the rest is the bundled web dictionary
 * (apps/web/src/i18n) flattened into this registry. Completeness is measured
 * against this full catalog — not a 48-key subset.
 */
import {
  BUNDLED_UI_SOURCE_EN,
  BUNDLED_UI_SOURCE_HE,
  BUNDLED_UI_SOURCE_RU,
} from './bundled-ui-catalog.js';

export const ACCOUNT_SETTINGS_SOURCE_EN: Record<string, string> = {
  'common.loading': 'Loading…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.create': 'Create',
  'settings.title': 'Organization Settings',
  'settings.subtitle': 'Manage your organization profile and business identity.',
  'settings.readOnly': 'Only the organization owner can edit these settings.',
  'settings.ownerIdentity.section': 'Company Identity',
  'settings.ownerIdentity.status': 'Status',
  'settings.loginEmail': 'Primary login email',
  'settings.loginEmailVerified': 'Verified',
  'settings.loginEmailUnverified': 'Not verified',
  'settings.passwordMasked': 'Password',
  'settings.changePasswordAction': 'Change password',
  'settings.accountSecurity.section': 'Account & Security',
  'settings.accountSecurity.additionalEmail': 'Additional login email',
  'settings.accountSecurity.additionalEmailHint':
    'Maximum one additional address. It signs into this same account after you verify it.',
  'settings.accountSecurity.addEmail': 'Add additional email',
  'settings.accountSecurity.replaceEmail': 'Replace additional email',
  'settings.accountSecurity.removeEmail': 'Remove additional email',
  'settings.accountSecurity.resend': 'Resend verification',
  'settings.accountSecurity.pending': 'Pending verification',
  'settings.accountSecurity.verified': 'Verified',
  'settings.accountSecurity.currentPassword': 'Current password',
  'settings.accountSecurity.newPassword': 'New password',
  'settings.accountSecurity.confirmPassword': 'Confirm new password',
  'settings.accountSecurity.savePassword': 'Update password',
  'settings.accountSecurity.recovery': 'Forgot current password? Use password recovery.',
  'settings.localization.section': 'Country & Localization',
  'settings.localization.country': 'Country',
  'settings.localization.countryNote':
    'Country follows Country Pack authorization. This is not a display-only preference and does not silently change tax jurisdiction.',
  'settings.localization.language': 'Interface language',
  'settings.localization.timezone': 'Time zone',
  'settings.localization.timezoneNote': 'Display time zone only. Stored timestamps are not rewritten.',
  'settings.localization.dateFormat': 'Date format',
  'settings.localization.dateFormatNote': 'Display format only. Legal and accounting source dates are unchanged.',
  'settings.localization.currency': 'Display currency',
  'settings.localization.currencyNote':
    'Display default only. This does not change Accounting Base currency, invoices, tax, or historical entries.',
  'settings.country': 'Country',
  'settings.currency': 'Currency',
  'settings.save': 'Save',
  'auth.signIn': 'Sign in',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.forgotPassword': 'Forgot password?',
  'clients.create': 'New client',
  'dashboard.activeClients': 'Active Clients',
};

export const ACCOUNT_SETTINGS_SOURCE_HE: Record<string, string> = {
  'common.loading': 'טוען…',
  'common.save': 'שמירה',
  'common.cancel': 'ביטול',
  'common.close': 'סגירה',
  'common.create': 'יצירה',
  'settings.title': 'הגדרות ארגון',
  'settings.subtitle': 'נהל את פרופיל הארגון וזהות העסק.',
  'settings.readOnly': 'רק בעל הארגון יכול לערוך הגדרות אלה.',
  'settings.ownerIdentity.section': 'זהות החברה',
  'settings.ownerIdentity.status': 'סטטוס',
  'settings.loginEmail': 'אימייל כניסה ראשי',
  'settings.loginEmailVerified': 'מאומת',
  'settings.loginEmailUnverified': 'לא מאומת',
  'settings.passwordMasked': 'סיסמה',
  'settings.changePasswordAction': 'שינוי סיסמה',
  'settings.accountSecurity.section': 'חשבון ואבטחה',
  'settings.accountSecurity.additionalEmail': 'אימייל כניסה נוסף',
  'settings.accountSecurity.additionalEmailHint':
    'כתובת נוספת אחת לכל היותר. לאחר אימות היא נכנסת לאותו חשבון.',
  'settings.accountSecurity.addEmail': 'הוספת אימייל נוסף',
  'settings.accountSecurity.replaceEmail': 'החלפת אימייל נוסף',
  'settings.accountSecurity.removeEmail': 'הסרת אימייל נוסף',
  'settings.accountSecurity.resend': 'שליחת אימות מחדש',
  'settings.accountSecurity.pending': 'ממתין לאימות',
  'settings.accountSecurity.verified': 'מאומת',
  'settings.accountSecurity.currentPassword': 'סיסמה נוכחית',
  'settings.accountSecurity.newPassword': 'סיסמה חדשה',
  'settings.accountSecurity.confirmPassword': 'אימות סיסמה חדשה',
  'settings.accountSecurity.savePassword': 'עדכון סיסמה',
  'settings.accountSecurity.recovery': 'שכחת את הסיסמה הנוכחית? השתמש בשחזור סיסמה.',
  'settings.localization.section': 'מדינה ולוקליזציה',
  'settings.localization.country': 'מדינה',
  'settings.localization.countryNote':
    'המדינה כפופה ל-Country Pack. זו אינה העדפת תצוגה בלבד ואינה משנה סמכות מס בשקט.',
  'settings.localization.language': 'שפת ממשק',
  'settings.localization.timezone': 'אזור זמן',
  'settings.localization.timezoneNote': 'אזור זמן לתצוגה בלבד. חותמות זמן שמורות אינן משתנות.',
  'settings.localization.dateFormat': 'פורמט תאריך',
  'settings.localization.dateFormatNote': 'פורמט תצוגה בלבד. תאריכי מקור משפטיים וחשבונאיים אינם משתנים.',
  'settings.localization.currency': 'מטבע תצוגה',
  'settings.localization.currencyNote':
    'ברירת מחדל לתצוגה בלבד. אין שינוי במטבע Accounting Base, חשבוניות, מס או רשומות היסטוריות.',
  'settings.country': 'מדינה',
  'settings.currency': 'מטבע',
  'settings.save': 'שמירה',
  'auth.signIn': 'התחברות',
  'auth.email': 'אימייל',
  'auth.password': 'סיסמה',
  'auth.forgotPassword': 'שכחת סיסמה?',
  'clients.create': 'לקוח חדש',
  'dashboard.activeClients': 'לקוחות פעילים',
};

const COMMON_ERROR_SOURCE_EN: Record<string, string> = {
  'common.errors.workItemVersionConflict': 'Item was updated. Refreshing...',
  'common.errors.versionConflict':
    'This record changed since the screen opened. Close and reopen the client card, or refresh the list, then try again.',
  'common.errors.invitationExpired': 'This invitation has expired. Ask the office for a new invitation link.',
  'common.errors.invitationRevoked': 'This invitation was revoked. Contact the office for a new invitation.',
  'common.errors.invalidInvitationToken':
    'This invitation link is invalid or does not match the server. Ask the office for a new link.',
  'common.errors.invitationNotAcceptable':
    'This invitation link cannot be used in its current state. Ask the office for a new link.',
  'common.errors.portalAccessRevoked': 'DocFlow access was revoked by the office. Contact the office.',
  'common.errors.portalActivationFailed': 'DocFlow access could not be activated. Contact the office for support.',
  'common.errors.forbidden': 'You do not have permission to perform this action.',
  'common.errors.portalSessionExpired':
    'The DocFlow access link has expired. Ask the office for a new invitation link.',
  'common.errors.portalSessionInvalid':
    'The DocFlow session is not valid. Open the invitation link from the email again (the same link can renew access if the invitation is still valid).',
  'common.errors.unauthorized': 'Your session expired. Sign in again.',
  'common.errors.notImplemented': 'This action is not available yet. Try a different format.',
  'common.errors.serverError':
    'Temporary server error. Try again in a moment; if it continues, contact support.',
  'common.errors.conflict': 'A version conflict or concurrent update occurred. Refresh the data and try again.',
  'common.errors.failed': 'The action failed. Try again.',
  'common.errors.aborted': 'The request was cancelled.',
  'common.errors.network': 'Network problem. Check your internet connection and try again.',
  'common.errors.generic': 'Error',
};

const COMMON_ERROR_SOURCE_HE: Record<string, string> = {
  'common.errors.workItemVersionConflict': 'הפריט עודכן. מרענן…',
  'common.errors.versionConflict':
    'המידע עודכן מאז שנפתח המסך. סגור ופתח מחדש את כרטיס הלקוח, או רענן את הרשימה, ונסה שוב.',
  'common.errors.invitationExpired': 'תוקף ההזמנה פג. בקשו מהמשרד קישור הזמנה חדש.',
  'common.errors.invitationRevoked': 'ההזמנה בוטלה. פנו למשרד לקבלת הזמנה חדשה.',
  'common.errors.invalidInvitationToken':
    'קישור ההזמנה אינו תקין או אינו תואם לשרת. בקשו קישור חדש מהמשרד.',
  'common.errors.invitationNotAcceptable':
    'לא ניתן להשתמש בקישור ההזמנה במצב הנוכחי. בקשו מהמשרד קישור חדש.',
  'common.errors.portalAccessRevoked': 'הגישה ל-DocFlow בוטלה על ידי המשרד. פנו למשרד.',
  'common.errors.portalActivationFailed': 'לא ניתן להפעיל את הגישה ל-DocFlow. פנו למשרד לתמיכה.',
  'common.errors.forbidden': 'אין הרשאה לביצוע הפעולה.',
  'common.errors.portalSessionExpired':
    'קישור הגישה ל-DocFlow פג תוקף. בקשו מהמשרד קישור הזמנה חדש.',
  'common.errors.portalSessionInvalid':
    'סשן ה-DocFlow אינו תקף. פתחו שוב את קישור ההזמנה מהאימייל (אותו קישור יכול לחדש את הגישה אם ההזמנה עדיין בתוקף).',
  'common.errors.unauthorized': 'פג תוקף ההתחברות. יש להיכנס מחדש.',
  'common.errors.notImplemented': 'הפעולה עדיין לא זמינה בשלב זה. נסה פורמט אחר.',
  'common.errors.serverError': 'שגיאת שרת זמנית. נסה שוב בעוד רגע; אם זה חוזר — פנה לתמיכה.',
  'common.errors.conflict': 'קונפליקט גרסה או עדכון במקביל. רענן את הנתונים ונסה שוב.',
  'common.errors.failed': 'הפעולה נכשלה. נסה שוב.',
  'common.errors.aborted': 'הבקשה בוטלה.',
  'common.errors.network': 'בעיית תקשורת. בדוק חיבור לאינטרנט ונסה שוב.',
  'common.errors.generic': 'שגיאה',
};

const CLIENT_OPERATIONS_CONTROL_SOURCE_EN: Record<string, string> = {
  'nav.collapse': 'Collapse navigation',
  'nav.expand': 'Expand navigation',
  'clientOperations.noData': 'No data.',
  'clientOperations.tabsAria': 'Workspace tabs',
  'clientOperations.loadFailed': 'Failed to load',
  'clientOperations.reminders.dismissAll': 'Dismiss all',
  'clientOperations.docflow.revokePortal': 'Revoke Portal',
  'clientOperations.docflow.threadTitle': 'Thread title',
  'clientOperations.docflow.newThread': '+ New thread',
  'clientOperations.docflow.noThreads': 'No threads',
  'clientOperations.docflow.markRead': 'Mark read',
  'clientOperations.docflow.archive': 'Archive',
  'clientOperations.docflow.reopen': 'Reopen',
  'clientOperations.docflow.selectThread': 'Select thread',
  'clientOperations.docflow.noMessages': 'No messages yet',
  'clientOperations.docflow.writeMessage': 'Write office message',
  'clientOperations.docflow.unread': 'Unread:',
  'clientOperations.docflow.sla': 'SLA:',
  'clientOperations.docflow.attachments': 'Attachments:',
  'clientOperations.docflow.portal': 'Portal:',
  'clientOperations.docflow.send': 'Send',
  'clientOperations.docflow.uploading': 'Uploading…',
  'clientOperations.docflow.uploadAttach': 'Upload & attach',
  'clientOperations.docflow.types.document_request': 'Document request',
  'clientOperations.docflow.types.question': 'Question',
  'clientOperations.docflow.types.reminder': 'Reminder',
  'clientOperations.docflow.types.task_followup': 'Task follow-up',
};

const CLIENT_OPERATIONS_CONTROL_SOURCE_HE: Record<string, string> = {
  'nav.collapse': 'כיווץ ניווט',
  'nav.expand': 'הרחבת ניווט',
  'clientOperations.noData': 'אין נתונים.',
  'clientOperations.tabsAria': 'לשוניות תיק',
  'clientOperations.loadFailed': 'הטעינה נכשלה',
  'clientOperations.reminders.dismissAll': 'סגור הכל',
  'clientOperations.docflow.revokePortal': 'ביטול פורטל',
  'clientOperations.docflow.threadTitle': 'כותרת שיחה',
  'clientOperations.docflow.newThread': '+ שיחה חדשה',
  'clientOperations.docflow.noThreads': 'אין שיחות',
  'clientOperations.docflow.markRead': 'סמן כנקרא',
  'clientOperations.docflow.archive': 'ארכיון',
  'clientOperations.docflow.reopen': 'פתיחה מחדש',
  'clientOperations.docflow.selectThread': 'בחירת שיחה',
  'clientOperations.docflow.noMessages': 'עדיין אין הודעות',
  'clientOperations.docflow.writeMessage': 'כתבו הודעת משרד',
  'clientOperations.docflow.unread': 'לא נקראו:',
  'clientOperations.docflow.sla': 'SLA:',
  'clientOperations.docflow.attachments': 'קבצים מצורפים:',
  'clientOperations.docflow.portal': 'פורטל:',
  'clientOperations.docflow.send': 'שליחה',
  'clientOperations.docflow.uploading': 'מעלה…',
  'clientOperations.docflow.uploadAttach': 'העלאה וצירוף',
  'clientOperations.docflow.types.document_request': 'בקשת מסמך',
  'clientOperations.docflow.types.question': 'שאלה',
  'clientOperations.docflow.types.reminder': 'תזכורת',
  'clientOperations.docflow.types.task_followup': 'מעקב משימה',
};

export const CANONICAL_SOURCE_EN: Record<string, string> = {
  ...BUNDLED_UI_SOURCE_EN,
  ...ACCOUNT_SETTINGS_SOURCE_EN,
  ...COMMON_ERROR_SOURCE_EN,
  ...CLIENT_OPERATIONS_CONTROL_SOURCE_EN,
};

export const CANONICAL_SOURCE_HE: Record<string, string> = {
  ...BUNDLED_UI_SOURCE_HE,
  ...ACCOUNT_SETTINGS_SOURCE_HE,
  ...COMMON_ERROR_SOURCE_HE,
  ...CLIENT_OPERATIONS_CONTROL_SOURCE_HE,
};

export const CANONICAL_SOURCE_RU: Record<string, string> = {
  ...BUNDLED_UI_SOURCE_RU,
};

export function bundledSourceForLocale(locale: string): Record<string, string> {
  if (locale === 'he') return CANONICAL_SOURCE_HE;
  if (locale === 'ru') return { ...CANONICAL_SOURCE_EN, ...CANONICAL_SOURCE_RU };
  return CANONICAL_SOURCE_EN;
}
