import { useCallback, useEffect, useRef, useState } from 'react';
import type { IncomeClientIncomeLedgerCardAggregate } from '../../api/income';
import {
  downloadIncomeDocumentPdf,
  fetchIncomeClientIncomeLedgerCardAggregate,
  incomeApiPathFromBackend,
} from '../../api/income';

type Props = {
  open: boolean;
  representedClientId: string | null;
  representedClientDisplayName?: string | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onError?: (message: string) => void;
};

/** RTL visual order (first column = far right). Display-only. */
const LEDGER_TABLE_COLUMNS = [
  { key: 'income_label', label: 'הכנסה' },
  { key: 'debit_amount_display', label: 'חובה' },
  { key: 'credit_amount_display', label: 'זכות' },
  { key: 'balance_display', label: 'יתרה' },
  { key: 'document_number', label: 'מס חש' },
  { key: 'issue_date_display', label: 'תאריך הפקה' },
  { key: 'view', label: 'צפייה' },
] as const;

const DEFAULT_TOP_ACTIONS = [
  { key: 'send_ledger', label: 'שליחה', icon_key: 'send' as const, enabled: false, disabled_reason: 'בקרוב' },
  { key: 'print_ledger', label: 'הדפסה', icon_key: 'print' as const, enabled: true, disabled_reason: null },
];

