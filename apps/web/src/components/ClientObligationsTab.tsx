import { useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { moduleClientOperationsObligationsCommands } from '../api/endpoints';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import '../styles/nx-client-obligations-tab.css';

type ObligationStatusCode =
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'upcoming'
  | 'ok'
  | 'blocked'
  | 'missing_data'
  | 'pending_payment_confirmation'
  | 'not_reported'
  | 'reported'
  | 'reported_and_paid';

export type ClientObligationsTabModel = {
  tab_key: 'client_obligations';
  read_model_version: number;
  summary: { overdue_count: number; due_today_count: number; due_soon_count: number };
  period_labels?: {
    payroll_salary_period: { period_key: string; display_he: string };
    vat_reporting_period: { period_key: string; display_he: string };
  };
  payroll_ready_for_ni_deductions?: boolean;
  payroll_manual_modal?: null | {
    modal_key: string;
    title_he: string;
    payroll_period_key: string;
    payroll_period_display_he: string;
    status_label_he: string;
    checkboxes: Array<{
      key: string;
      label_he: string;
      is_checked: boolean;
      interaction: { type: string; command_type?: string; payload?: Record<string, unknown> };
    }>;
    actions: Array<{
      action_key: string;
      action_label_he: string;
      interaction:
        | { type: 'close_modal' }
        | { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    }>;
  };
  ni_auto_reminder_modal?: null | {
    is_visible: boolean;
    title_he: string;
    message_he: string;
    monthly_amount: number | null;
    monthly_amount_display_he: string;
    standing_order_checkbox: { is_visible: boolean; is_checked: boolean };
    actions: Array<{
      action_key: string;
      action_label_he: string;
      interaction: {
        type: 'command' | 'open_module' | 'none';
        action_key?: string;
        command_type?:
          | 'mark_ni_paid'
          | 'mark_ni_not_paid'
          | 'set_ni_standing_order'
          | 'update_ni_payment_amount';
        payload?: Record<string, unknown>;
      };
    }>;
  };
  ni_manual_modal?: null | {
    title_he: string;
    status_label_he: string;
    monthly_amount: number | null;
    monthly_amount_display_he: string;
    standing_order_checkbox: { is_visible: boolean; is_checked: boolean; interaction: { type: 'command'; command_type: 'set_ni_standing_order'; payload?: Record<string, unknown> } };
    actions: Array<{
      action_key: string;
      action_label_he: string;
      interaction: {
        type: 'command' | 'open_module' | 'none';
        action_key?: string;
        command_type?:
          | 'mark_ni_paid'
          | 'mark_ni_not_paid'
          | 'mark_ni_not_relevant'
          | 'set_ni_standing_order'
          | 'update_ni_payment_amount';
        payload?: Record<string, unknown>;
      };
    }>;
  };
  ni_deductions_auto_reminder_modal?: null | {
    is_visible: boolean;
    modal_key: string;
    title_he: string;
    message_he: string;
    period_key: string;
    checkboxes: Array<{
      key: string;
      label_he: string;
      is_checked: boolean;
      interaction:
        | { type: 'command'; command_type: string; payload?: Record<string, unknown> }
        | { type: 'open_modal'; modal_key: 'payroll_manual_modal' };
    }>;
    suppress_checkbox: {
      is_visible: boolean;
      is_checked: boolean;
      interaction: { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    };
    actions: Array<{
      action_key: string;
      action_label_he: string;
      interaction: { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    }>;
  };
  ni_deductions_manual_modal?: null | {
    modal_key: string;
    title_he: string;
    message_he: string;
    period_key: string;
    status_label_he: string;
    checkboxes: Array<{
      key: string;
      label_he: string;
      is_checked: boolean;
      interaction:
        | { type: 'command'; command_type: string; payload?: Record<string, unknown> }
        | { type: 'open_modal'; modal_key: 'payroll_manual_modal' };
    }>;
    actions: Array<{
      action_key: string;
      action_label_he: string;
      interaction: { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    }>;
  };
  income_tax_deductions_manual_modal?: null | {
    modal_key: string;
    title_he: string;
    message_he: string;
    period_key: string;
    period_label_he: string;
    status_label_he: string;
    actions: Array<{
      action_key: string;
      action_label_he: string;
      interaction: { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    }>;
  };
  table: {
    columns: Array<{
      key: string;
      label_he: string;
      kind: 'date' | 'status' | 'action' | 'text' | 'multi_checkbox';
      order: number;
    }>;
    rows: Array<{
      row_key: string;
      period_key: string;
      period_display_he: string;
      cells: Array<{
        column_key: string;
        kind: 'date' | 'status' | 'action' | 'text' | 'multi_checkbox';
        display_value: string;
        status_code?: string;
        status_label_he?: string;
        status_tone?: 'critical' | 'warning' | 'ok' | 'blocked' | 'neutral';
        icon_key?: string;
        action_label_he?: string | null;
        priority_code?: 'high_today' | 'warning' | 'ok';
        interaction?: {
            type: 'command' | 'open_module' | 'open_modal' | 'none';
          action_key?: string;
            modal_key?: 'ni_manual_modal' | 'ni_deductions_manual_modal' | 'payroll_manual_modal' | 'income_tax_deductions_manual_modal';
          command_type?:
            | 'mark_obligation_reported'
            | 'mark_obligation_reported_and_paid'
            | 'mark_obligation_not_reported'
            | 'notify_client_payment_amount'
            | 'send_docflow_request'
            | 'approve_docflow_reminder_send'
            | 'dismiss_docflow_reminder'
            | 'mark_material_received'
            | 'mark_salary_data_received'
            | 'mark_income_data_received'
            | 'mark_material_not_relevant'
            | 'mark_salary_data_not_relevant'
            | 'mark_income_data_not_relevant'
            | 'mark_ni_paid'
            | 'mark_ni_not_paid'
            | 'mark_ni_not_relevant'
            | 'set_ni_standing_order'
            | 'update_ni_payment_amount'
            | 'mark_material_received_not_relevant'
            | 'mark_salary_data_received_not_relevant'
            | 'mark_income_data_received_not_relevant'
            | 'set_ni_deductions_reminder_suppressed'
            | 'set_ni_deductions_step'
            | 'mark_ni_deductions_payroll_in_progress'
            | 'mark_ni_deductions_reported_and_paid'
            | 'mark_ni_deductions_not_relevant'
            | 'touch_ni_deductions_auto_reminder_shown'
            | 'set_payroll_period_salary_data_received'
            | 'set_payroll_period_sent_to_employer'
            | 'set_payroll_period_no_salaries'
            | 'mark_payroll_period_not_relevant'
            | 'mark_income_tax_deductions_reported'
            | 'mark_income_tax_deductions_paid'
            | 'mark_income_tax_deductions_not_relevant';
          payload?: Record<string, unknown>;
        };
        available_actions?: Array<{
          action_key: string;
          action_label_he: string;
          interaction: {
            type: 'command' | 'open_module' | 'none';
            action_key?: string;
            command_type?:
              | 'mark_obligation_reported'
              | 'mark_obligation_reported_and_paid'
              | 'mark_obligation_not_reported'
              | 'notify_client_payment_amount'
              | 'send_docflow_request'
              | 'approve_docflow_reminder_send'
              | 'dismiss_docflow_reminder'
              | 'mark_material_received'
              | 'mark_salary_data_received'
              | 'mark_income_data_received'
              | 'mark_material_not_relevant'
              | 'mark_salary_data_not_relevant'
              | 'mark_income_data_not_relevant'
              | 'mark_ni_paid'
              | 'mark_ni_not_paid'
              | 'mark_ni_not_relevant'
              | 'set_ni_standing_order'
              | 'update_ni_payment_amount'
              | 'mark_material_received_not_relevant'
              | 'mark_salary_data_received_not_relevant'
              | 'mark_income_data_received_not_relevant';
            payload?: Record<string, unknown>;
          };
        }>;
        checkboxes?: Array<{
          key: 'vat' | 'income_advances' | 'payroll';
          label_he: string;
          is_active: boolean;
          is_checked: boolean;
          show_request_icon?: boolean;
          request_priority?: 'info' | 'warning' | 'critical';
          request_stage_code?: 'day_1' | 'day_4' | 'day_8' | 'day_10_plus';
          request_text_he?: string;
          request_interaction?: {
            type: 'command' | 'open_module' | 'none';
            action_key?: string;
            command_type?:
              | 'mark_obligation_reported'
              | 'mark_obligation_reported_and_paid'
              | 'mark_obligation_not_reported'
              | 'notify_client_payment_amount'
              | 'send_docflow_request'
              | 'approve_docflow_reminder_send'
              | 'dismiss_docflow_reminder'
              | 'mark_material_received'
              | 'mark_salary_data_received'
              | 'mark_income_data_received'
              | 'mark_material_not_relevant'
              | 'mark_salary_data_not_relevant'
              | 'mark_income_data_not_relevant';
            payload?: Record<string, unknown>;
          };
          interaction?: {
            type: 'command' | 'open_module' | 'none';
            action_key?: string;
            command_type?:
              | 'mark_obligation_reported'
              | 'mark_obligation_reported_and_paid'
              | 'mark_obligation_not_reported'
              | 'notify_client_payment_amount'
              | 'send_docflow_request'
              | 'approve_docflow_reminder_send'
              | 'dismiss_docflow_reminder'
              | 'mark_material_received'
              | 'mark_salary_data_received'
              | 'mark_income_data_received'
              | 'mark_material_not_relevant'
              | 'mark_salary_data_not_relevant'
              | 'mark_income_data_not_relevant';
            payload?: Record<string, unknown>;
          };
        }>;
      }>;
    }>;
  };
  obligations?: Array<{
    obligation_id: string;
    obligation_type: string;
    period_key: string;
    period_display_he: string;
    due_date: string;
    due_date_display_he: string;
    status_code: ObligationStatusCode;
    status_label_he: string;
    blocking_reason_he: string | null;
    related_module: string;
    priority_score: number;
    priority_level: 'high' | 'medium' | 'low';
    suggested_actions: Array<{ action_key: string; label_he: string }>;
    can_mark_reported: boolean;
    can_mark_reported_and_paid: boolean;
    can_mark_not_reported: boolean;
  }>;
  period_summary: Array<{ period_key: string; status_label_he: string }>;
  annual_report_summary?: {
    period_display_he: string;
    due_date_display_he: string;
    status_code: ObligationStatusCode;
    status_label_he: string;
    status_tone: 'critical' | 'warning' | 'ok' | 'blocked' | 'neutral';
    icon_key: string;
  } | null;
  labels?: { tab_title_he?: string };
};
const ICON_BY_KEY: Record<string, string> = {
  red_dot: '🔴',
  orange_dot: '🟠',
  yellow_dot: '🟡',
  green_dot: '🟢',
  black_dot: '⚫',
  gray_dot: '⚪',
  cross: '❌',
};

export function ClientObligationsTab({
  clientId,
  obligationsTab,
  onCaseUpdated,
}: {
  clientId: string;
  obligationsTab: ClientObligationsTabModel;
  onCaseUpdated: (next: ClientOperationsCaseResponse) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [openActionsForCell, setOpenActionsForCell] = useState<string | null>(null);
  const [niAutoDismissed, setNiAutoDismissed] = useState(false);
  const [niManualOpen, setNiManualOpen] = useState(false);
  const [niDedAutoDismissed, setNiDedAutoDismissed] = useState(false);
  const [niDedManualOpen, setNiDedManualOpen] = useState(false);
  const [itdManualOpen, setItdManualOpen] = useState(false);
  const [payrollManualOpen, setPayrollManualOpen] = useState(false);
  const niDedAutoTouchSentForPeriodRef = useRef<string | null>(null);
  const [niAmountModalOpen, setNiAmountModalOpen] = useState(false);
  const [niAmountValue, setNiAmountValue] = useState('');

  const tabTitle = obligationsTab.labels?.tab_title_he?.trim() || 'התחייבויות';
  const summaryItems = useMemo(
    () => [
      { key: 'overdue', icon: '◷', label: 'באיחור', value: obligationsTab.summary.overdue_count, tone: 'critical' as const },
      { key: 'today', icon: '🗓', label: 'היום', value: obligationsTab.summary.due_today_count, tone: 'warn' as const },
      { key: 'soon', icon: '◔', label: 'בקרוב', value: obligationsTab.summary.due_soon_count, tone: 'soon' as const },
    ],
    [obligationsTab.summary]
  );
  const firstRow = obligationsTab.table.rows[0];
  const firstPeriod = firstRow?.period_display_he ?? obligationsTab.period_summary[0]?.period_key ?? '—';
  const niAuto = obligationsTab.ni_auto_reminder_modal ?? null;
  const niManual = obligationsTab.ni_manual_modal ?? null;
  const niDedAuto = obligationsTab.ni_deductions_auto_reminder_modal ?? null;
  const niDedManual = obligationsTab.ni_deductions_manual_modal ?? null;
  const itdManual = obligationsTab.income_tax_deductions_manual_modal ?? null;
  const payrollMan = obligationsTab.payroll_manual_modal ?? null;

  useEffect(() => {
    if (!niAuto?.is_visible) return;
    setNiAutoDismissed(false);
    setNiAmountValue(niAuto.monthly_amount != null ? String(niAuto.monthly_amount) : '');
  }, [niAuto?.is_visible, niAuto?.monthly_amount]);
  useEffect(() => {
    if (!niDedAuto?.is_visible) return;
    setNiDedAutoDismissed(false);
  }, [niDedAuto?.is_visible, niDedAuto?.period_key]);
  useEffect(() => {
    if (!niDedAuto?.is_visible) {
      niDedAutoTouchSentForPeriodRef.current = null;
      return;
    }
    if (niDedAutoDismissed) return;
    const pk = niDedAuto.period_key;
    if (niDedAutoTouchSentForPeriodRef.current === pk) return;
    niDedAutoTouchSentForPeriodRef.current = pk;
    let cancelled = false;
    void (async () => {
      try {
        const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsObligationsCommands(clientId), {
          method: 'POST',
          body: JSON.stringify({
            type: 'touch_ni_deductions_auto_reminder_shown',
            payload: { period_key: pk },
          }),
        });
        if (!cancelled) onCaseUpdated(out);
      } catch (e) {
        if (!cancelled) {
          setErr(userFacingApiMessage(e));
          niDedAutoTouchSentForPeriodRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, niDedAuto?.is_visible, niDedAuto?.period_key, niDedAutoDismissed, onCaseUpdated]);
  useEffect(() => {
    if (!niManual) return;
    setNiAmountValue(niManual.monthly_amount != null ? String(niManual.monthly_amount) : '');
  }, [niManual?.monthly_amount]);
  useEffect(() => {
    if (!obligationsTab.payroll_manual_modal) setPayrollManualOpen(false);
  }, [obligationsTab.payroll_manual_modal]);
  useEffect(() => {
    if (!obligationsTab.income_tax_deductions_manual_modal) setItdManualOpen(false);
  }, [obligationsTab.income_tax_deductions_manual_modal]);

  const visibleNiAuto = Boolean(niAuto?.is_visible) && !niAutoDismissed ? niAuto : null;
  const visibleNiDedAuto = Boolean(niDedAuto?.is_visible) && !niDedAutoDismissed ? niDedAuto : null;

  const runObligationCommand = async (
    type: string,
    payload: Record<string, unknown>,
    opts?: { dismissPayrollModal?: boolean }
  ) => {
    if (opts?.dismissPayrollModal) setPayrollManualOpen(false);
    setBusy(true);
    setErr('');
    try {
      const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsObligationsCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type,
          payload,
        }),
      });
      onCaseUpdated(out);
    } catch (e) {
      setErr(userFacingApiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onCellInteraction = async (
    interaction:
      | {
          type: 'command' | 'open_module' | 'open_modal' | 'none';
          action_key?: string;
          modal_key?: 'ni_manual_modal' | 'ni_deductions_manual_modal' | 'payroll_manual_modal' | 'income_tax_deductions_manual_modal';
          command_type?:
            | 'mark_obligation_reported'
            | 'mark_obligation_reported_and_paid'
            | 'mark_obligation_not_reported'
            | 'notify_client_payment_amount'
            | 'send_docflow_request'
            | 'approve_docflow_reminder_send'
            | 'dismiss_docflow_reminder'
            | 'mark_material_received'
            | 'mark_salary_data_received'
            | 'mark_income_data_received'
            | 'mark_material_not_relevant'
            | 'mark_salary_data_not_relevant'
            | 'mark_income_data_not_relevant'
            | 'mark_ni_paid'
            | 'mark_ni_not_paid'
            | 'mark_ni_not_relevant'
            | 'set_ni_standing_order'
            | 'update_ni_payment_amount'
            | 'mark_material_received_not_relevant'
            | 'mark_salary_data_received_not_relevant'
            | 'mark_income_data_received_not_relevant'
            | 'set_ni_deductions_reminder_suppressed'
            | 'set_ni_deductions_step'
            | 'mark_ni_deductions_payroll_in_progress'
            | 'mark_ni_deductions_reported_and_paid'
            | 'mark_ni_deductions_not_relevant'
            | 'touch_ni_deductions_auto_reminder_shown'
            | 'set_payroll_period_salary_data_received'
            | 'set_payroll_period_sent_to_employer'
            | 'set_payroll_period_no_salaries'
            | 'mark_payroll_period_not_relevant'
            | 'mark_income_tax_deductions_reported'
            | 'mark_income_tax_deductions_paid'
            | 'mark_income_tax_deductions_not_relevant';
          payload?: Record<string, unknown>;
        }
      | undefined
  ) => {
    if (!interaction || busy) return;
    if (interaction.type === 'none') {
      return;
    }
    if (interaction.type === 'open_module') {
      if (interaction.action_key === 'open_national_insurance') {
        setNiAmountModalOpen(true);
      }
      return;
    }
    if (interaction.type === 'open_modal') {
      if (interaction.modal_key === 'ni_manual_modal') {
        setNiManualOpen(true);
      }
      if (interaction.modal_key === 'ni_deductions_manual_modal') {
        setNiDedManualOpen(true);
      }
      if (interaction.modal_key === 'payroll_manual_modal') {
        setPayrollManualOpen(true);
      }
      if (interaction.modal_key === 'income_tax_deductions_manual_modal') {
        setItdManualOpen(true);
      }
      return;
    }
    if (interaction.type === 'command' && interaction.command_type) {
      await runObligationCommand(interaction.command_type, interaction.payload ?? {});
    }
  };

  return (
    <div className="nx-oblig-root">
      <section className="nx-oblig-card nx-oblig-summary-card">
        <div className="nx-oblig-summary-head">
          <div>
            <h2 className="nx-oblig-title">{tabTitle}</h2>
          </div>
          <div className="nx-oblig-summary-pills">
            {obligationsTab.period_labels ? (
              <>
                <div className="nx-oblig-summary-pill">
                  תקופת משכורות: {obligationsTab.period_labels.payroll_salary_period.display_he}
                </div>
                <div className="nx-oblig-summary-pill">
                  תקופת דיווח מע״מ: {obligationsTab.period_labels.vat_reporting_period.display_he}
                </div>
              </>
            ) : (
              <div className="nx-oblig-summary-pill">תקופה: {firstPeriod}</div>
            )}
          </div>
        </div>
        <div className="nx-oblig-kpis">
          {summaryItems.map((item) => (
            <div key={item.key} className="nx-oblig-kpi">
              <div className={`nx-oblig-kpi-icon nx-oblig-kpi-icon--${item.tone}`} aria-hidden>
                {item.icon}
              </div>
              <div className="nx-oblig-kpi-meta">
                <div className="nx-oblig-kpi-label">{item.label}</div>
                <div className="nx-oblig-kpi-value">{item.value}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {err ? <div className="nx-oblig-error">{err}</div> : null}

      <section className="nx-oblig-card nx-oblig-main-list">
        {obligationsTab.table.rows.length === 0 ? (
          <div className="nx-oblig-empty">
            <div className="nx-oblig-empty-title">אין התחייבויות פתוחות כרגע</div>
          </div>
        ) : (
          <div className="nx-oblig-table-wrap">
            <table className="nx-oblig-table nx-oblig-table--excel" role="table" aria-label="טבלת התחייבויות">
              <thead>
                <tr>
                  {obligationsTab.table.columns
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((col) => (
                    <th key={col.key}>{col.label_he}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {obligationsTab.table.rows.map((row) => (
                  <tr key={row.row_key}>
                    {obligationsTab.table.columns
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((col) => {
                        const cell = row.cells.find((c) => c.column_key === col.key);
                        const toneClass = cell?.status_tone ? `nx-oblig-status--${cell.status_tone}` : '';
                        const icon = cell?.icon_key ? ICON_BY_KEY[cell.icon_key] ?? '' : '';
                        return (
                      <td key={`${row.row_key}-${col.key}`}>
                        {cell?.kind === 'date' ? (
                          <div className={`nx-oblig-cell-date-badge ${cell ? '' : 'nx-oblig-cell-btn--empty'}`}>{cell?.display_value || 'לא נדרש'}</div>
                        ) : cell?.kind === 'multi_checkbox' ? (
                          <div className="nx-oblig-multi-checkboxes">
                            {(cell.checkboxes ?? []).map((cb) => (
                              <div key={`${row.row_key}-${col.key}-${cb.key}`} className={`nx-oblig-checkbox-row ${!cb.is_active ? 'is-disabled' : ''}`}>
                                <label className="nx-oblig-checkbox-main">
                                  <input
                                    type="checkbox"
                                    checked={cb.is_checked}
                                    disabled={busy || !cb.is_active || !cb.interaction || cb.interaction.type !== 'command'}
                                    onChange={() => void onCellInteraction(cb.interaction)}
                                  />
                                  <span>{cb.label_he}</span>
                                </label>
                                {cb.show_request_icon ? (
                                  <button
                                    type="button"
                                    className={`nx-oblig-request-icon nx-oblig-request-icon--${cb.request_priority ?? 'info'} ${
                                      cb.key === 'vat' || cb.key === 'payroll' ? 'nx-oblig-request-icon--tight' : ''
                                    }`}
                                    disabled={busy || !cb.is_active || !cb.request_interaction}
                                    onClick={() => void onCellInteraction(cb.request_interaction)}
                                    aria-label={`שלח בקשה לנתונים עבור ${cb.label_he}`}
                                    title={cb.request_text_he ?? `שלח בקשה לנתונים עבור ${cb.label_he}`}
                                  >
                                    <svg className="nx-oblig-request-icon-envelope" viewBox="0 0 20 14" aria-hidden>
                                      <rect x="1.25" y="1.25" width="17.5" height="11.5" rx="1.75" />
                                      <path d="M2.5 3.25L10 8.5L17.5 3.25" />
                                    </svg>
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`nx-oblig-cell-btn ${cell ? toneClass : 'nx-oblig-cell-btn--empty'}`}
                              disabled={busy || !cell || !cell.interaction || cell.interaction.type === 'none'}
                              onClick={() => {
                                const cellKey = `${row.row_key}-${col.key}`;
                                if (cell?.available_actions && cell.available_actions.length > 0) {
                                  setOpenActionsForCell((curr) => (curr === cellKey ? null : cellKey));
                                  return;
                                }
                                setOpenActionsForCell(null);
                                void onCellInteraction(cell?.interaction);
                              }}
                            >
                              {cell ? (
                                <span className="nx-oblig-cell-content">
                                  <span className="nx-oblig-cell-badge">
                                    <span>{icon}</span>
                                    <span>{cell.display_value}</span>
                                  </span>
                                  {cell.action_label_he ? <span className="nx-oblig-cell-hint">{cell.action_label_he}</span> : null}
                                </span>
                              ) : (
                                <span className="nx-oblig-cell-empty">לא רלוונטי</span>
                              )}
                            </button>
                            {cell?.available_actions && cell.available_actions.length > 0 && openActionsForCell === `${row.row_key}-${col.key}` ? (
                              <div className="nx-oblig-actions-menu">
                                {cell.available_actions.map((a) => (
                                  <button
                                    key={`${row.row_key}-${col.key}-${a.action_key}`}
                                    type="button"
                                    className="nx-oblig-actions-item"
                                    disabled={busy}
                                    onClick={() => {
                                      setOpenActionsForCell(null);
                                      void onCellInteraction(a.interaction);
                                    }}
                                  >
                                    {a.action_label_he}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </>
                        )}
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

      <section className="nx-oblig-card nx-oblig-bottom-sections">
        <h3 className="nx-oblig-section-title">סיכום תקופות</h3>
        {obligationsTab.period_summary.length === 0 ? (
          <div className="nx-oblig-period-empty">אין נתוני תקופות להצגה.</div>
        ) : (
          <ul className="nx-oblig-period-list">
            {obligationsTab.period_summary.map((p, idx) => (
              <li key={`${p.period_key}-${idx}`} className="nx-oblig-period-item">
                <span className="nx-oblig-period-key">{p.period_key}</span>
                <span className="nx-oblig-period-status">{p.status_label_he}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="nx-oblig-card nx-oblig-bottom-sections">
        <h3 className="nx-oblig-section-title">דוח שנתי</h3>
        {!obligationsTab.annual_report_summary ? (
          <div className="nx-oblig-period-empty">אין נתוני דוח שנתי להצגה.</div>
        ) : (
          <div className="nx-oblig-annual-row">
            <span className="nx-oblig-period-key">{obligationsTab.annual_report_summary.period_display_he}</span>
            <span className={`nx-oblig-status nx-oblig-status--${obligationsTab.annual_report_summary.status_tone}`}>
              {(ICON_BY_KEY[obligationsTab.annual_report_summary.icon_key] ?? '')} {obligationsTab.annual_report_summary.status_label_he}
            </span>
            <span className="nx-oblig-period-status">{obligationsTab.annual_report_summary.due_date_display_he}</span>
          </div>
        )}
      </section>

      {visibleNiAuto ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setNiAutoDismissed(true);
            }
          }}
        >
          <div
            className="nx-modal nx-oblig-ni-modal"
            role="dialog"
            aria-modal="true"
            aria-label={visibleNiAuto.title_he}
          >
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{visibleNiAuto.title_he}</h2>
                <span className="nx-modal-subtitle">{visibleNiAuto.message_he}</span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setNiAutoDismissed(true)}
                aria-label="סגור"
                title="סגור"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              <p className="nx-oblig-ni-prompt-amount">סכום חודשי: {visibleNiAuto.monthly_amount_display_he}</p>
              {(() => {
                const cb = visibleNiAuto.standing_order_checkbox;
                if (!cb?.is_visible) return null;
                return (
                  <label className="nx-oblig-ni-prompt-checkbox">
                    <input
                      type="checkbox"
                      checked={cb.is_checked}
                      disabled={busy}
                      onChange={(e) => {
                        setNiAutoDismissed(true);
                        void runObligationCommand('set_ni_standing_order', { enabled: e.target.checked });
                      }}
                    />
                    <span>קיימת הוראת קבע</span>
                  </label>
                );
              })()}
            </div>
            <div className="nx-modal-footer nx-oblig-ni-prompt-footer">
              {visibleNiAuto.actions.map((a) => (
                  <button
                    key={a.action_key}
                    type="button"
                    className="nx-btn nx-btn-primary"
                    disabled={busy}
                    onClick={() => {
                      setNiAutoDismissed(true);
                      void onCellInteraction(a.interaction);
                    }}
                  >
                    {a.action_label_he}
                  </button>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {niManualOpen && niManual ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setNiManualOpen(false);
            }
          }}
        >
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={niManual.title_he}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{niManual.title_he}</h2>
                <span className="nx-modal-subtitle">{niManual.status_label_he}</span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => {
                  setNiManualOpen(false);
                }}
                aria-label="סגור"
                title="סגור"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              <p className="nx-oblig-ni-prompt-amount">סכום חודשי: {niManual.monthly_amount_display_he}</p>
              {(() => {
                const cb = niManual.standing_order_checkbox;
                if (!cb?.is_visible) return null;
                return (
                  <label className="nx-oblig-ni-prompt-checkbox">
                    <input
                      type="checkbox"
                      checked={cb.is_checked}
                      disabled={busy}
                      onChange={(e) => {
                        setNiManualOpen(false);
                        void runObligationCommand('set_ni_standing_order', { enabled: e.target.checked });
                      }}
                    />
                    <span>קיימת הוראת קבע</span>
                  </label>
                );
              })()}
            </div>
            <div className="nx-modal-footer nx-oblig-ni-prompt-footer">
              {niManual.actions.map((a) => (
                <button
                  key={a.action_key}
                  type="button"
                  className="nx-btn nx-btn-primary"
                  disabled={busy}
                  onClick={() => {
                    setNiManualOpen(false);
                    void onCellInteraction(a.interaction);
                  }}
                >
                  {a.action_label_he}
                </button>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {visibleNiDedAuto ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNiDedAutoDismissed(true);
          }}
        >
          <div
            className="nx-modal nx-oblig-ni-modal"
            role="dialog"
            aria-modal="true"
            aria-label={visibleNiDedAuto.title_he}
          >
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{visibleNiDedAuto.title_he}</h2>
                <span className="nx-modal-subtitle">{visibleNiDedAuto.message_he}</span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setNiDedAutoDismissed(true)}
                aria-label="סגור"
                title="סגור"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              {visibleNiDedAuto.checkboxes.map((cb) => (
                <label key={cb.key} className="nx-oblig-ni-prompt-checkbox">
                  <input
                    type="checkbox"
                    checked={cb.is_checked}
                    disabled={busy}
                    onChange={(e) => {
                      const intr = cb.interaction as { type?: string; command_type?: string; payload?: Record<string, unknown> };
                      if (intr.type === 'open_modal') {
                        setPayrollManualOpen(true);
                        return;
                      }
                      void runObligationCommand(intr.command_type ?? '', {
                        ...intr.payload,
                        enabled: e.target.checked,
                      });
                    }}
                  />
                  <span>{cb.label_he}</span>
                </label>
              ))}
              {visibleNiDedAuto.suppress_checkbox.is_visible ? (
                <label className="nx-oblig-ni-prompt-checkbox">
                  <input
                    type="checkbox"
                    checked={visibleNiDedAuto.suppress_checkbox.is_checked}
                    disabled={busy}
                    onChange={(e) => {
                      void runObligationCommand(visibleNiDedAuto.suppress_checkbox.interaction.command_type, {
                        ...visibleNiDedAuto.suppress_checkbox.interaction.payload,
                        enabled: e.target.checked,
                      });
                    }}
                  />
                  <span>לא להציג שוב החודש</span>
                </label>
              ) : null}
            </div>
            <div className="nx-modal-footer nx-oblig-ni-prompt-footer nx-oblig-ni-ded-actions-footer">
              {visibleNiDedAuto.actions.map((a) => (
                <button
                  key={a.action_key}
                  type="button"
                  className="nx-btn nx-btn-primary"
                  disabled={busy}
                  onClick={() => {
                    setNiDedAutoDismissed(true);
                    void runObligationCommand(a.interaction.command_type, a.interaction.payload ?? {});
                  }}
                >
                  {a.action_label_he}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {payrollManualOpen && payrollMan ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPayrollManualOpen(false);
          }}
        >
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={payrollMan.title_he}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{payrollMan.title_he}</h2>
                <span className="nx-modal-subtitle">
                  {payrollMan.payroll_period_display_he} — {payrollMan.status_label_he}
                </span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setPayrollManualOpen(false)}
                aria-label="סגור"
                title="סגור"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              {payrollMan.checkboxes.map((cb) => (
                <label key={cb.key} className="nx-oblig-ni-prompt-checkbox">
                  <input
                    type="checkbox"
                    checked={cb.is_checked}
                    disabled={busy}
                    onChange={(e) => {
                      void runObligationCommand(
                        cb.interaction.command_type ?? '',
                        {
                          ...cb.interaction.payload,
                          enabled: e.target.checked,
                        },
                        { dismissPayrollModal: true }
                      );
                    }}
                  />
                  <span>{cb.label_he}</span>
                </label>
              ))}
            </div>
            <div className="nx-modal-footer nx-oblig-ni-prompt-footer nx-oblig-ni-ded-actions-footer">
              {payrollMan.actions.map((a) => (
                <button
                  key={a.action_key}
                  type="button"
                  className={`nx-btn nx-btn-taxes-compact ${a.action_key === 'not_relevant' ? 'nx-btn-secondary' : 'nx-btn-primary'}`}
                  disabled={busy}
                  onClick={() => {
                    if (a.interaction.type === 'close_modal') {
                      setPayrollManualOpen(false);
                      return;
                    }
                    void runObligationCommand(a.interaction.command_type, a.interaction.payload ?? {}, {
                      dismissPayrollModal: true,
                    });
                  }}
                >
                  {a.action_label_he}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {itdManualOpen && itdManual ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setItdManualOpen(false);
          }}
        >
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={itdManual.title_he}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{itdManual.title_he}</h2>
                <span className="nx-modal-subtitle">
                  {itdManual.period_label_he} — {itdManual.status_label_he}
                </span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setItdManualOpen(false)}
                aria-label="סגור"
                title="סגור"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              <p className="nx-oblig-ni-prompt-amount">{itdManual.message_he}</p>
            </div>
            <div className="nx-modal-footer nx-oblig-ni-prompt-footer nx-oblig-ni-ded-actions-footer">
              {itdManual.actions.map((a) => (
                <button
                  key={a.action_key}
                  type="button"
                  className={`nx-btn nx-btn-taxes-compact ${a.action_key === 'mark_not_relevant' ? 'nx-btn-secondary' : 'nx-btn-primary'}`}
                  disabled={busy}
                  onClick={() => {
                    setItdManualOpen(false);
                    void runObligationCommand(a.interaction.command_type, a.interaction.payload ?? {});
                  }}
                >
                  {a.action_label_he}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {niDedManualOpen && niDedManual ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNiDedManualOpen(false);
          }}
        >
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={niDedManual.title_he}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{niDedManual.title_he}</h2>
                <span className="nx-modal-subtitle">{niDedManual.status_label_he}</span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setNiDedManualOpen(false)}
                aria-label="סגור"
                title="סגור"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              <p className="nx-oblig-ni-prompt-amount">{niDedManual.message_he}</p>
              {niDedManual.checkboxes.map((cb) => (
                <label key={cb.key} className="nx-oblig-ni-prompt-checkbox">
                  <input
                    type="checkbox"
                    checked={cb.is_checked}
                    disabled={busy}
                    onChange={(e) => {
                      const intr = cb.interaction as { type?: string; command_type?: string; payload?: Record<string, unknown> };
                      if (intr.type === 'open_modal') {
                        setPayrollManualOpen(true);
                        return;
                      }
                      void runObligationCommand(intr.command_type ?? '', {
                        ...intr.payload,
                        enabled: e.target.checked,
                      });
                    }}
                  />
                  <span>{cb.label_he}</span>
                </label>
              ))}
            </div>
            <div className="nx-modal-footer nx-oblig-ni-prompt-footer nx-oblig-ni-ded-actions-footer">
              {niDedManual.actions.map((a) => (
                <button
                  key={a.action_key}
                  type="button"
                  className="nx-btn nx-btn-primary"
                  disabled={busy}
                  onClick={() => {
                    setNiDedManualOpen(false);
                    void runObligationCommand(a.interaction.command_type, a.interaction.payload ?? {});
                  }}
                >
                  {a.action_label_he}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {niAmountModalOpen ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNiAmountModalOpen(false);
          }}
        >
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label="עדכון סכום לתשלום">
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">עדכון סכום לתשלום</h2>
                <span className="nx-modal-subtitle">ביטוח לאומי עצמאי</span>
              </div>
              <button type="button" className="nx-modal-close" onClick={() => setNiAmountModalOpen(false)} aria-label="סגור" title="סגור">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body">
              <label className="nx-oblig-ni-prompt-text" htmlFor="ni-amount-input">סכום חודשי</label>
              <input
                id="ni-amount-input"
                className="nx-datetime"
                type="number"
                min="0"
                step="0.01"
                value={niAmountValue}
                onChange={(e) => setNiAmountValue(e.target.value)}
              />
            </div>
            <div className="nx-modal-footer">
              <button type="button" className="nx-btn nx-btn-secondary" onClick={() => setNiAmountModalOpen(false)} disabled={busy}>
                סגירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                disabled={busy || Number(niAmountValue) <= 0}
                onClick={async () => {
                  setNiAmountModalOpen(false);
                  await runObligationCommand('update_ni_payment_amount', { amount: Number(niAmountValue) });
                }}
              >
                שמירה
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

