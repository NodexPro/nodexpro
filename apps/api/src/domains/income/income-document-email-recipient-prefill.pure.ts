/**
 * Issued-document email recipient prefill for a NEW send action.
 *
 * Proven ownership:
 * - represented_client = issuer scope (never Email recipient)
 * - income_customers.email = current delivery contact for saved customers
 * - customer_snapshot_json = frozen issued/legal history (+ one-time fallback)
 * - draft delivery_contact is auto-seeded with snapshot_only:true on create AND on
 *   update_income_document_delivery_contact — there is NO canonical flag proving
 *   an accountant explicit override vs auto-seed. Therefore delivery_contact must
 *   NOT override live saved-customer email for new send defaults.
 */

import { resolveDraftDeliveryContactEmail } from './income-document-issue-and-send.pure.js';

export function normalizeIncomeDocumentRecipientEmailPrefill(
  email: string | null | undefined,
): string | null {
  const trimmed = email != null ? String(email).trim() : '';
  return trimmed ? trimmed : null;
}

/** @deprecated Use normalizeIncomeDocumentRecipientEmailPrefill */
export const normalizeRepresentedClientRecipientEmailPrefill =
  normalizeIncomeDocumentRecipientEmailPrefill;

export function resolveCustomerSnapshotEmail(
  customerSnapshotJson: Record<string, unknown> | null | undefined,
): string | null {
  if (!customerSnapshotJson || typeof customerSnapshotJson !== 'object') return null;
  return normalizeIncomeDocumentRecipientEmailPrefill(
    customerSnapshotJson.email != null ? String(customerSnapshotJson.email) : null,
  );
}

/**
 * Canonical V1 priority for NEW send modal default:
 * A) saved income_customer_id → live income_customers.email
 *    then snapshot fallback if live email absent
 * B) one-time / no live customer row → delivery_contact then snapshot
 * C/D) empty when nothing available
 *
 * Historical delivery_attempts are unrelated and must not be rewritten.
 */
export function resolveIssuedDocumentEmailRecipientPrefill(params: {
  incomeCustomerId: string | null | undefined;
  draftDeliveryContactJson: unknown;
  incomeCustomerEmail: string | null | undefined;
  customerSnapshotJson: Record<string, unknown> | null | undefined;
}): string | null {
  const live = normalizeIncomeDocumentRecipientEmailPrefill(params.incomeCustomerEmail);
  const snapshot = resolveCustomerSnapshotEmail(params.customerSnapshotJson);
  const delivery = resolveDraftDeliveryContactEmail(params.draftDeliveryContactJson);
  const hasSavedCustomer =
    params.incomeCustomerId != null && String(params.incomeCustomerId).trim() !== '';

  if (hasSavedCustomer) {
    return live ?? snapshot;
  }
  return delivery ?? snapshot;
}
