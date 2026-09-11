import type { TaxFactValueType } from './tax-fact-dictionary.types.js';

export type IlStarterEnumOption = {
  code: string;
  sort_order: number;
  he_label: string;
};

export type IlStarterFactSpec = {
  fact_key: string;
  semantic_title: string;
  owner_note: string;
  value_type: TaxFactValueType;
  currency_policy: { required: boolean; allowed_currencies: string[] } | null;
  he_label: string;
  he_professional_question: string;
  he_help_text: string;
  enum_options: IlStarterEnumOption[];
};

/** High-confidence IL starter facts. Canonical keys are language-neutral. Hebrew is presentation only. */
export const IL_STARTER_FACT_SPECS: readonly IlStarterFactSpec[] = [
  {
    fact_key: 'date_of_birth',
    semantic_title: 'Date of birth',
    owner_note: 'Actual calendar date of birth. Raw client identity, not a computed age or tax conclusion.',
    value_type: 'date',
    currency_policy: null,
    he_label: 'תאריך לידה',
    he_professional_question: 'מהו תאריך הלידה של הלקוח?',
    he_help_text: 'תאריך הלידה בפועל. אינו גיל מחושב ואינו מסקנת תושבות או זכאות.',
    enum_options: [],
  },
  {
    fact_key: 'marital_status',
    semantic_title: 'Marital status',
    owner_note: 'Client-stated civil status. Engine consumes enum codes, never translated labels.',
    value_type: 'enum',
    currency_policy: null,
    he_label: 'מצב משפחתי',
    he_professional_question: 'מהו המצב המשפחתי של הלקוח?',
    he_help_text: 'סטטוס אזרחי מוצהר. המנוע משתמש בקוד המכונה בלבד, לא בתווית העברית.',
    enum_options: [
      { code: 'single', sort_order: 10, he_label: 'רווק/ה' },
      { code: 'married', sort_order: 20, he_label: 'נשוי/אה' },
      { code: 'divorced', sort_order: 30, he_label: 'גרוש/ה' },
      { code: 'widowed', sort_order: 40, he_label: 'אלמן/ה' },
    ],
  },
  {
    fact_key: 'tax_residency_country',
    semantic_title: 'Stated tax-residency country',
    owner_note:
      'Client-stated ISO 3166-1 alpha-2 country of tax residence. Not a legal determination of residency_status.',
    value_type: 'string',
    currency_policy: null,
    he_label: 'מדינת תושבות לצורכי מס (מוצהרת)',
    he_professional_question: 'באיזו מדינה הלקוח מצהיר על תושבות לצורכי מס? (קוד ISO דו-אותי)',
    he_help_text: 'קוד מדינה מוצהר על ידי הלקוח. אינו קביעה משפטית של תושב/תושב חוזר/תושב חוץ.',
    enum_options: [],
  },
  {
    fact_key: 'residence_city',
    semantic_title: 'Residence city',
    owner_note: 'Client-stated locality of residence. Raw address fact, not Core client card address ownership.',
    value_type: 'string',
    currency_policy: null,
    he_label: 'יישוב מגורים',
    he_professional_question: 'מהו יישוב המגורים של הלקוח?',
    he_help_text: 'יישוב המגורים המוצהר. אינו כתובת לקוח במודול הליבה ואינו מסקנת תושבות.',
    enum_options: [],
  },
  {
    fact_key: 'residence_since',
    semantic_title: 'Residence since date',
    owner_note: 'Date the client started living in the stated residence locality.',
    value_type: 'date',
    currency_policy: null,
    he_label: 'תאריך תחילת מגורים ביישוב',
    he_professional_question: 'ממתי הלקוח מתגורר ביישוב זה?',
    he_help_text: 'תאריך תחילת המגורים ביישוב המוצהר. אינו תאריך עלייה.',
    enum_options: [],
  },
  {
    fact_key: 'aliyah_date',
    semantic_title: 'Aliyah date',
    owner_note: 'Date of aliyah if applicable. Raw client event date, not returning-resident legal status.',
    value_type: 'date',
    currency_policy: null,
    he_label: 'תאריך עלייה',
    he_professional_question: 'מהו תאריך העלייה, אם חל?',
    he_help_text: 'תאריך עלייה בפועל. אינו סטטוס תושב חוזר ואינו זכאות למסלול מס.',
    enum_options: [],
  },
  {
    fact_key: 'business_start_date',
    semantic_title: 'Business activity start date',
    owner_note:
      'Date business activity began for advisory facts. Parallel Core profile dates are not this Fact Dictionary identity.',
    value_type: 'date',
    currency_policy: null,
    he_label: 'תאריך תחילת הפעילות העסקית',
    he_professional_question: 'מתי החלה הפעילות העסקית?',
    he_help_text: 'תאריך תחילת הפעילות העסקית לצורכי עובדות ייעוץ. אינו סוג עוסק ואינו המלצת רישום.',
    enum_options: [],
  },
  {
    fact_key: 'expected_annual_business_revenue',
    semantic_title: 'Expected annual business revenue',
    owner_note:
      'Forecast annual business turnover for the relevant tax year. Not actual recorded revenue. Currency is ILS.',
    value_type: 'money',
    currency_policy: { required: true, allowed_currencies: ['ILS'] },
    he_label: 'מחזור עסקי שנתי צפוי',
    he_professional_question: 'מהו המחזור העסקי השנתי הצפוי (ILS)?',
    he_help_text: 'תחזית מחזור לשנת המס הרלוונטית, לא מחזור בפועל ולא הכנסה מחושבת.',
    enum_options: [],
  },
  {
    fact_key: 'expected_annual_business_expenses',
    semantic_title: 'Expected annual business expenses',
    owner_note:
      'Forecast annual business expenses for the relevant tax year. Not actual recorded expenses. Currency is ILS.',
    value_type: 'money',
    currency_policy: { required: true, allowed_currencies: ['ILS'] },
    he_label: 'הוצאות עסקיות שנתיות צפויות',
    he_professional_question: 'מהן ההוצאות העסקיות השנתיות הצפויות (ILS)?',
    he_help_text: 'תחזית הוצאות לשנת המס הרלוונטית, לא הוצאות בפועל ולא תוצאה חשבונאית.',
    enum_options: [],
  },
];

