import { badRequest } from '../../shared/errors.js';
import type { ClientOperationsCoreClientRow } from '../client-operations/client-operations-client-core.read.js';
import type { IncomeBrandingResolvedProfile } from './income-document-branding.types.js';
import type { IncomeDocumentType } from './income.types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type IncomeIssuedDocumentEmailReadiness = {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  document_type: IncomeDocumentType;
  document_number: string;
  document_status: string;
  issue_date: string;
  due_date: string | null;
  currency: string | null;
  pdf_render_status: string;
  pdf_asset_id: string | null;
  customer_snapshot_json: Record<string, unknown> | null;
  totals_snapshot_json: Record<string, unknown> | null;
  language: string | null;
};

export function parseIncomeDocumentEmailIdempotencyKey(body: Record<string, unknown>): string {
  const raw = String(body.idempotency_key ?? '').trim();
  if (!raw) throw badRequest('idempotency_key is required');
  if (raw.length > 256) throw badRequest('idempotency_key too long');
  return raw;
}

export function normalizeIncomeDocumentRecipientEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email) throw badRequest('recipient_email is required');
  if (!EMAIL_RE.test(email)) throw badRequest('recipient_email is invalid');
  return email;
}

export function buildIncomeDocumentEmailDeliveryIdempotencyKey(
  incomeDocumentId: string,
  idempotencyKey: string,
): string {
  return `income:email:${incomeDocumentId}:${idempotencyKey}`;
}

export function assertIncomeDocumentReadyForEmailSend(doc: IncomeIssuedDocumentEmailReadiness): void {
  if (doc.document_status !== 'issued') {
    throw badRequest('Document must be issued before email delivery');
  }
  if (doc.pdf_render_status !== 'rendered') {
    throw badRequest('Document PDF is not ready for email delivery');
  }
  if (!doc.pdf_asset_id) {
    throw badRequest('Document PDF attachment is not available');
  }
}

export function assertIncomeRepresentedClientScopeForEmailSend(representedClientId: string | null): string {
  if (!representedClientId) {
    throw badRequest('Email delivery requires an active represented client scope');
  }
  return representedClientId;
}

export function buildIncomeEmailSenderSnapshot(client: ClientOperationsCoreClientRow): Record<string, unknown> {
  return {
    source: 'client_operations_core',
    client_id: client.id,
    display_name: client.display_name,
    email: client.email,
    phone: client.phone,
    tax_id: client.tax_id,
    business_type: client.business_type,
  };
}

export function customerDisplayNameFromSnapshot(snapshot: Record<string, unknown> | null): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const name = snapshot.display_name;
  return name != null && String(name).trim() ? String(name).trim() : null;
}

export function renderIncomeEmailTemplate(
  template: string | null | undefined,
  values: Record<string, string>,
): string {
  if (!template?.trim()) return '';
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result.trim();
}

export function buildIncomeDocumentEmailTemplateValues(params: {
  documentTypeLabel: string;
  documentNumber: string;
  clientName: string | null;
  businessName: string;
}): Record<string, string> {
  return {
    document_type: params.documentTypeLabel,
    document_number: params.documentNumber,
    client_name: params.clientName ?? '',
    business_name: params.businessName,
  };
}

export function appendIncomeEmailFooter(bodyText: string, footerText: string | null | undefined): string {
  const footer = String(footerText ?? '').trim();
  if (!footer) return bodyText.trim();
  if (!bodyText.trim()) return footer;
  return `${bodyText.trim()}\n\n${footer}`;
}

export function incomeEmailTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<div dir="auto" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escaped.replace(/\n/g, '<br>')}</div>`;
}

export function buildIncomeDocumentEmailMessage(params: {
  branding: IncomeBrandingResolvedProfile;
  templateValues: Record<string, string>;
  replyTo: string | null;
}): {
  subject: string;
  body_text: string;
  body_html: string;
  reply_to: string | null;
  message_snapshot_json: Record<string, unknown>;
} {
  const subject = renderIncomeEmailTemplate(params.branding.email_subject_template, params.templateValues);
  const bodyCore = renderIncomeEmailTemplate(params.branding.email_body_template, params.templateValues);
  const body_text = appendIncomeEmailFooter(bodyCore, params.branding.footer_text);
  const body_html = incomeEmailTextToHtml(body_text);

  if (!subject) throw badRequest('Email subject could not be built');
  if (!body_text) throw badRequest('Email body could not be built');

  return {
    subject,
    body_text,
    body_html,
    reply_to: params.replyTo,
    message_snapshot_json: {
      subject,
      body_text,
      body_html,
      reply_to: params.replyTo,
      footer_text: params.branding.footer_text ?? null,
      email_subject_template: params.branding.email_subject_template,
      email_body_template: params.branding.email_body_template,
    },
  };
}
