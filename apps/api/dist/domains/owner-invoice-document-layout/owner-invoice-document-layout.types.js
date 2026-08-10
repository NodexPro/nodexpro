/**
 * INV-13A — Owner Invoice Document Builder types (Phase 1).
 */
export const OWNER_INVOICE_LAYOUT_AGGREGATE_KEY = 'owner_invoice_document_builder_aggregate';
export const OWNER_INVOICE_LAYOUT_KEY_DEFAULT = 'income_sectioned_il';
export const OWNER_INVOICE_LAYOUT_STATUSES = ['draft', 'published', 'archived'];
export const OWNER_INVOICE_LAYOUT_DOCUMENT_TYPE_GROUPS = [
    'all',
    'tax_group',
    'quote_deal',
    'receipt',
    'credit',
];
export const OWNER_INVOICE_LAYOUT_COMMANDS = {
    create_draft: 'create_owner_invoice_layout_draft',
    move_section: 'move_owner_invoice_layout_section',
    resize_section: 'resize_owner_invoice_layout_section',
    move_field: 'move_owner_invoice_layout_field',
    place_field: 'place_owner_invoice_layout_field',
    set_field_visibility: 'set_owner_invoice_field_visibility',
    set_table_column: 'set_owner_invoice_table_column',
    set_section_lock: 'set_owner_invoice_section_lock',
    publish: 'publish_owner_invoice_layout_version',
    archive: 'archive_owner_invoice_layout_version',
};
const OWNER_INVOICE_LAYOUT_COMMAND_SET = new Set(Object.values(OWNER_INVOICE_LAYOUT_COMMANDS));
export function isOwnerInvoiceLayoutCommand(command) {
    return OWNER_INVOICE_LAYOUT_COMMAND_SET.has(command);
}