export const IL_STARTER_FACT_KEYS = IL_STARTER_FACT_SPECS.map((row) => row.fact_key);

/** Concepts audited and deferred: too broad, derived, or period-ambiguous for this slice. */
export const IL_STARTER_DEFERRED_FACTS = [
  {
    proposed_key: 'children',
    reason: 'Israeli credits and benefits depend on per-child age, custody, and residency. A single aggregate children fact would be semantically wrong. A full family model is out of scope.',
  },
  {
    proposed_key: 'child_count',
    reason: 'Count-only identity hides legally material child attributes. Same family-model risk as children.',
  },
  {
    proposed_key: 'returning_resident_status',
    reason: 'This is a legal residency category, not raw client-stated input. Fact Dictionary must not own tax conclusions.',
  },
  {
    proposed_key: 'business_activity_type',
    reason: 'Ambiguous taxonomy: occupation vs legal form vs VAT classification. No stable language-neutral enum without inventing legal meaning.',
  },
  {
    proposed_key: 'employment_income',
    reason: 'Period semantics are unspecified (annual vs monthly vs tax-year). Do not create an ambiguous money fact.',
  },
  {
    proposed_key: 'other_income',
    reason: 'Source and period are unspecified. Too vague for a stable canonical money fact.',
  },
  {
    proposed_key: 'prior_year_losses',
    reason: 'Loss year, type, and carry-forward legal character are unspecified. Period-ambiguous money fact.',
  },
  {
    proposed_key: 'military_service_status',
    reason: 'Israeli service categories and legal effects are not a high-confidence closed enum yet.',
  },
  {
    proposed_key: 'military_discharge_date',
    reason: 'Depends on the deferred military_service_status model; not independently canonical in this slice.',
  },
  {
    proposed_key: 'pension_contributions',
    reason: 'Period, fund type, and employee vs employer split are unspecified.',
  },
  {
    proposed_key: 'donations',
    reason: 'Period, recognized-institution status, and receipt identity are unspecified. Too vague for a money fact.',
  },
] as const;
