/** Mirrors API `inferCardBrand` for live preview in card entry modal only. */
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
  if (/^3[47]/.test(d)) return 'amex';
  const p4 = parseInt(d.slice(0, 4), 10);
  if (!Number.isNaN(p4) && p4 >= 3528 && p4 <= 3589) return 'jcb';
  if (/^3(0[0-5]|[68])/.test(d)) return 'diners';
  if (/^33\d{2}/.test(d)) return 'diners';
  if (/^(6360|6361|6388|6390|5075|5866)/.test(d)) return 'isracard';
  if (/^4/.test(d)) return 'visa';
  if (/^5[1-5]/.test(d)) return 'mastercard';
  const f4 = parseInt(d.slice(0, 4), 10);
  if (!Number.isNaN(f4) && f4 >= 2221 && f4 <= 2720) return 'mastercard';
  const f6 = parseInt(d.slice(0, 6), 10);
  if (!Number.isNaN(f6) && f6 >= 222100 && f6 <= 272099) return 'mastercard';
  return 'unknown';
}
