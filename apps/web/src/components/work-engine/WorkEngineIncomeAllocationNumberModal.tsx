import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IncomeDocumentAllocationNumberField } from '../../income/income-document-details-types';
import '../../styles/nx-work-engine-invoice-retainer.css';

type Props = {
  open: boolean;
  field: IncomeDocumentAllocationNumberField;
  busy?: boolean;
  error?: string | null;
  onSave: (value: string | null) => void;
  onClose: () => void;
};

export function WorkEngineIncomeAllocationNumberModal({
  open,
  field,
  busy = false,
  error = null,
  onSave,
  onClose,
}: Props) {
  const [value, setValue] = useState(field.value ?? '');

  useEffect(() => {
    if (open) setValue(field.value ?? '');
  }, [open, field.value]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const content = (
    <div
      className="nx-we-retainer-overlay nx-we-retainer-overlay--nested"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-income-allocation-number-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="nx-we-retainer-modal nx-we-retainer-modal--nested nx-we-income-allocation-modal"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-we-retainer-modal__head">
          <div className="nx-we-retainer-modal__head-text">
            <h3 id="we-income-allocation-number-title" className="nx-we-retainer-modal__title">
              {field.label}
            </h3>
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

        <div className="nx-we-retainer-modal__body">
          <label className="nx-income-field">
            <span>{field.label}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder={field.placeholder}
              value={value}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {error ? <div className="nx-we-banner-error">{error}</div> : null}
        </div>

        <div className="nx-we-retainer-modal__footer nx-tax-nested-modal-footer">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            סגירה
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={busy}
            onClick={() => onSave(value.trim() || null)}
          >
            {busy ? 'שומר…' : 'שמירה'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
