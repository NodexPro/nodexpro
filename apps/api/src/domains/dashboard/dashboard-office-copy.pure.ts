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
  indicator_zero_fee: string;
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
  kpi_left: string;
  kpi_left_secondary: (periodLabel: string) => string;
  kpi_left_churn: (pct: string) => string;
  kpi_left_churn_unavailable: string;
  kpi_expected_incomplete: string;
  kpi_expected_year_unavailable: string;
  breakdown_title: string;
  breakdown_search: string;
  breakdown_empty: string;
  breakdown_load_failed: string;
  breakdown_page: (page: number, pages: number, total: number) => string;
  breakdown_filter_all: string;
  breakdown_filter_attention: string;
  breakdown_filter_no_fee: string;
  breakdown_filter_zero_fee: string;
  breakdown_filter_one_time: string;
  col_client: string;
  col_agreement: string;
  col_frequency: string;
  col_before_discount: string;
  col_discount: string;
  col_monthly: string;
  col_status: string;
  cat_positive_recurring: string;
  cat_configured_zero: string;
  cat_no_agreement: string;
  cat_no_recurring_service: string;
  cat_one_time_only: string;
  cat_needs_attention: string;
  cat_unsupported_vat_fx: string;
  freq_monthly: string;
  freq_bi_monthly: string;
  freq_quarterly: string;
  freq_yearly: string;
  freq_one_time: string;
  freq_mixed: string;
  discount_none: string;
  discount_percent: (n: string) => string;
  discount_amount: (n: string) => string;
  completeness_complete: string;
  completeness_incomplete: string;
  view_all: string;
  chart_growth_departed_hint: string;
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
  missing_empty: 'לכל הלקוחות הוגדר שכ״ט',
  indicator_zero_fee: 'שכ״ט 0 ₪',
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
  kpi_left: 'לקוחות שעזבו',
  kpi_left_secondary: (periodLabel) => `סיום טיפול ב${periodLabel}`,
  kpi_left_churn: (pct) => `שיעור עזיבה ${pct}%`,
  kpi_left_churn_unavailable: 'שיעור עזיבה אינו זמין — אין אוכלוסיית פתיחת תקופה מהימנה',
  kpi_expected_incomplete: 'הסכום אינו מלא: יש לקוחות שלא ניתן לחשב עבורם שכ״ט באופן מהימן.',
  kpi_expected_year_unavailable:
    'אין סכום שנתי מהימן: היסטוריית השכ״ט אינה מאפשרת שחזור חודשים קודמים. לא הוכפל התעריף הנוכחי.',
  breakdown_title: 'פירוט שכ״ט חודשי',
  breakdown_search: 'חיפוש לקוח',
  breakdown_empty: 'אין לקוחות להצגה במסנן זה.',
  breakdown_load_failed: 'לא ניתן לטעון את פירוט השכ״ט.',
  breakdown_page: (page, pages, total) => `עמוד ${page} מתוך ${pages} · ${total} לקוחות`,
  breakdown_filter_all: 'הכל',
  breakdown_filter_attention: 'לקוחות ללא שכ״ט מוגדר',
  breakdown_filter_no_fee: 'ללא שכ״ט',
  breakdown_filter_zero_fee: 'שכ״ט 0 ₪',
  breakdown_filter_one_time: 'חד-פעמי',
  col_client: 'לקוח',
  col_agreement: 'סטטוס הסכם',
  col_frequency: 'תדירות',
  col_before_discount: 'לפני הנחה',
  col_discount: 'הנחה',
  col_monthly: 'שווי חודשי לפני מע״מ',
  col_status: 'סטטוס חישוב',
  cat_positive_recurring: 'שכ״ט חוזר',
  cat_configured_zero: 'שכ״ט אפס מפורש',
  cat_no_agreement: 'לא הוגדר הסכם שכ״ט',
  cat_no_recurring_service: 'הסכם ללא שירות חוזר',
  cat_one_time_only: 'שירות חד-פעמי בלבד',
  cat_needs_attention: 'דורש בדיקה',
  cat_unsupported_vat_fx: 'מע״מ או מטבע לא זמינים',
  freq_monthly: 'חודשי',
  freq_bi_monthly: 'דו-חודשי',
  freq_quarterly: 'רבעוני',
  freq_yearly: 'שנתי',
  freq_one_time: 'חד-פעמי',
  freq_mixed: 'משולב',
  discount_none: 'אין',
  discount_percent: (n) => `${n}%`,
  discount_amount: (n) => n,
  completeness_complete: 'סה״כ מלא תואם לפירוט',
  completeness_incomplete: 'סה״כ חלקי — לא מוצג כסכום סופי',
  view_all: 'הצג הכל',
  chart_growth_departed_hint: 'פעילים בסוף החודש לפי תאריך פתיחה וסיום טיפול; עזיבות בנפרד',
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
  missing_empty: 'All clients have fees configured',
  indicator_zero_fee: '₪0 fee',
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
  kpi_left: 'Clients who left',
  kpi_left_secondary: (periodLabel) => `Service ended in ${periodLabel}`,
  kpi_left_churn: (pct) => `Churn ${pct}%`,
  kpi_left_churn_unavailable: 'Churn % unavailable — beginning-of-period population cannot be reconstructed',
  kpi_expected_incomplete: 'The total is incomplete: some client fees cannot be established reliably.',
  kpi_expected_year_unavailable:
    'No trustworthy year-to-date amount: fee history cannot reconstruct prior months. Current tariff was not multiplied.',
  breakdown_title: 'Monthly fee breakdown',
  breakdown_search: 'Search clients',
  breakdown_empty: 'No clients match this filter.',
  breakdown_load_failed: 'The fee breakdown could not be loaded.',
  breakdown_page: (page, pages, total) => `Page ${page} of ${pages} · ${total} clients`,
  breakdown_filter_all: 'All',
  breakdown_filter_attention: 'Clients without configured fees',
  breakdown_filter_no_fee: 'No fee',
  breakdown_filter_zero_fee: 'Zero fee',
  breakdown_filter_one_time: 'One time',
  col_client: 'Client',
  col_agreement: 'Agreement status',
  col_frequency: 'Frequency',
  col_before_discount: 'Before discount',
  col_discount: 'Discount',
  col_monthly: 'Monthly equivalent before VAT',
  col_status: 'Calculation status',
  cat_positive_recurring: 'Recurring fees',
  cat_configured_zero: 'Explicit zero fee',
  cat_no_agreement: 'No fee agreement',
  cat_no_recurring_service: 'Agreement without recurring service',
  cat_one_time_only: 'One-time only',
  cat_needs_attention: 'Needs attention',
  cat_unsupported_vat_fx: 'VAT or FX unavailable',
  freq_monthly: 'Monthly',
  freq_bi_monthly: 'Bi-monthly',
  freq_quarterly: 'Quarterly',
  freq_yearly: 'Yearly',
  freq_one_time: 'One-time',
  freq_mixed: 'Mixed',
  discount_none: 'None',
  discount_percent: (n) => `${n}%`,
  discount_amount: (n) => n,
  completeness_complete: 'Complete total matches the breakdown',
  completeness_incomplete: 'Partial total — not shown as a final figure',
  view_all: 'View all',
  chart_growth_departed_hint: 'Active at month end from open/end dates; departures as a separate series',
};

export function officeCopy(locale: DashboardLocale): OfficeCopy {
  return locale === 'he' ? HE : EN;
}