function TopActionIcon({ iconKey }: { iconKey: string }) {
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

function resolveFooterBalanceDisplay(aggregate: IncomeClientIncomeLedgerCardAggregate): string {
  const rows = aggregate.rows ?? [];
  if (rows.length > 0) {
    return rows[rows.length - 1]?.balance_display ?? aggregate.summary?.open_balance_display ?? '₪0.00';
  }
  return aggregate.summary?.open_balance_display ?? '₪0.00';
}

function columnClassName(key: string): string | undefined {
  if (key === 'debit_amount_display' || key === 'credit_amount_display' || key === 'balance_display') {
    return 'nx-income-ledger-modal__num-col';
  }
  if (key === 'view') return 'nx-income-ledger-modal__view-col';
  if (key === 'income_label') return 'nx-income-ledger-modal__income-col';
  if (key === 'document_number') return 'nx-income-ledger-modal__doc-col';
  if (key === 'issue_date_display') return 'nx-income-ledger-modal__date-col';
  return undefined;
}

export function IncomeClientIncomeLedgerCardModal({
  open,
  representedClientId,
  representedClientDisplayName,
  busy,
  onBusyChange,
  onClose,
  onError,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const [aggregate, setAggregate] = useState<IncomeClientIncomeLedgerCardAggregate | null>(null);

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
      return;
    }
    void loadAggregate({});
  }, [loadAggregate, open, representedClientId]);

  const handleSelectCustomer = (endCustomerId: string) => {
    if (!endCustomerId) return;
    void loadAggregate({ endCustomerId });
  };

  const handleYearChange = (year: number) => {
    void loadAggregate({
      endCustomerId: aggregate?.selected_end_customer_id ?? null,
      year,
    });
  };

  const handleViewDocument = async (documentId: string | null) => {
    if (!documentId || !aggregate?.document_download_path_template) return;
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

  const officeClientName =
    aggregate?.represented_client_display_name ?? representedClientDisplayName ?? '—';
  const topActions =
    aggregate?.top_actions?.length ? aggregate.top_actions : DEFAULT_TOP_ACTIONS;
  const endCustomerOptions = aggregate?.end_customer_options ?? [];
  const yearOptions =
    aggregate?.available_years?.length ? aggregate.available_years : [new Date().getFullYear()];
  const selectedYear = aggregate?.selected_year ?? yearOptions[0]!;
  const footerBalanceDisplay = aggregate ? resolveFooterBalanceDisplay(aggregate) : '₪0.00';

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-ledger-modal" role="dialog" aria-modal="true">
      <div className="nx-income-ledger-modal__dialog">
        <header className="nx-income-ledger-modal__header">
          <div className="nx-income-ledger-modal__header-top">
            <h2 className="nx-income-ledger-modal__title">כרטסת הכנסות</h2>
            <div className="nx-income-ledger-modal__header-actions">
              {topActions.map((action) => (
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
                  <span className="nx-income-ledger-modal__top-action-label">{action.label}</span>
                </button>
              ))}
              <button
                type="button"
                className="nx-income-ledger-modal__top-action nx-income-ledger-modal__close"
                disabled={busy}
                aria-label="סגירה"
                onClick={onClose}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M18 6 6 18M6 6l12 12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="nx-income-ledger-modal__top-action-label">סגירה</span>
              </button>
            </div>
          </div>

          <div className="nx-income-ledger-modal__meta">
            <span className="nx-income-ledger-modal__meta-item">
              <span className="nx-income-ledger-modal__meta-label">לקוח משרד:</span>
              <span className="nx-income-ledger-modal__meta-value">{officeClientName}</span>
            </span>
            <label className="nx-income-ledger-modal__meta-item nx-income-ledger-modal__customer-select">
              <span className="nx-income-ledger-modal__meta-label">לקוח:</span>
              <select
                value={aggregate?.selected_end_customer_id ?? ''}
                disabled={busy || !aggregate || endCustomerOptions.length === 0}
                onChange={(e) => handleSelectCustomer(e.target.value)}
              >
                {!aggregate || endCustomerOptions.length === 0 ? (
                  <option value="">—</option>
                ) : (
                  <>
                    {!aggregate.selected_end_customer_id ? (
                      <option value="" disabled>
                        בחר לקוח
                      </option>
                    ) : null}
                    {endCustomerOptions.map((option) => (
                      <option key={option.end_customer_id} value={option.end_customer_id}>
                        {option.display_name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
            <label className="nx-income-ledger-modal__year">
              <span className="nx-income-ledger-modal__meta-label">שנה:</span>
              <select
                value={selectedYear}
                disabled={busy || !aggregate || !aggregate.selected_end_customer_id}
                onChange={(e) => handleYearChange(Number(e.target.value))}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="nx-income-ledger-modal__body" ref={printRef}>
          {aggregate?.financial_source === 'TEMPORARY_ACCOUNTING_BASE_PENDING' ? (
            <p className="nx-income-ledger-modal__source-note" role="status">
              מקור כספי: TEMPORARY_ACCOUNTING_BASE_PENDING — ערכי ייחוס ממסמכי הכנסה בלבד.
            </p>
          ) : null}

          <div className="nx-income-ledger-modal__table-wrap">
            <table className="nx-income-ledger-modal__table">
              <thead>
                <tr>
                  {LEDGER_TABLE_COLUMNS.map((col) => (
                    <th key={col.key} scope="col" className={columnClassName(col.key)}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(aggregate?.rows ?? []).map((row) => (
                  <tr key={row.row_id}>
                    <td className="nx-income-ledger-modal__income-col">{row.income_label}</td>
                    <td className="nx-income-ledger-modal__debit nx-income-ledger-modal__num-col">
                      {row.debit_amount_display ?? '—'}
                    </td>
                    <td className="nx-income-ledger-modal__credit nx-income-ledger-modal__num-col">
                      {row.credit_amount_display ?? '—'}
                    </td>
                    <td
                      className={`nx-income-ledger-modal__balance nx-income-ledger-modal__num-col${
                        row.balance_tone === 'open' ? ' nx-income-ledger-modal__balance--open' : ''
                      }`}
                    >
                      {row.balance_display}
                    </td>
                    <td className="nx-income-ledger-modal__doc-col">{row.document_number}</td>
                    <td className="nx-income-ledger-modal__date-col">{row.issue_date_display}</td>
                    <td className="nx-income-ledger-modal__view-col">
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
              <tfoot>
                <tr className="nx-income-ledger-modal__footer-row">
                  <td colSpan={3} className="nx-income-ledger-modal__footer-label">
                    יתרה
                  </td>
                  <td className="nx-income-ledger-modal__balance nx-income-ledger-modal__num-col nx-income-ledger-modal__footer-balance">
                    {footerBalanceDisplay}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
