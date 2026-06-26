import { createPortal } from 'react-dom';
import type { WorkEngineInvoiceRetainerNextDocumentApplyScope } from '../../income/income-workspace-types';

type DialogConfig = NonNullable<
  NonNullable<
    import('../../income/income-workspace-types').WorkEngineInvoiceRetainerNextDocumentPreview['save_action']['apply_scope_dialog']
  >
>;

type Props = {
  open: boolean;
  dialog: DialogConfig;
  selectedScope: WorkEngineInvoiceRetainerNextDocumentApplyScope;
  busy?: boolean;
  onScopeChange: (scope: WorkEngineInvoiceRetainerNextDocumentApplyScope) => void;
  onConfirm: () => void;
  onClose: () => void;
};

export function WorkEngineInvoiceRetainerNextDocumentSaveDialog({
  open,
  dialog,
  selectedScope,
  busy = false,
  onScopeChange,
  onConfirm,
  onClose,
}: Props) {
  if (!open) return null;

  const content = (
    <div
      className="nx-we-retainer-overlay nx-we-retainer-overlay--nested"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-retainer-next-doc-save-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="nx-we-retainer-modal nx-we-retainer-modal--nested"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-we-retainer-modal__head">
          <div className="nx-we-retainer-modal__head-text">
            <h3 id="we-retainer-next-doc-save-title" className="nx-we-retainer-modal__title">
              {dialog.title}
            </h3>
            <p className="nx-we-retainer-modal__subtitle">{dialog.prompt}</p>
          </div>
          <button
            type="button"
            className="nx-we-retainer-modal__close"
            aria-label="סגירה"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="nx-we-retainer-modal__body nx-we-retainer-next-doc-save__body">
          <div className="nx-we-retainer-options" role="radiogroup" aria-label={dialog.title}>
            <label
              className={`nx-we-retainer-option${
                selectedScope === dialog.option_next_cycle_only.key
                  ? ' nx-we-retainer-option--selected'
                  : ''
              }`}
            >
              <input
                type="radio"
                name="retainer-next-doc-apply-scope"
                value={dialog.option_next_cycle_only.key}
                checked={selectedScope === dialog.option_next_cycle_only.key}
                disabled={busy}
                onChange={() => onScopeChange(dialog.option_next_cycle_only.key)}
              />
              <span className="nx-we-retainer-next-doc-save__option-text">
                <strong>{dialog.option_next_cycle_only.label}</strong>
                <span>{dialog.option_next_cycle_only.description}</span>
              </span>
            </label>
            <label
              className={`nx-we-retainer-option${
                selectedScope === dialog.option_all_future_cycles.key
                  ? ' nx-we-retainer-option--selected'
                  : ''
              }`}
            >
              <input
                type="radio"
                name="retainer-next-doc-apply-scope"
                value={dialog.option_all_future_cycles.key}
                checked={selectedScope === dialog.option_all_future_cycles.key}
                disabled={busy}
                onChange={() => onScopeChange(dialog.option_all_future_cycles.key)}
              />
              <span className="nx-we-retainer-next-doc-save__option-text">
                <strong>{dialog.option_all_future_cycles.label}</strong>
                <span>{dialog.option_all_future_cycles.description}</span>
              </span>
            </label>
          </div>
          <p className="nx-we-retainer-note nx-we-retainer-next-doc-save__note">{dialog.persistence_note}</p>
        </div>

        <div className="nx-we-retainer-modal__footer nx-tax-nested-modal-footer">
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            onClick={onClose}
          >
            {dialog.cancel_label}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={busy}
            onClick={onConfirm}
          >
            {dialog.confirm_label}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
