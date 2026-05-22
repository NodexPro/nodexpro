import type { ActiveIncomeIssuerScope } from './income.guards.js';

export function buildDocumentDetailsHeaderTitle(
  scope: ActiveIncomeIssuerScope,
  docTypeLabel: string,
  numberPreview: string | null,
  recipientName: string,
): string {
  const numberPart = numberPreview?.trim() ? ` ${numberPreview.trim()}` : '';
  const recipientPart = recipientName.trim() || '—';
  if (scope.acting_mode === 'office_representative' && scope.represented_client_label?.trim()) {
    return `לקוח המשרד ${scope.represented_client_label.trim()} מפיק ${docTypeLabel}${numberPart} ל-${recipientPart}`;
  }
  return `${scope.issuer_label.trim()} מפיק ${docTypeLabel}${numberPart} ל-${recipientPart}`;
}
