import { useEffect, useMemo, useRef, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { moduleClientOperationsObligationsCommands } from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { fillI18n, localizeSystemLabel } from '../lib/co-display-label.pure';
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
    title_key?: string;
    payroll_period_key: string;
    payroll_period_display_he: string;
    status_label_he: string;
    status_label_key?: string;
    checkboxes: Array<{
      key: string;
      label_he: string;
      label_key?: string;
      is_checked: boolean;
      interaction: { type: string; command_type?: string; payload?: Record<string, unknown> };
    }>;
    actions: Array<{
      action_key: string;
      action_label_he: string;
      action_label_key?: string;
      interaction:
        | { type: 'close_modal' }
        | { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    }>;
  };
  ni_auto_reminder_modal?: null | {
    is_visible: boolean;
    title_he: string;
    title_key?: string;
    message_he: string;
    message_key?: string;
    monthly_amount: number | null;
    monthly_amount_display_he: string;
    standing_order_checkbox: { is_visible: boolean; is_checked: boolean };
    actions: Array<{
      action_key: string;
      action_label_he: string;
      action_label_key?: string;
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
    title_key?: string;
    status_label_he: string;
    status_label_key?: string;
    monthly_amount: number | null;
    monthly_amount_display_he: string;
    standing_order_checkbox: { is_visible: boolean; is_checked: boolean; interaction: { type: 'command'; command_type: 'set_ni_standing_order'; payload?: Record<string, unknown> } };
    actions: Array<{
      action_key: string;
      action_label_he: string;
      action_label_key?: string;
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
    title_key?: string;
    message_he: string;
    message_key?: string;
    period_key: string;
    checkboxes: Array<{
      key: string;
      label_he: string;
      label_key?: string;
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
      action_label_key?: string;
      interaction: { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    }>;
  };
  ni_deductions_manual_modal?: null | {
    modal_key: string;
    title_he: string;
    title_key?: string;
    message_he: string;
    message_key?: string;
    period_key: string;
    status_label_he: string;
    status_label_key?: string;
    checkboxes: Array<{
      key: string;
      label_he: string;
      label_key?: string;
      is_checked: boolean;
      interaction:
        | { type: 'command'; command_type: string; payload?: Record<string, unknown> }
        | { type: 'open_modal'; modal_key: 'payroll_manual_modal' };
    }>;
    actions: Array<{
      action_key: string;
      action_label_he: string;
      action_label_key?: string;
      interaction: { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    }>;
  };
  income_tax_deductions_manual_modal?: null | {
    modal_key: string;
    title_he: string;
    title_key?: string;
    message_he: string;
    message_key?: string;
    message_vars?: Record<string, string>;
    period_key: string;
    period_label_he: string;
    status_label_he: string;
    status_label_key?: string;
    actions: Array<{
      action_key: string;
      action_label_he: string;
      action_label_key?: string;
      interaction: { type: 'command'; command_type: string; payload?: Record<string, unknown> };
    }>;
  };
  table: {
    columns: Array<{
      key: string;
      label_he: string;
      label_key?: string;
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
        display_value_key?: string;
        status_code?: string;
        status_label_he?: string;
        status_label_key?: string;
        status_tone?: 'critical' | 'warning' | 'ok' | 'blocked' | 'neutral';
        icon_key?: string;
        action_label_he?: string | null;
        action_label_key?: string | null;
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
          action_label_key?: string;
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
          label_key?: string;
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
    status_label_key?: string;
    blocking_reason_he: string | null;
    related_module: string;
    priority_score: number;
    priority_level: 'high' | 'medium' | 'low';
    suggested_actions: Array<{ action_key: string; label_he: string; label_key?: string }>;
    can_mark_reported: boolean;
    can_mark_reported_and_paid: boolean;
    can_mark_not_reported: boolean;
  }>;
  period_summary: Array<{
    period_key: string;
    period_label_key?: string;
    period_label_vars?: Record<string, string>;
    status_label_he: string;
    status_label_key?: string;
  }>;
  annual_report_summary?: {
    period_display_he: string;
    due_date_display_he: string;
    status_code: ObligationStatusCode;
    status_label_he: string;
    status_label_key?: string;
    status_tone: 'critical' | 'warning' | 'ok' | 'blocked' | 'neutral';
    icon_key: string;
  } | null;
  labels?: { tab_title_he?: string; tab_title_key?: string };
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
  const { t } = useI18n();
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

  const tabTitle = localizeSystemLabel(
    t,
    obligationsTab.labels?.tab_title_key,
    obligationsTab.labels?.tab_title_he?.trim() || t('clientOperations.obligations.title'),
  );
  const summaryItems = useMemo(
    () => [
      { key: 'overdue', icon: '◷', label: t('clientOperations.obligations.overdue'), value: obligationsTab.summary.overdue_count, tone: 'critical' as const },
      { key: 'today', icon: '🗓', label: t('clientOperations.obligations.today'), value: obligationsTab.summary.due_today_count, tone: 'warn' as const },
      { key: 'soon', icon: '◔', label: t('clientOperations.obligations.soon'), value: obligationsTab.summary.due_soon_count, tone: 'soon' as const },
    ],
    [obligationsTab.summary, t]
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
                  {t('clientOperations.obligations.payrollPeriod')}: {obligationsTab.period_labels.payroll_salary_period.display_he}
                </div>
                <div className="nx-oblig-summary-pill">
                  {t('clientOperations.obligations.vatPeriod')}: {obligationsTab.period_labels.vat_reporting_period.display_he}
                </div>
              </>
            ) : (
              <div className="nx-oblig-summary-pill">{t('clientOperations.obligations.period')}: {firstPeriod}</div>
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
            <div className="nx-oblig-empty-title">{t('clientOperations.obligations.noneOpen')}</div>
          </div>
        ) : (
          <div className="nx-oblig-table-wrap">
            <table className="nx-oblig-table nx-oblig-table--excel" role="table" aria-label={t('clientOperations.obligations.table')}>
              <thead>
                <tr>
                  {obligationsTab.table.columns
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((col) => (
                    <th key={col.key}>{localizeSystemLabel(t, col.label_key, col.label_he)}</th>
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
                          <div className={`nx-oblig-cell-date-badge ${cell ? '' : 'nx-oblig-cell-btn--empty'}`}>{cell?.display_value || t('clientOperations.obligations.notRequired')}</div>
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
                                  <span>{localizeSystemLabel(t, cb.label_key, cb.label_he)}</span>
                                </label>
                                {cb.show_request_icon ? (
                                  <button
                                    type="button"
                                    className={`nx-oblig-request-icon nx-oblig-request-icon--${cb.request_priority ?? 'info'} ${
                                      cb.key === 'vat' || cb.key === 'payroll' ? 'nx-oblig-request-icon--tight' : ''
                                    }`}
                                    disabled={busy || !cb.is_active || !cb.request_interaction}
                                    onClick={() => void onCellInteraction(cb.request_interaction)}
                                    aria-label={fillI18n(t('clientOperations.obligations.sendDataRequest'), {
                                      label: localizeSystemLabel(t, cb.label_key, cb.label_he),
                                    })}
                                    title={
                                      cb.request_text_he ??
                                      fillI18n(t('clientOperations.obligations.sendDataRequest'), {
                                        label: localizeSystemLabel(t, cb.label_key, cb.label_he),
                                      })
                                    }
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
                                    <span>{localizeSystemLabel(t, cell.display_value_key ?? cell.status_label_key, cell.display_value)}</span>
                                  </span>
                                  {cell.action_label_he ? (
                                    <span className="nx-oblig-cell-hint">
                                      {localizeSystemLabel(t, cell.action_label_key, cell.action_label_he)}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="nx-oblig-cell-empty">{t('clientOperations.obligations.notRelevant')}</span>
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
                                    {localizeSystemLabel(t, a.action_label_key, a.action_label_he)}
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
        <h3 className="nx-oblig-section-title">{t('clientOperations.obligations.periodSummary')}</h3>
        {obligationsTab.period_summary.length === 0 ? (
          <div className="nx-oblig-period-empty">{t('clientOperations.obligations.noPeriods')}</div>
        ) : (
          <ul className="nx-oblig-period-list">
            {obligationsTab.period_summary.map((p, idx) => (
              <li key={`${p.period_key}-${idx}`} className="nx-oblig-period-item">
                <span className="nx-oblig-period-key">
                  {p.period_label_key
                    ? fillI18n(localizeSystemLabel(t, p.period_label_key, p.period_key), p.period_label_vars ?? {})
                    : p.period_key}
                </span>
                <span className="nx-oblig-period-status">
                  {localizeSystemLabel(t, p.status_label_key, p.status_label_he)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="nx-oblig-card nx-oblig-bottom-sections">
        <h3 className="nx-oblig-section-title">{t('clientOperations.obligations.annualReport')}</h3>
        {!obligationsTab.annual_report_summary ? (
          <div className="nx-oblig-period-empty">{t('clientOperations.obligations.noAnnual')}</div>
        ) : (
          <div className="nx-oblig-annual-row">
            <span className="nx-oblig-period-key">{obligationsTab.annual_report_summary.period_display_he}</span>
            <span className={`nx-oblig-status nx-oblig-status--${obligationsTab.annual_report_summary.status_tone}`}>
              {(ICON_BY_KEY[obligationsTab.annual_report_summary.icon_key] ?? '')}{' '}
              {localizeSystemLabel(
                t,
                obligationsTab.annual_report_summary.status_label_key,
                obligationsTab.annual_report_summary.status_label_he,
              )}
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
            aria-label={localizeSystemLabel(t, visibleNiAuto.title_key, visibleNiAuto.title_he)}
          >
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{localizeSystemLabel(t, visibleNiAuto.title_key, visibleNiAuto.title_he)}</h2>
                <span className="nx-modal-subtitle">{localizeSystemLabel(t, visibleNiAuto.message_key, visibleNiAuto.message_he)}</span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setNiAutoDismissed(true)}
                aria-label={t('clientOperations.close')}
                title={t('clientOperations.close')}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              <p className="nx-oblig-ni-prompt-amount">
                {t('clientOperations.obligations.monthlyAmount')}: {visibleNiAuto.monthly_amount_display_he}
              </p>
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
                    <span>{t('clientOperations.obligations.standingOrder')}</span>
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
                    {localizeSystemLabel(t, a.action_label_key, a.action_label_he)}
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
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={localizeSystemLabel(t, niManual.title_key, niManual.title_he)}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{localizeSystemLabel(t, niManual.title_key, niManual.title_he)}</h2>
                <span className="nx-modal-subtitle">{localizeSystemLabel(t, niManual.status_label_key, niManual.status_label_he)}</span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => {
                  setNiManualOpen(false);
                }}
                aria-label={t('clientOperations.close')}
                title={t('clientOperations.close')}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              <p className="nx-oblig-ni-prompt-amount">
                {t('clientOperations.obligations.monthlyAmount')}: {niManual.monthly_amount_display_he}
              </p>
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
                    <span>{t('clientOperations.obligations.standingOrder')}</span>
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
                  {localizeSystemLabel(t, a.action_label_key, a.action_label_he)}
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
            aria-label={localizeSystemLabel(t, visibleNiDedAuto.title_key, visibleNiDedAuto.title_he)}
          >
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{localizeSystemLabel(t, visibleNiDedAuto.title_key, visibleNiDedAuto.title_he)}</h2>
                <span className="nx-modal-subtitle">{localizeSystemLabel(t, visibleNiDedAuto.message_key, visibleNiDedAuto.message_he)}</span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setNiDedAutoDismissed(true)}
                aria-label={t('clientOperations.close')}
                title={t('clientOperations.close')}
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
                  <span>{localizeSystemLabel(t, cb.label_key, cb.label_he)}</span>
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
                  <span>{t('clientOperations.obligations.dontShowThisMonth')}</span>
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
                  {localizeSystemLabel(t, a.action_label_key, a.action_label_he)}
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
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={localizeSystemLabel(t, payrollMan.title_key, payrollMan.title_he)}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{localizeSystemLabel(t, payrollMan.title_key, payrollMan.title_he)}</h2>
                <span className="nx-modal-subtitle">
                  {payrollMan.payroll_period_display_he} — {localizeSystemLabel(t, payrollMan.status_label_key, payrollMan.status_label_he)}
                </span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setPayrollManualOpen(false)}
                aria-label={t('clientOperations.close')}
                title={t('clientOperations.close')}
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
                  <span>{localizeSystemLabel(t, cb.label_key, cb.label_he)}</span>
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
                  {localizeSystemLabel(t, a.action_label_key, a.action_label_he)}
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
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={localizeSystemLabel(t, itdManual.title_key, itdManual.title_he)}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{localizeSystemLabel(t, itdManual.title_key, itdManual.title_he)}</h2>
                <span className="nx-modal-subtitle">
                  {itdManual.period_label_he} — {localizeSystemLabel(t, itdManual.status_label_key, itdManual.status_label_he)}
                </span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setItdManualOpen(false)}
                aria-label={t('clientOperations.close')}
                title={t('clientOperations.close')}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              <p className="nx-oblig-ni-prompt-amount">
                {fillI18n(
                  localizeSystemLabel(t, itdManual.message_key, itdManual.message_he),
                  itdManual.message_vars ?? {},
                )}
              </p>
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
                  {localizeSystemLabel(t, a.action_label_key, a.action_label_he)}
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
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={localizeSystemLabel(t, niDedManual.title_key, niDedManual.title_he)}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{localizeSystemLabel(t, niDedManual.title_key, niDedManual.title_he)}</h2>
                <span className="nx-modal-subtitle">{localizeSystemLabel(t, niDedManual.status_label_key, niDedManual.status_label_he)}</span>
              </div>
              <button
                type="button"
                className="nx-modal-close"
                onClick={() => setNiDedManualOpen(false)}
                aria-label={t('clientOperations.close')}
                title={t('clientOperations.close')}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body nx-oblig-ni-modal-body">
              <p className="nx-oblig-ni-prompt-amount">{localizeSystemLabel(t, niDedManual.message_key, niDedManual.message_he)}</p>
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
                  <span>{localizeSystemLabel(t, cb.label_key, cb.label_he)}</span>
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
                  {localizeSystemLabel(t, a.action_label_key, a.action_label_he)}
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
          <div className="nx-modal nx-oblig-ni-modal" role="dialog" aria-modal="true" aria-label={t('clientOperations.obligations.updateAmount')}>
            <div className="nx-modal-header">
              <div className="nx-modal-title-wrap nx-modal-title-wrap-stacked">
                <h2 className="nx-modal-title">{t('clientOperations.obligations.updateAmount')}</h2>
                <span className="nx-modal-subtitle">{t('clientOperations.taxes.cards.niSelfEmployed')}</span>
              </div>
              <button type="button" className="nx-modal-close" onClick={() => setNiAmountModalOpen(false)} aria-label={t('clientOperations.close')} title={t('clientOperations.close')}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body">
              <label className="nx-oblig-ni-prompt-text" htmlFor="ni-amount-input">{t('clientOperations.obligations.monthlyAmount')}</label>
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
                {t('clientOperations.close')}
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
                {t('clientOperations.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

