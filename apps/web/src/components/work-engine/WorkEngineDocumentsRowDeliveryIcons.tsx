import type { WorkEngineInvoicesClientDocumentsByTypeRow } from '../../income/income-workspace-types';

type Props = {
  row: WorkEngineInvoicesClientDocumentsByTypeRow;
  busy: boolean;
  onOpenEmail: (incomeDocumentId: string) => void;
  onOpenDocflow: (incomeDocumentId: string) => void;
};

export function workEngineDocumentsRowDeliveryVisible(row: WorkEngineInvoicesClientDocumentsByTypeRow): {
  showEmail: boolean;
  showDocflow: boolean;
} {
  const emailEnabled = Boolean(row.email_delivery?.action?.enabled && row.document_id);
  const docflowEnabled = Boolean(row.docflow_delivery?.action?.enabled && row.document_id);
  return { showEmail: emailEnabled, showDocflow: docflowEnabled };
}

export function WorkEngineDocumentsRowDeliveryIcons({
  row,
  busy,
  onOpenEmail,
  onOpenDocflow,
}: Props) {
  const { showEmail, showDocflow } = workEngineDocumentsRowDeliveryVisible(row);
  const emailAction = row.email_delivery?.action ?? null;
  const docflowAction = row.docflow_delivery?.action ?? null;
  if (!showEmail && !showDocflow) return null;

  return (
    <>
      {showEmail && row.document_id ? (
        <button
          type="button"
          className="nx-we-documents-modal__icon-btn"
          data-testid="nx-we-documents-row-email"
          disabled={busy}
          aria-label={emailAction?.label ?? 'שליחה באימייל'}
          title={emailAction?.label ?? 'שליחה באימייל'}
          onClick={() => onOpenEmail(row.document_id as string)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 6h16v12H4V6zm0 0 8 7 8-7"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
      {showDocflow && row.document_id ? (
        <button
          type="button"
          className="nx-we-documents-modal__icon-btn"
          data-testid="nx-we-documents-row-docflow"
          disabled={busy}
          aria-label={docflowAction?.label ?? 'שליחה בדוקפלו'}
          title={docflowAction?.label ?? 'שליחה בדוקפלו'}
          onClick={() => onOpenDocflow(row.document_id as string)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 12 20 4l-3 8-5 2-2 5-2-7Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </>
  );
}
