/**
 * Issue & Send orchestration — eligibility and recipient resolution (read-model only).
 */

import { badRequest } from '../../shared/errors.js';
import { normalizeIncomeDocumentRecipientEmail } from './income-document-email-delivery.pure.js';

export function resolveDraftDeliveryContactEmail(
  deliveryContactJson: unknown,
): string | null {
  if (!deliveryContactJson || typeof deliveryContactJson !== 'object') return null;
  const raw = (deliveryContactJson as { email?: unknown }).email;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return normalizeIncomeDocumentRecipientEmail(raw);
  } catch {
    return null;
  }
}

export function resolveIssueAndSendRecipientEmail(params: {
  body_recipient_email: unknown;
  draft_delivery_contact_json: unknown;
}): string {
  const bodyEmail =
    params.body_recipient_email != null && String(params.body_recipient_email).trim()
      ? String(params.body_recipient_email).trim()
      : null;
  if (bodyEmail) return normalizeIncomeDocumentRecipientEmail(bodyEmail);
  const draftEmail = resolveDraftDeliveryContactEmail(params.draft_delivery_contact_json);
  if (draftEmail) return draftEmail;
  throw badRequest('recipient_email is required');
}
