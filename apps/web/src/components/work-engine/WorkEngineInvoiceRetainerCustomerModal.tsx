import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [listLoading, setListLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!open || !representedClientId) {
      setAggregate(null);
      setSelectingId(null);
      setListLoading(false);
      return;
    }

    let cancelled = false;
    setListLoading(true);
    setSelectingId(null);

    void fetchWorkEngineInvoiceRetainerSetupAggregate({ representedClientId })
      .then((agg) => {
        if (!cancelled) setAggregate(agg);
      })
      .catch((e) => {
        if (!cancelled) onErrorRef.current?.(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, representedClientId, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !listLoading && !selectingId) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, listLoading, onClose, open, selectingId]);

  const selectCustomer = async (endCustomerId: string, selectable: boolean) => {
    if (listLoading || selectingId || !selectable || !representedClientId) return;

    setSelectingId(endCustomerId);
    onBusyChange?.(true);
    try {
      const agg = await fetchWorkEngineInvoiceRetainerSetupAggregate({
        representedClientId,
        endCustomerId,
      });
      onSelectCustomer(endCustomerId, agg);
      onClose();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSelectingId(null);
      onBusyChange?.(false);
    }
  };

  if (!open || !representedClientId) return null;

  const rows = aggregate?.end_customers ?? [];
  const interactionLocked = listLoading || Boolean(selectingId);

  const dialog = (
    <div
      className="nx-we-retainer-overlay nx-invoice-ui"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-retainer-customers-title"
      onClick={() => {
        if (!busy && !interactionLocked) onClose();
      }}
    >
      <div className="nx-we-retainer-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="nx-we-retainer-modal__head">
          <div className="nx-we-retainer-modal__head-text">
            <h2 id="we-retainer-customers-title" className="nx-we-retainer-modal__title">
              ריטיינר חשבוניות — {clientDisplayName || aggregate?.client_display_name}
            </h2>
          </div>
          {canAddCustomer && onAddCustomer ? (
            <button
              type="button"
              className="nx-we-retainer-add-btn"
              disabled={busy || interactionLocked}
              onClick={() => void onAddCustomer()}
            >
              הוסף לקוח חדש
            </button>
          ) : null}
          <button
            type="button"
            className="nx-we-retainer-modal__close"
            aria-label="סגירה"
            disabled={Boolean(selectingId)}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="nx-we-retainer-modal__body">
          {listLoading && !aggregate ? (
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
                    const isSelecting = selectingId === row.end_customer_id;
                    return (
                      <tr
                        key={row.end_customer_id}
                        className={
                          isSelecting
                            ? 'nx-we-retainer-table__row nx-we-retainer-table__row--selected'
                            : 'nx-we-retainer-table__row'
                        }
                        onClick={() => void selectCustomer(row.end_customer_id, row.selectable)}
                      >
                        <td className="nx-we-retainer-table__check-col">
                          <input
                            type="checkbox"
                            checked={isSelecting}
                            readOnly
                            disabled={interactionLocked || !row.selectable}
                            aria-label="בחירת לקוח לריטיינר"
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => void selectCustomer(row.end_customer_id, row.selectable)}
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
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || interactionLocked}
            onClick={onClose}
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
