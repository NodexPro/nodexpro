/**
 * Customer-facing draft תצוגה מקדימה head-rail actions.
 * Same download/print icons as issued document viewer; eligibility from backend only.
 */
/**
 * Stable ordered head actions for draft/preview overlays.
 * Print is live when preview HTML is ready; PDF download remains after issue.
 */
export function buildIncomeDocumentPreviewToolbarActions(params) {
    return [
        {
            action: 'preview_download',
            label: 'הורדה',
            enabled: false,
            reason: 'זמין לאחר הפקה',
        },
        {
            action: 'preview_print',
            label: 'הדפסה',
            enabled: params.previewReady,
            reason: params.previewReady ? null : 'אין תצוגה מקדימה להדפסה',
        },
    ];
}
