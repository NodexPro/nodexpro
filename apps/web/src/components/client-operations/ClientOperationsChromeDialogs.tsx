import { useEffect, useRef, useState } from 'react';
import { WorkspaceNestedDialogClose } from '../WorkspaceNestedDialogClose';
import '../../styles/nx-workspace-nested-dialogs.css';

export function ClientOperationsPromptDialog({
  title,
  initialValue = '',
  placeholder,
  confirmLabel,
  cancelLabel,
  emptyError,
  busy = false,
  onSubmit,
  onClose,
}: {
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  emptyError: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(emptyError);
      inputRef.current?.focus();
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div
      className="nx-annual-dialog-backdrop nx-co-prompt-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="nx-annual-dialog nx-co-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-co-prompt-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (!busy) onClose();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!busy) submit();
          }
        }}
      >
        <WorkspaceNestedDialogClose disabled={busy} onClick={onClose} />
        <h4 id="nx-co-prompt-title">{title}</h4>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'nx-co-prompt-error' : undefined}
        />
        {error ? (
          <p id="nx-co-prompt-error" className="nx-co-prompt-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="nx-annual-dialog-footer">
          <button
            type="button"
            className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={busy}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientOperationsConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy = false,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className="nx-annual-dialog-backdrop nx-co-prompt-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="nx-annual-dialog nx-co-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-co-confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (!busy) onClose();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!busy) onConfirm();
          }
        }}
      >
        <WorkspaceNestedDialogClose disabled={busy} onClick={onClose} />
        <h4 id="nx-co-confirm-title">{title}</h4>
        {message ? <p>{message}</p> : null}
        <div className="nx-annual-dialog-footer">
          <button
            type="button"
            className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`nx-btn nx-btn-taxes-compact ${danger ? 'nx-btn-danger-ghost' : 'nx-btn-primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
