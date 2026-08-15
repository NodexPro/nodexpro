import { useCallback, useEffect, useRef, useState } from 'react';
import type { IncomeDocumentEmailHistoryAggregate, IncomeWorkspaceAggregate } from '../../api/income';
import {
  executeIncomeCommand,
  fetchIncomeDocumentEmailHistoryAggregate,
  isIncomeCommandResponse,
} from '../../api/income';

type Props = {
  open: boolean;
  incomeDocumentId: string | null;
  /** When opening from Work Engine office-client list — align Income issuer before load/send. */
  representedClientId?: string | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onError?: (message: string) => void;
  onAfterSend?: (workspace: IncomeWorkspaceAggregate) => void;
  onAfterSendComplete?: () => void | Promise<void>;
};

function formValuesFromAggregate(
  aggregate: IncomeDocumentEmailHistoryAggregate | null,
): Record<string, string> {
  const values: Record<string, string> = {};
  const rootDefault =
    aggregate?.recipient_email_default != null && String(aggregate.recipient_email_default).trim()
      ? String(aggregate.recipient_email_default).trim()
      : '';
  for (const field of aggregate?.send_form.fields ?? []) {
    if (field.key === 'recipient_email') {
      const fieldDefault =
        field.default_value != null && String(field.default_value).trim()
          ? String(field.default_value).trim()
          : '';
      values[field.key] = fieldDefault || rootDefault;
      continue;
    }
    values[field.key] =
      field.default_value != null && String(field.default_value).trim()
        ? String(field.default_value).trim()
        : '';
  }
  return values;
}

