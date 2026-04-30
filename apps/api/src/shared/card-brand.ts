/**
 * Card scheme from PAN prefix (PCI: call only on full number server-side at save).
 * Israeli CAL / Isracard domestic prefixes are heuristics and may overlap with int'l schemes.
 */
export type CardBrandCode =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'diners'
  | 'jcb'
  | 'isracard'
  | 'unknown';

export function inferCardBrand(pan: string): CardBrandCode {
  const d = String(pan).replace(/\D/g, '');
  if (d.length < 4) return 'unknown';

  // American Express (34xx, 37xx only — not every 3xxx)
  if (/^3[47]/.test(d)) return 'amex';

  // JCB (3528–3589)
  const p4 = parseInt(d.slice(0, 4), 10);
  if (!Number.isNaN(p4) && p4 >= 3528 && p4 <= 3589) return 'jcb';

  // Diners / Carte Blanche (standard IIN subset)
  if (/^3(0[0-5]|[68])/.test(d)) return 'diners';

  // Heuristic: many test / legacy cards use 33xx (e.g. 3333); real Amex stays 34/37 above
  if (/^33\d{2}/.test(d)) return 'diners';

  // Israeli CAL / legacy domestic (before generic Visa 4xxx / MC 5xxx)
  if (/^(6360|6361|6388|6390|5075|5866)/.test(d)) return 'isracard';

  // Visa
  if (/^4/.test(d)) return 'visa';

  // Mastercard 51–55
  if (/^5[1-5]/.test(d)) return 'mastercard';

  // Mastercard 2-series (2221–2720)
  const f4b = parseInt(d.slice(0, 4), 10);
  if (!Number.isNaN(f4b) && f4b >= 2221 && f4b <= 2720) return 'mastercard';
  const f6 = parseInt(d.slice(0, 6), 10);
  if (!Number.isNaN(f6) && f6 >= 222100 && f6 <= 272099) return 'mastercard';

  return 'unknown';
}
