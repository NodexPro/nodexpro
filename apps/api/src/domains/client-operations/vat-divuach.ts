/**
 * חישוב יעדי דיווח מע״מ (PCN = עד 23 לחודש; רגיל = עד 19 לחודש).
 * דו-חודשי: חודשים 1,3,5,7,9,11 (ינואר, מרץ, מאי, יולי, ספטמבר, נובמבר).
 * מקור לתזכורות עתידיות ולתצוגה ברשימה.
 */

const BI_MONTHLY_REPORT_MONTHS = [0, 2, 4, 6, 8, 10] as const;

function dateOnlyLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateHeDots(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function toIsoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextMonthlyDue(dayOfMonth: number, from: Date): Date | null {
  const today = dateOnlyLocal(from);
  for (let i = 0; i < 24; i++) {
    const probe = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const y = probe.getFullYear();
    const m = probe.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const dom = Math.min(dayOfMonth, lastDay);
    const candidate = new Date(y, m, dom);
    if (candidate >= today) return candidate;
  }
  return null;
}

function nextBiMonthlyDue(dayOfMonth: number, from: Date): Date | null {
  const today = dateOnlyLocal(from);
  for (let i = 0; i < 36; i++) {
    const probe = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const y = probe.getFullYear();
    const m = probe.getMonth();
    if (!(BI_MONTHLY_REPORT_MONTHS as readonly number[]).includes(m)) continue;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const dom = Math.min(dayOfMonth, lastDay);
    const candidate = new Date(y, m, dom);
    if (candidate >= today) return candidate;
  }
  return null;
}

export type VatDivuachInput = {
  vat_due_type: string | null;
  vat_frequency: string | null;
  now?: Date;
};

/** תאריך יעד דיווח הבא (מקומי), או null אם לא חל */
export function computeNextVatDivuachDueDate(params: VatDivuachInput): Date | null {
  const { vat_due_type, vat_frequency } = params;
  const now = params.now ?? new Date();
  if (!vat_due_type || vat_due_type === 'not_relevant') return null;
  if (!vat_frequency || vat_frequency === 'not_relevant') return null;
  if (vat_due_type !== 'pcn' && vat_due_type !== 'regular') return null;

  const dayOfMonth = vat_due_type === 'pcn' ? 23 : 19;

  if (vat_frequency === 'monthly') {
    return nextMonthlyDue(dayOfMonth, now);
  }
  if (vat_frequency === 'bi_monthly') {
    return nextBiMonthlyDue(dayOfMonth, now);
  }
  return null;
}

export function formatVatDivuachDisplayHe(d: Date): string {
  return formatDateHeDots(d);
}

/**
 * תצוגה ברשימת לקוחות: PCN כטקסט; רגיל — תאריך יעד הבא (יום 19 + חודש לפי כלל).
 */
/** תצוגת עמודת מע״מ ברשימה — מתאים ל-vat_type ב-client_tax_settings (גיבוי) */
export function mapVatTypeToProfileDisplayHe(vatType: string | null | undefined): string | null {
  if (vatType == null || vatType === '') return null;
  switch (vatType) {
    case 'yes':
      return 'כן';
    case 'no':
      return 'לא';
    case 'patur':
      return 'פטור';
    default:
      return vatType;
  }
}

const OSEK_PATUR_BUSINESS_TYPE_HE = 'עוסק פטור';

/**
 * עמודת «מע״מ» ברשימה: תדירות מע״מ (חודשי / דו-חודשי / לא רלוונטי);
 * לסוג עסק עוסק פטור — תמיד «פטור».
 */
export function computeVatRegistryColumnDisplayHe(
  businessType: string | null | undefined,
  vatType: string | null | undefined,
  vatFrequency: string | null | undefined
): string | null {
  if ((businessType ?? '').trim() === OSEK_PATUR_BUSINESS_TYPE_HE) return 'פטור';

  if (vatFrequency === 'monthly') return 'חודשי';
  if (vatFrequency === 'bi_monthly') return 'דו-חודשי';
  if (vatFrequency === 'not_relevant') {
    if (vatType === 'patur') return 'פטור';
    return 'לא רלוונטי';
  }

  return mapVatTypeToProfileDisplayHe(vatType ?? null);
}

export function computeVatDueRegistryDisplayHe(
  vat_due_type: string | null,
  vat_frequency: string | null,
  now = new Date()
): string | null {
  if (!vat_due_type || vat_due_type === 'not_relevant') return null;
  if (!vat_frequency || vat_frequency === 'not_relevant') return null;
  if (vat_due_type === 'pcn') return 'PCN';
  if (vat_due_type === 'regular') {
    const next = computeNextVatDivuachDueDate({ vat_due_type: 'regular', vat_frequency, now });
    if (!next) return null;
    return formatDateHeDots(next);
  }
  return null;
}
