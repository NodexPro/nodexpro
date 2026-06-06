import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  IncomeClientDocumentManagementPanel,
  IncomeClientDocumentManagementReportItem,
  IncomeClientDocumentManagementRow,
  IncomeClientDocumentManagementRowAction,
  IncomeCustomersTableRow,
  IncomeTableModel,
} from '../../api/income';

/** RTL visual order (first = far right). Display-only; backend column order unchanged. */
const VISUAL_COLUMN_KEYS = [
  'client',
  'status_label',
  'total_documents_count',
  'unpaid_amount_display',
  'last_document_date_display',
  'last_activity_display',
  'actions',
] as const;

type VisualColumnKey = (typeof VISUAL_COLUMN_KEYS)[number];

function resolveVisualColumns(
  columns: Array<{ key: string; label: string }>,
): Array<{ key: VisualColumnKey; label: string }> {
  const byKey = new Map(columns.map((col) => [col.key, col]));
  return VISUAL_COLUMN_KEYS.flatMap((key) => {
    const col = byKey.get(key);
    return col ? [{ key, label: col.label }] : [];
  });
}

function ActionIcon({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case 'settings':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M19.4 13.5a7.6 7.6 0 0 0 .1-3l2-1.2-2-3.5-2.3.7a7.8 7.8 0 0 0-2.6-1.5L14.2 2h-4.4l-.4 2.9a7.8 7.8 0 0 0-2.6 1.5l-2.3-.7-2 3.5 2 1.2a7.6 7.6 0 0 0-.1 3l-2 1.2 2 3.5 2.3-.7a7.8 7.8 0 0 0 2.6 1.5l.4 2.9h4.4l.4-2.9a7.8 7.8 0 0 0 2.6-1.5l2.3.7 2-3.5-2-1.2Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'end_customers':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M16 11a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M4 19c.8-2.8 3.2-4.5 8-4.5s7.2 1.7 8 4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M18 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M21 19c-.5-1.8-1.8-3-4-3.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'reports':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 19V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12 19V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M19 19v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 19h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'more':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="18" cy="12" r="1.6" fill="currentColor" />
        </svg>
      );
    case 'ledger':
      return <span className="nx-income-cdm__action-letter">כ</span>;
    default:
      return null;
  }
}

export type IncomeClientDocumentPanelActionResult =
  | { kind: 'command'; action: IncomeClientDocumentManagementRowAction; clientName: string }
  | { kind: 'reports'; clientId: string; clientName: string }
  | { kind: 'ledger'; clientId: string; clientName: string }
  | { kind: 'more'; clientId: string; clientName: string; anchor: HTMLButtonElement };

type PanelProps = {
  panel: IncomeClientDocumentManagementPanel;
  busy: boolean;
  onAction: (result: IncomeClientDocumentPanelActionResult) => void | Promise<void>;
  renderDocumentsCell?: (row: IncomeClientDocumentManagementRow) => ReactNode;
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
      <ActionIcon iconKey={action.icon_key} />
    </button>
  );
}

function ClientCell({ row }: { row: IncomeClientDocumentManagementRow }) {
  const subtext = [row.tax_id, row.email].filter(Boolean).join(' · ');

  return (
    <div className="nx-income-cdm__client">
      <div className="nx-income-cdm__avatar">
        {row.client_logo_url ? (
          <img className="nx-income-cdm__logo" src={row.client_logo_url} alt="" />
        ) : (
          <span className="nx-income-cdm__logo-fallback" aria-hidden>
            {row.client_initials}
          </span>
        )}
      </div>
      <div className="nx-income-cdm__client-meta">
        <span className="nx-income-cdm__client-name">{row.client_display_name}</span>
        {subtext ? <span className="nx-income-cdm__client-sub">{subtext}</span> : null}
      </div>
    </div>
  );
}

function renderRowCell(row: IncomeClientDocumentManagementRow, columnKey: string): string {
  if (columnKey === 'client') return row.client_display_name;
  const value = (row as unknown as Record<string, unknown>)[columnKey];
  if (value == null || value === '') return '—';
  return String(value);
}

