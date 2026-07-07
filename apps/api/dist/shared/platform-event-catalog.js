/**
 * P11.1 — Central runtime catalog for platform work_events / facts.
 *
 * Aggregates every event_type currently emitted or declared by module bridges.
 * Does NOT change intake, mapping, or payload contracts.
 */
import { INCOME_WORK_EVENT_CREDIT_ISSUED, INCOME_WORK_EVENT_DOCUMENT_ISSUED, INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW, INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL, INCOME_WORK_EVENT_DUE_DATE_SET, INCOME_WORK_EVENT_OVERDUE, INCOME_WORK_EVENTS_DEFERRED, INCOME_WORK_ENGINE_SCHEMA_VERSION, } from '../domains/income/income-work-engine-bridge.pure.js';
import { RECURRING_APPROVED_EVENT_TYPE, RECURRING_FAILURE_EVENT_TYPE, RECURRING_SEND_FOLLOWUP_EVENT_TYPE, RECURRING_WORK_ENGINE_SCHEMA_VERSION, RECURRING_WORK_EVENT_TYPE, } from '../domains/work-engine/work-engine-invoice-retainer.pure.js';
const WORK_ENGINE_CONSUMER = ['work_engine'];
/** DocFlow → Work Engine */
export const PLATFORM_EVENT_DOCFLOW_THREAD_NEEDS_ATTENTION = 'docflow.thread_needs_attention';
/** Client Operations → Work Engine */
export const PLATFORM_EVENT_CLIENT_OPERATIONS_ANNUAL_REPORT_DOCUMENTS_MISSING = 'client_operations.annual_report_documents_missing';
export const PLATFORM_EVENT_CLIENT_OPERATIONS_CAPITAL_DECLARATION_DOCUMENTS_MISSING = 'client_operations.capital_declaration_documents_missing';
export const PLATFORM_EVENT_CLIENT_OPERATIONS_PAYROLL_MATERIAL_MISSING = 'client_operations.payroll_material_missing';
export const PLATFORM_EVENT_CLIENT_OPERATIONS_VAT_MATERIAL_MISSING = 'client_operations.vat_material_missing';
export const PLATFORM_EVENT_CLIENT_OPERATIONS_TYPES = [
    PLATFORM_EVENT_CLIENT_OPERATIONS_ANNUAL_REPORT_DOCUMENTS_MISSING,
    PLATFORM_EVENT_CLIENT_OPERATIONS_CAPITAL_DECLARATION_DOCUMENTS_MISSING,
    PLATFORM_EVENT_CLIENT_OPERATIONS_PAYROLL_MATERIAL_MISSING,
    PLATFORM_EVENT_CLIENT_OPERATIONS_VAT_MATERIAL_MISSING,
];
/** Client Obligations → Work Engine (semantic owners: payroll / vat / annual_report) */
export const PLATFORM_EVENT_PAYROLL_DOCUMENTS_MISSING = 'payroll.documents_missing';
export const PLATFORM_EVENT_VAT_DOCUMENTS_MISSING = 'vat.documents_missing';
export const PLATFORM_EVENT_ANNUAL_REPORT_DOCUMENTS_MISSING = 'annual_report.documents_missing';
const DOCFLOW_SCHEMA_VERSION = 1;
const CLIENT_OPERATIONS_SCHEMA_VERSION = 1;
const CLIENT_OBLIGATIONS_SCHEMA_VERSION = 1;
function entry(event_type, owner_module, current_schema_version, description, consumer_modules = WORK_ENGINE_CONSUMER) {
    return {
        event_type,
        owner_module,
        current_schema_version,
        description,
        consumer_modules,
    };
}
/** Canonical runtime catalog — one row per known platform event_type. */
export const PLATFORM_EVENT_CATALOG = [
    // —— Income ——
    entry(INCOME_WORK_EVENT_DOCUMENT_ISSUED, 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Income document issued (audit/context intake; no work_item mapping).'),
    entry(INCOME_WORK_EVENT_DUE_DATE_SET, 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Income invoice due date set on issue (audit/context intake).'),
    entry(INCOME_WORK_EVENT_OVERDUE, 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Issued income invoice past due_date; maps to invoice_collection_followup work_item.'),
    entry(INCOME_WORK_EVENT_CREDIT_ISSUED, 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Income credit document issued (audit/context intake).'),
    entry(INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL, 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Successful email delivery fact; Work Engine may complete recurring send-followup.'),
    entry(INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW, 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Successful DocFlow delivery fact; Work Engine may complete recurring send-followup.'),
    entry(INCOME_WORK_EVENTS_DEFERRED[0], 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Deferred — payment pipeline not implemented.', []),
    entry(INCOME_WORK_EVENTS_DEFERRED[1], 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Deferred — payment pipeline not implemented.', []),
    entry(INCOME_WORK_EVENTS_DEFERRED[2], 'income', INCOME_WORK_ENGINE_SCHEMA_VERSION, 'Deferred — payment pipeline not implemented.', []),
    // —— Retainers (Work Engine scheduler emits on behalf of income recurring profiles) ——
    entry(RECURRING_WORK_EVENT_TYPE, 'work_engine', RECURRING_WORK_ENGINE_SCHEMA_VERSION, 'Recurring retainer draft generated; maps to recurring_invoice_review work_item.'),
    entry(RECURRING_FAILURE_EVENT_TYPE, 'work_engine', RECURRING_WORK_ENGINE_SCHEMA_VERSION, 'Recurring retainer draft generation failed for a cycle.'),
    entry(RECURRING_APPROVED_EVENT_TYPE, 'work_engine', RECURRING_WORK_ENGINE_SCHEMA_VERSION, 'Recurring cycle approved (audit-only intake; no work_item mapping).'),
    entry(RECURRING_SEND_FOLLOWUP_EVENT_TYPE, 'work_engine', RECURRING_WORK_ENGINE_SCHEMA_VERSION, 'Approved recurring document not delivered after grace; maps to recurring_document_send_followup.'),
    // —— DocFlow ——
    entry(PLATFORM_EVENT_DOCFLOW_THREAD_NEEDS_ATTENTION, 'docflow', DOCFLOW_SCHEMA_VERSION, 'DocFlow thread needs office attention; maps to docflow_thread_followup work_item.'),
    // —— Client Operations ——
    entry(PLATFORM_EVENT_CLIENT_OPERATIONS_ANNUAL_REPORT_DOCUMENTS_MISSING, 'client_operations', CLIENT_OPERATIONS_SCHEMA_VERSION, 'Client Operations annual report material missing for client.'),
    entry(PLATFORM_EVENT_CLIENT_OPERATIONS_CAPITAL_DECLARATION_DOCUMENTS_MISSING, 'client_operations', CLIENT_OPERATIONS_SCHEMA_VERSION, 'Client Operations capital declaration material missing for client.'),
    entry(PLATFORM_EVENT_CLIENT_OPERATIONS_PAYROLL_MATERIAL_MISSING, 'client_operations', CLIENT_OPERATIONS_SCHEMA_VERSION, 'Client Operations payroll material missing for client period.'),
    entry(PLATFORM_EVENT_CLIENT_OPERATIONS_VAT_MATERIAL_MISSING, 'client_operations', CLIENT_OPERATIONS_SCHEMA_VERSION, 'Client Operations VAT material missing for client period.'),
    // —— Payroll / VAT / Annual Reports (via Client Obligations bridge) ——
    entry(PLATFORM_EVENT_PAYROLL_DOCUMENTS_MISSING, 'payroll', CLIENT_OBLIGATIONS_SCHEMA_VERSION, 'Client obligation payroll_data missing; emitted by client_obligations bridge.'),
    entry(PLATFORM_EVENT_VAT_DOCUMENTS_MISSING, 'vat', CLIENT_OBLIGATIONS_SCHEMA_VERSION, 'Client obligation vat_report missing; emitted by client_obligations bridge.'),
    entry(PLATFORM_EVENT_ANNUAL_REPORT_DOCUMENTS_MISSING, 'annual_report', CLIENT_OBLIGATIONS_SCHEMA_VERSION, 'Client obligation annual_report missing; emitted by client_obligations bridge.'),
];
const CATALOG_BY_EVENT_TYPE = new Map(PLATFORM_EVENT_CATALOG.map((row) => [row.event_type, row]));
export function getPlatformEventCatalogEntry(eventType) {
    return CATALOG_BY_EVENT_TYPE.get(eventType);
}
export function listPlatformEventCatalogEntries() {
    return PLATFORM_EVENT_CATALOG;
}
export function listPlatformEventTypes() {
    return PLATFORM_EVENT_CATALOG.map((row) => row.event_type);
}
export function isKnownPlatformEventType(eventType) {
    return CATALOG_BY_EVENT_TYPE.has(eventType);
}
