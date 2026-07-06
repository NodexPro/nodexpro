import { badRequest } from '../../shared/errors.js';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function parseIncomeDocumentEmailIdempotencyKey(body) {
    const raw = String(body.idempotency_key ?? '').trim();
    if (!raw)
        throw badRequest('idempotency_key is required');
    if (raw.length > 256)
        throw badRequest('idempotency_key too long');
    return raw;
}
export function normalizeIncomeDocumentRecipientEmail(value) {
    const email = String(value ?? '').trim().toLowerCase();
    if (!email)
        throw badRequest('recipient_email is required');
    if (!EMAIL_RE.test(email))
        throw badRequest('recipient_email is invalid');
    return email;
}
export function buildIncomeDocumentEmailDeliveryIdempotencyKey(incomeDocumentId, idempotencyKey) {
    return `income:email:${incomeDocumentId}:${idempotencyKey}`;
}
export function assertIncomeDocumentReadyForEmailSend(doc) {
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
export function assertIncomeRepresentedClientScopeForEmailSend(representedClientId) {
    if (!representedClientId) {
        throw badRequest('Email delivery requires an active represented client scope');
    }
    return representedClientId;
}
export function buildIncomeEmailSenderSnapshot(client) {
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
export function customerDisplayNameFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object')
        return null;
    const name = snapshot.display_name;
    return name != null && String(name).trim() ? String(name).trim() : null;
}
export function renderIncomeEmailTemplate(template, values) {
    if (!template?.trim())
        return '';
    let result = template;
    for (const [key, value] of Object.entries(values)) {
        result = result.split(`{{${key}}}`).join(value);
    }
    return result.trim();
}
export function buildIncomeDocumentEmailTemplateValues(params) {
    return {
        document_type: params.documentTypeLabel,
        document_number: params.documentNumber,
        client_name: params.clientName ?? '',
        business_name: params.businessName,
    };
}
export function appendIncomeEmailFooter(bodyText, footerText) {
    const footer = String(footerText ?? '').trim();
    if (!footer)
        return bodyText.trim();
    if (!bodyText.trim())
        return footer;
    return `${bodyText.trim()}\n\n${footer}`;
}
export function incomeEmailTextToHtml(text) {
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<div dir="auto" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escaped.replace(/\n/g, '<br>')}</div>`;
}
export function buildIncomeDocumentEmailMessage(params) {
    const subject = renderIncomeEmailTemplate(params.branding.email_subject_template, params.templateValues);
    const bodyCore = renderIncomeEmailTemplate(params.branding.email_body_template, params.templateValues);
    const body_text = appendIncomeEmailFooter(bodyCore, params.branding.footer_text);
    const body_html = incomeEmailTextToHtml(body_text);
    if (!subject)
        throw badRequest('Email subject could not be built');
    if (!body_text)
        throw badRequest('Email body could not be built');
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
