import { badRequest } from '../../shared/errors.js';
export function validateDeliveryEmailEnvelope(envelope) {
    if (!String(envelope.organizationId ?? '').trim()) {
        throw badRequest('organization_id is required');
    }
    const to = String(envelope.to ?? '').trim();
    if (!to || !to.includes('@')) {
        throw badRequest('to is required');
    }
    if (!String(envelope.subject ?? '').trim()) {
        throw badRequest('subject is required');
    }
    if (!String(envelope.body_text ?? '').trim() && !String(envelope.body_html ?? '').trim()) {
        throw badRequest('body_text or body_html is required');
    }
    if (envelope.attachments) {
        for (const attachment of envelope.attachments) {
            if (!String(attachment.filename ?? '').trim()) {
                throw badRequest('attachment filename is required');
            }
            if (!String(attachment.content_base64 ?? '').trim()) {
                throw badRequest('attachment content_base64 is required');
            }
        }
    }
}
export function normalizeDeliveryEmailFailureReason(error) {
    if (error instanceof Error) {
        const message = error.message.trim();
        if (message.startsWith('email_send_failed:')) {
            return message.slice('email_send_failed:'.length) || 'email_send_failed';
        }
        return message || 'email_send_failed';
    }
    return 'email_send_failed';
}
