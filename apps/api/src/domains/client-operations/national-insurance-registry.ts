/** תצוגת עמודת ביטוח לאומי ברשימה — מסכום חודשי במיסים */

export function formatNationalInsuranceRegistryDisplayHe(
  national_insurance_type: string | null | undefined,
  national_insurance_monthly_amount: number | null | undefined
): string | null {
  if (national_insurance_type === 'yes') {
    if (national_insurance_monthly_amount == null || Number.isNaN(Number(national_insurance_monthly_amount))) {
      return null;
    }
    return `${new Intl.NumberFormat('he-IL').format(Number(national_insurance_monthly_amount))}\u00A0₪`;
  }
  if (national_insurance_type === 'not_applicable') return 'לא עונה להגדרות';
  return null;
}
