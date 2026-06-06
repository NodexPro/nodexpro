import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IncomeClientIncomeLedgerCardAggregate } from '../../api/income';
import {
  downloadIncomeDocumentPdf,
  fetchIncomeClientIncomeLedgerCardAggregate,
  incomeApiPathFromBackend,
} from '../../api/income';

type Props = {
  open: boolean;
  representedClientId: string | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onError?: (message: string) => void;
};

function TopActionIcon({ iconKey }: { iconKey: 'send' | 'print' }) {
  if (iconKey === 'send') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M22 3 11 14"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M22 3 15 22l-4-9-9-4 20-5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9V3h12v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 14H4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2h-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M6 9h12v8H6V9Z" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function IncomeClientIncomeLedgerCardModal({
  open,
  representedClientId,
  busy,
  onBusyChange,
  onClose,
  onError,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const [aggregate, setAggregate] = useState<IncomeClientIncomeLedgerCardAggregate | null>(null);
  const [customerFilter, setCustomerFilter] = useState('');

  const loadAggregate = useCallback(
    async (params: { endCustomerId?: string | null; year?: number | null }) => {
      if (!representedClientId) return;
      onBusyChange?.(true);
      try {
        const next = await fetchIncomeClientIncomeLedgerCardAggregate({
          representedClientId,
          endCustomerId: params.endCustomerId ?? null,
          year: params.year ?? null,
        });
        setAggregate(next);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
      } finally {
        onBusyChange?.(false);
      }
    },
    [onBusyChange, onError, representedClientId],
  );

  useEffect(() => {
    if (!open || !representedClientId) {
      setAggregate(null);
      setCustomerFilter('');
      return;
    }
    void loadAggregate({});
  }, [loadAggregate, open, representedClientId]);

  const filteredOptions = useMemo(() => {
    if (!aggregate) return [];
    const q = customerFilter.trim().toLowerCase();
    if (!q) return aggregate.end_customer_options;
    return aggregate.end_customer_options.filter((o) => {
      const hay = `${o.display_name} ${o.tax_id ?? ''} ${o.email ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [aggregate, customerFilter]);

  const handleSelectCustomer = (endCustomerId: string) => {
    void loadAggregate({ endCustomerId });
  };

  const handleYearChange = (year: number) => {
    void loadAggregate({
      endCustomerId: aggregate?.selected_end_customer_id ?? null,
      year,
    });
  };

  const handleViewDocument = async (documentId: string | null) => {
    if (!documentId || !aggregate) return;
    const path = aggregate.document_download_path_template.replace('{document_id}', documentId);
    try {
      onBusyChange?.(true);
      await downloadIncomeDocumentPdf(incomeApiPathFromBackend(path), 'document.pdf');
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!open) return null;

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-ledger-modal" role="dialog" aria-modal="true">
      <div className="nx-income-ledger-modal__dialog">
        <header className="nx-income-ledger-modal__header">
          <div className="nx-income-ledger-modal__header-main">
            <h2 className="nx-income-ledger-modal__title">כרטסת הכנסות</h2>
            <p className="nx-income-ledger-modal__subtitle">תנועות חובה / זכות / יתרה לפי לקוח</p>
          </div>
          <div className="nx-income-ledger-modal__header-actions">
            {(aggregate?.top_actions ?? []).map((action) => (
              <button
                key={action.key}
                type="button"
                className="nx-income-ledger-modal__top-action"
                disabled={busy || !action.enabled}
                title={action.enabled ? action.label : (action.disabled_reason ?? action.label)}
                aria-label={action.label}
                onClick={() => {
                  if (action.key === 'print_ledger') handlePrint();
                }}
              >
                <TopActionIcon iconKey={action.icon_key} />
                <span>{action.label}</span>
              </button>
            ))}
            <button
              type="button"
              className="nx-income-ledger-modal__close"
              disabled={busy}
              aria-label="סגירה"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className="nx-income-ledger-modal__body" ref={printRef}>
          {aggregate?.financial_source === 'TEMPORARY_ACCOUNTING_BASE_PENDING' ? (
            <p className="nx-income-ledger-modal__source-note" role="status">
              מקור כספי: TEMPORARY_ACCOUNTING_BASE_PENDING — ערכי ייחוס ממסמכי הכנסה בלבד.
            </p>
          ) : null}

          {aggregate && !aggregate.show_customer_picker && aggregate.selected_end_customer_id ? (
            <div className="nx-income-ledger-modal__chips">
              <div className="nx-income-ledger-modal__chip">
                <span className="nx-income-ledger-modal__chip-label">לקוח המשרד</span>
                <span className="nx-income-ledger-modal__chip-value">
                  {aggregate.represented_client_display_name}
                </span>
              </div>
              <div className="nx-income-ledger-modal__chip">
                <span className="nx-income-ledger-modal__chip-label">לקוח</span>
                <span className="nx-income-ledger-modal__chip-value">
                  {aggregate.selected_end_customer_display_name ?? '—'}
                </span>
              </div>
              <label className="nx-income-ledger-modal__year">
                <span>שנה:</span>
                <select
                  value={aggregate.selected_year}
                  disabled={busy}
                  onChange={(e) => handleYearChange(Number(e.target.value))}
                >
                  {aggregate.available_years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {aggregate?.show_customer_picker ? (
            <div className="nx-income-ledger-modal__picker">
              <h3 className="nx-income-ledger-modal__picker-title">בחר לקוח קצה</h3>
              <input
                type="search"
                className="nx-income-ledger-modal__picker-search"
                placeholder="חיפוש לפי שם / ח.פ / אימייל"
                value={customerFilter}
                disabled={busy}
                onChange={(e) => setCustomerFilter(e.target.value)}
              />
              <div className="nx-income-ledger-modal__picker-grid">
                {filteredOptions.map((option) => (
                  <button
                    key={option.end_customer_id}
                    type="button"
                    className="nx-income-ledger-modal__picker-card"
                    disabled={busy}
                    onClick={() => handleSelectCustomer(option.end_customer_id)}
                  >
                    <span className="nx-income-ledger-modal__picker-name">{option.display_name}</span>
                    <span className="nx-income-ledger-modal__picker-meta">
                      {[option.tax_id, option.email].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <span className="nx-income-ledger-modal__picker-balance">
                      יתרה פתוחה: {option.open_balance_display}
                    </span>
                    <span className="nx-income-ledger-modal__picker-count">
                      {option.open_invoice_count} חשבוניות פתוחות
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {aggregate && !aggregate.show_customer_picker ? (
            <>
              <div className="nx-income-ledger-modal__summary">
                <div className="nx-income-ledger-modal__summary-card">
                  <span className="nx-income-ledger-modal__summary-label">סה״כ חובה</span>
                  <span className="nx-income-ledger-modal__summary-value nx-income-ledger-modal__summary-value--debit">
                    {aggregate.summary.total_debit_display}
                  </span>
                </div>
                <div className="nx-income-ledger-modal__summary-card">
                  <span className="nx-income-ledger-modal__summary-label">סה״כ זכות</span>
                  <span className="nx-income-ledger-modal__summary-value nx-income-ledger-modal__summary-value--credit">
                    {aggregate.summary.total_credit_display}
                  </span>
                </div>
                <div className="nx-income-ledger-modal__summary-card">
                  <span className="nx-income-ledger-modal__summary-label">יתרה פתוחה</span>
                  <span className="nx-income-ledger-modal__summary-value">
                    {aggregate.summary.open_balance_display}
                  </span>
                </div>
                <div className="nx-income-ledger-modal__summary-card">
                  <span className="nx-income-ledger-modal__summary-label">מסמכים</span>
                  <span className="nx-income-ledger-modal__summary-value">
                    {aggregate.summary.invoice_count} חש / {aggregate.summary.payment_count} תשלומים
                  </span>
                </div>
              </div>

              {aggregate.empty_state.visible ? (
                <div className="nx-income-ledger-modal__empty">
                  <p>{aggregate.empty_state.title}</p>
                  {aggregate.empty_state.description ? <p>{aggregate.empty_state.description}</p> : null}
                </div>
              ) : (
                <div className="nx-income-ledger-modal__table-wrap">
                  <table className="nx-income-ledger-modal__table">
                    <thead>
                      <tr>
                        {aggregate.table_columns.map((col) => (
                          <th key={col.key} scope="col">
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {aggregate.rows.map((row) => (
                        <tr key={row.row_id}>
                          <td>{row.income_label}</td>
                          <td className="nx-income-ledger-modal__debit">{row.debit_amount_display ?? '—'}</td>
                          <td className="nx-income-ledger-modal__credit">{row.credit_amount_display ?? '—'}</td>
                          <td
                            className={`nx-income-ledger-modal__balance${
                              row.balance_tone === 'open' ? ' nx-income-ledger-modal__balance--open' : ''
                            }`}
                          >
                            {row.balance_display}
                          </td>
                          <td>{row.document_number}</td>
                          <td>{row.issue_date_display}</td>
                          <td>
                            {row.can_view_document ? (
                              <button
                                type="button"
                                className="nx-income-ledger-modal__view"
                                disabled={busy}
                                aria-label="צפייה במסמך"
                                title="צפייה במסמך"
                                onClick={() => void handleViewDocument(row.document_id)}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                                  <path
                                    d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                  />
                                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                                </svg>
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}

          {!aggregate && busy ? <p className="nx-income-ledger-modal__loading">טוען כרטסת…</p> : null}
        </div>
      </div>
    </div>
  );
}
