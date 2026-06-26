import { createPortal } from 'react-dom';
import type { IncomeDocumentDetailsStep } from '../../income/income-document-details-types';

type PreviewBlock = NonNullable<IncomeDocumentDetailsStep['document_preview']>;

type Props = {
  open: boolean;
  preview: PreviewBlock | null | undefined;
  busy: boolean;
  onClose: () => void;
};

export function WorkEngineInvoiceRetainerPreviewModal({ open, preview, busy, onClose }: Props) {
  if (!open) return null;

  const previewHtml = preview?.preview_html?.trim() ?? '';
  const toolbarActions = (preview?.toolbar_actions ?? []).filter((action) => action.enabled);

  return createPortal(
    <div
      className="nx-we-retainer-preview-overlay nx-invoice-ui"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-retainer-preview-title"
      onClick={onClose}
    >
      <div className="nx-we-retainer-preview-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <header className="nx-we-retainer-preview-modal__head">
          <h2 id="we-retainer-preview-title" className="nx-we-retainer-preview-modal__title">
            תצוגה מקדימה
          </h2>
          <button
            type="button"
            className="nx-we-retainer-preview-modal__close"
            aria-label="סגירה"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {toolbarActions.length > 0 ? (
          <div className="nx-we-retainer-preview-modal__toolbar">
            {toolbarActions.map((action) => (
              <button key={action.action} type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy}>
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="nx-we-retainer-preview-modal__canvas">
          {busy ? (
            <p className="nx-we-retainer-preview-modal__status">מייצר תצוגה מקדימה…</p>
          ) : previewHtml ? (
            <div className="nx-we-preview-paper">
              <div
                className="nx-we-preview-paper__content"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          ) : (
            <p className="nx-we-retainer-preview-modal__status">לא ניתן להציג תצוגה מקדימה</p>
          )}
        </div>

        {preview?.validation_messages?.length ? (
          <div className="nx-we-retainer-preview-modal__validation">
            {preview.validation_messages.map((message, idx) => (
              <div
                key={idx}
                className={`nx-we-preview-validation__item nx-we-preview-validation__item--${message.severity}`}
              >
                {message.label}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
