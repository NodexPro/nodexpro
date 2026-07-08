/**
 * Platform owner — system center aggregate loader (read only).
 */
import { loadCustomerHealthRows } from './owner-system-health.customer-health.read.js';
import { buildSchedulerSourceNote, loadPlatformHealthRows, } from './owner-system-health.platform-health.read.js';
export async function loadOwnerSystemHealthData(lastCheckedAt) {
    const sourceNotes = [
        {
            source_key: 'database_ping',
            status: 'included',
            reason: 'Database ping included in platform health.',
        },
        buildSchedulerSourceNote(),
        {
            source_key: 'customer_health',
            status: 'partial',
            reason: `Customer health scan is bounded to organization issue candidates.`,
        },
        {
            source_key: 'billing_email',
            status: 'included',
            reason: 'Billing email uses organization owner email when separate billing email is unavailable.',
        },
        {
            source_key: 'delivery_attempts',
            status: 'included',
            reason: 'Failed delivery_attempts grouped platform-wide and per organization.',
        },
        {
            source_key: 'income_pdf',
            status: 'included',
            reason: 'income_documents with pdf_render_status=failed.',
        },
        {
            source_key: 'work_events',
            status: 'included',
            reason: 'work_events with processing_status=failed.',
        },
        {
            source_key: 'unsupported_event_versions',
            status: 'included',
            reason: 'Derived from persisted work_events.processing_error when unsupported schema version is recorded.',
        },
        {
            source_key: 'owner_email_provider_configs',
            status: 'included',
            reason: 'SMTP disconnected detected from owner_email_provider_configs.is_configured.',
        },
    ];
    const [{ rows: platformHealthRows, legacyRows }, customerHealthRows] = await Promise.all([
        loadPlatformHealthRows(lastCheckedAt),
        loadCustomerHealthRows(),
    ]);
    return {
        platformHealthRows,
        customerHealthRows,
        legacyRows,
        sourceNotes,
    };
}
