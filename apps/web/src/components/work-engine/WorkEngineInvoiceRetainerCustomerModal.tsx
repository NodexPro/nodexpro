import { useCallback, useEffect, useState } from 'react';
import type { WorkEngineInvoiceRetainerSetupAggregate } from '../../income/income-workspace-types';
import { fetchWorkEngineInvoiceRetainerSetupAggregate } from '../../api/work-engine';

type Props = {
  open: boolean;
  representedClientId: string | null;
  clientDisplayName: string;
  busy: boolean;
  canAddCustomer: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onSelectCustomer: (endCustomerId: string, aggregate: WorkEngineInvoiceRetainerSetupAggregate) => void;
  onAddCustomer?: () => void | Promise<void>;
  onError?: (message: string) => void;
  refreshKey?: number;
};

export function WorkEngineInvoiceRetainerCustomerModal({
  open,
  representedClientId,
  clientDisplayName,
  busy,
  canAddCustomer,
  onBusyChange,
  onClose,
  onSelectCustomer,
  onAddCustomer,
  onError,
  refreshKey = 0,
}: Props) {
  const [aggregate, setAggregate] = useState<WorkEngineInvoiceRetainerSetupAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadAggregate = useCallback(async () => {
    if (!representedClientId) return;
    setLoading(true);
    onBusyChange?.(true);
    try {
      const agg = await fetchWorkEngineInvoiceRetainerSetupAggregate({
        representedClientId,
      });
      setAggregate(agg);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      onBusyChange?.(false);
    }
  }, [onBusyChange, onError, representedClientId]);

  useEffect(() => {
    if (!open || !representedClientId) {
      setAggregate(null);
      setSelectedId(null);
      return;
    }
    void loadAggregate();
  }, [loadAggregate, open, representedClientId, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, loading, onClose, open]);

  const handleContinue = async () => {
    if (!representedClientId || !selectedId) return;
    setLoading(true);
    onBusyChange?.(true);
    try {
      const agg = await fetchWorkEngineInvoiceRetainerSetupAggregate({
        representedClientId,
        endCustomerId: selectedId,
      });
      onSelectCustomer(selectedId, agg);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      onBusyChange?.(false);
    }
  };

  if (!open || !representedClientId) return null;

  const rows = aggregate?.end_customers ?? [];

  return (
    <div
      className="nx-we-retainer-overlay nx-invoice-ui"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-retainer-customers-title"
      onClick={() => {
        if (!busy && !loading) onClose();
      }}
    >
      <div className="nx-we-retainer-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="nx-we-retainer-modal__head">
          <div className="nx-we-retainer-modal__head-text">
            <h2 id="we-retainer-customers-title" className="nx-we-retainer-modal__title">
              ריטיינר חשבוניות — {clientDisplayName || aggregate?.client_display_name}
            </h2>
            <p className="nx-we-retainer-modal__subtitle">בחרו לקוח קצה להגדרת מסמך חוזר</p>
          </div>
          {canAddCustomer && onAddCustomer ? (
            <button
              type="button"
              className="nx-we-retainer-add-btn"
              disabled={busy || loading}
              onClick={() => void onAddCustomer()}
            >
              הוסף לקוח חדש
            </button>
          ) : null}
          <button
            type="button"
            className="nx-we-retainer-modal__close"
            aria-label="סגירה"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="nx-we-retainer-modal__body">
          {loading && !aggregate ? (
            <p className="nx-we-retainer-note">טוען לקוחות…</p>
          ) : rows.length === 0 ? (
            <p className="nx-we-retainer-note">אין לקוחות קצה פעילים ללקוח משרד זה.</p>
          ) : (
            <div className="nx-we-retainer-table-wrap">
              <table className="nx-we-retainer-table">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 48 }} />
                    <th scope="col">שם לקוח</th>
                    <th scope="col">אימייל / ח.פ.</th>
                    <th scope="col">סטטוס ריטיינר</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const sub = [row.email, row.tax_id].filter(Boolean).join(' · ');
                    return (
                      <tr key={row.end_customer_id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedId === row.end_customer_id}
                            disabled={busy || loading || !row.selectable}
                            aria-label={`בחר ${row.display_name}`}
                            onChange={() => setSelectedId(row.end_customer_id)}
                          />
                        </td>
                        <td>{row.display_name}</td>
                        <td>
                          {sub || '—'}
                          {row.profile_summary ? (
                            <span className="nx-we-retainer-table__sub">{row.profile_summary}</span>
                          ) : null}
                        </td>
                        <td>
                          {row.profile_status_label ? (
                            <span className="nx-we-retainer-status" data-status={row.profile_status ?? undefined}>
                              {row.profile_status_label}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="nx-we-retainer-modal__footer">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || loading} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={busy || loading || !selectedId}
            onClick={() => void handleContinue()}
          >
            המשך
          </button>
        </div>
      </div>
    </div>
  );
}
