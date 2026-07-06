import { normalizeDeliveryEmailFailureReason, validateDeliveryEmailEnvelope } from './delivery-email.pure.js';
let defaultDepsPromise = null;
async function loadDefaultDeps() {
    if (!defaultDepsPromise) {
        defaultDepsPromise = (async () => {
            const [{ resolveEmailProvider }, { createEmailDeliveryAdapter }] = await Promise.all([
                import('../../shared/owner-email-provider-config.service.js'),
                import('../../shared/email-delivery.adapter.js'),
            ]);
            return {
                resolveProvider: resolveEmailProvider,
                createAdapter: createEmailDeliveryAdapter,
                sendViaAdapter: (adapter, input) => adapter.sendEmail(input),
            };
        })();
    }
    return defaultDepsPromise;
}
function envelopeToSendInput(envelope) {
    return {
        to: envelope.to.trim(),
        reply_to: envelope.reply_to?.trim() || null,
        subject: envelope.subject.trim(),
        text: envelope.body_text,
        html: envelope.body_html,
        attachments: envelope.attachments?.map((attachment) => ({
            filename: attachment.filename,
            content_type: attachment.content_type ?? null,
            content_base64: attachment.content_base64 ?? null,
        })),
    };
}
/**
 * Generic module-agnostic email transport.
 * Caller supplies opaque envelope; provider config is resolved per organization.
 */
export async function sendEmail(envelope, deps) {
    validateDeliveryEmailEnvelope(envelope);
    const resolvedDeps = deps ?? (await loadDefaultDeps());
    const provider = await resolvedDeps.resolveProvider(envelope.organizationId);
    if (!provider?.isConfigured) {
        return {
            status: 'failed',
            provider_message_id: null,
            failure_reason: 'email_provider_not_configured',
        };
    }
    try {
        const adapter = resolvedDeps.createAdapter(provider);
        const result = await resolvedDeps.sendViaAdapter(adapter, envelopeToSendInput(envelope));
        return {
            status: 'sent',
            provider_message_id: result.providerMessageId,
            failure_reason: null,
        };
    }
    catch (error) {
        return {
            status: 'failed',
            provider_message_id: null,
            failure_reason: normalizeDeliveryEmailFailureReason(error),
        };
    }
}
