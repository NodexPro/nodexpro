/**
 * Provider adapter contract. No adapter may confirm payment without PSP verification.
 * Catalog-only providers never implement confirm.
 */

import type { PaymentProviderCapabilities, PaymentScenario } from './payment-provider-catalog.pure.js';

export type PaymentAdapterResult =
  | { ok: false; code: 'PAYMENT_ADAPTER_NOT_READY' | 'PAYMENT_SIGNATURE_INVALID' | 'PAYMENT_EVENT_DUPLICATE' }
  | { ok: true; verified: true; provider_event_id: string };

export type PaymentAdapter = {
  code: string;
  capabilities: PaymentProviderCapabilities;
  verifyWebhook(input: { headers: Record<string, string>; rawBody: string; secret: string }): PaymentAdapterResult;
};

export function catalogOnlyAdapter(code: string, capabilities: PaymentProviderCapabilities): PaymentAdapter {
  return {
    code,
    capabilities,
    verifyWebhook() {
      return { ok: false, code: 'PAYMENT_ADAPTER_NOT_READY' };
    },
  };
}

export function resolveAdapterOrUnavailable(input: {
  adapterStatus: string;
  code: string;
  capabilities: PaymentProviderCapabilities;
}): PaymentAdapter | null {
  if (input.adapterStatus !== 'ready') return catalogOnlyAdapter(input.code, input.capabilities);
  return null;
}

export function clientRedirectIsNotPaymentProof(_redirectStatus: string | null | undefined): true {
  return true;
}

export function sellerContextForScenario(scenario: PaymentScenario): 'nodexpro_platform' | 'office' {
  return scenario === 'PLATFORM_BILLING' ? 'nodexpro_platform' : 'office';
}
