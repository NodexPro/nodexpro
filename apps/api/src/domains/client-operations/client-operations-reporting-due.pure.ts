import { parseReportingPeriodKey } from '../country-pack/reporting-calendar.pure.js';

/** Period identity for VAT on a selected registry month (monthly any month; bi-monthly pair start). */
export function vatPeriodIdentityForSelectedPeriod(
  vatFrequency: string | null | undefined,
  selectedPeriodKey: string,
): string | null {
  const frequency = String(vatFrequency ?? '')
    .trim()
    .toLowerCase();
  const parsed = parseReportingPeriodKey(selectedPeriodKey);
  if (!parsed) return null;
  if (frequency === 'monthly') return selectedPeriodKey;
  if (frequency === 'bi_monthly') {
    if (parsed.month % 2 === 1) return selectedPeriodKey;
    const startMonth = parsed.month - 1;
    if (startMonth < 1) return `${parsed.year - 1}-11`;
    return `${parsed.year}-${String(startMonth).padStart(2, '0')}`;
  }
  return null;
}