function renderDataCell(
  row: IncomeClientDocumentManagementRow,
  colKey: VisualColumnKey,
  busy: boolean,
  onAction: PanelProps['onAction'],
  renderDocumentsCell?: PanelProps['renderDocumentsCell'],
) {
  if (colKey === 'client') return <ClientCell row={row} />;
  if (colKey === 'total_documents_count' && renderDocumentsCell) {
    return renderDocumentsCell(row);
  }
  if (colKey === 'status_label') {
    return (
      <span className="nx-income-cdm__status" data-status={row.status_label}>
        {row.status_label}
      </span>
    );
  }
  if (colKey === 'actions') {
    return (
      <div className="nx-income-cdm__actions">
        {(row.actions ?? []).map((action) => (
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
                                  if (action.key === 'open_income_ledger_card') {
                                    void onAction({
                                      kind: 'ledger',
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
    );
  }

  const value = renderRowCell(row, colKey);
  return (
    <span className={value === '—' ? 'nx-income-cdm__muted' : undefined}>{value}</span>
  );
}

export function IncomeClientDocumentManagementPanelView({
  panel,
  busy,
  onAction,
  renderDocumentsCell,
}: PanelProps) {
  if (!panel?.visible) return null;

  const visualColumns = resolveVisualColumns(panel.columns ?? []);
  const rows = panel.rows ?? [];

  return (
    <section className="nx-income-cdm" dir="rtl" aria-labelledby="income-cdm-title">
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
                  {visualColumns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={
                        col.key === 'client'
                          ? 'nx-income-cdm__cell--client'
                          : col.key === 'actions'
                            ? 'nx-income-cdm__cell--actions'
                            : undefined
                      }
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.represented_client_id}>
                    {visualColumns.map((col) => (
                      <td
                        key={col.key}
                        className={
                          col.key === 'client'
                            ? 'nx-income-cdm__cell--client'
                            : col.key === 'actions'
                              ? 'nx-income-cdm__cell--actions'
                              : undefined
                        }
                      >
                        {renderDataCell(row, col.key, busy, onAction, renderDocumentsCell)}
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
            {(catalog ?? []).map((item) => (
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
  canCreate,
  canEdit,
  onClose,
  onCreateCustomer,
  onUpdateCustomer,
}: {
  open: boolean;
  clientName: string;
  model: IncomeTableModel<IncomeCustomersTableRow>;
  busy: boolean;
  canCreate: boolean;
  canEdit: boolean;
  onClose: () => void;
  onCreateCustomer: (payload: {
    display_name: string;
    phone: string | null;
    email: string | null;
    tax_id: string | null;
  }) => Promise<void>;
  onUpdateCustomer: (
    customerId: string,
    payload: {
      display_name: string;
      phone: string | null;
      email: string | null;
      tax_id: string | null;
    },
  ) => Promise<void>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [form, setForm] = useState({ display_name: '', phone: '', email: '', tax_id: '' });
  const [submitting, setSubmitting] = useState(false);

  const columns = model?.columns ?? [];
  const rows = model?.rows ?? [];

  const openCreate = () => {
    setEditorMode('create');
    setEditingCustomerId(null);
    setForm({ display_name: '', phone: '', email: '', tax_id: '' });
    setEditorOpen(true);
  };

  const openEdit = (row: IncomeCustomersTableRow) => {
    setEditorMode('edit');
    setEditingCustomerId(row.customer_id);
    setForm({
      display_name: row.display_name ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      tax_id: row.tax_id ?? '',
    });
    setEditorOpen(true);
  };

  const submitEditor = async () => {
    const payload = {
      display_name: form.display_name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      tax_id: form.tax_id.trim() || null,
    };
    if (!payload.display_name) return;
    setSubmitting(true);
    try {
      if (editorMode === 'create') {
        await onCreateCustomer(payload);
      } else if (editingCustomerId) {
        await onUpdateCustomer(editingCustomerId, payload);
      }
      setEditorOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-cdm-modal" role="dialog" aria-modal="true">
        <div className="nx-income-cdm-end-customers nx-income-wizard nx-accounting-editor-modal">
          <div className="nx-income-wizard__head nx-income-cdm-end-customers__head">
            <h2 className="nx-modal-title">לקוחות — {clientName}</h2>
            {canCreate ? (
              <button
                type="button"
                className="nx-income-cdm-end-customers__add"
                disabled={busy || submitting}
                onClick={openCreate}
              >
                הוסף לקוח חדש
              </button>
            ) : null}
          </div>
          <div className="nx-income-wizard__body">
            <div className="nx-income-cdm-end-customers__table-wrap">
              <table className="nx-income-cdm-end-customers__table">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col.key} scope="col">
                        {col.label}
                      </th>
                    ))}
                    {canEdit ? <th scope="col" className="nx-income-cdm-end-customers__actions-col" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.customer_id}>
                      {columns.map((col) => (
                        <td key={col.key}>
                          {renderEndCustomerCell(row, col.key)}
                        </td>
                      ))}
                      {canEdit ? (
                        <td className="nx-income-cdm-end-customers__actions-col">
                          <button
                            type="button"
                            className="nx-income-cdm-end-customers__edit"
                            disabled={busy || submitting}
                            aria-label={`עריכת ${row.display_name}`}
                            title="עריכה"
                            onClick={() => openEdit(row)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path
                                d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="nx-income-wizard__footer nx-modal-footer nx-tax-nested-modal-footer">
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || submitting} onClick={onClose}>
              סגירה
            </button>
          </div>
        </div>
      </div>

      {editorOpen ? (
        <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-cdm-modal" role="dialog" aria-modal="true">
          <div className="nx-income-cdm-end-customers-editor nx-income-wizard nx-income-wizard--compact nx-accounting-editor-modal">
            <div className="nx-income-wizard__head">
              <h2 className="nx-modal-title">
                {editorMode === 'create' ? 'הוסף לקוח חדש' : 'עריכת לקוח'}
              </h2>
            </div>
            <div className="nx-income-wizard__body">
              <div className="nx-income-field">
                <label>שם</label>
                <input
                  value={form.display_name}
                  disabled={busy || submitting}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>טלפון</label>
                <input
                  value={form.phone}
                  disabled={busy || submitting}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>אימייל</label>
                <input
                  value={form.email}
                  disabled={busy || submitting}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>מספר זיהוי</label>
                <input
                  value={form.tax_id}
                  disabled={busy || submitting}
                  onChange={(e) => setForm((f) => ({ ...f, tax_id: e.target.value }))}
                />
              </div>
            </div>
            <div className="nx-income-wizard__footer nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={busy || submitting}
                onClick={() => setEditorOpen(false)}
              >
                סגירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                disabled={busy || submitting || !form.display_name.trim()}
                onClick={() => void submitEditor()}
              >
                {submitting ? 'שומר…' : 'שמירה'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function renderEndCustomerCell(row: IncomeCustomersTableRow, columnKey: string): string {
  const value = (row as unknown as Record<string, unknown>)[columnKey];
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'כן' : 'לא';
  return String(value);
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
