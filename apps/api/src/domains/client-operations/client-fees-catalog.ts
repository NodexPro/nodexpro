/** Built-in fee service catalog — backend-owned; codes stable for storage. */
export type BuiltInFeeService = { code: string; label_he: string };

export const BUILT_IN_FEE_SERVICES: BuiltInFeeService[] = [
  { code: 'accounting_single_sided', label_he: 'הנהלת חשבונות חד צדדית' },
  { code: 'accounting_double_sided', label_he: 'הנהלת חשבונות דו צדדית' },
  { code: 'bank_reconciliations', label_he: 'התאמות בנקים' },
  { code: 'credit_card_reconciliations', label_he: 'התאמות כרטיסי אשראי' },
  { code: 'customer_reconciliations', label_he: 'התאמות לקוחות' },
  { code: 'supplier_reconciliations', label_he: 'התאמות ספקים' },
  { code: 'periodic_reports', label_he: 'הפקת דוחות תקופתיים' },
  { code: 'vat_reporting', label_he: '\u05D3\u05D9\u05D5\u05D5\u05D7 \u05DE\u05E2"\u05DE' },
  { code: 'income_tax_advances_reporting', label_he: 'דיווח מקדמות מס הכנסה' },
  { code: 'withholding_reporting', label_he: 'דיווח ניכויים' },
  { code: 'national_insurance_reporting', label_he: 'דיווח לביטוח לאומי' },
  { code: 'annual_report', label_he: 'דוח שנתי' },
  { code: 'capital_declaration', label_he: 'הצהרת הון' },
  { code: 'authority_letters', label_he: 'טיפול במכתבים מרשויות' },
  { code: 'payslip_preparation', label_he: 'הכנת תלושי שכר' },
  { code: 'payroll_reporting', label_he: 'דיווח שכר' },
  { code: 'business_closure', label_he: 'טיפול בסיום העסקה' },
  { code: 'pension_funds', label_he: 'טיפול בפנסיה / קופות' },
  { code: 'file_open', label_he: 'פתיחת תיק' },
  { code: 'file_close', label_he: 'סגירת תיק' },
  { code: 'tax_refund', label_he: 'החזר מס' },
  { code: 'special_one_time', label_he: 'בדיקה מיוחדת / עבודה חד פעמית' },
  { code: 'meeting_consult', label_he: '\u05E4\u05D2\u05D9\u05E9\u05D4 / \u05D9\u05D9\u05E2\u05D5\u05E5' },
  { code: 'osek_patur_declaration', label_he: 'הצהרת עוסק פטור' },
  { code: 'advance_cancellation', label_he: 'ביטול מקדמות' },
  { code: 'salary_by_payslips', label_he: 'שכר לפי מספר תלושים' },
  { code: 'salary_monthly_fixed', label_he: 'שכר חודשי קבוע' },
  { code: 'authority_debts', label_he: 'טיפול בחובות לרשויות' },
  { code: 'forms_fill', label_he: 'מילוי טפסים' },
  { code: 'tax_consult_calc', label_he: '\u05D9\u05D9\u05E2\u05D5\u05E5 \u05D1\u05D7\u05D9\u05E9\u05D5\u05D1\u05D9 \u05DE\u05E1' },
  { code: 'misc_reports', label_he: 'דוחות שונים' },
  { code: 'business_planning', label_he: 'תכנון עסקי' },
];

export const BUILT_IN_BY_CODE = new Map(BUILT_IN_FEE_SERVICES.map((s) => [s.code, s]));

export const MAX_BUILT_IN_LINES = 25;
export const MAX_CUSTOM_LINES = 3;

export const CHARGING_TYPE_LABELS: Record<string, string> = {
  monthly: 'חודשי',
  bi_monthly: 'דו חודשי',
  quarterly: 'רבעוני',
  yearly: 'שנתי',
  one_time: 'חד פעמי',
};

/** יום חיוב בחודש — ערכי אחסון בשרת בלבד; התוויות לתצוגה */
export const BILLING_DAY_RANGE_LABELS: Record<string, string> = {
  '1_5': '1–5',
  '6_9': '6–9',
  '10_14': '10–14',
  '15_20': '15–20',
  '21_31': '21–31',
};

export const BILLING_DAY_RANGE_ORDER = ['1_5', '6_9', '10_14', '15_20', '21_31'] as const;

export function isAllowedBillingDayRange(v: unknown): v is string {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BILLING_DAY_RANGE_LABELS, v);
}

export const AGREEMENT_STATUS_LABELS: Record<string, string> = {
  active: 'פעיל',
  before_renewal: 'לפני חידוש',
  expired: 'פג תוקף',
  in_progress: 'בטיפול',
  stopped: 'הופסק',
};

/** Legacy DB fields — not exposed in fees modal UI */
export const PRICING_BASIS_LABELS: Record<string, string> = {
  fixed: 'קבוע',
  by_scope: 'לפי היקף עבודה',
  by_documents: 'לפי מספר מסמכים',
  by_employees: 'לפי מספר עובדים',
  other: 'אחר',
};

export const DEFAULT_END_ACTION_LABELS: Record<string, string> = {
  auto_renew_year: 'לחדש אוטומטית לשנה',
  remind_contact_client: 'ליצור תזכורת ליצור קשר עם הלקוח',
  increase_price_percent: 'להעלות מחיר באחוז',
  increase_price_amount: 'להעלות מחיר בסכום',
};

export const CHANGE_REASON_LABELS: Record<string, string> = {
  manual: 'עדכון ידני',
  agreement_renewal: 'חידוש הסכם',
  auto_percent: 'העלאה אוטומטית באחוז',
  auto_amount: 'העלאה אוטומטית בסכום',
  service_added: 'הוספת שירות',
  service_removed: 'ביטול שירות',
  service_deactivated: 'השבתת שירות',
  discount_change: 'שינוי הנחה',
  /** סנאפשוט לפני/אחרי שמירה — סה״כ אחרי הנחה לפני מע״מ */
  totals_change: 'עדכון סה״כ (אחרי הנחה, לפני מע״מ)',
  periodic_change: 'שינוי תקופתי',
  other: 'אחר',
};
