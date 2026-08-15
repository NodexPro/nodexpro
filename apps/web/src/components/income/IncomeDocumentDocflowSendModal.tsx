import { useCallback, useEffect, useState } from 'react';
import type { IncomeDocumentDocflowSendAggregate, IncomeWorkspaceAggregate } from '../../api/income';
import {
  executeIncomeCommand,
  fetchIncomeDocumentDocflowSendAggregate,
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

export function IncomeDocumentDocflowSendModal({
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
  const [aggregate, setAggregate] = useState<IncomeDocumentDocflowSendAggregate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAggregate = useCallback(async () => {
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
      const next = await fetchIncomeDocumentDocflowSendAggregate({ incomeDocumentId });
      setAggregate(next);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setAggregate(null);
      setLoadError(message);
      onError?.(message);
    } finally {
      onBusyChange?.(false);
    }
  }, [incomeDocumentId, representedClientId, onBusyChange, onError]);

  useEffect(() => {
    if (!open || !incomeDocumentId) {
      setAggregate(null);
      setLoadError(null);
      return;
    }
    void loadAggregate();
  }, [open, incomeDocumentId, loadAggregate]);

  const handleClose = () => {
    if (busy && !loadError) return;
    onClose();
  };

  const handleRetryPdf = async () => {
    if (!aggregate?.allowed_actions.includes('retry_income_document_pdf_render')) return;
    onBusyChange?.(true);
    try {
      await executeIncomeCommand('retry_income_document_pdf_render', {
        income_document_id: aggregate.income_document_id,
      });
      const next = await fetchIncomeDocumentDocflowSendAggregate({
        incomeDocumentId: aggregate.income_document_id,
      });
      setAggregate(next);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleSend = async () => {
    if (!aggregate?.send_form.visible || !aggregate.send_form.enabled) return;
    onBusyChange?.(true);
    try {
      const body: Record<string, unknown> = {
        income_document_id: aggregate.send_form.income_document_id,
        idempotency_key: crypto.randomUUID(),
      };
      const res = await executeIncomeCommand(aggregate.send_form.command, body);
      if (
        res.command === 'send_income_document_by_docflow' &&
        'income_workspace_aggregate' in res
      ) {
        onAfterSend?.(res.income_workspace_aggregate);
      }
      const next = await fetchIncomeDocumentDocflowSendAggregate({
        incomeDocumentId: aggregate.income_document_id,
      });
      setAggregate(next);
      await onAfterSendComplete?.();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  if (!open) return null;

  const sendForm = aggregate?.send_form;
  const rows = aggregate?.rows ?? [];
  const columns = aggregate?.table_columns ?? [];
  const pdfReadiness = aggregate?.pdf_send_readiness;
  const canRetryPdf = Boolean(aggregate?.allowed_actions.includes('retry_income_document_pdf_render'));
  const statusMessage = sendForm?.disabled_reason ?? pdfReadiness?.message ?? null;

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-email-history-overlay" role="presentation">
      <div
        className="nx-income-wizard nx-income-wizard--compact nx-accounting-editor-modal nx-income-email-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="income-doc-docflow-send-title"
        dir="rtl"
      >
        <div className="nx-modal-header">
          <h2 id="income-doc-docflow-send-title" className="nx-modal-title">
            שליחה בדוקפלו — {aggregate?.document_number ?? '…'}
          </h2>
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

        <div className="nx-modal-body nx-income-email-history-modal__body">
          {loadError ? (
            <p className="nx-body-text" role="alert" style={{ color: '#b91c1c' }}>
              {loadError}
            </p>
          ) : aggregate ? (
            <>
              <p className="nx-body-text nx-body-text--muted nx-income-email-history-modal__subtitle">
                {aggregate.document_type_label}
                {aggregate.client_display_name ? ` — ${aggregate.client_display_name}` : ''}
                {pdfReadiness?.status_label ? ` — ${pdfReadiness.status_label}` : ''}
              </p>

              {sendForm?.visible ? (
                <section className="nx-income-email-history-modal__send" aria-label="אישור שליחה">
                  {statusMessage ? (
                    <p className="nx-income-email-history-modal__hint" role="status">
                      {statusMessage}
                    </p>
                  ) : null}
                  <div className="nx-income-email-history-modal__send-actions">
                    {canRetryPdf ? (
                      <button
                        type="button"
                        className="nx-btn nx-btn-taxes-compact"
                        disabled={busy}
                        onClick={() => void handleRetryPdf()}
                      >
                        נסה שוב להפיק PDF
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="nx-btn nx-btn-taxes-compact"
                      disabled={busy || !sendForm.enabled}
                      title={sendForm.enabled ? undefined : (sendForm.disabled_reason ?? undefined)}
                      onClick={() => void handleSend()}
                    >
                      {sendForm.confirm_label}
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="nx-income-email-history-modal__history" aria-label="היסטוריית שליחה בדוקפלו">
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
            </>
          ) : (
            <p className="nx-body-text">טוען…</p>
          )}
        </div>
      </div>
    </div>
  );
}
