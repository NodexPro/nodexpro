export function buildDocumentDetailsHeaderTitle(scope, docTypeLabel, numberPreview, recipientName) {
    const numberPart = numberPreview?.trim() ? ` ${numberPreview.trim()}` : '';
    const recipientPart = recipientName.trim() || '—';
    if (scope.acting_mode === 'office_representative' && scope.represented_client_label?.trim()) {
        return `לקוח המשרד ${scope.represented_client_label.trim()} מפיק ${docTypeLabel}${numberPart} ל-${recipientPart}`;
    }
    return `${scope.issuer_label.trim()} מפיק ${docTypeLabel}${numberPart} ל-${recipientPart}`;
}
