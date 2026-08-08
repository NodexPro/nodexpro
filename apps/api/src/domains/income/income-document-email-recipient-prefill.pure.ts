/**
 * Issued-document email recipient prefill.
 *
 * Proven from existing Income draft/issue/send architecture:
 * - Wizard seeds delivery_contact from income_customers.email / one-time snapshot email
 * - Issue & Send prefers draft delivery_contact when body recipient is absent
 * - Issue freezes customer email into customer_snapshot_json
 *
 * Represented Core client email is the issuer scope — never the invoice recipient.
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
 * Priority (existing Income delivery ownership):
 * 1) explicit draft delivery_contact.email
 * 2) live income_customers.email (canonical invoice customer)
 * 3) frozen customer_snapshot_json.email (one-time / issued snapshot)
 * 4) empty — UI remains manually editable when send policy allows
 */
export function resolveIssuedDocumentEmailRecipientPrefill(params: {
  draftDeliveryContactJson: unknown;
  incomeCustomerEmail: string | null | undefined;
  customerSnapshotJson: Record<string, unknown> | null | undefined;
}): string | null {
  return (
    resolveDraftDeliveryContactEmail(params.draftDeliveryContactJson) ??
    normalizeIncomeDocumentRecipientEmailPrefill(params.incomeCustomerEmail) ??
    resolveCustomerSnapshotEmail(params.customerSnapshotJson)
  );
}