export function IncomeDocumentEmailHistoryModal({
  open,
  incomeDocumentId,
  representedClientId = null,
  busy,
  onBusyChange,
  onClose,
  onError,
  onAfterSend,
  onAfterSendComplete,
}: Props) {
  const [aggregate, setAggregate] = useState<IncomeDocumentEmailHistoryAggregate | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const recipientInitializedRef = useRef(false);

  const loadAggregate = useCallback(
    async (options?: { resetRecipient?: boolean }) => {
      if (!incomeDocumentId) return;
      onBusyChange?.(true);
      setLoadError(null);
      try {
        if (representedClientId) {
          await executeIncomeCommand('select_income_issuer_context', {
            acting_mode: 'office_representative',
            issuer_business_id: representedClientId,
            represented_client_id: representedClientId,
          });
        }
        const next = await fetchIncomeDocumentEmailHistoryAggregate({ incomeDocumentId });
        setAggregate(next);
        if (options?.resetRecipient || !recipientInitializedRef.current) {
          setFormValues(formValuesFromAggregate(next));
          recipientInitializedRef.current = true;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setAggregate(null);
        setLoadError(message);
        onError?.(message);
      } finally {
        onBusyChange?.(false);
      }
    },
    [incomeDocumentId, representedClientId, onBusyChange, onError],
  );

  useEffect(() => {
    if (!open || !incomeDocumentId) {
      setAggregate(null);
      setFormValues({});
      setLoadError(null);
      setHistoryOpen(false);
      recipientInitializedRef.current = false;
      return;
    }
    void loadAggregate({ resetRecipient: true });
  }, [open, incomeDocumentId, loadAggregate]);

  const handleClose = () => {
    if (busy && !loadError) return;
    onClose();
  };

  const handleSend = async () => {
    if (!aggregate?.send_form.visible || !aggregate.send_form.enabled) return;
    onBusyChange?.(true);
    try {
      const body: Record<string, unknown> = {
        income_document_id: aggregate.send_form.income_document_id,
        idempotency_key: crypto.randomUUID(),
      };
      for (const field of aggregate.send_form.fields) {
        body[field.key] = formValues[field.key] ?? '';
      }
      const res = await executeIncomeCommand(aggregate.send_form.command, body);
      if (isIncomeCommandResponse(res)) {
        if (res.income_document_email_history_aggregate) {
          setAggregate(res.income_document_email_history_aggregate);
          setFormValues(formValuesFromAggregate(res.income_document_email_history_aggregate));
          recipientInitializedRef.current = true;
        }
        onAfterSend?.(res.income_workspace_aggregate);
        await onAfterSendComplete?.();
        if (res.meta?.delivery_result === 'failed') {
          return;
        }
        onClose();
        return;
      }
      await onAfterSendComplete?.();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  if (!open) return null;

  const sendForm = aggregate?.send_form;
  const sendView = aggregate?.send_view;
  const rows = aggregate?.rows ?? [];
  const columns = aggregate?.table_columns ?? [];
  const emailField = sendForm?.fields.find((field) => field.key === 'recipient_email');
  const emailEditable = Boolean(sendView?.email_editable && emailField);

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-email-history-overlay" role="presentation">
      <div
        className="nx-income-wizard nx-income-wizard--compact nx-accounting-editor-modal nx-income-email-history-modal nx-income-email-send-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="income-doc-email-send-title"
        dir="rtl"
      >
        <div className="nx-modal-header">
          <h2 id="income-doc-email-send-title" className="nx-modal-title">
            {sendView?.title ?? 'שליחה במייל'}
          </h2>
          <div className="nx-income-email-send-modal__header-actions">
            {aggregate && sendView ? (
              <button
                type="button"
                className="nx-income-email-send-modal__history-btn"
                aria-label={sendView.history_toggle_label}
                aria-pressed={historyOpen}
                disabled={busy && !loadError}
                onClick={() => setHistoryOpen((openHistory) => !openHistory)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path
                    fill="currentColor"
                    d="M8 1.5A6.5 6.5 0 1 0 14.5 8 6.51 6.51 0 0 0 8 1.5Zm0 12A5.5 5.5 0 1 1 13.5 8 5.51 5.51 0 0 1 8 13.5Zm.25-8.25h-1v4.13l3.4 2.04.5-.86-2.9-1.73Z"
                  />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              className="nx-income-ledger-modal__close-btn"
              aria-label="סגירה"
              disabled={busy && !loadError}
              onClick={handleClose}
            >
              ×
            </button>
          </div>
        </div>

        <div className="nx-modal-body nx-income-email-send-modal__body">
          {loadError ? (
            <p className="nx-body-text" role="alert" style={{ color: '#b91c1c' }}>
              {loadError}
            </p>
          ) : aggregate && sendView && historyOpen ? (
            <section className="nx-income-email-history-modal__history" aria-label={sendView.history_toggle_label}>
              {aggregate.empty_state.visible ? (
                <p className="nx-income-email-history-modal__empty">{aggregate.empty_state.title}</p>
              ) : (
                <div className="nx-income-email-history-modal__table-wrap">
                  <table className="nx-income-email-history-modal__table">
                    <thead>
                      <tr>
                        {columns.map((col) => (
                          <th key={col.key}>{col.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.attempt_id}>
                          {columns.map((col) => {
                            const value = (row as unknown as Record<string, unknown>)[col.key];
                            return (
                              <td key={col.key}>
                                {value == null || value === '' ? '—' : String(value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : aggregate && sendView ? (
            <section className="nx-income-email-send-modal__form" aria-label="טופס שליחה">
              <dl className="nx-income-email-send-modal__facts">
                <div className="nx-income-email-send-modal__fact">
                  <dt>{sendView.sender_label}</dt>
                  <dd>{sendView.sender_display_name}</dd>
                </div>
                <div className="nx-income-email-send-modal__fact">
                  <dt>{sendView.recipient_name_label}</dt>
                  <dd>{sendView.recipient_display_name}</dd>
                </div>
                <div className="nx-income-email-send-modal__fact">
                  <dt>{sendView.email_label}</dt>
                  <dd>
                    {emailEditable && emailField ? (
                      <input
                        id={`income-email-send-${emailField.key}`}
                        className="nx-income-email-send-modal__email-input"
                        type={emailField.type}
                        value={formValues[emailField.key] ?? ''}
                        required={emailField.required}
                        disabled={busy}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, [emailField.key]: e.target.value }))
                        }
                      />
                    ) : (
                      formValues.recipient_email || '—'
                    )}
                  </dd>
                </div>
                <div className="nx-income-email-send-modal__fact">
                  <dt>{sendView.document_label}</dt>
                  <dd>{sendView.document_display}</dd>
                </div>
              </dl>
              {sendView.attachment_ready && sendView.attachment_filename ? (
                <p className="nx-income-email-send-modal__attachment">
                  <span aria-hidden="true">📎</span>
                  <span>{sendView.attachment_filename}</span>
                </p>
              ) : null}
              {sendView.send_disabled_user_message ? (
                <p className="nx-income-email-send-modal__hint" role="status">
                  {sendView.send_disabled_user_message}
                </p>
              ) : null}
            </section>
          ) : (
            <p className="nx-body-text">טוען…</p>
          )}
        </div>

        {!historyOpen && sendForm?.visible ? (
          <div className="nx-modal-footer nx-income-email-send-modal__footer">
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={busy || !sendForm.enabled}
              onClick={() => void handleSend()}
            >
              {sendView?.send_button_label ?? 'שליחה'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
