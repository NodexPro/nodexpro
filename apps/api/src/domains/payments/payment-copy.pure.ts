export type PaymentUiLang = 'en' | 'he';

type Copy = Record<string, string>;

const EN: Copy = {
  owner_title: 'Payments',
  owner_subtitle: 'Payment providers, platform billing, office connections, and diagnostics. No live adapter is connected.',
  tab_providers: 'Payment Providers',
  tab_platform_billing: 'Platform Billing',
  tab_office_providers: 'Office Payment Providers',
  tab_transactions: 'Transactions',
  tab_subscriptions: 'Subscriptions',
  tab_diagnostics: 'Diagnostics',
  catalog_only: 'Catalog only — not connected',
  no_ready_adapter: 'No signed payment adapter is ready. Credentials cannot be stored for catalog-only providers.',
  platform_seller: 'NodexPro platform seller context. Office customer receipts are never recorded here.',
  office_seller: 'Office seller context. Platform subscription income is never recorded here.',
  checkout_blocked: 'Checkout stays disabled until a real adapter is ready.',
  empty_transactions: 'No payment transactions.',
  empty_subscriptions: 'No platform billing subscriptions. Recurring collection requires a real adapter.',
  diagnostics_note: 'Webhook verification, replay protection, and entitlement activation are prepared. Client-side success redirects are not payment proof.',
  office_title: 'Payments & Processing',
  office_lead: 'Choose how this office collects payments. Both paths stay unavailable until a signed provider adapter exists.',
  external_title: 'Connect Existing Provider',
  external_body: 'Connect the office merchant account of a supported provider. API keys are not accepted until an adapter is ready.',
  embedded_title: 'NodexPro Integrated Payments',
  embedded_body: 'Onboard through a NodexPro partner with a separate merchant or sub-merchant account. Activation waits for provider confirmation.',
  unavailable: 'Not available yet',
  unavailable_steps: 'Required: signed provider contract, live adapter, webhook secrets, and merchant/KYC flow. Do not paste API keys here.',
  start_external: 'Start independent connection',
  start_embedded: 'Start integrated onboarding',
  disconnect: 'Disconnect',
  back_to_settings: 'Back to Settings',
};

const HE: Copy = {
  owner_title: 'תשלומים',
  owner_subtitle: 'ספקי סליקה, חיוב פלטפורמה, חיבורי משרדים ואבחון. אין מתאם חי שמחובר.',
  tab_providers: 'ספקי סליקה',
  tab_platform_billing: 'חיוב פלטפורמה',
  tab_office_providers: 'סליקה למשרדים',
  tab_transactions: 'עסקאות',
  tab_subscriptions: 'מנויים',
  tab_diagnostics: 'אבחון',
  catalog_only: 'קטלוג בלבד — לא מחובר',
  no_ready_adapter: 'אין מתאם סליקה חתום. לא ניתן לשמור מפתחות לספקים בקטלוג בלבד.',
  platform_seller: 'הקשר המוכר הוא NodexPro. קבלות לקוחות המשרד לא נרשמות כאן.',
  office_seller: 'הקשר המוכר הוא המשרד. הכנסות מנוי הפלטפורמה לא נרשמות כאן.',
  checkout_blocked: 'התשלום יישאר כבוי עד שיהיה מתאם אמיתי.',
  empty_transactions: 'אין עסקאות תשלום.',
  empty_subscriptions: 'אין מנויי חיוב פלטפורמה. גבייה חוזרת דורשת מתאם אמיתי.',
  diagnostics_note: 'אימות webhook, הגנה מפני replay והפעלת מקומות מוכנים. הפניה מהדפדפן אינה אישור תשלום.',
  office_title: 'תשלומים וסליקה',
  office_lead: 'בחרו איך המשרד יגבה תשלומים. שני המסלולים אינם זמינים עד שיהיה מתאם ספק חתום.',
  external_title: 'חיבור עצמאי',
  external_body: 'חיבור חשבון הסליקה הקיים של המשרד. מפתחות API לא מתקבלים עד שיהיה מתאם מוכן.',
  embedded_title: 'סליקה מובנית',
  embedded_body: 'הרשמה דרך שותף NodexPro עם חשבון סוחר נפרד. ההפעלה ממתינה לאישור הספק.',
  unavailable: 'עדיין לא זמין',
  unavailable_steps: 'נדרשים: חוזה ספק, מתאם חי, סודות webhook ותהליך KYC. אל תדביקו כאן מפתחות API.',
  start_external: 'התחלת חיבור עצמאי',
  start_embedded: 'התחלת סליקה מובנית',
  disconnect: 'ניתוק',
  back_to_settings: 'חזרה להגדרות',
};

export function paymentCopy(lang: PaymentUiLang): Copy {
  return lang === 'he' ? HE : EN;
}

export function paymentUiLang(raw: string | null | undefined): PaymentUiLang {
  return raw === 'he' ? 'he' : 'en';
}
