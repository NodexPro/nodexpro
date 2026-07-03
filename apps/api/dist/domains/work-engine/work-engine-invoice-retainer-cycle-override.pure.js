/**
 * Recurring cycle overrides — pure helpers (projection-only, no Accounting Base).
 */
import { normalizeDraftLines } from '../income/income-document-draft-lines.pure.js';
function retainerOverrideDocumentType(documentType) {
    if (documentType === 'quote' || documentType === 'deal_invoice' || documentType === 'tax_invoice') {
        return documentType;
    }
    return 'deal_invoice';
}
export function isRecurringCycleOverrideApplyScope(value) {
    return value === 'single_cycle' || value === 'this_and_future';
}
export function overridePayloadFromTemplateSnapshot(snapshot) {
    return {
        snapshot_version: 1,
        snapshot_kind: 'recurring_cycle_override',
        document_type: retainerOverrideDocumentType(snapshot.document_type),
        document_settings_json: snapshot.document_settings_json,
        draft_lines_json: snapshot.draft_lines_json,
        notes: snapshot.notes,
        delivery_contact_json: snapshot.delivery_contact_json,
    };
}
export function overridePayloadFromDocumentDetailsStep(step) {
    const documentType = step.document_type_key;
    if (documentType !== 'quote' && documentType !== 'deal_invoice' && documentType !== 'tax_invoice') {
        throw new Error('document_type_key is required for override payload');
    }
    const settings = {};
    for (const field of step.settings_schema) {
        if (field.value != null && field.value !== '') {
            settings[field.key] = field.value;
        }
    }
    const draft_lines_json = normalizeDraftLines(step.line_items.rows.map((row) => ({
        line_id: row.line_id,
        sort_index: row.row_number,
        description: row.description.value,
        quantity: Number(row.quantity.value) || 1,
        unit_price_reference: Number(String(row.unit_price.value).replace(/,/g, '')) || null,
        currency: row.currency.value,
        exchange_rate_to_ils_override: row.exchange_rate_override?.value
            ? Number(row.exchange_rate_override.value)
            : null,
        price_includes_vat: row.price_includes_vat,
        vat_rate_code: row.vat_rate_code,
    })));
    const deliveryEmail = step.delivery_contact?.email ?? null;
    const delivery_contact_json = deliveryEmail ? { email: deliveryEmail } : null;
    return {
        snapshot_version: 1,
        snapshot_kind: 'recurring_cycle_override',
        document_type: documentType,
        document_settings_json: settings,
        draft_lines_json,
        notes: step.notes?.value ?? null,
        delivery_contact_json,
    };
}
export function mergeOverridePayloadIntoTemplateSnapshot(base, override) {
    if (!override)
        return base;
    return {
        ...base,
        document_type: override.document_type,
        document_settings_json: override.document_settings_json,
        draft_lines_json: override.draft_lines_json,
        notes: override.notes,
        delivery_contact_json: override.delivery_contact_json,
    };
}
export function resolveCycleOverrideForDate(cycleDate, overridesByDate) {
    return overridesByDate.get(cycleDate) ?? null;
}
function mapSidebarField(field) {
    return {
        key: field.key,
        label: field.label,
        input_type: field.input_type === 'select'
            ? 'select'
            : field.input_type === 'date'
                ? 'date'
                : 'text',
        value: field.value,
        editable: !field.disabled,
        disabled_reason: field.disabled_reason,
        hint: null,
        options: field.options ?? [],
        required: field.required,
        min_value: field.min_value ?? null,
    };
}
export function buildCycleOverrideSidebarSections(step) {
    const sections = [];
    const paymentTerms = step.settings_schema.find((field) => field.key === 'payment_terms');
    if (paymentTerms?.visible) {
        sections.push({
            key: 'payment_terms',
            title: 'תנאי תשלום',
            fields: [mapSidebarField(paymentTerms)],
        });
    }
    const documentSettings = step.settings_schema.filter((field) => field.visible && field.key !== 'payment_terms');
    if (documentSettings.length > 0) {
        sections.push({
            key: 'document_settings',
            title: 'הגדרות מסמך',
            fields: documentSettings.map(mapSidebarField),
        });
    }
    if (step.notes) {
        sections.push({
            key: 'notes',
            title: step.notes.label,
            fields: [
                {
                    key: 'notes',
                    label: step.notes.label,
                    input_type: 'textarea',
                    value: step.notes.value,
                    editable: step.notes.editable,
                    disabled_reason: null,
                    hint: null,
                    options: [],
                    required: false,
                    min_value: null,
                },
            ],
        });
    }
    if (step.delivery_contact) {
        sections.push({
            key: 'delivery_contact',
            title: step.delivery_contact.label,
            fields: [
                {
                    key: 'delivery_contact_email',
                    label: step.delivery_contact.label,
                    input_type: 'email',
                    value: step.delivery_contact.email,
                    editable: step.delivery_contact.editable,
                    disabled_reason: null,
                    hint: step.delivery_contact.hint,
                    options: [],
                    required: false,
                    min_value: null,
                },
            ],
        });
    }
    return sections;
}
export function buildOverrideSaveScopeDialog(visible) {
    return {
        title: 'להחיל על',
        prompt: 'בחר כיצד לשמור את השינויים במסמך העתידי:',
        option_single_cycle: {
            key: 'single_cycle',
            label: 'רק למסמך הזה',
            description: 'שמירת שינוי חד-פעמי למחזור זה בלבד.',
        },
        option_this_and_future: {
            key: 'this_and_future',
            label: 'מהמסמך הזה והלאה',
            description: 'עדכון תבנית הריטיינר לכל המחזורים מהתאריך הזה.',
        },
        confirm_label: 'שמירה',
        cancel_label: 'ביטול',
        persistence_note: visible
            ? 'השינויים נשמרים כהגדרות תצוגה עתידית בלבד — ללא יצירת טיוטה או מסמך.'
            : null,
    };
}
const PROJECTION_LINE_ITEM_ACTIONS = [
    'add_income_document_line',
    'update_income_document_line',
    'delete_income_document_line',
    'reorder_income_document_lines',
];
const PROJECTION_LINE_ROW_ACTIONS = [
    'update_income_document_line',
    'delete_income_document_line',
];
export function ensureProjectionEditableLineItems(step) {
    return {
        ...step,
        line_items: {
            ...step.line_items,
            allowed_actions: [...PROJECTION_LINE_ITEM_ACTIONS],
            rows: step.line_items.rows.map((row) => ({
                ...row,
                description: { ...row.description, editable: true },
                quantity: { ...row.quantity, editable: true },
                unit_price: { ...row.unit_price, editable: true },
                currency: { ...row.currency, editable: true },
                allowed_actions: row.allowed_actions.includes('update_income_document_line')
                    ? row.allowed_actions
                    : [...PROJECTION_LINE_ROW_ACTIONS],
            })),
        },
        document_discount: {
            ...step.document_discount,
            editable: true,
            allowed_actions: step.document_discount.allowed_actions.includes('update_income_document_discount')
                ? step.document_discount.allowed_actions
                : ['update_income_document_discount'],
        },
    };
}
