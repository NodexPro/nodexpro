export function buildDocumentCreationSchema(perms) {
    const draftActions = [];
    if (perms.edit) {
        draftActions.push('create_income_document_draft', 'update_income_document_draft', 'cancel_income_document_draft');
    }
    return {
        steps: [
            { key: 'issuer', label: 'בחירת עסק', required: true },
            { key: 'document_type', label: 'סוג מסמך', required: true },
            { key: 'customer', label: 'לקוח', required: true },
            { key: 'lines', label: 'פריטים / שירותים', required: true },
            { key: 'payment', label: 'תשלום', required: 'depends_on_document_type' },
            { key: 'preview', label: 'תצוגה מקדימה', required: true },
        ],
        allowed_actions: draftActions,
    };
}
