import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { IncomeClientIncomeLedgerCardAggregate } from '../../api/income';
import { fetchIncomeClientIncomeLedgerCardAggregate } from '../../api/income';
import { IncomeIssuedDocumentViewModal } from './IncomeIssuedDocumentViewModal';

type Props = {
  open: boolean;
  representedClientId: string | null;
  representedClientDisplayName?: string | null;
  /** Optional backend-scoped end customer when opening from an end-customer row. */
  initialEndCustomerId?: string | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onError?: (message: string) => void;
};

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
        strokeLinejoin="round"
      />
      <path d="M6 9h12v8H6V9Z" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function columnClassName(key: string): string | undefined {
  if (key === 'original_amount_display' || key === 'remaining_balance_display') {
    return 'nx-income-ledger-modal__num-col';
  }
  if (key === 'view') return 'nx-income-ledger-modal__view-col';
  if (key === 'document_type_label') return 'nx-income-ledger-modal__type-col';
  if (key === 'document_number') return 'nx-income-ledger-modal__doc-col';
  if (key === 'issue_date_display') return 'nx-income-ledger-modal__date-col';
  return undefined;
}

export function IncomeClientIncomeLedgerCardModal({
  open,
  representedClientId,
  initialEndCustomerId = null,
  busy,
  onBusyChange,
  onClose,
  onError,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const [aggregate, setAggregate] = useState<IncomeClientIncomeLedgerCardAggregate | null>(null);
  const [issuedViewDocId, setIssuedViewDocId] = useState<string | null>(null);

  const loadAggregate = useCallback(
    async (params: { year?: number | null; endCustomerId?: string | null }) => {
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
      setIssuedViewDocId(null);
      return;
    }
    // Clear prior recipient identity before reload (no stale Uniliver→Chicago flash).
    setAggregate(null);
    void loadAggregate({
      endCustomerId: initialEndCustomerId ?? null,
    });
  }, [loadAggregate, open, representedClientId, initialEndCustomerId]);

  const handleYearChange = (year: number) => {
    void loadAggregate({ year });
  };

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleTopAction = useCallback(
    (action: NonNullable<IncomeClientIncomeLedgerCardAggregate['top_actions']>[number]) => {
      if (busy || !action.enabled) return;
      if (action.key === 'print_ledger') handlePrint();
    },
    [busy, handlePrint],
  );

  const handleClose = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  if (!open) return null;

  // Primary = recipient when scoped; issuer otherwise. Aggregate-only (no prop fallback).
  const recipientName = aggregate?.selected_end_customer_display_name?.trim() || null;
  const issuerName = aggregate?.represented_client_display_name ?? '—';
  const primaryName = recipientName || issuerName;
  const topActions = aggregate?.top_actions ?? [];
  const yearOptions =
    aggregate?.available_years?.length ? aggregate.available_years : [new Date().getFullYear()];
  const selectedYear = aggregate?.selected_year ?? yearOptions[0]!;
  const tableColumns = aggregate?.table_columns ?? [];
  const rows = aggregate?.rows ?? [];
  const userNotice = aggregate?.user_notice?.trim() || null;

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-ledger-modal" role="dialog" aria-modal="true">
      <div className="nx-income-ledger-modal__dialog">
        <header className="nx-income-ledger-modal__header">
          <div className="nx-income-ledger-modal__header-top">
            <div className="nx-income-ledger-modal__header-main">
              <h2 className="nx-income-ledger-modal__title">כרטסת הכנסות</h2>
              <p className="nx-income-ledger-modal__customer-name">{primaryName}</p>
              {recipientName ? (
                <p className="nx-income-ledger-modal__issuer">עבור העסק: {issuerName}</p>
              ) : null}
            </div>
            <div className="nx-income-ledger-modal__header-actions">
              {topActions.map((action) => {
                const isSend = action.key === 'send_ledger';
                const isPrint = action.key === 'print_ledger';
                const ariaLabel = isSend ? 'שליחה' : isPrint ? 'הדפסה' : action.label;
                const title = action.enabled
                  ? action.label
                  : (action.disabled_reason ?? action.label);
                return (
                  <button
                    key={action.key}
                    type="button"
                    className="nx-income-ledger-modal__top-action"
                    disabled={busy || !action.enabled}
                    title={title}
                    aria-label={ariaLabel}
                    aria-disabled={busy || !action.enabled}
                    onClick={() => handleTopAction(action)}
                  >
                    <TopActionIcon iconKey={action.icon_key} />
                    <span className="nx-income-ledger-modal__top-action-label">{action.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="nx-income-ledger-modal__close-btn"
                aria-label="סגירה"
                title="סגירה"
                onClick={handleClose}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M18 6 6 18M6 6l12 12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="nx-income-ledger-modal__meta">
            <label className="nx-income-ledger-modal__year">
              <span className="nx-income-ledger-modal__meta-label">שנה:</span>
              <select
                value={selectedYear}
                disabled={busy || !aggregate}
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
          {userNotice ? (
            <p className="nx-income-ledger-modal__source-note" role="status">
              {userNotice}
            </p>
          ) : null}

          <div className="nx-income-ledger-modal__table-wrap">
            <table className="nx-income-ledger-modal__table">
              <thead>
                <tr>
                  {tableColumns.map((col) => (
                    <th key={col.key} scope="col" className={columnClassName(col.key)}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.row_id}
                    className={
                      row.visual_role === 'child'
                        ? 'nx-income-ledger-modal__row--child'
                        : 'nx-income-ledger-modal__row--parent'
                    }
                  >
                    <td className="nx-income-ledger-modal__type-col">
                      {row.visual_role === 'child' ? (
                        <span className="nx-income-ledger-modal__child-label">{row.document_type_label}</span>
                      ) : (
                        row.document_type_label
                      )}
                    </td>
                    <td className="nx-income-ledger-modal__doc-col">{row.document_number || ''}</td>
                    <td className="nx-income-ledger-modal__date-col">{row.issue_date_display}</td>
                    <td
                      className={`nx-income-ledger-modal__num-col${
                        row.amount_tone === 'payment' ? ' nx-income-ledger-modal__payment-amount' : ''
                      }`}
                    >
                      {row.original_amount_display}
                    </td>
                    <td
                      className={`nx-income-ledger-modal__num-col nx-income-ledger-modal__balance${
                        row.visual_role === 'parent' && row.remaining_balance_display
                          ? ' nx-income-ledger-modal__balance--invoice'
                          : ''
                      }`}
                    >
                      {row.remaining_balance_display}
                    </td>
                    <td className="nx-income-ledger-modal__view-col">
                      {row.visual_role === 'parent' && row.view_action?.enabled ? (
                        <button
                          type="button"
                          className="nx-income-ledger-modal__view"
                          disabled={busy}
                          aria-label={row.view_action.label}
                          title={row.view_action.label}
                          onClick={() => setIssuedViewDocId(row.view_action!.income_document_id)}
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
                        ''
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {aggregate && !aggregate.empty_state.visible ? (
                <tfoot>
                  <tr className="nx-income-ledger-modal__footer-row">
                    <td colSpan={4} className="nx-income-ledger-modal__footer-label">
                      יתרה
                    </td>
                    <td className="nx-income-ledger-modal__balance nx-income-ledger-modal__num-col nx-income-ledger-modal__footer-balance">
                      {aggregate.summary.open_balance_display}
                    </td>
                    <td />
                  </tr>
                                  {aggregate.customer_credit?.visible ? (
                    <tr className="nx-income-ledger-modal__footer-row">
                      <td colSpan={4} className="nx-income-ledger-modal__footer-label">
                        {aggregate.customer_credit.label}
                      </td>
                      <td />
                      <td className="nx-income-ledger-modal__num-col nx-income-ledger-modal__credit-amount">
                        {aggregate.customer_credit.amount_display}
                      </td>
                      <td className="nx-income-ledger-modal__num-col">
                        {aggregate.customer_credit.status_label}
                      </td>
                      <td />
                    </tr>
                  ) : null}
</tfoot>
              ) : null}
            </table>
            {aggregate?.empty_state.visible ? (
              <p className="nx-income-ledger-modal__empty">{aggregate.empty_state.title}</p>
            ) : null}
          </div>
        </div>
      </div>
      <IncomeIssuedDocumentViewModal
        open={Boolean(issuedViewDocId)}
        incomeDocumentId={issuedViewDocId}
        representedClientId={representedClientId}
        busy={busy}
        onBusyChange={onBusyChange}
        onClose={() => setIssuedViewDocId(null)}
        onError={onError}
      />
    </div>
  );
}
