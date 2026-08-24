import { useCallback, useEffect, useState } from 'react';
import type { IncomeRepresentedClientEmailHistoryAggregate } from '../../api/income';
import { fetchIncomeRepresentedClientEmailHistoryAggregate } from '../../api/income';

type Props = {
  open: boolean;
  representedClientId: string | null;
  /** Optional backend-scoped end customer when opening from an end-customer row. */
  incomeCustomerId?: string | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onError?: (message: string) => void;
};

export function IncomeRepresentedClientEmailHistoryModal({
  open,
  representedClientId,
  incomeCustomerId = null,
  busy,
  onBusyChange,
  onClose,
  onError,
}: Props) {
  const [aggregate, setAggregate] = useState<IncomeRepresentedClientEmailHistoryAggregate | null>(null);

  const loadAggregate = useCallback(async () => {
    if (!representedClientId) return;
    onBusyChange?.(true);
    try {
      const next = await fetchIncomeRepresentedClientEmailHistoryAggregate({
        representedClientId,
        incomeCustomerId: incomeCustomerId ?? null,
      });
      setAggregate(next);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  }, [representedClientId, incomeCustomerId, onBusyChange, onError]);

  useEffect(() => {
    if (!open || !representedClientId) {
      setAggregate(null);
      return;
    }
    void loadAggregate();
  }, [open, representedClientId, incomeCustomerId, loadAggregate]);

  if (!open) return null;

  const rows = aggregate?.rows ?? [];
  const columns = aggregate?.table_columns ?? [];

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-email-history-overlay" role="presentation">
      <div
        className="nx-income-wizard nx-income-wizard--compact nx-accounting-editor-modal nx-income-email-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="income-client-email-history-title"
        dir="rtl"
      >
        <div className="nx-modal-header">
          <h2 id="income-client-email-history-title" className="nx-modal-title">
            היסטוריית שליחה במייל — {aggregate?.client_display_name ?? '…'}
          </h2>
          <button
            type="button"
            className="nx-income-ledger-modal__close-btn"
            aria-label="סגירה"
            disabled={busy}
            onClick={() => {
              if (!busy) onClose();
            }}
          >
            ×
          </button>
        </div>

        <div className="nx-modal-body nx-income-email-history-modal__body">
          {aggregate ? (
            aggregate.empty_state.visible ? (
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
                            <td key={col.key}>{value == null || value === '' ? '—' : String(value)}</td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <p className="nx-body-text">טוען…</p>
          )}
        </div>
      </div>
    </div>
  );
}
