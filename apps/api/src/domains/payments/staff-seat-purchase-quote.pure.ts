import { moneyWithVat } from '../modules/staff-seat-entitlement.pure.js';

export type StaffSeatPurchaseQuote = {
  quantity: number;
  currency: string;
  billing_period: string;
  unit_price_net: number;
  net_amount: number;
  vat_rate: number;
  vat_percent_label: string;
  vat_amount: number;
  total_amount: number;
  price_source: 'office_commercial_terms' | 'platform_catalog';
  catalog_unit_price_net: number;
  checkout_available: false;
  pay_enabled: false;
};

export function normalizeSeatPurchaseQuantity(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 99) return null;
  return value;
}

export function resolveSeatPurchaseUnitNet(input: {
  catalogUnitPrice: number;
  officeCurrentUnitPrice: number | null | undefined;
}): { unit: number; source: 'office_commercial_terms' | 'platform_catalog' } {
  const catalog = Math.max(0, Number(input.catalogUnitPrice) || 0);
  if (input.officeCurrentUnitPrice != null && Number.isFinite(Number(input.officeCurrentUnitPrice))) {
    return { unit: Math.max(0, Number(input.officeCurrentUnitPrice)), source: 'office_commercial_terms' };
  }
  return { unit: catalog, source: 'platform_catalog' };
}

export function buildStaffSeatPurchaseQuote(input: {
  quantity: number;
  catalogUnitPrice: number;
  officeCurrentUnitPrice: number | null | undefined;
  currency: string;
  billingPeriod: string;
  vatRate: number;
  vatPercentLabel: string;
}): StaffSeatPurchaseQuote {
  const quantity = normalizeSeatPurchaseQuantity(input.quantity) ?? 1;
  const priced = resolveSeatPurchaseUnitNet({
    catalogUnitPrice: input.catalogUnitPrice,
    officeCurrentUnitPrice: input.officeCurrentUnitPrice,
  });
  const net = Math.round(priced.unit * quantity * 100) / 100;
  const total = moneyWithVat(net, input.vatRate);
  const vatAmount = Math.round((total - net) * 100) / 100;
  return {
    quantity,
    currency: String(input.currency ?? 'ILS').trim().toUpperCase() || 'ILS',
    billing_period: input.billingPeriod === 'year' ? 'year' : 'month',
    unit_price_net: priced.unit,
    net_amount: net,
    vat_rate: Number(input.vatRate) || 0,
    vat_percent_label: input.vatPercentLabel,
    vat_amount: vatAmount,
    total_amount: total,
    price_source: priced.source,
    catalog_unit_price_net: Math.max(0, Number(input.catalogUnitPrice) || 0),
    checkout_available: false,
    pay_enabled: false,
  };
}

export function canActivateSeatPurchase(input: {
  intentStatus: string;
  paymentVerified: boolean;
  alreadyActivated: boolean;
}): { ok: true } | { ok: false; code: 'NOT_PAID' | 'ALREADY_ACTIVATED' | 'INVALID_STATUS' } {
  if (input.alreadyActivated || input.intentStatus === 'activated') {
    return { ok: false, code: 'ALREADY_ACTIVATED' };
  }
  if (!input.paymentVerified) return { ok: false, code: 'NOT_PAID' };
  if (input.intentStatus !== 'paid_pending_activation' && input.intentStatus !== 'pending_payment') {
    return { ok: false, code: 'INVALID_STATUS' };
  }
  return { ok: true };
}

export function nextPurchasedSeatQuantity(currentPurchased: number, addQuantity: number): number {
  return Math.max(0, Math.floor(currentPurchased)) + Math.max(0, Math.floor(addQuantity));
}

export function formatSeatMoneyAmount(amount: number, currency: string): string {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const code = String(currency ?? 'ILS').trim().toUpperCase() || 'ILS';
  return `${value.toFixed(2)} ${code}`;
}
