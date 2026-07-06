/**
 * Caller-supplied opaque email envelope — Delivery does not interpret business meaning.
 */

export type DeliveryEmailAttachment = {
  filename: string;
  content_type?: string | null;
  content_base64?: string | null;
};

export type DeliveryEmailEnvelope = {
  organizationId: string;
  to: string;
  reply_to?: string | null;
  subject: string;
  body_text: string;
  body_html: string;
  attachments?: DeliveryEmailAttachment[];
};

export type DeliveryEmailSendStatus = 'sent' | 'failed';

export type DeliveryEmailSendResult = {
  status: DeliveryEmailSendStatus;
  provider_message_id: string | null;
  failure_reason: string | null;
};
