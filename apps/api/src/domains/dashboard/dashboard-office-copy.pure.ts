export type DashboardLocale = 'he' | 'en';

export function parseDashboardLocale(raw: unknown): DashboardLocale {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'he' || s.startsWith('he-')) return 'he';
  return 'en';
}

type OfficeCopy = {
  title: string;
  subtitle: string;
  load_failed: string;
  no_fees_permission: string;
  historical_unavailable: string;
  vat_rate_unavailable: string;
  unavailable: string;
  fx_skipped: (n: number) => string;
  period_current_month: string;
  period_previous_month: string;
  period_current_year: string;
  kpi_active: string;
  kpi_active_secondary: string;
  kpi_expected_fees: string;
  kpi_expected_secondary: string;
  kpi_expected_secondary_year: string;
  kpi_debtors: string;
  kpi_debtors_secondary: string;
  kpi_debtors_note: string;
  kpi_new_clients: string;
  kpi_new_clients_secondary: (periodLabel: string) => string;
  missing_title: string;
  missing_indicator: string;
  missing_empty: string;
  missing_truncated: (shown: number, total: number) => string;
  attention_title: string;
  attention_overdue: string;
  attention_due_today: string;
  attention_approval: string;
  attention_missing_docs: string;
  attention_missing_docs_unavailable: string;
  we_unavailable: string;
  deadlines_title: string;
  deadlines_unavailable: string;
  chart_fees_title: string;
  chart_growth_title: string;
  chart_growth_hint: string;
  status_title: string;
  status_active: string;
  status_pending: string;
  status_inactive: string;
  status_archived: string;
  activity_title: string;
  activity_unavailable: string;
  actions_title: string;
  action_new_client: string;
  action_upload: string;
  action_tasks: string;
  collected_cash_note: string;
  clients_count: (n: number) => string;
  historical_basis: (missing: string) => string;
};

const HE: OfficeCopy = {
  title: 'סקירת המשרד',
  subtitle: 'תמונת מצב של המשרד',
  load_failed: 'לא ניתן לטעון את נתוני המשרד כרגע.',
  no_fees_permission: 'אין הרשאה לצפייה בשכ״ט.',
  historical_unavailable: 'לא ניתן לשחזר שכ״ט היסטורי: טבלת ההיסטוריה אינה שומרת תדירות, מע״מ, הנחה או שווי חודשי.',
  vat_rate_unavailable: 'שיעור מע״מ סטטוטורי אינו זמין מ-Country Pack; לא ניתן להמיר שורות כולל מע״מ.',
  unavailable: 'לא זמין',
  fx_skipped: (n) => `${n} לקוחות עם מטבע שאינו ₪ ללא שער המרה — לא נכללו בסכום.`,
  period_current_month: 'חודש נוכחי',
  period_previous_month: 'חודש קודם',
  period_current_year: 'שנה נוכחית',
  kpi_active: 'לקוחות פעילים',
  kpi_active_secondary: 'סטטוס פעיל במשרד · לא תלוי בתקופה הנבחרת',
  kpi_expected_fees: 'הכנסה חודשית צפויה משכ״ט',
  kpi_expected_secondary: 'צפי חודשי לפני מע״מ לפי תעריף נוכחי · לא כולל גבייה בפועל',
  kpi_expected_secondary_year: 'תעריף נוכחי, ממוצע חודשי לפני מע״מ, להסכמים בתוקף השנה · לא שחזור היסטורי',
  kpi_debtors: 'לקוחות עם חוב למשרד',
  kpi_debtors_secondary: 'חוב אמיתי למשרד עדיין לא זמין מ-Accounting Base',
  kpi_debtors_note: 'אין אגרגט של יתרות שכ״ט שנגבו מול המשרד.',
  kpi_new_clients: 'לקוחות חדשים',
  kpi_new_clients_secondary: (periodLabel) => `נוספו ב${periodLabel}`,
  missing_title: 'לקוחות ללא שכ״ט מוגדר',
  missing_indicator: 'לא הוגדר שכ״ט',
  missing_empty: 'לכל הלקוחות הפעילים מוגדר שכ״ט, כולל סכום אפס מפורש.',
  missing_truncated: (shown, total) => `מוצגים ${shown} מתוך ${total}`,
  attention_title: 'משימות דורשות תשומת לב',
  attention_overdue: 'משימות באיחור',
  attention_due_today: 'לביצוע היום',
  attention_approval: 'ממתינות לאישור',
  attention_missing_docs: 'מסמכי לקוח חסרים',
  attention_missing_docs_unavailable: 'אין כרגע aggregate ארגוני של מסמכים חסרים הדורשים מעקב.',
  we_unavailable: 'לא ניתן לטעון מונים מ-Work Engine כרגע.',
  deadlines_title: 'הדיווחים הקרובים',
  deadlines_unavailable: 'מועדי דיווח סטטוטוריים עדיין לא זמינים דרך aggregate מורשה. לא נקבעו מועדים בצד הלקוח.',
  chart_fees_title: 'הכנסה צפויה משכ״ט לפי חודשים',
  chart_growth_title: 'צמיחת לקוחות',
  chart_growth_hint: 'מצטבר לפי תאריך פתיחה במרשם',
  status_title: 'סטטוס לקוחות',
  status_active: 'פעיל',
  status_pending: 'ממתין',
  status_inactive: 'לא פעיל',
  status_archived: 'בארכיון',
  activity_title: 'פעילות אחרונה',
  activity_unavailable: 'אין aggregate ארגוני של פעילות אחרונה. היסטוריה קיימת בכרטיס הלקוח בלבד.',
  actions_title: 'פעולות מהירות',
  action_new_client: 'לקוח חדש',
  action_upload: 'העלאת מסמך',
  action_tasks: 'משימות',
  collected_cash_note: 'גבייה בפועל אינה מוצגת כאן. Accounting Base אינו חושף הכנסה שנאספה למשרד.',
  clients_count: (n) => `${n} לקוחות`,
  historical_basis: (missing) =>
    `חודשים היסטוריים אינם מוצגים: היסטוריית השכ״ט אינה כוללת ${missing}. התעריף הנוכחי אינו מושלך אחורה.`,
};

