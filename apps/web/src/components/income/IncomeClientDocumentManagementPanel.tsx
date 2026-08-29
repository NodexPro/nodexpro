import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  IncomeClientDocumentManagementCustomerGroup,
  IncomeClientDocumentManagementPanel,
  IncomeClientDocumentManagementReportItem,
  IncomeClientDocumentManagementRow,
  IncomeClientDocumentManagementRowAction,
  IncomeClientDocumentManagementSection,
  IncomeClientQuickCardAction,
  IncomeCustomerEditorField,
  IncomeCustomersTableRow,
  IncomeTableModel,
} from '../../api/income';
import {
  WORK_ENGINE_INVOICES_POPULATIONS_BOTH_LABEL,
  WORK_ENGINE_INVOICES_POPULATIONS_DISPLAY_DEFAULT,
  incomeClientDocumentManagementRowReactKey,
  resolveWorkEngineInvoicesPopulationsVisibility,
  type WorkEngineInvoicesPopulationsDisplayMode,
} from '../../income/income-client-document-management-populations-display.pure';
import type { WorkEngineInvoicesPopulationNewDocumentAction } from '../../api/work-engine';
import { ClientQuickCardPopover } from '../work-engine/ClientQuickCardPopover';

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
  hideStatusColumn = false,
): Array<{ key: VisualColumnKey; label: string }> {
  const byKey = new Map(columns.map((col) => [col.key, col]));
  const keys = hideStatusColumn
    ? VISUAL_COLUMN_KEYS.filter((key) => key !== 'status_label')
    : VISUAL_COLUMN_KEYS;
  return keys.flatMap((key) => {
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
    case 'plus':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 5v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'ledger':
      return <span className="nx-income-cdm__action-letter">כ</span>;
    case 'retainer':
      return <span className="nx-income-cdm__action-letter">ר</span>;
    case 'at':
      return <span className="nx-income-cdm__action-letter">@</span>;
    default:
      return null;
  }
}

export type IncomeClientDocumentPanelActionResult =
  | { kind: 'command'; action: IncomeClientDocumentManagementRowAction; clientName: string }
  | {
      kind: 'reports';
      clientId: string;
      clientName: string;
      endCustomerId?: string | null;
      /** Backend `report_scope` when present — FE must not invent catalog from this alone. */
      reportScope?: 'issuer' | 'recipient' | null;
      /** Issuer display name for scope header (group / parent). */
      issuerDisplayName?: string | null;
      /** Recipient display name when report_scope is recipient. */
      recipientDisplayName?: string | null;
      /**
       * Backend `available_reports` when present.
       * Null means shell should fall back to panel.report_catalog (office population).
       */
      catalog: IncomeClientDocumentManagementReportItem[] | null;
    }
  | {
      kind: 'ledger';
      clientId: string;
      clientName: string;
      /** Backend action payload end-customer scope when present. */
      endCustomerId?: string | null;
    }
  | {
      kind: 'email_history';
      clientId: string;
      clientName: string;
      /** Backend action payload end-customer scope when present. */
      endCustomerId?: string | null;
    }
  | {
      kind: 'retainer';
      clientId: string;
      clientName: string;
      /** Backend action payload end-customer scope when present. */
      endCustomerId?: string | null;
    }
  | { kind: 'more'; clientId: string; clientName: string; anchor: HTMLButtonElement }
  | {
      kind: 'quick_card_action';
      action: IncomeClientQuickCardAction;
      clientName: string;
    };

function parseReportsCatalogFromPayload(
  payload: Record<string, unknown>,
): IncomeClientDocumentManagementReportItem[] | null {
  const raw = payload.available_reports;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      key: typeof item.key === 'string' ? item.key : '',
      label: typeof item.label === 'string' ? item.label : '',
      enabled: item.enabled === true,
      disabled_reason: typeof item.disabled_reason === 'string' ? item.disabled_reason : null,
    }))
    .filter((item) => item.key.length > 0);
}

function parseReportScopeFromPayload(
  payload: Record<string, unknown>,
): 'issuer' | 'recipient' | null {
  return payload.report_scope === 'issuer' || payload.report_scope === 'recipient'
    ? payload.report_scope
    : null;
}

