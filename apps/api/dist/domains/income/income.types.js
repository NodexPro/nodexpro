export const INCOME_CONTEXT_AGGREGATE_KEY = 'income_workspace_context_aggregate';
export const INCOME_WORKSPACE_AGGREGATE_KEY = 'income_workspace_aggregate';
export const INCOME_COMMAND_SELECT_ISSUER = 'select_income_issuer_context';
export const INCOME_COMMAND_CREATE_CUSTOMER = 'create_income_customer';
export const INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER = 'create_one_time_income_customer';
export const INCOME_COMMAND_CREATE_ITEM = 'create_income_item';
export const INCOME_COMMAND_CREATE_DRAFT = 'create_income_document_draft';
export const INCOME_COMMAND_UPDATE_DRAFT = 'update_income_document_draft';
export const INCOME_COMMAND_CANCEL_DRAFT = 'cancel_income_document_draft';
export const INCOME_COMMAND_ISSUE_DOCUMENT = 'issue_income_document';
export const INCOME_COMMAND_SEARCH_RECIPIENTS = 'search_income_recipients';
export const INCOME_COMMAND_SELECT_RECIPIENT = 'select_income_recipient';
export const INCOME_COMMAND_SET_RECIPIENT_SNAPSHOT = 'set_income_recipient_snapshot';
export const INCOME_COMMAND_SAVE_RECIPIENT_FOR_FUTURE = 'save_income_recipient_for_future';
export const INCOME_COMMAND_RETRY_ACCOUNTING_POSTING = 'retry_income_document_accounting_posting';
export const INCOME_COMMAND_RETRY_PDF_RENDER = 'retry_income_document_pdf_render';
export const INCOME_COMMAND_BEGIN_WIZARD_DRAFT = 'begin_income_wizard_document_draft';
export const INCOME_COMMAND_ADD_LINE = 'add_income_document_line';
export const INCOME_COMMAND_UPDATE_LINE = 'update_income_document_line';
export const INCOME_COMMAND_DELETE_LINE = 'delete_income_document_line';
export const INCOME_COMMAND_REORDER_LINES = 'reorder_income_document_lines';
export const INCOME_COMMAND_UPDATE_DRAFT_SETTINGS = 'update_income_document_draft_settings';
export const INCOME_COMMAND_UPDATE_NOTES = 'update_income_document_notes';
export const INCOME_COMMAND_UPDATE_DELIVERY_CONTACT = 'update_income_document_delivery_contact';
export const INCOME_COMMAND_SAVE_DRAFT = 'save_income_document_draft';
export const INCOME_COMMAND_RESUME_DRAFT = 'resume_income_document_draft';
export const INCOME_COMMAND_GENERATE_PREVIEW = 'generate_income_document_preview';
export const INCOME_COMMAND_UPDATE_DISCOUNT = 'update_income_document_discount';
export { INCOME_COMMAND_UPDATE_BRANDING_PROFILE, INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT, INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO, INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE, } from './income-document-branding.types.js';
export const INCOME_MODULE_CODE = 'income';
export const INCOME_PERMISSIONS = {
    view: 'income.view',
    edit: 'income.edit',
    issue: 'income.issue',
    issueOnBehalf: 'income.issue_on_behalf',
};
export const INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY = 'income_client_document_management_panel';
