import { useEffect, useRef } from 'react';
import type {
  IncomeClientDocumentManagementPanel,
  IncomeClientDocumentManagementReportItem,
  IncomeClientDocumentManagementRow,
  IncomeClientDocumentManagementRowAction,
  IncomeCustomersTableRow,
  IncomeTableModel,
} from '../../api/income';
import { IncomeDataTable } from './IncomeDataTable';

const ACTION_GLYPH: Record<string, string> = {
  settings: '⚙',
  end_customers: '👥',
  reports: '📊',
  more: '⋯',
};

export type IncomeClientDocumentPanelActionResult =
  | { kind: 'command'; action: IncomeClientDocumentManagementRowAction; clientName: string }
  | { kind: 'reports'; clientId: string; clientName: string }
  | { kind: 'more'; clientId: string; clientName: string; anchor: HTMLButtonElement };

type PanelProps = {
  panel: IncomeClientDocumentManagementPanel;
  busy: boolean;
  onAction: (result: IncomeClientDocumentPanelActionResult) => void | Promise<void>;
};

function ActionButton({
  action,
  busy,
  onClick,
}: {
  action: IncomeClientDocumentManagementRowAction;
  busy: boolean;
  onClick: (el: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      className={`nx-income-cdm__action nx-income-cdm__action--${action.icon_key}`}
      disabled={busy || !action.enabled}
      title={action.enabled ? action.label : (action.disabled_reason ?? action.label)}
      aria-label={action.label}
      onClick={(e) => onClick(e.currentTarget)}
    >
      {ACTION_GLYPH[action.icon_key] ?? '•'}
    </button>
  );
}

function ClientCell({ row }: { row: IncomeClientDocumentManagementRow }) {
  return (
    <div className="nx-income-cdm__client">
      {row.client_logo_url ? (
        <img className="nx-income-cdm__logo" src={row.client_logo_url} alt="" />
      ) : (
        <span className="nx-income-cdm__logo-fallback" aria-hidden>
          {row.client_initials}
        </span>
      )}
      <span className="nx-income-cdm__client-name">{row.client_display_name}</span>
    </div>
  );
}

function renderRowCell(row: IncomeClientDocumentManagementRow, columnKey: string): string {
  if (columnKey === 'client') return row.client_display_name;
  const value = (row as unknown as Record<string, unknown>)[columnKey];
  if (value == null || value === '') return '—';
  return String(value);
}

export function IncomeClientDocumentManagementPanelView({ panel, busy, onAction }: PanelProps) {
  if (!panel?.visible) return null;

  const columns = panel.columns ?? [];
  const rows = panel.rows ?? [];

  return (
    <section className="nx-income-cdm" aria-labelledby="income-cdm-title">
      <div className="nx-income-cdm__card">
        <div className="nx-income-cdm__head">
          <div className="nx-income-cdm__head-main">
            <h2 id="income-cdm-title" className="nx-income-cdm__title">
              {panel.title}
            </h2>
            {panel.description ? <p className="nx-income-cdm__description">{panel.description}</p> : null}
          </div>
        </div>

        {(panel.empty_state?.visible ?? false) ? (
          <div className="nx-income-cdm__empty">
            <p className="nx-income-cdm__empty-title">{panel.empty_state.title}</p>
            {panel.empty_state.description ? (
              <p className="nx-income-cdm__empty-desc">{panel.empty_state.description}</p>
            ) : null}
          </div>
        ) : (
          <div className="nx-income-cdm__table-wrap">
            <table className="nx-income-cdm__table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} scope="col">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.represented_client_id}>
                    {columns.map((col) => (
                      <td key={col.key}>
                        {col.key === 'client' ? (
                          <ClientCell row={row} />
                        ) : col.key === 'actions' ? (
                          <div className="nx-income-cdm__actions">
                            {row.actions.map((action) => (
                              <ActionButton
                                key={action.key}
                                action={action}
                                busy={busy}
                                onClick={(anchor) => {
                                  if (action.key === 'open_reports') {
                                    void onAction({
                                      kind: 'reports',
                                      clientId: row.represented_client_id,
                                      clientName: row.client_display_name,
                                    });
                                    return;
                                  }
                                  if (action.key === 'more') {
                                    void onAction({
                                      kind: 'more',
                                      clientId: row.represented_client_id,
                                      clientName: row.client_display_name,
                                      anchor,
                                    });
                                    return;
                                  }
                                  void onAction({
                                    kind: 'command',
                                    action,
                                    clientName: row.client_display_name,
                                  });
                                }}
                              />
                            ))}
                          </div>
                        ) : (
                          <span
                            className={
                              renderRowCell(row, col.key) === '—' ? 'nx-income-cdm__muted' : undefined
                            }
                          >
                            {renderRowCell(row, col.key)}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function IncomeClientDocumentReportsModal({
  open,
  clientName,
  catalog,
  busy,
  onClose,
}: {
  open: boolean;
  clientName: string;
  catalog: IncomeClientDocumentManagementReportItem[];
  busy: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-cdm-modal" role="dialog" aria-modal="true">
      <div className="nx-income-wizard nx-income-wizard--compact nx-accounting-editor-modal">
        <div className="nx-income-wizard__head">
          <h2 className="nx-modal-title">דוחות — {clientName}</h2>
        </div>
        <div className="nx-income-wizard__body">
          <div className="nx-income-cdm-reports">
            {catalog.map((item) => (
              <div
                key={item.key}
                className={`nx-income-cdm-report-row${item.enabled ? '' : ' nx-income-cdm-report-row--disabled'}`}
              >
                <span className="nx-income-cdm-report-row__label">{item.label}</span>
                <span className="nx-income-cdm-report-row__badge">
                  {item.enabled ? 'זמין' : (item.disabled_reason ?? 'לא זמין')}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="nx-income-wizard__footer nx-modal-footer nx-tax-nested-modal-footer">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            סגירה
          </button>
        </div>
      </div>
    </div>
  );
}

export function IncomeClientEndCustomersModal({
  open,
  clientName,
  model,
  busy,
  onClose,
}: {
  open: boolean;
  clientName: string;
  model: IncomeTableModel<IncomeCustomersTableRow>;
  busy: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-cdm-modal" role="dialog" aria-modal="true">
      <div className="nx-income-wizard nx-accounting-editor-modal" style={{ maxWidth: 920 }}>
        <div className="nx-income-wizard__head">
          <h2 className="nx-modal-title">לקוחות — {clientName}</h2>
        </div>
        <div className="nx-income-wizard__body">
          <IncomeDataTable
            title=""
            panelId="income-cdm-end-customers"
            columns={model.columns}
            rows={model.rows}
            emptyState={model.empty_state}
            rowKey={(r) => r.customer_id}
            renderCell={(row, key) => {
              const v = (row as unknown as Record<string, unknown>)[key];
              if (v == null || v === '') return '—';
              if (typeof v === 'boolean') return v ? 'כן' : 'לא';
              return String(v);
            }}
          />
        </div>
        <div className="nx-income-wizard__footer nx-modal-footer nx-tax-nested-modal-footer">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            סגירה
          </button>
        </div>
      </div>
    </div>
  );
}

export function IncomeClientDocumentMoreMenu({
  open,
  clientName,
  anchorEl,
  busy,
  onClose,
}: {
  open: boolean;
  clientName: string;
  anchorEl: HTMLButtonElement | null;
  busy: boolean;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, anchorEl, onClose]);

  if (!open || !anchorEl) return null;

  const rect = anchorEl.getBoundingClientRect();

  return (
    <div
      ref={menuRef}
      className="nx-income-cdm-more-popover"
      style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, zIndex: 1200 }}
      role="menu"
      aria-label={`פעולות נוספות — ${clientName}`}
    >
      <div className="nx-income-cdm-more-menu">
        <button type="button" disabled={busy} onClick={onClose}>
          הפקת מסמך חדש — בקרוב
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          ייצוא — בקרוב
        </button>
      </div>
    </div>
  );
}
