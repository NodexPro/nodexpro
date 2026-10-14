/**
 * ToDo completion confirmation (סיום משימה) — presentation only.
 * Completion happens ONLY on explicit confirmation; X, ביטול, Escape and a click outside close the dialog
 * without completing. The optional reason is sent with the existing complete command by the parent.
 * Uses the module's existing form/modal classes (nx-co-todo-form*, nx-btn nx-btn-taxes-compact).
 */
import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

type Props = {
  clientLabel: string | null;
  taskText: string;
  reason: string;
  onReasonChange: (value: string) => void;
  /** Backend-owned limit (aggregate `field_limits.completion_reason_max_length`). */
  reasonMaxLength?: number;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
};

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], select:not(:disabled), textarea:not(:disabled)';

export function ClientOperationsTodoCompleteModal({
  clientLabel,
  taskText,
  reason,
  onReasonChange,
  reasonMaxLength,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const taskId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the reason field on open; give focus back to whatever opened the dialog on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      // Close THIS dialog only (not the edit form / board underneath).
      e.stopPropagation();
      e.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = Array.from(formRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onConfirm();
  };

  return (
    <div
      className="nx-co-todo-form-overlay nx-co-todo-form-overlay--confirm"
      role="presentation"
      data-testid="client-operations-todo-complete-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      onKeyDown={onKeyDown}
    >
      <form
        ref={formRef}
        className="nx-co-todo-form nx-co-todo-form--complete"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={taskId}
        dir="rtl"
        onSubmit={onSubmit}
      >
        <div className="nx-co-todo-form__header">
          <h3 id={titleId}>סיום משימה</h3>
          <button
            type="button"
            className="nx-co-todo-board__close"
            onClick={onCancel}
            disabled={busy}
            aria-label="סגור"
            data-testid="client-operations-todo-complete-x"
          >
            ×
          </button>
        </div>
        <div className="nx-co-todo-form__body">
          <p id={taskId} className="nx-co-todo-complete__task">
            {clientLabel ? <strong>{clientLabel}</strong> : null}
            {clientLabel ? ' — ' : null}
            {taskText}
          </p>
          <label className="nx-co-todo-form__field">
            <span>סיבת סגירה</span>
            <input
              ref={inputRef}
              type="text"
              value={reason}
              maxLength={reasonMaxLength}
              placeholder="אופציונלי"
              disabled={busy}
              onChange={(e) => onReasonChange(e.target.value)}
              data-testid="client-operations-todo-complete-reason"
            />
          </label>
          {error ? (
            <div className="nx-co-todo-board__error nx-co-todo-form__error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <div className="nx-co-todo-form__footer">
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact nx-btn-secondary nx-co-todo-btn"
            onClick={onCancel}
            disabled={busy}
            data-testid="client-operations-todo-complete-cancel"
          >
            ביטול
          </button>
          <button
            type="submit"
            className="nx-btn nx-btn-taxes-compact nx-btn-primary nx-co-todo-btn"
            disabled={busy}
            data-testid="client-operations-todo-complete-confirm"
          >
            סיום והעברה לארכיון
          </button>
        </div>
      </form>
    </div>
  );
}
