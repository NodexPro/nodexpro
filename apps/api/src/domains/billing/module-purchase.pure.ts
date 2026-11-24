import { moneyWithVat } from '../modules/staff-seat-entitlement.pure.js';
import { formatSeatMoneyAmount } from '../payments/staff-seat-purchase-quote.pure.js';

export type ModulePurchaseQuote = {
  module_id: string;
  module_plan_id: string;
  currency: string;
  billing_period: string;
  unit_price_net: number;
  net_amount: number;
  vat_rate: number;
  vat_percent_label: string;
  vat_amount: number;
  total_amount: number;
  vat_authoritative: boolean;
  checkout_available: false;
  pay_enabled: false;
  labels: { unit: string; net: string; vat: string; total: string };
};

export function buildModulePurchaseQuote(input: {
  moduleId: string;
  modulePlanId: string;
  unitPriceNet: number;
  currency: string;
  billingPeriod: string;
  vatRate: number;
  vatPercentLabel: string;
  vatAuthoritative: boolean;
}): ModulePurchaseQuote {
  const net = Math.max(0, Number(input.unitPriceNet) || 0);
  const vatRate = input.vatAuthoritative ? Number(input.vatRate) || 0 : 0;
  const total = input.vatAuthoritative ? moneyWithVat(net, vatRate) : net;
  const vatAmount = Math.round((total - net) * 100) / 100;
  const currency = String(input.currency ?? 'ILS').trim().toUpperCase() || 'ILS';
  return {
    module_id: input.moduleId,
    module_plan_id: input.modulePlanId,
    currency,
    billing_period: input.billingPeriod === 'year' ? 'year' : 'month',
    unit_price_net: net,
    net_amount: net,
    vat_rate: vatRate,
    vat_percent_label: input.vatAuthoritative ? input.vatPercentLabel : '',
    vat_amount: vatAmount,
    total_amount: total,
    vat_authoritative: input.vatAuthoritative,
    checkout_available: false,
    pay_enabled: false,
    labels: {
      unit: formatSeatMoneyAmount(net, currency),
      net: formatSeatMoneyAmount(net, currency),
      vat: input.vatAuthoritative ? formatSeatMoneyAmount(vatAmount, currency) : '',
      total: input.vatAuthoritative ? formatSeatMoneyAmount(total, currency) : '',
    },
  };
}

export function canActivateModulePurchase(input: {
  intentStatus: string;
  paymentVerified: boolean;
  alreadyActivated: boolean;
}): { ok: true } | { ok: false; code: 'NOT_PAID' | 'ALREADY_ACTIVATED' | 'INVALID_STATUS' } {
  if (input.alreadyActivated || input.intentStatus === 'activated') {
    return { ok: false, code: 'ALREADY_ACTIVATED' };
  }
  if (!input.paymentVerified) return { ok: false, code: 'NOT_PAID' };
  if (!['quoted', 'pending_payment', 'paid_pending_activation'].includes(input.intentStatus)) {
    return { ok: false, code: 'INVALID_STATUS' };
  }
  return { ok: true };
}