type PanelProps = {
  panel: IncomeClientDocumentManagementPanel;
  busy: boolean;
  onAction: (result: IncomeClientDocumentPanelActionResult) => void | Promise<void>;
  renderDocumentsCell?: (row: IncomeClientDocumentManagementRow) => ReactNode;
  /** Work Engine invoices tab: hide סטטוס column; backend field unchanged. */
  hideStatusColumn?: boolean;
  /**
   * Work Engine invoices tab only: compact Quick Card on avatar click;
   * hides email/tax id from the main row identity area.
   */
  clientQuickCardEnabled?: boolean;
  /**
   * Work Engine invoices tab only: dual-population layout from backend sections.
   * Display mode is UI preference only — does not reload or reclassify populations.
   */
  populationsLayoutEnabled?: boolean;
  populationsDisplayMode?: WorkEngineInvoicesPopulationsDisplayMode;
  onPopulationsDisplayModeChange?: (mode: WorkEngineInvoicesPopulationsDisplayMode) => void;
  /** Backend-owned +מסמך actions per population section (WE invoices). */
  populationNewDocumentActions?: WorkEngineInvoicesPopulationNewDocumentAction[];
  onPopulationNewDocument?: (sectionKey: 'office_clients' | 'office_client_customers') => void;
};

type QuickCardOpenState = {
  rowKey: string;
  anchorEl: HTMLElement;
  card: NonNullable<IncomeClientDocumentManagementRow['client_quick_card']>;
  clientName: string;
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

function ClientCell({
  row,
  clientQuickCardEnabled,
  quickCardOpenRowKey,
  onToggleQuickCard,
}: {
  row: IncomeClientDocumentManagementRow;
  clientQuickCardEnabled?: boolean;
  quickCardOpenRowKey?: string | null;
  onToggleQuickCard?: (row: IncomeClientDocumentManagementRow, anchorEl: HTMLElement) => void;
}) {
  const rowKey = incomeClientDocumentManagementRowReactKey(row);
  const quickCard = row.client_quick_card;
  const showQuickCard =
    Boolean(clientQuickCardEnabled) && Boolean(quickCard?.enabled);
  const subtext = showQuickCard
    ? ''
    : [row.tax_id, row.email].filter(Boolean).join(' · ');

  const avatar = (
    <div className="nx-income-cdm__avatar">
      {row.client_logo_url ? (
        <img className="nx-income-cdm__logo" src={row.client_logo_url} alt="" />
      ) : (
        <span className="nx-income-cdm__logo-fallback" aria-hidden>
          {row.client_initials}
        </span>
      )}
    </div>
  );

  return (
    <div className="nx-income-cdm__client">
      {showQuickCard && onToggleQuickCard ? (
        <button
          type="button"
          className="nx-income-cdm__avatar-btn"
          aria-label={`כרטיס לקוח — ${row.client_display_name}`}
          aria-expanded={quickCardOpenRowKey === rowKey}
          onClick={(e) => onToggleQuickCard(row, e.currentTarget)}
        >
          {avatar}
        </button>
      ) : (
        avatar
      )}
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
  clientQuickCardEnabled?: boolean,
  quickCardOpenRowKey?: string | null,
  onToggleQuickCard?: (row: IncomeClientDocumentManagementRow, anchorEl: HTMLElement) => void,
) {
  if (colKey === 'client') {
    return (
      <ClientCell
        row={row}
        clientQuickCardEnabled={clientQuickCardEnabled}
        quickCardOpenRowKey={quickCardOpenRowKey}
        onToggleQuickCard={onToggleQuickCard}
      />
    );
  }
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
                                    const payload = action.command_payload ?? {};
                                    const endCustomerId =
                                      typeof payload.income_customer_id === 'string'
                                        ? payload.income_customer_id
                                        : typeof payload.end_customer_id === 'string'
                                          ? payload.end_customer_id
                                          : null;
                                    void onAction({
                                      kind: 'reports',
                                      clientId: row.represented_client_id,
                                      clientName: row.client_display_name,
                                      endCustomerId,
                                      reportScope: parseReportScopeFromPayload(payload),
                                      issuerDisplayName:
                                        row.parent_client_display_name ?? row.client_display_name,
                                      recipientDisplayName: endCustomerId
                                        ? row.client_display_name
                                        : null,
                                      catalog: parseReportsCatalogFromPayload(payload),
                                    });
                                    return;
                                  }
                                  if (action.key === 'open_income_ledger_card') {
                                    const payload = action.command_payload ?? {};
                                    const endCustomerId =
                                      typeof payload.income_customer_id === 'string'
                                        ? payload.income_customer_id
                                        : typeof payload.end_customer_id === 'string'
                                          ? payload.end_customer_id
                                          : null;
                                    void onAction({
                                      kind: 'ledger',
                                      clientId: row.represented_client_id,
                                      clientName: row.client_display_name,
                                      endCustomerId,
                                    });
                                    return;
                                  }
                                  if (action.key === 'open_email_history') {
                                    const payload = action.command_payload ?? {};
                                    const endCustomerId =
                                      typeof payload.income_customer_id === 'string'
                                        ? payload.income_customer_id
                                        : typeof payload.end_customer_id === 'string'
                                          ? payload.end_customer_id
                                          : null;
                                    void onAction({
                                      kind: 'email_history',
                                      clientId: row.represented_client_id,
                                      clientName: row.client_display_name,
                                      endCustomerId,
                                    });
                                    return;
                                  }
                                  if (action.key === 'open_invoice_retainer_setup') {
                                    const payload = action.command_payload ?? {};
                                    const endCustomerId =
                                      typeof payload.income_customer_id === 'string'
                                        ? payload.income_customer_id
                                        : typeof payload.end_customer_id === 'string'
                                          ? payload.end_customer_id
                                          : null;
                                    void onAction({
                                      kind: 'retainer',
                                      clientId: row.represented_client_id,
                                      clientName: row.client_display_name,
                                      endCustomerId,
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

function renderClientDocumentManagementDataRows(
  rows: IncomeClientDocumentManagementRow[],
  visualColumns: Array<{ key: VisualColumnKey; label: string }>,
  busy: boolean,
  onAction: PanelProps['onAction'],
  renderDocumentsCell?: PanelProps['renderDocumentsCell'],
  clientQuickCardEnabled?: boolean,
  quickCardOpenRowKey?: string | null,
  onToggleQuickCard?: (row: IncomeClientDocumentManagementRow, anchorEl: HTMLElement) => void,
) {
  return rows.map((row) => (
    <tr key={incomeClientDocumentManagementRowReactKey(row)}>
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
          {renderDataCell(
            row,
            col.key,
            busy,
            onAction,
            renderDocumentsCell,
            clientQuickCardEnabled,
            quickCardOpenRowKey,
            onToggleQuickCard,
          )}
        </td>
      ))}
    </tr>
  ));
}

function ClientDocumentManagementRowsTable({
  columns,
  rows,
  groups,
  busy,
  onAction,
  renderDocumentsCell,
  emptyState,
  clientQuickCardEnabled,
  quickCardOpenRowKey,
  onToggleQuickCard,
}: {
  columns: Array<{ key: VisualColumnKey; label: string }>;
  rows: IncomeClientDocumentManagementRow[];
  groups?: IncomeClientDocumentManagementCustomerGroup[] | null;
  busy: boolean;
  onAction: PanelProps['onAction'];
  renderDocumentsCell?: PanelProps['renderDocumentsCell'];
  emptyState?: IncomeClientDocumentManagementSection['empty_state'] | null;
  clientQuickCardEnabled?: boolean;
  quickCardOpenRowKey?: string | null;
  onToggleQuickCard?: (row: IncomeClientDocumentManagementRow, anchorEl: HTMLElement) => void;
}) {
  if (emptyState?.visible) {
    return (
      <div className="nx-income-cdm__empty">
        <p className="nx-income-cdm__empty-title">{emptyState.title}</p>
        {emptyState.description ? (
          <p className="nx-income-cdm__empty-desc">{emptyState.description}</p>
        ) : null}
      </div>
    );
  }

  const useGroups = Array.isArray(groups) && groups.length > 0;

  return (
    <div className="nx-income-cdm__table-wrap">
      <table className="nx-income-cdm__table">
        <thead>
          <tr>
            {columns.map((col) => (
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
          {useGroups
            ? groups!.map((group) => (
                <Fragment key={`group:${group.parent_represented_client_id}`}>
                  <tr className="nx-we-invoices-cdm-group-header-row">
                    <td colSpan={columns.length}>
                      <div className="nx-we-invoices-cdm-group-header">
                        <div className="nx-we-invoices-cdm-group-header__identity">
                          <span className="nx-we-invoices-cdm-group-header__name">
                            {group.parent_client_display_name}
                          </span>
                          {typeof group.total_customers === 'number' ? (
                            <span className="nx-we-invoices-cdm-group-header__count">
                              {group.total_customers}
                            </span>
                          ) : null}
                        </div>
                        {(group.actions ?? []).length > 0 ? (
                          <div className="nx-income-cdm__actions nx-we-invoices-cdm-group-header__actions">
                            {(group.actions ?? []).map((action) => (
                              <ActionButton
                                key={action.key}
                                action={action}
                                busy={busy}
                                onClick={() => {
                                  if (action.key === 'open_reports') {
                                    const payload = action.command_payload ?? {};
                                    void onAction({
                                      kind: 'reports',
                                      clientId: group.parent_represented_client_id,
                                      clientName: group.parent_client_display_name,
                                      endCustomerId: null,
                                      reportScope: parseReportScopeFromPayload(payload),
                                      issuerDisplayName: group.parent_client_display_name,
                                      recipientDisplayName: null,
                                      catalog: parseReportsCatalogFromPayload(payload),
                                    });
                                    return;
                                  }
                                  void onAction({
                                    kind: 'command',
                                    action,
                                    clientName: group.parent_client_display_name,
                                  });
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {renderClientDocumentManagementDataRows(
                    group.rows ?? [],
                    columns,
                    busy,
                    onAction,
                    renderDocumentsCell,
                    clientQuickCardEnabled,
                    quickCardOpenRowKey,
                    onToggleQuickCard,
                  )}
                </Fragment>
              ))
            : renderClientDocumentManagementDataRows(
                rows,
                columns,
                busy,
                onAction,
                renderDocumentsCell,
                clientQuickCardEnabled,
                quickCardOpenRowKey,
                onToggleQuickCard,
              )}
        </tbody>
      </table>
    </div>
  );
}

function PopulationsSegmentedControl({
  mode,
  officeTitle,
  customersTitle,
  onChange,
}: {
  mode: WorkEngineInvoicesPopulationsDisplayMode;
  officeTitle: string;
  customersTitle: string;
  onChange: (mode: WorkEngineInvoicesPopulationsDisplayMode) => void;
}) {
  const options: Array<{ key: WorkEngineInvoicesPopulationsDisplayMode; label: string }> = [
    { key: 'office', label: officeTitle },
    { key: 'both', label: WORK_ENGINE_INVOICES_POPULATIONS_BOTH_LABEL },
    { key: 'office_client_customers', label: customersTitle },
  ];

  return (
    <div
      className="nx-we-invoices-cdm-seg"
      role="tablist"
      aria-label="תצוגת אוכלוסיות לקוחות"
      dir="rtl"
    >
      {options.map((option) => {
        const active = mode === option.key;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`nx-we-invoices-cdm-seg__btn${active ? ' nx-we-invoices-cdm-seg__btn--active' : ''}`}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function PopulationSectionPanel({
  section,
  visualColumns,
  busy,
  onAction,
  renderDocumentsCell,
  clientQuickCardEnabled,
  quickCardOpenRowKey,
  onToggleQuickCard,
  newDocumentAction,
  onNewDocument,
}: {
  section: IncomeClientDocumentManagementSection;
  visualColumns: Array<{ key: VisualColumnKey; label: string }>;
  busy: boolean;
  onAction: PanelProps['onAction'];
  renderDocumentsCell?: PanelProps['renderDocumentsCell'];
  clientQuickCardEnabled?: boolean;
  quickCardOpenRowKey?: string | null;
  onToggleQuickCard?: (row: IncomeClientDocumentManagementRow, anchorEl: HTMLElement) => void;
  newDocumentAction?: WorkEngineInvoicesPopulationNewDocumentAction | null;
  onNewDocument?: () => void;
}) {
  const showNewDocument = Boolean(newDocumentAction && onNewDocument);
  const headerActions = section.header_actions ?? [];

  return (
    <div className="nx-we-invoices-cdm-population" data-section-key={section.section_key}>
      <div className="nx-we-invoices-cdm-population__head">
        <div className="nx-we-invoices-cdm-population__head-group">
          <h3 className="nx-we-invoices-cdm-population__title">{section.title}</h3>
          {showNewDocument || headerActions.length > 0 ? (
            <div className="nx-we-invoices-cdm-population__head-actions">
              {showNewDocument ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-primary nx-btn-taxes-compact nx-we-invoices-cdm-population__new-doc"
                  disabled={busy || !newDocumentAction!.enabled}
                  title={
                    newDocumentAction!.enabled
                      ? newDocumentAction!.button_label
                      : (newDocumentAction!.disabled_reason ?? newDocumentAction!.button_label)
                  }
                  onClick={() => onNewDocument?.()}
                >
                  {newDocumentAction!.button_label}
                </button>
              ) : null}
              {headerActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className="nx-btn nx-btn-taxes-compact nx-we-invoices-cdm-population__header-action"
                  disabled={busy || !action.enabled}
                  title={action.enabled ? action.label : (action.disabled_reason ?? action.label)}
                  aria-label={action.label}
                  onClick={() => {
                    void onAction({
                      kind: 'command',
                      action,
                      clientName: section.title,
                    });
                  }}
                >
                  {action.icon_key === 'settings' ? (
                    <span className="nx-we-invoices-cdm-population__header-action-icon" aria-hidden>
                      <ActionIcon iconKey="settings" />
                    </span>
                  ) : null}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <ClientDocumentManagementRowsTable
        columns={visualColumns}
        rows={section.rows ?? []}
        groups={section.groups}
        busy={busy}
        onAction={onAction}
        renderDocumentsCell={renderDocumentsCell}
        emptyState={section.empty_state}
        clientQuickCardEnabled={clientQuickCardEnabled}
        quickCardOpenRowKey={quickCardOpenRowKey}
        onToggleQuickCard={onToggleQuickCard}
      />
    </div>
  );
}

export function IncomeClientDocumentManagementPanelView({
  panel,
  busy,
  onAction,
  renderDocumentsCell,
  hideStatusColumn = false,
  clientQuickCardEnabled = false,
  populationsLayoutEnabled = false,
  populationsDisplayMode = WORK_ENGINE_INVOICES_POPULATIONS_DISPLAY_DEFAULT,
  onPopulationsDisplayModeChange,
  populationNewDocumentActions = [],
  onPopulationNewDocument,
}: PanelProps) {
  const [quickCardOpen, setQuickCardOpen] = useState<QuickCardOpenState | null>(null);

  useEffect(() => {
    setQuickCardOpen(null);
  }, [panel]);

  if (!panel?.visible) return null;

  const visualColumns = resolveVisualColumns(panel.columns ?? [], hideStatusColumn);
  const rows = panel.rows ?? [];
  const quickCardOpenRowKey = quickCardOpen?.rowKey ?? null;

  const onToggleQuickCard = (row: IncomeClientDocumentManagementRow, anchorEl: HTMLElement) => {
    const card = row.client_quick_card;
    if (!card?.enabled) return;
    const rowKey = incomeClientDocumentManagementRowReactKey(row);
    setQuickCardOpen((prev) =>
      prev?.rowKey === rowKey
        ? null
        : {
            rowKey,
            anchorEl,
            card,
            clientName: row.client_display_name,
          },
    );
  };

  const quickCardPortal =
    clientQuickCardEnabled && quickCardOpen ? (
      <ClientQuickCardPopover
        card={quickCardOpen.card}
        anchorEl={quickCardOpen.anchorEl}
        busy={busy}
        onClose={() => setQuickCardOpen(null)}
        onAction={(action) => {
          setQuickCardOpen(null);
          void onAction({
            kind: 'quick_card_action',
            action,
            clientName: quickCardOpen.clientName,
          });
        }}
      />
    ) : null;

  if (populationsLayoutEnabled) {
    const officeSection = panel.office_clients_section;
    const customersSection = panel.office_client_customers_section;
    const visibility = resolveWorkEngineInvoicesPopulationsVisibility(populationsDisplayMode);
    const layoutClass =
      populationsDisplayMode === 'both'
        ? 'nx-we-invoices-cdm-populations nx-we-invoices-cdm-populations--both'
        : 'nx-we-invoices-cdm-populations nx-we-invoices-cdm-populations--single';

    return (
      <>
        <section
          className="nx-income-cdm nx-we-invoices-cdm"
          dir="rtl"
          aria-label={panel.title}
        >
          <div className="nx-income-cdm__card">
            <div className="nx-income-cdm__head nx-we-invoices-cdm__head">
              <PopulationsSegmentedControl
                mode={populationsDisplayMode}
                officeTitle={officeSection?.title ?? 'לקוחות המשרד'}
                customersTitle={customersSection?.title ?? 'לקוחות של לקוחות המשרד'}
                onChange={(mode) => onPopulationsDisplayModeChange?.(mode)}
              />
            </div>

            <div className={layoutClass}>
              {visibility.showOfficeClients && officeSection ? (
                <PopulationSectionPanel
                  section={officeSection}
                  visualColumns={visualColumns}
                  busy={busy}
                  onAction={onAction}
                  renderDocumentsCell={renderDocumentsCell}
                  clientQuickCardEnabled={clientQuickCardEnabled}
                  quickCardOpenRowKey={quickCardOpenRowKey}
                  onToggleQuickCard={onToggleQuickCard}
                  newDocumentAction={
                    populationNewDocumentActions.find((a) => a.section_key === 'office_clients') ??
                    null
                  }
                  onNewDocument={
                    onPopulationNewDocument
                      ? () => onPopulationNewDocument('office_clients')
                      : undefined
                  }
                />
              ) : null}
              {visibility.showOfficeClientCustomers && customersSection ? (
                <PopulationSectionPanel
                  section={customersSection}
                  visualColumns={visualColumns}
                  busy={busy}
                  onAction={onAction}
                  renderDocumentsCell={renderDocumentsCell}
                  clientQuickCardEnabled={clientQuickCardEnabled}
                  quickCardOpenRowKey={quickCardOpenRowKey}
                  onToggleQuickCard={onToggleQuickCard}
                  newDocumentAction={
                    populationNewDocumentActions.find(
                      (a) => a.section_key === 'office_client_customers',
                    ) ?? null
                  }
                  onNewDocument={
                    onPopulationNewDocument
                      ? () => onPopulationNewDocument('office_client_customers')
                      : undefined
                  }
                />
              ) : null}
            </div>
          </div>
        </section>
        {quickCardPortal}
      </>
    );
  }

  return (
    <>
      <section
        className={hideStatusColumn ? 'nx-income-cdm nx-we-invoices-cdm' : 'nx-income-cdm'}
        dir="rtl"
        aria-labelledby="income-cdm-title"
      >
        <div className="nx-income-cdm__card">
          <div className="nx-income-cdm__head">
            <div className="nx-income-cdm__head-main">
              <h2 id="income-cdm-title" className="nx-income-cdm__title">
                {panel.title}
              </h2>
              {panel.description ? <p className="nx-income-cdm__description">{panel.description}</p> : null}
            </div>
          </div>

          <ClientDocumentManagementRowsTable
            columns={visualColumns}
            rows={rows}
            busy={busy}
            onAction={onAction}
            renderDocumentsCell={renderDocumentsCell}
            emptyState={panel.empty_state}
            clientQuickCardEnabled={clientQuickCardEnabled}
            quickCardOpenRowKey={quickCardOpenRowKey}
            onToggleQuickCard={onToggleQuickCard}
          />
        </div>
      </section>
      {quickCardPortal}
    </>
  );
}

export function IncomeClientDocumentReportsModal({
  open,
  clientName,
  catalog,
  busy,
  onClose,
  reportScope = null,
  issuerDisplayName = null,
  recipientDisplayName = null,
}: {
  open: boolean;
  clientName: string;
  catalog: IncomeClientDocumentManagementReportItem[];
  busy: boolean;
  onClose: () => void;
  reportScope?: 'issuer' | 'recipient' | null;
  issuerDisplayName?: string | null;
  recipientDisplayName?: string | null;
}) {
  if (!open) return null;

  const scopeIssuer = issuerDisplayName ?? clientName;
  const scopeRecipient = recipientDisplayName;

  return (
    <div className="nx-income-wizard-overlay nx-invoice-ui nx-income-cdm-modal" role="dialog" aria-modal="true">
      <div className="nx-income-wizard nx-income-wizard--compact nx-accounting-editor-modal">
        <div className="nx-income-wizard__head">
          <h2 className="nx-modal-title">דוחות</h2>
          <div className="nx-income-cdm-reports-scope" dir="rtl">
            {reportScope === 'recipient' && scopeRecipient ? (
              <>
                <div>לקוח: {scopeRecipient}</div>
                <div>מנפיק: {scopeIssuer}</div>
              </>
            ) : (
              <div>מנפיק: {scopeIssuer}</div>
            )}
          </div>
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

export type IncomeEndCustomerFormPayload = {
  display_name: string;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  default_payment_terms: string;
};

function defaultPaymentTermsFromModel(model: IncomeTableModel<IncomeCustomersTableRow>): string {
  return (
    model.editor_fields?.find((field) => field.key === 'default_payment_terms')?.default_value ??
    'eom_plus_30'
  );
}

function emptyCustomerForm(model: IncomeTableModel<IncomeCustomersTableRow>): Record<string, string> {
  return {
    display_name: '',
    phone: '',
    email: '',
    tax_id: '',
    default_payment_terms: defaultPaymentTermsFromModel(model),
  };
}

function customerFormFromRow(
  row: IncomeCustomersTableRow,
  model: IncomeTableModel<IncomeCustomersTableRow>,
): Record<string, string> {
  return {
    display_name: row.display_name ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    tax_id: row.tax_id ?? '',
    default_payment_terms: row.default_payment_terms ?? defaultPaymentTermsFromModel(model),
  };
}

function renderCustomerEditorField(
  field: IncomeCustomerEditorField,
  form: Record<string, string>,
  disabled: boolean,
  onChange: (key: string, value: string) => void,
) {
  const value = form[field.key] ?? '';
  return (
    <div key={field.key} className="nx-income-field">
      <label>{field.label}</label>
      {field.input_type === 'select' ? (
        <select
          value={value}
          disabled={disabled}
          required={field.required}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          disabled={disabled}
          required={field.required}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      )}
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
  /** When set, open the edit form for this customer once the modal opens. */
  initialEditCustomerId = null,
}: {
  open: boolean;
  clientName: string;
  model: IncomeTableModel<IncomeCustomersTableRow>;
  busy: boolean;
  canCreate: boolean;
  canEdit: boolean;
  onClose: () => void;
  onCreateCustomer: (payload: IncomeEndCustomerFormPayload) => Promise<void>;
  onUpdateCustomer: (customerId: string, payload: IncomeEndCustomerFormPayload) => Promise<void>;
  initialEditCustomerId?: string | null;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(() => emptyCustomerForm(model));
  const [submitting, setSubmitting] = useState(false);
  const appliedInitialEditRef = useRef<string | null>(null);

  const columns = model?.columns ?? [];
  const rows = model?.rows ?? [];
  const editorFields = model.editor_fields ?? [];

  useEffect(() => {
    if (!open) {
      appliedInitialEditRef.current = null;
      setEditorOpen(false);
      setEditingCustomerId(null);
      return;
    }
    const targetId = initialEditCustomerId?.trim() || null;
    if (!targetId || !canEdit) return;
    if (appliedInitialEditRef.current === targetId) return;
    const row = rows.find((r) => r.customer_id === targetId);
    if (!row) return;
    appliedInitialEditRef.current = targetId;
    setEditorMode('edit');
    setEditingCustomerId(row.customer_id);
    setForm(customerFormFromRow(row, model));
    setEditorOpen(true);
  }, [open, initialEditCustomerId, canEdit, rows, model]);

  const openCreate = () => {
    setEditorMode('create');
    setEditingCustomerId(null);
    setForm(emptyCustomerForm(model));
    setEditorOpen(true);
  };

  const openEdit = (row: IncomeCustomersTableRow) => {
    setEditorMode('edit');
    setEditingCustomerId(row.customer_id);
    setForm(customerFormFromRow(row, model));
    setEditorOpen(true);
  };

  const submitEditor = async () => {
    const payload: IncomeEndCustomerFormPayload = {
      display_name: (form.display_name ?? '').trim(),
      phone: (form.phone ?? '').trim() || null,
      email: (form.email ?? '').trim() || null,
      tax_id: (form.tax_id ?? '').trim() || null,
      default_payment_terms: form.default_payment_terms ?? defaultPaymentTermsFromModel(model),
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
              {editorFields.length > 0
                ? editorFields.map((field) =>
                    renderCustomerEditorField(
                      field,
                      form,
                      busy || submitting,
                      (key, value) => setForm((f) => ({ ...f, [key]: value })),
                    ),
                  )
                : null}
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
                disabled={busy || submitting || !(form.display_name ?? '').trim()}
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
