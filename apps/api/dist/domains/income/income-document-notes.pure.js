/** Document notes (הערות שיופיעו במסמך) — length policy for draft commands + aggregate UI. */
export const INCOME_DOCUMENT_NOTES_MAX_LENGTH = 500;
export const INCOME_DOCUMENT_NOTES_HINT_HE = 'מקסימום 500 תווים';
export function incomeDocumentNotesLengthError(notes) {
    if (notes == null)
        return null;
    if (notes.length <= INCOME_DOCUMENT_NOTES_MAX_LENGTH)
        return null;
    return INCOME_DOCUMENT_NOTES_HINT_HE;
}
