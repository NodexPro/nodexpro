/**
 * INV-13C — Universal Document Platform types (Owner Builder foundation).
 * Invoice is the first template family; other families register into the same model.
 */
export const OWNER_DOCUMENT_PLATFORM_AGGREGATE_KEY = 'owner_document_platform_builder_aggregate';
/** Canonical template families — registry may enable a subset. */
export const OWNER_DOCUMENT_TEMPLATE_FAMILIES = [
    'invoice',
    'receipt',
    'tax_invoice',
    'quote',
    'credit_note',
    'purchase_order',
    'sales_order',
    'payslip',
    'contract',
    'statement',
    'reminder',
    'letter',
    'report',
];
export const OWNER_DOCUMENT_WIDGET_TYPES = [
    'text',
    'image',
    'logo',
    'table',
    'signature',
    'divider',
    'barcode',
    'qr_code',
    'legal_block',
    'payment_block',
    'totals_block',
    'address_block',
    'contact_block',
    'timeline',
    'chart',
    'custom_label',
];
