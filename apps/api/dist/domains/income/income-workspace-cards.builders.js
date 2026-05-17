export function buildIncomeWorkspaceCards(perms, counts) {
    const editActions = perms.edit ? ['open'] : [];
    const createDraftActions = perms.edit ? ['create_income_document_draft'] : [];
    const createCustomerActions = perms.edit
        ? ['create_income_customer', 'create_one_time_income_customer']
        : [];
    const createItemActions = perms.edit ? ['create_income_item'] : [];
    return [
        {
            key: 'new_document',
            label: '+ מסמך',
            count: null,
            allowed_actions: createDraftActions,
        },
        {
            key: 'reports',
            label: 'דוחות',
            count: null,
            allowed_actions: perms.view ? ['open'] : [],
        },
        {
            key: 'customers',
            label: 'לקוחות',
            count: counts.customers,
            allowed_actions: [...editActions, ...createCustomerActions],
        },
        {
            key: 'retainers',
            label: 'ריטיינרים',
            count: 0,
            allowed_actions: editActions,
        },
        {
            key: 'drafts',
            label: 'טיוטות',
            count: counts.drafts,
            allowed_actions: [...editActions, ...createDraftActions],
        },
        {
            key: 'payments',
            label: 'תשלומים',
            count: 0,
            allowed_actions: editActions,
        },
        {
            key: 'operations',
            label: 'ניהול שוטף',
            count: 0,
            allowed_actions: editActions,
        },
        {
            key: 'items',
            label: 'פריטים',
            count: counts.items,
            allowed_actions: [...editActions, ...createItemActions],
        },
        {
            key: 'inventory',
            label: 'מלאי',
            count: null,
            allowed_actions: [],
            disabled: true,
            disabled_reason: 'Future inventory module',
        },
        {
            key: 'credits',
            label: 'זיכויים',
            count: 0,
            allowed_actions: editActions,
        },
        {
            key: 'settings',
            label: 'הגדרות מסמך',
            count: null,
            allowed_actions: perms.edit ? ['open'] : [],
        },
    ];
}
export function buildWorkspaceAllowedActions(perms) {
    const actions = [];
    if (perms.view)
        actions.push('view_workspace');
    if (perms.edit) {
        actions.push('select_issuer_context', 'create_income_customer', 'create_one_time_income_customer', 'create_income_item', 'create_income_document_draft', 'update_income_document_draft', 'cancel_income_document_draft');
    }
    return actions;
}