const EN: OfficeCopy = {
  title: 'Office overview',
  subtitle: 'A snapshot of the office',
  load_failed: 'Office data could not be loaded right now.',
  no_fees_permission: 'You do not have permission to view fees.',
  historical_unavailable:
    'Historical fees cannot be reconstructed: fee history does not store frequency, VAT, discount, or monthly equivalent.',
  vat_rate_unavailable:
    'The statutory VAT rate is unavailable from Country Pack; VAT-inclusive lines cannot be converted.',
  unavailable: 'Unavailable',
  fx_skipped: (n) => `${n} clients with a non-₪ currency and no conversion rate were excluded.`,
  period_current_month: 'Current month',
  period_previous_month: 'Previous month',
  period_current_year: 'Current year',
  kpi_active: 'Active clients',
  kpi_active_secondary: 'Active office status · not period-dependent',
  kpi_expected_fees: 'Expected monthly office fees',
  kpi_expected_secondary: 'Current monthly expected fees before VAT · not cash collected',
  kpi_expected_secondary_year:
    'Current tariff, monthly equivalent before VAT, for agreements in force this year · not historical reconstruction',
  kpi_debtors: 'Clients with office debt',
  kpi_debtors_secondary: 'Genuine office receivables are not yet available from Accounting Base',
  kpi_debtors_note: 'There is no aggregate of collected office fee balances.',
  kpi_new_clients: 'New clients',
  kpi_new_clients_secondary: (periodLabel) => `Added in ${periodLabel}`,
  missing_title: 'Clients without configured fees',
  missing_indicator: 'Fees not configured',
  missing_empty: 'Every active client has a fee configuration, including an explicit zero amount.',
  missing_truncated: (shown, total) => `Showing ${shown} of ${total}`,
  attention_title: 'Tasks needing attention',
  attention_overdue: 'Overdue tasks',
  attention_due_today: 'Due today',
  attention_approval: 'Awaiting approval',
  attention_missing_docs: 'Missing client documents',
  attention_missing_docs_unavailable: 'There is no office-wide aggregate of missing documents requiring follow-up.',
  we_unavailable: 'Work Engine counts could not be loaded right now.',
  deadlines_title: 'Upcoming reports',
  deadlines_unavailable:
    'Statutory reporting deadlines are not yet available through an authorized aggregate. No dates were hardcoded.',
  chart_fees_title: 'Expected fees by month',
  chart_growth_title: 'Client growth',
  chart_growth_hint: 'Cumulative by registry created date',
  status_title: 'Client status',
  status_active: 'Active',
  status_pending: 'Pending',
  status_inactive: 'Inactive',
  status_archived: 'Archived',
  activity_title: 'Recent activity',
  activity_unavailable: 'There is no office-wide activity aggregate. History exists on the client card only.',
  actions_title: 'Quick actions',
  action_new_client: 'New client',
  action_upload: 'Upload document',
  action_tasks: 'Tasks',
  collected_cash_note: 'Collected cash is not shown here. Accounting Base does not expose office-earned revenue.',
  clients_count: (n) => `${n} clients`,
  historical_basis: (missing) =>
    `Historical months are not shown: fee history does not include ${missing}. Current tariffs are not projected backward.`,
};

export function officeCopy(locale: DashboardLocale): OfficeCopy {
  return locale === 'he' ? HE : EN;
}
