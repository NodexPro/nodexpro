/**
 * Issued schedule row — read-only menu actions (backend action truth).
 */
/** Read-only actions for an issued recurring schedule row. No edit / save / issue. */
export function buildIssuedScheduleRowMenuActions(params) {
    if (params.generatedDocumentId) {
        return [
            {
                key: 'open_document',
                label: 'צפייה במסמך',
                disabled: false,
                disabled_reason: null,
                href: params.documentDownloadPath(params.generatedDocumentId),
                income_command: null,
                income_command_payload: null,
            },
        ];
    }
    return [
        {
            key: 'open_document',
            label: 'צפייה במסמך',
            disabled: true,
            disabled_reason: 'המסמך עדיין לא זמין לצפייה',
            href: null,
            income_command: null,
            income_command_payload: null,
        },
    ];
}
export function issuedScheduleRowAllowedActionKeys(actions) {
    return actions.filter((action) => !action.disabled).map((action) => action.key);
}
