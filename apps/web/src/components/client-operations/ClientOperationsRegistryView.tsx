import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch, apiJson, ApiError, userFacingApiMessage } from '../../api/client';
import { localizeClientOperationsRegistryCommandError } from '../../lib/client-operations-registry-command-error.pure';
import {
  canStartFilingAction,
  filingAggregateConfirmsAction,
  filingCellPresentationClass,
} from '../../lib/client-operations-filing-result.pure';
import {
  beginOptimisticCheckbox,
  canStartOptimisticCheckboxCommand,
  checkboxOptimisticMarkKey,
  dropOptimisticCheckboxesForOtherPeriod,
  resolveOptimisticCheckboxChecked,
  revertOptimisticCheckbox,
  shouldClearOptimisticCheckboxAfterSuccess,
  type OptimisticCheckboxEntry,
} from '../../lib/client-operations-checkbox-optimistic.pure';
import { localizeSystemLabel } from '../../lib/co-display-label.pure';
import {
  matchClientOperationsRegistrySuggestions,
  moveClientOperationsSearchSuggestionIndex,
  type ClientOperationsSearchSuggestion,
} from '../../lib/client-operations-search-suggestions.pure';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import {
  beginExclusiveSubmit,
  buildCreateClientCommandPayload,
  endExclusiveSubmit,
  firstInvalidCreateClientFocusField,
  mapCreateClientCommandError,
  validateCreateClientDraft,
  type CreateClientField,
} from '../../pages/client-create-form.pure';
import { canonicalCreatedClientId } from '../../pages/client-create-navigation.pure';
import { AccountRequiredMark } from '../glass/AccountRequiredMark';
import { useClientOperationsHeaderSearchSlot, useClientOperationsHeaderWorkspaceSlot } from './ClientOperationsHeaderSearchSlot';
import { encodeClientOperationsWorkspaceOptionValue } from '../../lib/client-operations-workspace-url.pure';
import { ClientOperationsMultiSelectFilter } from './ClientOperationsMultiSelectFilter';
import {
  orgClients,
  moduleClientOperationsCase,
  moduleClientOperationsClientQuickProfile,
  moduleClientOperationsOperationalNotes,
  moduleClientOperationsOperationalNote,
  moduleClientOperationsCreateNote,
  moduleClientOperationsDeleteNote,
} from '../../api/endpoints';
import {
  ClientOperationsClientQuickProfilePopover,
  type ClientOperationsClientQuickProfileAggregate,
} from './ClientOperationsClientQuickProfilePopover';
import {
  clampClientOperationsColumnWidth,
  loadClientOperationsColumnWidths,
  saveClientOperationsColumnWidths,
} from '../../lib/client-operations-column-widths.pure';
import {
  loadClientOperationsCellPresentation,
  saveClientOperationsCellPresentation,
} from '../../lib/client-operations-cell-presentation.pure';
import {
  loadClientOperationsHiddenColumns,
  saveClientOperationsHiddenColumns,
} from '../../lib/client-operations-hidden-columns.pure';
import {
  clientOperationsPresentationCellKey,
  isClientOperationsFormatEligibleColumn,
  reconcileActiveCellAfterColumnVisibility,
  reconcileActiveCellAfterRowsChange,
  shouldClearActiveCellOnPeriodChange,
  type ClientOperationsActiveCell,
} from '../../lib/client-operations-active-cell.pure';
import {
  CLIENT_OPERATIONS_DEFAULT_TEXT_COLOR,
  clientOperationsTextColorPaletteRows,
} from '../../lib/client-operations-text-color-palette.pure';
import { resolveRegistryCellTextColor } from '../../lib/client-operations-registry-text-color.pure';
import {
  CLIENT_OPERATIONS_FONT_SIZES,
  CLIENT_OPERATIONS_DEFAULT_FONT_SIZE,
} from '../../lib/client-operations-font-size.pure';
import {
  computeClientOperationsColumnResizeDelta,
  CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE,
} from '../../lib/client-operations-column-resize.pure';
import {
  toggleClientOperationsHiddenColumn,
  isClientOperationsMandatoryVisibleColumn,
} from '../../lib/client-operations-column-visibility.pure';
import {
  selectPrintableColumnKeys,
  selectPrintableManualRows,
  formatClientOperationsPeriodHeading,
  type ClientOperationsPrintColumn,
  type ClientOperationsPrintRow,
} from '../../lib/client-operations-print.pure';
import {
  completeCustomCellSaveFailure,
  completeCustomCellSaveSuccess,
  customCellSaveKey,
  getCustomCellSlot,
  isCustomCellInFlight,
  manualDraftOverlayKey,
  reconcileManualRowsWithDirtyDrafts,
  rememberCustomCellDraft,
  shouldApplyCellSaveAggregate,
  shouldCacheCellSaveAggregate,
  shouldWriteManualDraftOverlay,
  tryStartCustomCellSave,
  type CustomCellSaveIdentity,
  type CustomCellSaveSlot,
  type CustomCellSaveStart,
} from '../../lib/client-operations-custom-cell-save.pure';
import {
  completeManualStatusPaintFailure,
  completeManualStatusPaintSuccess,
  rememberManualStatusPaintIntent,
  tryStartManualStatusPaint,
  type ManualStatusPaintIntent,
  type ManualStatusPaintSlot,
  type ManualStatusPaintStart,
} from '../../lib/client-operations-manual-status-paint.pure';
import {
  clearManualStatusOverlays,
  manualStatusPaintKey,
  reconcileManualStatusRows,
  setManualStatusOverlay,
  type ManualStatusOverlay,
} from '../../lib/client-operations-manual-status-reconcile.pure';
import {
  clearClientOperationsUndoStack,
  popClientOperationsUndoEntry,
  pushClientOperationsUndoEntry,
  type CoUndoEntry,
} from '../../lib/client-operations-undo-stack.pure';
import { formatCustomExcelCellDisplay } from '../../lib/client-operations-custom-cell-display.pure';
import {
  buildCopyUserPeriodDataCommandBody,
  sourcePeriodsForUserPeriodDataCopy,
  targetPeriodHasConflictingUserEnteredData,
  type UserPeriodDataCopyMode,
} from '../../lib/client-operations-user-period-data-copy.pure';
import { formatClientOperationsOperationalPeriodTabLabel } from '../../lib/client-operations-operational-period-label.pure';
import { PageHeader } from '../../templates/template-1/components/PageHeader';
import { SectionCard } from '../../templates/template-1/components/SectionCard';
import { ClientNoteModal } from '../ClientNoteModal';
import {
  ClientWorkspaceModal,
  buildPlaceholderClientCaseFromRegistryRow,
  type ClientOperationsCaseResponse,
} from '../ClientWorkspacePanel';
import '../../styles/nx-modal.css';
import '../../styles/nx-client-operations-spreadsheet.css';
import '../../styles/nx-client-operations-todo.css';
import '../../styles/nx-glass-surface.css';
import '../../styles/nx-clients.css';
import '../../styles/nx-client-create-deep-ocean-glass.css';
import { ClientOperationsPeriodSheetTabs } from './ClientOperationsPeriodSheetTabs';
import { ClientOperationsTodoBoardModal } from './ClientOperationsTodoBoardModal';

export type ClientOperationsMaterialCell = {
  /** Obligation exists in tax settings (independent of filing month). */
  configured?: boolean;
  /** Due / interactive in the selected period. */
  due?: boolean;
  /** Interactive this period (= configured && due). */
  applicable: boolean;
  editable?: boolean;
  completed: boolean | null;
  value: boolean | null;
};

export type ClientOperationsMaterialCells = {
  vat: ClientOperationsMaterialCell;
  income_tax_advance: ClientOperationsMaterialCell;
  payroll: ClientOperationsMaterialCell;
};

export type ClientOperationsAnnualReportCell = {
  applicable: boolean;
  editable: boolean;
  tax_year: number | null;
  instance_id: string | null;
  operational_target_date: string | null;
};

export type ClientOperationsCapitalDeclarationCell = {
  applicable: boolean;
  editable: boolean;
  instance_id: string | null;
  tax_year: number | null;
  operational_target_date: string | null;
  can_open: boolean;
};

export type ClientOperationsNiDeductionsFormItem = {
  configured?: boolean;
  due?: boolean;
  applicable: boolean;
  editable?: boolean;
  completed: boolean | null;
};

export type ClientOperationsNiDeductions126Item = ClientOperationsNiDeductionsFormItem & {
  outstanding_count: number;
};

export type ClientOperationsNiDeductionsCell = {
  configured?: boolean;
  due?: boolean;
  applicable: boolean;
  items: {
    '102': ClientOperationsNiDeductionsFormItem;
    '100': ClientOperationsNiDeductionsFormItem;
    '126': ClientOperationsNiDeductions126Item;
  };
};

export type ClientOperationsReportingCellPresentation = {
  kind: string;
  column_key: string;
  canonical_id: string;
  tone:
    | 'not_applicable'
    | 'unknown'
    | 'neutral_open'
    | 'warning'
    | 'urgent'
    | 'overdue'
    | 'submitted'
    | 'payment_outstanding'
    | 'payment_unknown';
  tone_label_key: string;
  tooltip_key: string;
  applicable: boolean;
  submitted: boolean;
  overdue: boolean;
  due_date: string | null;
  days_until_due: number | null;
  obligation_id: string | null;
  can_mark_submitted: boolean;
  can_mark_not_submitted: boolean;
  last_reported_at: string | null;
  submitted_indicator: boolean;
  display_dash: boolean;
  overlay_visible?: boolean;
  display_icon?: 'none' | 'check' | 'bang_overdue' | 'bang_payment' | 'unknown';
  filing_state?: 'not_applicable' | 'unfiled' | 'filed';
  payment_applies?: boolean;
  payment_question_visible?: boolean;
  payment_state?: string;
  payment_due_date?: string | null;
  payment_due_known?: boolean;
  payment_overdue?: boolean;
  payment_provenance?: 'user_attested' | null;
  bank_verified?: false;
  allowed_actions?: Array<'confirm_filing' | 'unfile' | 'update_payment'>;
  payment_modal?: {
    mode: 'file_with_payment' | 'update_payment';
    title_key: string;
    options: Array<{ id: string; label_key: string }>;
    confirm_key: string;
    cancel_key: string;
  } | null;
  filing_detail?: {
    openable: boolean;
    chrome: 'pending' | 'action_required' | 'filed_unpaid' | 'filed_paid' | 'not_applicable';
    period_key: string;
    period_display: string;
    filing_status_key: string;
    filed_on_display: string | null;
    submission_reference: string | null;
    payment_classification: string | null;
    payment_state: string;
    can_confirm_filing: boolean;
    can_clear_filing: boolean;
    can_record_payment: boolean;
    can_report: boolean;
    can_report_and_pay: boolean;
    can_mark_paid: boolean;
    material_warning_key?: string | null;
    attachment_notice_key?: string;
    evidence?: Array<{
      document_id: string;
      file_name: string | null;
      evidence_kind: 'filing' | 'payment';
      reporting_period_display: string;
    }>;
    report_key: string;
    report_and_paid_key: string;
    paid_key: string;
    title_key: string;
    client_key: string;
    period_label_key: string;
    frequency_key: string;
    status_key: string;
    confirm_action_key: string;
    filed_on_key: string;
    reference_key: string;
    payment_status_key: string;
    not_recorded_key: string;
    save_key: string;
    cancel_key: string;
  } | null;
  evidence_attachment?: {
    notice_key: string;
    filing_label_key: string;
    period_key: string;
    period_display: string;
    evidence: Array<{
      document_id: string;
      file_name: string | null;
      evidence_kind: 'filing' | 'payment';
      reporting_period_display: string;
    }>;
  };
};

export type SelfEmployedNiHandlingMethod = 'standing_order' | 'client_pays' | 'manual_monthly';

export type ClientOperationsSelfEmployedNiOperations = {
  applicable: boolean;
  openable: boolean;
  period_key: string;
  period_display: string;
  handling_method: SelfEmployedNiHandlingMethod | null;
  handling_method_source: 'explicit' | 'inherited' | 'standing_until' | 'unresolved';
  january_confirmation_required: boolean;
  ni_indicator_alert: boolean;
  handling_options: Array<{
    id: SelfEmployedNiHandlingMethod;
    label_key: string;
    selected: boolean;
  }>;
  standing_order_active: boolean;
  standing_order_status_key: string;
  standing_order_provenance: 'office_recorded';
  bank_verified: false;
  authority_verified: false;
  statutory_deadline: false;
  office_reminder: boolean;
  reminder_day: number;
  action_resolved: boolean;
  action_status_key: string;
  can_set_standing_order: boolean;
  can_set_handling_method: boolean;
  can_confirm_manual_resolution: boolean;
  can_confirm_month_handled: boolean;
  title_key: string;
  client_details_key: string;
  client_key: string;
  month_key: string;
  amount_key: string;
  handling_title_key: string;
  office_note_key: string;
  resolution_key: string;
  confirm_resolution_key: string;
  month_handled_key: string;
  save_key: string;
  cancel_key: string;
};

export type ClientOperationsReportingRowPresentation = {
  row_tone: 'none' | 'neutral' | 'warning' | 'urgent' | 'overdue' | 'payment_outstanding' | 'complete';
  row_tone_label_key: string;
  priority_rank: number;
  earliest_open_due_date: string | null;
  open_overdue_count: number;
  open_urgent_count: number;
  open_warning_count: number;
  open_neutral_count: number;
  open_payment_outstanding_count?: number;
  applicable_count: number;
  submitted_count: number;
  cells: Record<string, ClientOperationsReportingCellPresentation>;
};

export type ClientOperationsReportingDashboard = {
  kpi_cards: Array<{
    id: string;
    label_key: string;
    submitted_count: number;
    total_count: number;
    remaining_count: number;
    remaining_tone: 'neutral' | 'warning' | 'urgent' | 'overdue';
  }>;
  payments_outstanding_kpi?: {
    id: 'payments_outstanding';
    label_key: string;
    count: number;
    remaining_tone: 'payment_outstanding';
    tooltip_key: string;
    tooltip_periods: Array<{ period_key: string; display_label: string }>;
  };
  previous_periods: {
    incomplete_count: number;
    overdue_count: number;
    periods: Array<{
      period_key: string;
      navigate_period_key: string;
      display_label: string;
      kind: 'month' | 'year';
      incomplete: true;
      overdue: boolean;
    }>;
  };
  sort_options: Array<{ id: string; label_key: string }>;
  active_sort: string;
  active_kpi_filter: string | null;
};

export type ClientOperationsIncomeTaxDeductionsCell = {
  configured: boolean;
  due: boolean;
  applicable: boolean;
  editable: boolean;
  completed: boolean | null;
  value: boolean | null;
};

export type ClientOperationsRegistryRow = {
  client_id: string;
  client_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  payroll_flag: boolean | null;
  material_brought_flag: boolean | null;
  period_applicability?: {
    vat_applicable: boolean;
    payroll_applicable: boolean;
    income_tax_advance_applicable: boolean;
    income_tax_deductions_applicable: boolean;
    national_insurance_applicable: boolean;
    national_insurance_deductions_applicable: boolean;
    row_visible: boolean;
  };
  material_brought_cell?: ClientOperationsMaterialCell;
  material_cells?: ClientOperationsMaterialCells;
  annual_report_cell?: ClientOperationsAnnualReportCell;
  capital_declaration_cell?: ClientOperationsCapitalDeclarationCell;
  national_insurance_deductions_cell?: ClientOperationsNiDeductionsCell;
  income_tax_deductions_cell?: ClientOperationsIncomeTaxDeductionsCell;
  pcn_display?: string;
  vat_status: string | null;
  income_tax_advance_status: string | null;
  national_insurance_status: string | null;
  national_insurance_deductions_status: string | null;
  income_tax_deductions_status: string | null;
  assigned_handler_user_id: string | null;
  assigned_employees?: {
    display: string | null;
    names: string[];
    additional_count: number;
  };
  national_insurance_operations?: ClientOperationsSelfEmployedNiOperations;
  notes_cell_text_he: string | null;
  operational_notes_count: number;
  vat_due_registry_display_he: string | null;
  /** Ready-to-render display by column key (from aggregate). */
  cells?: Record<string, string>;
  cell_label_keys?: Record<string, string>;
  reporting?: ClientOperationsReportingRowPresentation;
  /** Backend-owned manual paint status capabilities per column key. */
  manual_cell_statuses?: Record<
    string,
    {
      status: 'ready' | 'sent_for_approval' | 'completed' | null;
      presentation_token: 'ready' | 'sent_for_approval' | 'completed' | null;
      allowed_statuses: Array<'ready' | 'sent_for_approval' | 'completed' | 'clear'>;
      operational_square_count: number;
    }
  >;
};

/** Backend-owned free-text manual spreadsheet rows (not Core clients). */
export type ClientOperationsManualRegistryRow = {
  row_kind: 'manual';
  row_key: string;
  manual_row_slot: 1 | 2 | 3 | 4 | 5;
  client_id: null;
  client_name: null;
  cells: Record<string, string>;
  cell_presentation: Record<string, { cell_kind: 'folder' | 'manual_text'; editable: boolean }>;
};

export type ClientOperationsNoteTypeRow = {
  code: string;
  label_he: string;
  sort_order: number;
  allows_reminder: boolean;
};

export type ClientOperationsRegistryColumn = {
  key: string;
  label: string;
  label_key?: string;
  cell_kind: 'folder' | 'text' | 'notes' | 'custom' | 'checkbox' | 'operational_date';
  value_field: string | null;
  data_type?: 'text' | 'number' | 'date' | 'boolean';
  custom_column_id?: string;
  default_width_px?: number;
  visible: boolean;
  system: boolean;
  editable: boolean;
  freeze_default: boolean;
  align: 'right' | 'center' | 'left';
  settings_available?: boolean;
  auto_extend_to_future?: boolean;
  auto_extend_from_period_key?: string | null;
  visible_period_keys?: string[];
  legacy_baseline_required?: boolean;
  legacy_baseline_period_key?: string | null;
};

export type ClientOperationsToolbarCapability = {
  id: string;
  label_he: string;
  label_key?: string;
  available: boolean;
  reason_he: string | null;
  reason_key?: string | null;
  group: 'history' | 'query' | 'format' | 'structure' | 'more';
};

type OperationalNoteRow = {
  id: string;
  type_code: string;
  type_label_he: string;
  body: string;
  reminder_at: string | null;
  created_at: string;
  updated_at: string;
};

type ConflictPayload = {
  code: string;
  ui: {
    title_he: string;
    title_key?: string;
    message_he: string;
    message_key?: string;
    button_create_anyway_he: string;
    button_create_anyway_key?: string;
    button_change_time_he: string;
    button_change_time_key?: string;
  };
  conflicts: Array<{
    client_display_name: string | null;
    body_preview: string;
    type_code?: string;
    type_label_he: string;
    type_label_key?: string | null;
    reminder_at: string;
  }>;
};

function operationalNoteTypeLabel(t: (key: string) => string, typeCode: string, fallbackHe: string): string {
  if (typeCode === 'call' || typeCode === 'reminder' || typeCode === 'greeting' || typeCode === 'text') {
    return localizeSystemLabel(t, `clientOperations.notes.${typeCode}`, fallbackHe);
  }
  return localizeSystemLabel(t, 'clientOperations.notes.text', fallbackHe);
}

type CellPresentation = {
  align?: 'right' | 'center' | 'left';
  wrap?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fill?: string;
  numberFormat?: 'general' | 'number' | 'currency' | 'percent' | 'date';
  /** Explicit font size in px; when unset default rendering applies (no forced 12px). */
  fontSize?: number;
};

type PresentationHistory = {
  presentation: Record<string, CellPresentation>;
};

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(local: string): string | null {
  if (!local || !local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Progressive enhancement: open native date picker when the platform supports it. */
function tryShowNativeDatePicker(input: HTMLInputElement): void {
  if (typeof input.showPicker !== 'function') return;
  try {
    void input.showPicker();
  } catch {
    // NotAllowedError / unsupported — native click / indicator path remains.
  }
}

/** Unified amber client-folder glyph (spreadsheet chrome) — folder shape preserved, colors via CSS. */
function ClientOperationsFolderIcon() {
  return (
    <svg className="nx-co-sheet__folder-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        className="nx-co-sheet__folder-back"
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6c.4 0 .8.16 1.06.44L11.6 6.9H19.5A1.5 1.5 0 0 1 21 8.4v9.1a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"
      />
      <path
        className="nx-co-sheet__folder-front"
        d="M3.4 10.2h17.2c.9 0 1.5.8 1.3 1.7l-1.2 6a1.5 1.5 0 0 1-1.47 1.2H4.77a1.5 1.5 0 0 1-1.47-1.2l-1.2-6c-.2-.9.4-1.7 1.3-1.7z"
      />
    </svg>
  );
}

function cellKey(clientId: string, colKey: string): string {
  return `${clientId}::${colKey}`;
}

function obligationApplicable(
  row: ClientOperationsRegistryRow,
  columnKey: string,
): boolean | null {
  const a = row.period_applicability;
  if (!a) return null;
  switch (columnKey) {
    case 'vat':
    case 'vat_due':
      return a.vat_applicable;
    case 'payroll':
      return a.payroll_applicable;
    case 'income_tax_advance':
      return a.income_tax_advance_applicable;
    case 'income_tax_deductions':
      // Presentation owned by income_tax_deductions_cell (configured/due/disabled).
      return null;
    case 'national_insurance':
      return a.national_insurance_applicable;
    case 'national_insurance_deductions':
      return (
        row.national_insurance_deductions_cell?.applicable ??
        a.national_insurance_deductions_applicable
      );
    case 'material_brought':
      return row.material_brought_cell?.applicable ?? row.material_brought_flag !== null;
    default:
      return null;
  }
}

/** USER/custom Excel cells: empty renders blank (never em-dash / placeholder). */
function displayCustomColumnValue(r: ClientOperationsRegistryRow, col: ClientOperationsRegistryColumn): string {
  return formatCustomExcelCellDisplay(r.cells?.[col.key]);
}

function displayForColumn(
  r: ClientOperationsRegistryRow,
  col: ClientOperationsRegistryColumn,
  t?: (key: string) => string,
): string {
  const value = r.cells?.[col.key];
  // PCN: empty string means not PCN (must not coerce to em-dash).
  if (col.key === 'pcn') {
    if (value != null) return String(value);
    return r.pcn_display ?? '';
  }
  // User Excel columns must stay blank when empty — system columns keep dash semantics.
  if (col.cell_kind === 'custom') return displayCustomColumnValue(r, col);
  if (value == null || value === '') return '—';
  if (t) {
    return localizeSystemLabel(t, r.cell_label_keys?.[col.key], value);
  }
  return value;
}

function systemColumnHeaderLabel(
  column: ClientOperationsRegistryColumn,
  t: (key: string) => string,
): string {
  if (!column.system) return column.label;
  return localizeSystemLabel(t, column.label_key, column.label);
}

function reportingPaymentStateLabelKey(state: string | null | undefined): string {
  switch (state) {
    case 'paid_in_full':
      return 'clientOperations.registry.reporting.payment.paidInFull';
    case 'outstanding':
      return 'clientOperations.registry.reporting.payment.outstanding';
    case 'partially_paid':
      return 'clientOperations.registry.reporting.payment.partiallyPaid';
    case 'not_required':
      return 'clientOperations.registry.reporting.payment.notRequired';
    case 'not_applicable':
      return 'clientOperations.registry.reporting.cell.notApplicable';
    default:
      return 'clientOperations.registry.reporting.filing.notRecorded';
  }
}

function ClientOperationsCalendarIcon() {
  return (
    <svg className="nx-co-sheet__date-field-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function fillI18n(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value), template);
}

/** Row pitch of the spreadsheet grid (matches the canvas row gradient in nx-client-operations-spreadsheet.css). */
const SHEET_GRID_ROW_PITCH_PX = 31;

export type ClientOperationsRegistryViewProps = {
  rows: ClientOperationsRegistryRow[];
  onRowsChange: (rows: ClientOperationsRegistryRow[]) => void;
  /** Backend-owned manual spreadsheet rows from aggregate (default []). */
  manualRows?: ClientOperationsManualRegistryRow[];
  noteTypes: ClientOperationsNoteTypeRow[];
  loading: boolean;
  /**
   * Period-safe transition: selected tab does not yet match painted aggregate.
   * Toolbar/filters/tabs stay; period-bound rows must not show prior-period content.
   */
  periodContentPending?: boolean;
  /** Quiet search/filter aggregate refresh in flight (page-owned) → compact pending state in the search field. */
  searchPending?: boolean;
  /** Aggregate period currently painted (null during transition). */
  renderedAggregatePeriodKey?: string | null;
  error: string;
  canEdit: boolean;
  showPageHeader?: boolean;
  onReloadRegistry?: (options?: { bypassCache?: boolean }) => void;
  /** Spreadsheet chrome only on /m/client-operations; embedded keeps prior Work Engine look. */
  variant?: 'spreadsheet' | 'embedded';
  /** Backend `create_core_client` — Core POST /clients, then this page's workspace modal. */
  canCreateCoreClient?: boolean;
  /** Open the existing folder modal after a create that arrived via registry navigation state. */
  pendingOpenClientId?: string | null;
  pendingOpenClientSnapshot?: {
    client_name: string | null;
    tax_id: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  onPendingOpenConsumed?: () => void;
  /**
   * Aggregate title (contract kept). The inner sheet title is no longer rendered —
   * the module title lives in the route header (ClientOperationsAppHeader).
   */
  titleHe?: string;
  columns?: ClientOperationsRegistryColumn[];
  toolbarCapabilities?: ClientOperationsToolbarCapability[];
  customColumnsCapability?: { max: number; current: number; can_create: boolean };
  userColumnPeriodSetup?: {
    needed: boolean;
    operational_period_key: string;
    eligible_columns: Array<{ column_id: string; label: string; key: string; preselected: boolean }>;
  } | null;
  columnsNeedingLegacyBaseline?: Array<{
    column_id: string;
    label: string;
    key: string;
    available_baseline_periods: string[];
  }>;
  manualStatusPaintModes?: Array<{
    id: 'ready' | 'sent_for_approval' | 'completed' | 'clear';
    label_he: string;
    label_key?: string;
    presentation_token: 'ready' | 'sent_for_approval' | 'completed' | 'clear';
  }>;
  /** Backend-owned filter bar contract — FE renders only. */
  filters?: {
    definitions: Array<{
      id: string;
      label_he: string;
      label_key?: string;
      width_hint?: 'default' | 'wide' | 'handler';
      selection_mode?: 'single' | 'multi';
      options: Array<{ id: string; label_he: string; label_key?: string; enabled: boolean }>;
    }>;
    active: {
      operational_reporting: string;
      material: string;
      payroll: string;
      reporting_type: string;
      business_type: string;
      handler: string;
    };
    any_business_filter_active: boolean;
    clear_action: { id: string; label_he: string; label_key?: string; available: boolean };
  };
  /** Stage 4 — backend-owned workspace projection (selector from allowed_scopes only). */
  workspace?: {
    scope_kind: 'OFFICE' | 'MY' | 'STAFF';
    viewer_user_id: string;
    workspace_subject_user_id: string | null;
    access_scope_key: string;
    label_he: string;
    label_key?: string;
    allowed_scopes: Array<{
      scope_kind: 'OFFICE' | 'MY' | 'STAFF';
      subject_user_id: string | null;
      label_he: string;
      label_key?: string;
      role_code: string | null;
    }>;
    available_workspace_subjects: Array<{
      user_id: string;
      display_name: string;
      role_code: string;
    }>;
    selector_visible: boolean;
    selector_options?: Array<{
      scope_kind: 'OFFICE' | 'MY' | 'STAFF';
      subject_user_id: string | null;
      label_he: string;
      label_key?: string;
    }>;
    /** Backend presentation flag: assigned-handler column / filter is shown in the office workspace only. */
    show_handler?: boolean;
  } | null;
  onWorkspaceChange?: (optionValue: string) => void;
  query?: {
    q: string | null;
    sort_by: string | null;
    sort_dir: 'asc' | 'desc' | null;
    operational_period_key?: string | null;
    filter_operational_reporting?: string | null;
    filter_material?: string | null;
    filter_payroll?: string | null;
    filter_reporting_type?: string | null;
    filter_business_type?: string | null;
    filter_handler?: string | null;
    filter_reporting_kpi?: string | null;
    workspace_scope?: string | null;
    workspace_subject_user_id?: string | null;
  };
  reportingDashboard?: ClientOperationsReportingDashboard | null;
  onQueryChange?: (
    next: {
      q: string | null;
      sort_by: string | null;
      sort_dir: 'asc' | 'desc' | null;
      filter_operational_reporting?: string | null;
      filter_material?: string | null;
      filter_payroll?: string | null;
      filter_reporting_type?: string | null;
      filter_business_type?: string | null;
      filter_handler?: string | null;
      filter_reporting_kpi?: string | null;
    },
    options?: { quiet?: boolean },
  ) => void;
  onRegistryCommand?: (
    body: Record<string, unknown>,
    options?: { applyAggregate?: boolean; requireApplied?: boolean },
  ) => Promise<unknown>;
  onApplyAggregate?: (aggregate: any) => void;
  /** Bump parent load generation so in-flight quiet GETs cannot wipe newer writes. */
  onInvalidateStaleLoads?: () => void;
  widthScope?: { userId: string; organizationId: string };
  period?: {
    selected_period_key: string;
    default_period_key: string;
    available_periods: string[];
  } | null;
  /** Backend-owned periods with meaningful user-entered custom/manual values (copy menu). */
  userPeriodDataCopySourcePeriods?: string[];
  onPeriodChange?: (operationalPeriodKey: string) => void;
};

export function ClientOperationsRegistryView(props: ClientOperationsRegistryViewProps) {
  const {
    rows,
    onRowsChange,
    manualRows = [],
    noteTypes,
    loading,
    periodContentPending = false,
    searchPending = false,
    error,
    canEdit,
    canCreateCoreClient = false,
    pendingOpenClientId = null,
    pendingOpenClientSnapshot = null,
    onPendingOpenConsumed,
    showPageHeader = true,
    onReloadRegistry,
    variant = 'embedded',
    columns: columnsProp,
    toolbarCapabilities = [],
    customColumnsCapability: _customColumnsCapability,
    userColumnPeriodSetup = null,
    columnsNeedingLegacyBaseline: _columnsNeedingLegacyBaseline = [],
    manualStatusPaintModes = [],
    filters,
    reportingDashboard = null,
    workspace = null,
    onWorkspaceChange,
    query,
    onQueryChange,
    onRegistryCommand,
    onApplyAggregate,
    onInvalidateStaleLoads,
    widthScope,
    period,
    userPeriodDataCopySourcePeriods = [],
    onPeriodChange,
  } = props;

  const setRows = onRowsChange;
  const isSpreadsheet = variant === 'spreadsheet';
  // Presentation only: employees do not see the assigned-handler column / filter (backend truth is untouched).
  const showHandler = workspace?.show_handler !== false;
  const columns = useMemo(() => {
    const all = columnsProp ?? [];
    return showHandler ? all : all.filter((c) => c.key !== 'handler');
  }, [columnsProp, showHandler]);
  /** Route header centre slot (CO route). null → search renders inline in the toolbar. */
  const headerSearchSlot = useClientOperationsHeaderSearchSlot();
  const headerWorkspaceSlot = useClientOperationsHeaderWorkspaceSlot();
  const [todoBoardOpen, setTodoBoardOpen] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalData, setModalData] = useState<ClientOperationsCaseResponse | null>(null);
  const auth = useAuth();
  const { t, lang } = useI18n();
  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createInvalidField, setCreateInvalidField] = useState<CreateClientField | null>(null);
  const [createTaxId, setCreateTaxId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('business_customer');
  const [createPhone, setCreatePhone] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createWebsite, setCreateWebsite] = useState('');
  const [createCountry, setCreateCountry] = useState('');
  const [createCity, setCreateCity] = useState('');
  const [createStreet, setCreateStreet] = useState('');
  const [createPostalCode, setCreatePostalCode] = useState('');
  const createInFlightRef = useRef(false);
  const createTaxIdRef = useRef<HTMLInputElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const createTypeRef = useRef<HTMLSelectElement>(null);
  const createPhoneRef = useRef<HTMLInputElement>(null);
  const createEmailRef = useRef<HTMLInputElement>(null);
  const [quickProfile, setQuickProfile] = useState<ClientOperationsClientQuickProfileAggregate | null>(
    null
  );
  const [quickProfileAnchor, setQuickProfileAnchor] = useState<HTMLElement | null>(null);
  const [quickProfileClientId, setQuickProfileClientId] = useState<string | null>(null);
  const [quickProfileLoading, setQuickProfileLoading] = useState(false);

  const [notesModalClientId, setNotesModalClientId] = useState<string | null>(null);
  const [notesModalClientName, setNotesModalClientName] = useState('');
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState('');
  const [operationalNotes, setOperationalNotes] = useState<OperationalNoteRow[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [formTypeCode, setFormTypeCode] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formReminderLocal, setFormReminderLocal] = useState('');
  const [, setFormSaving] = useState(false);
  const [conflict, setConflict] = useState<ConflictPayload | null>(null);

  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  /** Presentation-only active cell for formatting toolbar (not persisted). */
  const [focusedCell, setFocusedCell] = useState<ClientOperationsActiveCell | null>(null);
  /** Toolbar presentation choices when no cell is selected (not persisted; not cell truth). */
  const [presentationToolDefaults, setPresentationToolDefaults] = useState<{
    color: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    align?: 'right' | 'center' | 'left';
    wrap: boolean;
    fill?: string;
    numberFormat?: CellPresentation['numberFormat'];
  }>(() => ({
    color: CLIENT_OPERATIONS_DEFAULT_TEXT_COLOR,
    fontSize: CLIENT_OPERATIONS_DEFAULT_FONT_SIZE,
    bold: false,
    italic: false,
    underline: false,
    wrap: false,
  }));
  const [searchDraft, setSearchDraft] = useState(query?.q ?? '');
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  // Freeze sticky CSS retained; toolbar toggle is hidden — keep pinned columns on by default.
  const freezeOn = true;
  const [bordersOn, setBordersOn] = useState(true);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [cellPresentation, setCellPresentation] = useState<Record<string, CellPresentation>>({});
  const [coUndoStack, setCoUndoStack] = useState<CoUndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<PresentationHistory[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [colorPaletteOpen, setColorPaletteOpen] = useState(false);
  const [columnVisibilityOpen, setColumnVisibilityOpen] = useState(false);
  const [isResizingColumn, setIsResizingColumn] = useState(false);
  // Legacy "+ עמודה" dialog kept in code but hidden — 10 user slots via ensure command.
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [addColumnLabel, setAddColumnLabel] = useState('');
  const [addColumnDataType, setAddColumnDataType] = useState<'text' | 'number' | 'date' | 'boolean'>('text');
  const [commandError, setCommandError] = useState('');
  const [pendingMarkKeys, setPendingMarkKeys] = useState<ReadonlySet<string>>(() => new Set());
  const pendingMarkKeysRef = useRef<Set<string>>(new Set());
  const optimisticChecksRef = useRef<Map<string, OptimisticCheckboxEntry>>(new Map());
  const [optimisticChecks, setOptimisticChecks] = useState<ReadonlyMap<string, OptimisticCheckboxEntry>>(
    () => new Map(),
  );
  const [editingHeaderColumnId, setEditingHeaderColumnId] = useState<string | null>(null);
  const [headerDraft, setHeaderDraft] = useState('');
  const [editingCellKey, setEditingCellKey] = useState<string | null>(null);
  const [cellDraft, setCellDraft] = useState('');
  /**
   * Optimistic manual drafts keyed by period::row::col — period-scoped so month A
   * never paints into month B while a late save resolves.
   */
  const [manualDraftOverlay, setManualDraftOverlay] = useState<Record<string, string>>({});
  const [statusPaintMode, setStatusPaintMode] = useState<
    'ready' | 'sent_for_approval' | 'completed' | 'clear' | null
  >(null);
  /** Centered source-month modal for period copy (right-click entry). */
  const [periodCopySourceOpen, setPeriodCopySourceOpen] = useState(false);
  const [periodCopySelectedSource, setPeriodCopySelectedSource] = useState<string | null>(null);
  const [periodCopyDialog, setPeriodCopyDialog] = useState<null | {
    sourcePeriodKey: string;
    mode: UserPeriodDataCopyMode;
  }>(null);
  const [periodCopyBusy, setPeriodCopyBusy] = useState(false);
  const [periodCopyFeedback, setPeriodCopyFeedback] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{
    mode: 'file_with_payment' | 'update_payment';
    row: ClientOperationsRegistryRow;
    columnKey: string;
    obligationId: string;
    canonicalId: string;
    titleKey: string;
    options: Array<{ id: string; label_key: string }>;
    confirmKey: string;
    cancelKey: string;
    selected: string | null;
  } | null>(null);
  const [filingModal, setFilingModal] = useState<{
    row: ClientOperationsRegistryRow;
    columnKey: string;
  } | null>(null);
  const [filingEvidenceKind, setFilingEvidenceKind] = useState<'filing' | 'payment'>('filing');
  const filingEvidenceInputRef = useRef<HTMLInputElement | null>(null);
  const [filingActionPending, setFilingActionPending] = useState(false);
  const [filingFeedback, setFilingFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const filingActionLockRef = useRef(false);
  const [evidencePending, setEvidencePending] = useState(false);
  const [evidenceFeedback, setEvidenceFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const evidenceLockRef = useRef(false);
  const [niEvidencePrompt, setNiEvidencePrompt] = useState<{ clientId: string } | null>(null);
  const niEvidenceInputRef = useRef<HTMLInputElement | null>(null);
  const [niModal, setNiModal] = useState<{
    row: ClientOperationsRegistryRow;
    handlingMethod: SelfEmployedNiHandlingMethod | null;
    confirmMonthHandled: boolean;
  } | null>(null);
  const statusPaintSlotsRef = useRef<Map<string, ManualStatusPaintSlot>>(new Map());
  const statusOverlaysRef = useRef<Map<string, ManualStatusOverlay>>(new Map());
  const statusOverlayGenRef = useRef(0);
  const skipUndoPushRef = useRef(false);
  const searchFieldRef = useRef<HTMLDivElement | null>(null);
  const searchScrollClientIdRef = useRef<string | null>(null);
  const searchRequestSeqRef = useRef(0);

  useEffect(() => {
    setSearchDraft(query?.q ?? '');
  }, [query?.q]);

  const viewedCheckboxPeriodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';

  useEffect(() => {
    if (!dropOptimisticCheckboxesForOtherPeriod(optimisticChecksRef.current, viewedCheckboxPeriodKey)) {
      return;
    }
    setOptimisticChecks(new Map(optimisticChecksRef.current));
  }, [viewedCheckboxPeriodKey]);

  const searchSuggestions = useMemo(
    () => matchClientOperationsRegistrySuggestions(rows, searchDraft),
    [rows, searchDraft],
  );

  useEffect(() => {
    setSearchActiveIndex(-1);
  }, [searchDraft]);

  useEffect(() => {
    if (!searchSuggestionsOpen || searchActiveIndex < 0) return;
    const clientId = searchSuggestions[searchActiveIndex]?.client_id;
    if (!clientId) return;
    document.getElementById(`client-operations-search-option-${clientId}`)?.scrollIntoView({ block: 'nearest' });
  }, [searchActiveIndex, searchSuggestions, searchSuggestionsOpen]);

  useEffect(() => {
    if (!searchSuggestionsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const root = searchFieldRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return;
      setSearchSuggestionsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [searchSuggestionsOpen]);

  useEffect(() => {
    const clientId = searchScrollClientIdRef.current;
    if (!clientId) return;
    const row = document.querySelector(`tr[data-client-id="${CSS.escape(clientId)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    searchScrollClientIdRef.current = null;
  }, [rows]);

  const applyLiveSearch = useCallback(
    (raw: string) => {
      // Explicit confirm or clear only. Typing must not start this read.
      if (!onQueryChange) return;
      const q = raw.trim() || null;
      if ((query?.q ?? null) === q) return;
      const seq = ++searchRequestSeqRef.current;
      onQueryChange(
        {
          q,
          sort_by: query?.sort_by ?? null,
          sort_dir: query?.sort_dir ?? null,
          filter_operational_reporting: query?.filter_operational_reporting ?? null,
          filter_material: query?.filter_material ?? null,
          filter_payroll: query?.filter_payroll ?? null,
          filter_reporting_type: query?.filter_reporting_type ?? null,
          filter_business_type: query?.filter_business_type ?? null,
          filter_handler: query?.filter_handler ?? null,
          filter_reporting_kpi: query?.filter_reporting_kpi ?? null,
        },
        { quiet: true },
      );
      void seq;
    },
    [
      onQueryChange,
      query?.q,
      query?.sort_by,
      query?.sort_dir,
      query?.filter_operational_reporting,
      query?.filter_material,
      query?.filter_payroll,
      query?.filter_reporting_type,
      query?.filter_business_type,
      query?.filter_handler,
      query?.filter_reporting_kpi,
    ],
  );

  const FILTER_ID_TO_QUERY_KEY: Record<
    string,
    | 'filter_operational_reporting'
    | 'filter_material'
    | 'filter_payroll'
    | 'filter_reporting_type'
    | 'filter_business_type'
    | 'filter_handler'
  > = {
    operational_reporting: 'filter_operational_reporting',
    material: 'filter_material',
    payroll: 'filter_payroll',
    reporting_type: 'filter_reporting_type',
    business_type: 'filter_business_type',
    handler: 'filter_handler',
  };

  const applyBusinessFilterChange = useCallback(
    (filterId: string, optionId: string) => {
      if (!onQueryChange) return;
      const key = FILTER_ID_TO_QUERY_KEY[filterId];
      if (!key) return;
      const value = !optionId || optionId === 'all' ? null : optionId;
      onQueryChange(
        {
          q: query?.q ?? null,
          sort_by: query?.sort_by ?? null,
          sort_dir: query?.sort_dir ?? null,
          filter_operational_reporting: query?.filter_operational_reporting ?? null,
          filter_material: query?.filter_material ?? null,
          filter_payroll: query?.filter_payroll ?? null,
          filter_reporting_type: query?.filter_reporting_type ?? null,
          filter_business_type: query?.filter_business_type ?? null,
          filter_handler: query?.filter_handler ?? null,
          filter_reporting_kpi: query?.filter_reporting_kpi ?? null,
          [key]: value,
        },
        { quiet: true },
      );
    },
    [
      onQueryChange,
      query?.q,
      query?.sort_by,
      query?.sort_dir,
      query?.filter_operational_reporting,
      query?.filter_material,
      query?.filter_payroll,
      query?.filter_reporting_type,
      query?.filter_business_type,
      query?.filter_handler,
      query?.filter_reporting_kpi,
    ],
  );

  const clearBusinessFilters = useCallback(() => {
    if (!onQueryChange) return;
    onQueryChange(
      {
        q: query?.q ?? null,
        sort_by: query?.sort_by ?? null,
        sort_dir: query?.sort_dir ?? null,
        filter_operational_reporting: null,
        filter_material: null,
        filter_payroll: null,
        filter_reporting_type: null,
        filter_business_type: null,
        filter_handler: null,
        filter_reporting_kpi: query?.filter_reporting_kpi ?? null,
      },
      { quiet: true },
    );
  }, [onQueryChange, query?.q, query?.sort_by, query?.sort_dir, query?.filter_reporting_kpi]);

  const focusRegistryClient = (clientId: string) => {
    setSelectedRowId(clientId);
    searchScrollClientIdRef.current = clientId;
    const row = document.querySelector(`tr[data-client-id="${CSS.escape(clientId)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    searchScrollClientIdRef.current = null;
  };

  const confirmSearchSuggestion = (suggestion: ClientOperationsSearchSuggestion) => {
    setSearchSuggestionsOpen(false);
    setSearchActiveIndex(-1);
    const nextDraft = suggestion.query || suggestion.client_name;
    setSearchDraft(nextDraft);
    focusRegistryClient(suggestion.client_id);
    if (suggestion.query) applyLiveSearch(suggestion.query);
  };

  const confirmTypedSearch = () => {
    setSearchSuggestionsOpen(false);
    if (!isCap('search')) return;
    applyLiveSearch(searchDraft);
  };

  const onSearchDraftChange = (value: string) => {
    setSearchDraft(value);
    // Native clear restores the unfiltered aggregate immediately. Typing only updates suggestions.
    if (!value.trim()) {
      setSearchSuggestionsOpen(false);
      setSearchActiveIndex(-1);
      applyLiveSearch('');
      return;
    }
    setSearchSuggestionsOpen(true);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setSearchSuggestionsOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!searchSuggestionsOpen && searchDraft.trim()) setSearchSuggestionsOpen(true);
      setSearchActiveIndex((current) =>
        moveClientOperationsSearchSuggestionIndex(
          current,
          event.key === 'ArrowDown' ? 1 : -1,
          searchSuggestions.length,
        ),
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const highlighted = searchSuggestionsOpen ? searchSuggestions[searchActiveIndex] : undefined;
      if (highlighted) {
        confirmSearchSuggestion(highlighted);
        return;
      }
      confirmTypedSearch();
    }
  };

  useEffect(() => {
    if (!widthScope?.userId || !widthScope.organizationId) {
      setColumnWidths({});
      setCellPresentation({});
      setHiddenColumns(new Set());
      setFocusedCell(null);
      return;
    }
    setColumnWidths(loadClientOperationsColumnWidths(widthScope.userId, widthScope.organizationId));
    setCellPresentation(loadClientOperationsCellPresentation(widthScope.userId, widthScope.organizationId));
    setHiddenColumns(loadClientOperationsHiddenColumns(widthScope.userId, widthScope.organizationId));
    setFocusedCell(null);
  }, [widthScope?.organizationId, widthScope?.userId]);

  useEffect(() => {
    clearManualStatusOverlays(statusOverlaysRef.current);
    statusPaintSlotsRef.current.clear();
    setCoUndoStack(clearClientOperationsUndoStack());
    setRedoStack([]);
    // cellPresentation / hiddenColumns hydrate from org-scoped storage above — do not wipe to empty.
  }, [widthScope?.organizationId]);

  useEffect(() => {
    setFocusedCell((current) =>
      reconcileActiveCellAfterColumnVisibility({
        active: current,
        hiddenColumnKeys: hiddenColumns,
      }),
    );
  }, [hiddenColumns]);

  useEffect(() => {
    const clientIds = rows.map((r) => r.client_id);
    const manualRowKeys = manualRows.map((r) => r.row_key);
    setFocusedCell((current) =>
      reconcileActiveCellAfterRowsChange({
        active: current,
        clientIds,
        manualRowKeys,
      }),
    );
  }, [rows, manualRows]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (focusedCell) {
        setFocusedCell(null);
        setEditingCellKey(null);
        setColorPaletteOpen(false);
        setColumnVisibilityOpen(false);
      }
      if (fullscreenOpen) setFullscreenOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusedCell, fullscreenOpen]);

  useEffect(() => {
    if (!fullscreenOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreenOpen]);

  useEffect(() => {
    const first = noteTypes[0]?.code ?? '';
    if (first && !formTypeCode) setFormTypeCode(first);
  }, [noteTypes, formTypeCode]);

  useEffect(() => {
    if (!notesModalClientId) return;
    setNotesLoading(true);
    setNotesError('');
    apiJson<{ notes: OperationalNoteRow[] }>(moduleClientOperationsOperationalNotes(notesModalClientId))
      .then((d) => setOperationalNotes(Array.isArray(d?.notes) ? d.notes : []))
      .catch((e) => setNotesError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setNotesLoading(false));
  }, [notesModalClientId]);

  const reloadRegistry = useCallback(() => {
    onReloadRegistry?.();
  }, [onReloadRegistry]);

  const closeQuickProfile = useCallback(() => {
    setQuickProfile(null);
    setQuickProfileAnchor(null);
    setQuickProfileClientId(null);
    setQuickProfileLoading(false);
  }, []);

  const openQuickProfile = (r: ClientOperationsRegistryRow, anchorEl: HTMLElement) => {
    const requestedClientId = r.client_id;
    setQuickProfileAnchor(anchorEl);
    setQuickProfileClientId(requestedClientId);
    setQuickProfile(null);
    setQuickProfileLoading(true);
    apiJson<ClientOperationsClientQuickProfileAggregate>(
      moduleClientOperationsClientQuickProfile(requestedClientId)
    )
      .then((res) => {
        setQuickProfileClientId((currentClientId) => {
          if (currentClientId === requestedClientId && res.client_id === requestedClientId) {
            setQuickProfile(res);
            setQuickProfileLoading(false);
          }
          return currentClientId;
        });
      })
      .catch(() => {
        setQuickProfile(null);
        setQuickProfileAnchor(null);
        setQuickProfileClientId(null);
        setQuickProfileLoading(false);
      });
  };

  const openClientModal = (r: ClientOperationsRegistryRow & { email?: string | null; phone?: string | null }) => {
    closeQuickProfile();
    setModalOpen(true);
    setModalLoading(true);
    setModalError('');
    setModalData(buildPlaceholderClientCaseFromRegistryRow(r));
    apiJson<ClientOperationsCaseResponse>(moduleClientOperationsCase(r.client_id))
      .then((res) => setModalData(res))
      .catch((e) => setModalError(userFacingApiMessage(e)))
      .finally(() => setModalLoading(false));
  };

  useEffect(() => {
    const clientId = String(pendingOpenClientId ?? '').trim();
    if (!clientId) return;
    const row = rows.find((r) => r.client_id === clientId);
    openClientModal(
      row ?? {
        client_id: clientId,
        client_name: pendingOpenClientSnapshot?.client_name ?? null,
        tax_id: pendingOpenClientSnapshot?.tax_id ?? null,
        email: pendingOpenClientSnapshot?.email ?? null,
        phone: pendingOpenClientSnapshot?.phone ?? null,
        business_type: null,
        payroll_flag: null,
        material_brought_flag: null,
        vat_status: null,
        income_tax_advance_status: null,
        national_insurance_status: null,
        national_insurance_deductions_status: null,
        income_tax_deductions_status: null,
        assigned_handler_user_id: null,
        vat_due_registry_display_he: null,
        notes_cell_text_he: null,
        operational_notes_count: 0,
      },
    );
    onPendingOpenConsumed?.();
    // Open once per pending id. rows listed only to prefer a registry placeholder.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume navigation state once
  }, [pendingOpenClientId]);

  const resetCreateClientForm = () => {
    setCreateError('');
    setCreateInvalidField(null);
    setCreateTaxId('');
    setCreateName('');
    setCreateType('business_customer');
    setCreatePhone('');
    setCreateEmail('');
    setCreateWebsite('');
    setCreateCountry('');
    setCreateCity('');
    setCreateStreet('');
    setCreatePostalCode('');
  };

  const focusCreateField = (field: CreateClientField | null) => {
    const target = firstInvalidCreateClientFocusField(field);
    const node =
      target === 'tax_id' ? createTaxIdRef.current
      : target === 'display_name' ? createNameRef.current
      : target === 'client_type' ? createTypeRef.current
      : target === 'phone' ? createPhoneRef.current
      : null;
    node?.focus();
  };

  const submitCreateCoreClient = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!orgId || !canCreateCoreClient) return;
    if (!beginExclusiveSubmit(createInFlightRef)) return;
    setCreateSubmitting(true);
    setCreateError('');
    setCreateInvalidField(null);
    const draft = {
      tax_id: createTaxId,
      display_name: createName,
      client_type: createType,
      phone: createPhone,
      email: createEmail,
      website: createWebsite,
      country_code: createCountry,
      city: createCity,
      street: createStreet,
      postal_code: createPostalCode,
    };
    const validation = validateCreateClientDraft(draft);
    if (!validation.ok) {
      setCreateInvalidField(validation.field);
      setCreateError(t(validation.messageKey));
      focusCreateField(validation.field);
      endExclusiveSubmit(createInFlightRef);
      setCreateSubmitting(false);
      return;
    }
    try {
      const created = await apiJson<{ id: string }>(orgClients(orgId), {
        method: 'POST',
        body: JSON.stringify(buildCreateClientCommandPayload(draft)),
      });
      const clientId = canonicalCreatedClientId(created);
      if (!clientId) {
        setCreateError(t('clients.errors.retryable'));
        return;
      }
      const savedPhone = createPhone.trim() || null;
      const savedEmail = createEmail.trim() || null;
      const savedName = createName.trim();
      const savedTaxId = createTaxId.trim();
      setShowCreateClient(false);
      resetCreateClientForm();
      onReloadRegistry?.({ bypassCache: true });
      closeQuickProfile();
      setModalOpen(true);
      setModalLoading(true);
      setModalError('');
      setModalData(
        buildPlaceholderClientCaseFromRegistryRow({
          client_id: clientId,
          client_name: savedName,
          tax_id: savedTaxId,
          email: savedEmail,
          phone: savedPhone,
          business_type: null,
          payroll_flag: null,
          material_brought_flag: null,
          vat_status: null,
          income_tax_advance_status: null,
          national_insurance_status: null,
          national_insurance_deductions_status: null,
          income_tax_deductions_status: null,
          assigned_handler_user_id: null,
          vat_due_registry_display_he: null,
        }),
      );
      apiJson<ClientOperationsCaseResponse>(moduleClientOperationsCase(clientId))
        .then((res) => setModalData(res))
        .catch((err) => setModalError(userFacingApiMessage(err)))
        .finally(() => setModalLoading(false));
    } catch (err) {
      const mapped = mapCreateClientCommandError(err);
      setCreateInvalidField(mapped.field);
      setCreateError(t(mapped.messageKey));
      focusCreateField(mapped.field);
    } finally {
      endExclusiveSubmit(createInFlightRef);
      setCreateSubmitting(false);
    }
  };

  const openNotesModal = (r: ClientOperationsRegistryRow) => {
    setNotesModalClientId(r.client_id);
    setNotesModalClientName(r.client_name ?? '');
    setEditingNoteId(null);
    setFormBody('');
    setFormReminderLocal('');
    setConflict(null);
    const first = noteTypes[0]?.code ?? '';
    setFormTypeCode(first);
  };

  const closeNotesModal = () => {
    setNotesModalClientId(null);
    setConflict(null);
  };

  const startEditNote = (n: OperationalNoteRow) => {
    setEditingNoteId(n.id);
    setFormTypeCode(n.type_code);
    setFormBody(n.body);
    setFormReminderLocal(isoToDatetimeLocal(n.reminder_at));
    setConflict(null);
  };

  const selectedType = noteTypes.find((t) => t.code === formTypeCode);
  const allowsReminder = selectedType?.allows_reminder ?? false;

  const runSave = async (ignoreConflict: boolean) => {
    if (!notesModalClientId || !canEdit) return;
    const bodyText = formBody.trim();
    if (!bodyText) return;
    setFormSaving(true);
    setNotesError('');
    try {
      const reminderIso = allowsReminder ? datetimeLocalToIso(formReminderLocal) : null;
      const payload: Record<string, unknown> = {
        type_code: formTypeCode,
        body: bodyText,
        reminder_at: reminderIso,
        ignore_reminder_conflict: ignoreConflict,
        query: query ?? {},
      };
      const url =
        editingNoteId
          ? moduleClientOperationsOperationalNote(notesModalClientId, editingNoteId)
          : moduleClientOperationsCreateNote(notesModalClientId);
      const res = await apiFetch(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => ({}));
      if (res.status === 409 && (raw as ConflictPayload).code === 'REMINDER_CONFLICT') {
        setConflict(raw as ConflictPayload);
        setFormSaving(false);
        return;
      }
      if (!res.ok) {
        setNotesError((raw as { message?: string }).message ?? res.statusText);
        setFormSaving(false);
        return;
      }
      setConflict(null);
      setEditingNoteId(null);
      setFormBody('');
      setFormReminderLocal('');
      setFormTypeCode(noteTypes[0]?.code ?? formTypeCode);
      const mutation = raw as {
        notes?: OperationalNoteRow[];
        registry?: Parameters<NonNullable<ClientOperationsRegistryViewProps['onApplyAggregate']>>[0];
      };
      if (Array.isArray(mutation.notes)) {
        setOperationalNotes(mutation.notes);
      }
      if (mutation.registry) {
        if (onApplyAggregate) onApplyAggregate(mutation.registry);
        else if (Array.isArray(mutation.registry.rows)) setRows(mutation.registry.rows);
      }
      closeNotesModal();
    } catch (e) {
      setNotesError(e instanceof Error ? e.message : 'Error');
    } finally {
      setFormSaving(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!notesModalClientId || !canEdit) return;
    if (!window.confirm(t('clientOperations.deleteNoteConfirm'))) return;
    setNotesError('');
    const res = await apiFetch(moduleClientOperationsDeleteNote(notesModalClientId, noteId), {
      method: 'POST',
      body: JSON.stringify({ query: query ?? {} }),
    });
    if (!res.ok) {
      const raw = await res.json().catch(() => ({}));
      setNotesError((raw as { message?: string }).message ?? 'Delete failed');
      return;
    }
    if (editingNoteId === noteId) {
      setEditingNoteId(null);
      setFormBody('');
      setFormReminderLocal('');
    }
    const mutation = (await res.json().catch(() => ({}))) as {
      notes?: OperationalNoteRow[];
      registry?: Parameters<NonNullable<ClientOperationsRegistryViewProps['onApplyAggregate']>>[0];
    };
    if (Array.isArray(mutation.notes)) {
      setOperationalNotes(mutation.notes);
    }
    if (mutation.registry) {
      if (onApplyAggregate) onApplyAggregate(mutation.registry);
      else if (Array.isArray(mutation.registry.rows)) setRows(mutation.registry.rows);
    }
  };

  const capById = useMemo(() => {
    const m = new Map<string, ClientOperationsToolbarCapability>();
    for (const c of toolbarCapabilities) m.set(c.id, c);
    return m;
  }, [toolbarCapabilities]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.visible !== false && !hiddenColumns.has(c.key)),
    [columns, hiddenColumns],
  );

  // Presentation only: empty grid cells below the real/manual rows so the sheet stays one continuous
  // cell grid (vertical + horizontal borders) in every workspace, however few rows the viewer has.
  const [sheetCanvasHeight, setSheetCanvasHeight] = useState(0);
  const sheetCanvasObserverRef = useRef<ResizeObserver | null>(null);
  const sheetCanvasRef = useCallback((el: HTMLDivElement | null) => {
    sheetCanvasObserverRef.current?.disconnect();
    sheetCanvasObserverRef.current = null;
    if (!el) return;
    setSheetCanvasHeight(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSheetCanvasHeight(el.clientHeight));
    observer.observe(el);
    sheetCanvasObserverRef.current = observer;
  }, []);
  const sheetFillerRowCount = Math.min(
    80,
    Math.max(0, Math.ceil(sheetCanvasHeight / SHEET_GRID_ROW_PITCH_PX) - 1 - rows.length - manualRows.length),
  );

  const persistCellPresentation = (next: Record<string, CellPresentation>) => {
    if (widthScope?.userId && widthScope.organizationId) {
      saveClientOperationsCellPresentation(widthScope.userId, widthScope.organizationId, next);
    }
  };

  const persistHiddenColumns = (next: Set<string>) => {
    if (widthScope?.userId && widthScope.organizationId) {
      saveClientOperationsHiddenColumns(widthScope.userId, widthScope.organizationId, next);
    }
  };

  const selectActiveFormatCell = (
    clientId: string,
    column: Pick<ClientOperationsRegistryColumn, 'key' | 'cell_kind'>,
    options?: { rowKey?: string },
  ) => {
    if (
      !isClientOperationsFormatEligibleColumn({
        columnKey: column.key,
        cellKind: column.cell_kind,
      })
    ) {
      return;
    }
    setSelectedRowId(options?.rowKey ?? clientId);
    if (options?.rowKey) {
      setFocusedCell({ rowKey: options.rowKey, colKey: column.key });
      return;
    }
    setFocusedCell({ clientId, colKey: column.key });
  };

  /** Keep active cell while clicking formatting toolbar (avoid input blur races). */
  const preserveActiveCellOnToolbarMouseDown = (event: ReactMouseEvent) => {
    event.preventDefault();
  };

  const applyPresentation = (patch: Partial<CellPresentation>) => {
    if (!focusedCell) return;
    const k = clientOperationsPresentationCellKey(focusedCell);
    if (!skipUndoPushRef.current) {
      setCoUndoStack((history) =>
        pushClientOperationsUndoEntry(history, { kind: 'presentation', previous: cellPresentation }),
      );
    }
    setRedoStack([]);
    setCellPresentation((prev) => {
      const next = {
        ...prev,
        [k]: { ...prev[k], ...patch },
      };
      persistCellPresentation(next);
      return next;
    });
  };

  /**
   * Cell-specific formatting: apply to active cell when present.
   * With no active cell: update toolbar tool defaults only — no cell mutation, no domain mutation.
   */
  const commitPresentationOrToolDefault = (patch: Partial<CellPresentation>) => {
    setPresentationToolDefaults((prev) => ({
      ...prev,
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}),
      ...(patch.bold !== undefined ? { bold: patch.bold } : {}),
      ...(patch.italic !== undefined ? { italic: patch.italic } : {}),
      ...(patch.underline !== undefined ? { underline: patch.underline } : {}),
      ...(patch.align !== undefined ? { align: patch.align } : {}),
      ...(patch.wrap !== undefined ? { wrap: patch.wrap } : {}),
      ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
      ...(patch.numberFormat !== undefined ? { numberFormat: patch.numberFormat } : {}),
    }));
    if (!focusedCell) return;
    applyPresentation(patch);
  };

  const isCap = (id: string) => capById.get(id)?.available === true;
  const capTitle = (id: string) => {
    const c = capById.get(id);
    if (!c) return undefined;
    const label = localizeSystemLabel(t, c.label_key, c.label_he);
    if (c.available) return label;
    const reason = localizeSystemLabel(t, c.reason_key, c.reason_he ?? t('clientOperations.unavailable'));
    return `${label}: ${reason}`;
  };
  const widthForColumn = (col: ClientOperationsRegistryColumn) =>
    columnWidths[col.key] ?? col.default_width_px ?? (col.cell_kind === 'folder' ? 44 : col.cell_kind === 'custom' ? 140 : 110);
  const saveColumnWidth = (key: string, width: number) => {
    const next = { ...columnWidths, [key]: width };
    setColumnWidths(next);
    if (widthScope?.userId && widthScope.organizationId) {
      saveClientOperationsColumnWidths(widthScope.userId, widthScope.organizationId, next);
    }
  };
  const toggleHiddenColumn = (columnKey: string) => {
    const next = toggleClientOperationsHiddenColumn(hiddenColumns, columnKey);
    setCoUndoStack((history) =>
      pushClientOperationsUndoEntry(history, {
        kind: 'column_visibility',
        previousHiddenKeys: [...hiddenColumns],
      }),
    );
    setHiddenColumns(next);
    persistHiddenColumns(next);
  };

  const beginResize = (event: ReactMouseEvent, column: ClientOperationsRegistryColumn) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthForColumn(column);
    const direction = (document.dir as 'rtl' | 'ltr') === 'rtl' ? 'rtl' : 'ltr';
    setIsResizingColumn(true);
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    const onMove = (moveEvent: MouseEvent) => {
      const delta = computeClientOperationsColumnResizeDelta({
        startClientX: startX,
        currentClientX: moveEvent.clientX,
        handleEdge: CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE,
        direction,
      });
      setColumnWidths((previous) => ({
        ...previous,
        [column.key]: clampClientOperationsColumnWidth(startWidth + delta),
      }));
    };
    const onUp = (upEvent: MouseEvent) => {
      const delta = computeClientOperationsColumnResizeDelta({
        startClientX: startX,
        currentClientX: upEvent.clientX,
        handleEdge: CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE,
        direction,
      });
      const finalWidth = clampClientOperationsColumnWidth(startWidth + delta);
      saveColumnWidth(column.key, finalWidth);
      if (finalWidth !== startWidth) {
        setCoUndoStack((history) =>
          pushClientOperationsUndoEntry(history, {
            kind: 'column_width',
            columnKey: column.key,
            previousWidth: startWidth,
            nextWidth: finalWidth,
          }),
        );
      }
      setIsResizingColumn(false);
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const undoPresentationOnly = (previous: Record<string, CellPresentation>) => {
    setRedoStack((history) => [...history, { presentation: cellPresentation }]);
    setCellPresentation(previous);
    persistCellPresentation(previous);
  };
  const redoPresentation = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setCoUndoStack((history) =>
      pushClientOperationsUndoEntry(history, { kind: 'presentation', previous: cellPresentation }),
    );
    setCellPresentation(next.presentation);
    persistCellPresentation(next.presentation);
    setRedoStack((history) => history.slice(0, -1));
  };
  const formatPresentationValue = (value: string, column: ClientOperationsRegistryColumn, presentation?: CellPresentation) => {
    if (column.cell_kind !== 'custom' || !presentation?.numberFormat || presentation.numberFormat === 'general') return value;
    const number = Number(value.replace(/[^\d.-]/g, ''));
    if (presentation.numberFormat === 'date') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('he-IL').format(date);
    }
    if (!Number.isFinite(number)) return value;
    if (presentation.numberFormat === 'currency') return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(number);
    if (presentation.numberFormat === 'percent') return new Intl.NumberFormat('he-IL', { style: 'percent' }).format(number);
    return new Intl.NumberFormat('he-IL').format(number);
  };
  const customCellSlotsRef = useRef<Map<string, CustomCellSaveSlot>>(new Map());
  const customCellDebounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const customCellMetaRef = useRef<
    Map<
      string,
      | {
          kind: 'custom';
          clientId: string;
          column: ClientOperationsRegistryColumn;
          identity: CustomCellSaveIdentity;
        }
      | {
          kind: 'manual';
          rowKey: string;
          manualRowSlot: number;
          column: ClientOperationsRegistryColumn;
          identity: CustomCellSaveIdentity;
        }
    >
  >(new Map());
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const manualRowsRef = useRef(manualRows);
  manualRowsRef.current = manualRows;
  const viewedPeriodKeyRef = useRef<string | null>(null);
  viewedPeriodKeyRef.current = query?.operational_period_key ?? period?.selected_period_key ?? null;

  const applyAggregateReconciled = useCallback(
    (data: unknown) => {
      if (!onApplyAggregate) return;
      const aggregate = data as {
        rows?: ClientOperationsRegistryRow[];
        period?: { selected_period_key?: string };
        query?: { operational_period_key?: string };
      };
      const responsePeriod =
        aggregate?.period?.selected_period_key ??
        aggregate?.query?.operational_period_key ??
        viewedPeriodKeyRef.current ??
        '';
      const incomingRows = Array.isArray(aggregate?.rows) ? aggregate.rows : [];
      const reconciled = reconcileManualStatusRows({
        rows: incomingRows,
        overlays: statusOverlaysRef.current,
        slots: statusPaintSlotsRef.current,
        viewedPeriodKey: String(responsePeriod ?? ''),
      });
      if (reconciled === incomingRows) {
        onApplyAggregate(data);
        return;
      }
      onApplyAggregate({ ...(aggregate as object), rows: reconciled });
    },
    [onApplyAggregate],
  );

  useLayoutEffect(() => {
    const periodKey = viewedPeriodKeyRef.current ?? '';
    const reconciled = reconcileManualStatusRows({
      rows,
      overlays: statusOverlaysRef.current,
      slots: statusPaintSlotsRef.current,
      viewedPeriodKey: periodKey,
    });
    if (reconciled !== rows) onRowsChange(reconciled);
  }, [rows, onRowsChange]);
  const editingCellKeyRef = useRef(editingCellKey);
  editingCellKeyRef.current = editingCellKey;
  const customCellFlightWaitersRef = useRef<Map<string, Array<() => void>>>(new Map());

  const notifyCustomCellFlightSettled = (key: string) => {
    if (isCustomCellInFlight(customCellSlotsRef.current, key)) return;
    const waiters = customCellFlightWaitersRef.current.get(key);
    if (!waiters?.length) return;
    customCellFlightWaitersRef.current.delete(key);
    for (const resolve of waiters) resolve();
  };

  const waitForCustomCellFlight = (key: string): Promise<void> => {
    if (!isCustomCellInFlight(customCellSlotsRef.current, key)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = customCellFlightWaitersRef.current.get(key) ?? [];
      list.push(resolve);
      customCellFlightWaitersRef.current.set(key, list);
    });
  };

  const makeCustomCellIdentity = (
    clientId: string,
    column: ClientOperationsRegistryColumn,
    operationalPeriodKey: string,
  ): CustomCellSaveIdentity | null => {
    const organizationId = widthScope?.organizationId?.trim() ?? '';
    const columnId = column.custom_column_id?.trim() ?? '';
    if (!organizationId || !clientId || !columnId || !operationalPeriodKey) return null;
    return { organizationId, clientId, columnId, operationalPeriodKey };
  };

  /** Slot identity for manual free-text cells — uses row_key (never a fabricated client UUID). */
  const makeManualRowCellIdentity = (
    rowKey: string,
    columnKey: string,
    operationalPeriodKey: string,
  ): CustomCellSaveIdentity | null => {
    const organizationId = widthScope?.organizationId?.trim() ?? '';
    if (!organizationId || !rowKey || !columnKey || !operationalPeriodKey) return null;
    return { organizationId, clientId: rowKey, columnId: columnKey, operationalPeriodKey };
  };

  const serverValueForMeta = (meta: {
    kind?: 'custom' | 'manual';
    clientId?: string;
    rowKey?: string;
    column: ClientOperationsRegistryColumn;
  }): string => {
    if (meta.kind === 'manual' && meta.rowKey) {
      const row = manualRowsRef.current.find((r) => r.row_key === meta.rowKey);
      return formatCustomExcelCellDisplay(row?.cells?.[meta.column.key]);
    }
    const clientId = meta.clientId;
    if (!clientId) return '';
    const row = rowsRef.current.find((r) => r.client_id === clientId);
    if (!row) return '';
    return displayForColumn(row, meta.column, t);
  };

  const clearCustomCellDebounce = (key: string) => {
    const timer = customCellDebounceTimersRef.current.get(key);
    if (timer) {
      clearTimeout(timer);
      customCellDebounceTimersRef.current.delete(key);
    }
  };

  const preserveEditorDraftIfNeeded = (
    key: string,
    meta: {
      kind?: 'custom' | 'manual';
      clientId?: string;
      rowKey?: string;
      column: ClientOperationsRegistryColumn;
    },
  ) => {
    const identity = meta.kind === 'manual' && meta.rowKey ? meta.rowKey : meta.clientId ?? '';
    const pk = cellKey(identity, meta.column.key);
    if (editingCellKeyRef.current !== pk) return;
    const slot = getCustomCellSlot(customCellSlotsRef.current, key);
    if (slot.latestDraft != null) setCellDraft(slot.latestDraft);
  };

  const executeCustomCellSave = async (start: CustomCellSaveStart): Promise<void> => {
    if (!onRegistryCommand) return;
    const meta = customCellMetaRef.current.get(start.key);
    if (!meta) {
      completeCustomCellSaveFailure(customCellSlotsRef.current, start.key);
      return;
    }
    setCommandError('');
    try {
      const previousValue = serverValueForMeta(meta);
      const data =
        meta.kind === 'manual'
          ? ((await onRegistryCommand(
              {
                command: 'set_client_operations_manual_row_cell_value',
                manual_row_slot: meta.manualRowSlot,
                column_key: meta.column.key,
                value: start.value,
                operational_period_key: start.identity.operationalPeriodKey,
              },
              { applyAggregate: false },
            )) as {
              rows?: ClientOperationsRegistryRow[];
              manual_rows?: ClientOperationsManualRegistryRow[];
              period?: { selected_period_key?: string | null };
              query?: { operational_period_key?: string | null };
            })
          : ((await onRegistryCommand(
              {
                command: 'set_client_operations_custom_column_value',
                client_id: start.identity.clientId,
                column_id: start.identity.columnId,
                value: start.value,
                // Period is bound to the dirty cell identity — never the live navigator alone.
                operational_period_key: start.identity.operationalPeriodKey,
              },
              { applyAggregate: false },
            )) as {
              rows?: ClientOperationsRegistryRow[];
              manual_rows?: ClientOperationsManualRegistryRow[];
              period?: { selected_period_key?: string | null };
              query?: { operational_period_key?: string | null };
            });

      if (
        meta.kind !== 'manual' &&
        !skipUndoPushRef.current &&
        previousValue !== start.value &&
        start.identity.organizationId &&
        start.identity.operationalPeriodKey
      ) {
        setCoUndoStack((history) =>
          pushClientOperationsUndoEntry(history, {
            kind: 'custom_cell',
            organizationId: start.identity.organizationId,
            periodKey: start.identity.operationalPeriodKey,
            clientId: start.identity.clientId,
            columnId: start.identity.columnId,
            columnKey: meta.column.key,
            previousValue,
            newValue: start.value,
          }),
        );
      }

      const responsePeriodKey =
        data?.period?.selected_period_key ?? data?.query?.operational_period_key ?? start.identity.operationalPeriodKey;
      const viewedPeriodKey = viewedPeriodKeyRef.current;
      const serverValueAfter =
        meta.kind === 'manual'
          ? (() => {
              const aggregateManualRow = Array.isArray(data?.manual_rows)
                ? data.manual_rows.find((r) => r.row_key === meta.rowKey)
                : undefined;
              return aggregateManualRow
                ? formatCustomExcelCellDisplay(aggregateManualRow.cells?.[meta.column.key])
                : start.value;
            })()
          : (() => {
              const aggregateRow = Array.isArray(data?.rows)
                ? data.rows.find((r) => r.client_id === start.identity.clientId)
                : undefined;
              return aggregateRow ? displayForColumn(aggregateRow, meta.column, t) : start.value;
            })();

      const { startNext, applyAggregateRecommended } = completeCustomCellSaveSuccess(
        customCellSlotsRef.current,
        start.key,
        start.value,
        serverValueAfter,
      );

      if (meta.kind === 'manual') {
        const writePeriod = start.identity.operationalPeriodKey;
        if (
          shouldWriteManualDraftOverlay({
            writePeriodKey: writePeriod,
            viewedPeriodKey,
          })
        ) {
          const pk = manualDraftOverlayKey(writePeriod, meta.rowKey, meta.column.key);
          const slotAfter = getCustomCellSlot(customCellSlotsRef.current, start.key);
          setManualDraftOverlay((prev) => {
            if (slotAfter.latestDraft == null) {
              if (!(pk in prev)) return prev;
              const next = { ...prev };
              delete next[pk];
              return next;
            }
            if (prev[pk] === slotAfter.latestDraft) return prev;
            return { ...prev, [pk]: slotAfter.latestDraft };
          });
        }
      }

      if (shouldCacheCellSaveAggregate({ applyAggregateRecommended, responsePeriodKey })) {
        if (
          shouldApplyCellSaveAggregate({
            responsePeriodKey,
            viewedPeriodKey,
          })
        ) {
          if (meta.kind === 'manual' && Array.isArray(data?.manual_rows)) {
            const orgId = widthScope?.organizationId?.trim() ?? '';
            const reconciledManual = reconcileManualRowsWithDirtyDrafts({
              manualRows: data.manual_rows,
              slots: customCellSlotsRef.current,
              organizationId: orgId,
              viewedPeriodKey: String(viewedPeriodKey ?? ''),
            });
            applyAggregateReconciled({ ...(data as object), manual_rows: reconciledManual });
          } else {
            applyAggregateReconciled(data);
          }
          preserveEditorDraftIfNeeded(start.key, meta);
        } else if (onApplyAggregate) {
          // Off-period completion: cache under response period only — never paint into viewed month.
          onApplyAggregate(data);
        }
      }

      if (startNext) {
        await executeCustomCellSave(startNext);
      } else {
        notifyCustomCellFlightSettled(start.key);
      }
    } catch (error) {
      completeCustomCellSaveFailure(customCellSlotsRef.current, start.key);
      preserveEditorDraftIfNeeded(start.key, meta);
      notifyCustomCellFlightSettled(start.key);
      setCommandError(error instanceof Error ? error.message : t('clientOperations.saveValueFailed'));
    }
  };

  const kickCustomCellSave = async (key: string): Promise<void> => {
    const meta = customCellMetaRef.current.get(key);
    if (!meta) return;
    const start = tryStartCustomCellSave(
      customCellSlotsRef.current,
      meta.identity,
      serverValueForMeta(meta),
    );
    if (!start) return;
    await executeCustomCellSave(start);
  };

  const flushCustomCellKey = async (
    key: string,
    options?: { clearEditingKey?: string | null },
  ): Promise<void> => {
    clearCustomCellDebounce(key);
    const meta = customCellMetaRef.current.get(key);
    if (!meta) return;

    for (let guard = 0; guard < 20; guard += 1) {
      if (isCustomCellInFlight(customCellSlotsRef.current, key)) {
        await waitForCustomCellFlight(key);
        continue;
      }
      const start = tryStartCustomCellSave(
        customCellSlotsRef.current,
        meta.identity,
        serverValueForMeta(meta),
      );
      if (!start) break;
      await executeCustomCellSave(start);
    }

    // Only clear editor if still on the flushed cell (switching cells must not wipe the new editor).
    if (options?.clearEditingKey != null) {
      const slot = getCustomCellSlot(customCellSlotsRef.current, key);
      if (!slot.inFlight && (slot.latestDraft == null || slot.latestDraft === serverValueForMeta(meta))) {
        setEditingCellKey((current) => (current === options.clearEditingKey ? null : current));
      }
    }
  };

  const scheduleCustomCellAutosave = (
    row: ClientOperationsRegistryRow,
    column: ClientOperationsRegistryColumn,
    value: string,
  ) => {
    if (!canEdit || !column.editable || !column.custom_column_id || !onRegistryCommand) return;
    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';
    const identity = makeCustomCellIdentity(row.client_id, column, periodKey);
    if (!identity) return;
    const key = rememberCustomCellDraft(customCellSlotsRef.current, identity, value);
    customCellMetaRef.current.set(key, { kind: 'custom', clientId: row.client_id, column, identity });
    clearCustomCellDebounce(key);
    customCellDebounceTimersRef.current.set(
      key,
      setTimeout(() => {
        customCellDebounceTimersRef.current.delete(key);
        void kickCustomCellSave(key);
      }, 500),
    );
  };

  const commitCustomCellEdit = (
    row: ClientOperationsRegistryRow,
    column: ClientOperationsRegistryColumn,
    value: string,
  ) => {
    if (!canEdit || !column.editable || !column.custom_column_id || !onRegistryCommand) return;
    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';
    const identity = makeCustomCellIdentity(row.client_id, column, periodKey);
    if (!identity) return;
    const key = rememberCustomCellDraft(customCellSlotsRef.current, identity, value);
    customCellMetaRef.current.set(key, { kind: 'custom', clientId: row.client_id, column, identity });
    const pk = cellKey(row.client_id, column.key);
    // Excel UX: leave the cell immediately; persistence continues via single-flight queue.
    setEditingCellKey((current) => (current === pk ? null : current));
    void flushCustomCellKey(key);
  };

  const beginCustomCellEdit = (
    row: ClientOperationsRegistryRow,
    column: ClientOperationsRegistryColumn,
  ) => {
    if (!canEdit || !column.editable || !column.custom_column_id) return;
    if (statusPaintMode) return;
    const pk = cellKey(row.client_id, column.key);
    selectActiveFormatCell(row.client_id, column);
    if (editingCellKeyRef.current === pk) return;
    setEditingCellKey(pk);
    setCellDraft(displayCustomColumnValue(row, column));
  };

  const scheduleManualRowCellAutosave = (
    row: ClientOperationsManualRegistryRow,
    column: ClientOperationsRegistryColumn,
    value: string,
  ) => {
    const cellPres = row.cell_presentation?.[column.key];
    if (!canEdit || cellPres?.cell_kind !== 'manual_text' || !cellPres.editable || !onRegistryCommand) return;
    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';
    const identity = makeManualRowCellIdentity(row.row_key, column.key, periodKey);
    if (!identity) return;
    const key = rememberCustomCellDraft(customCellSlotsRef.current, identity, value);
    customCellMetaRef.current.set(key, {
      kind: 'manual',
      rowKey: row.row_key,
      manualRowSlot: row.manual_row_slot,
      column,
      identity,
    });
    const pk = manualDraftOverlayKey(periodKey, row.row_key, column.key);
    if (
      shouldWriteManualDraftOverlay({
        writePeriodKey: periodKey,
        viewedPeriodKey: periodKey,
      })
    ) {
      setManualDraftOverlay((prev) => (prev[pk] === value ? prev : { ...prev, [pk]: value }));
    }
    // Manual rows: no debounce — first keystroke starts save immediately (single-flight + coalesce).
    clearCustomCellDebounce(key);
    void kickCustomCellSave(key);
  };

  const commitManualRowCellEdit = (
    row: ClientOperationsManualRegistryRow,
    column: ClientOperationsRegistryColumn,
    value: string,
  ) => {
    const cellPres = row.cell_presentation?.[column.key];
    if (!canEdit || cellPres?.cell_kind !== 'manual_text' || !cellPres.editable || !onRegistryCommand) return;
    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';
    const identity = makeManualRowCellIdentity(row.row_key, column.key, periodKey);
    if (!identity) return;
    const key = rememberCustomCellDraft(customCellSlotsRef.current, identity, value);
    customCellMetaRef.current.set(key, {
      kind: 'manual',
      rowKey: row.row_key,
      manualRowSlot: row.manual_row_slot,
      column,
      identity,
    });
    const pk = cellKey(row.row_key, column.key);
    setEditingCellKey((current) => (current === pk ? null : current));
    void flushCustomCellKey(key);
  };

  const beginManualRowCellEdit = (
    row: ClientOperationsManualRegistryRow,
    column: ClientOperationsRegistryColumn,
  ) => {
    const cellPres = row.cell_presentation?.[column.key];
    if (!canEdit || cellPres?.cell_kind !== 'manual_text' || !cellPres.editable) return;
    if (statusPaintMode) return;
    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';
    const pk = cellKey(row.row_key, column.key);
    const overlayPk = manualDraftOverlayKey(periodKey, row.row_key, column.key);
    selectActiveFormatCell(row.row_key, column, { rowKey: row.row_key });
    if (editingCellKeyRef.current === pk) return;
    setEditingCellKey(pk);
    const overlay = manualDraftOverlay[overlayPk];
    setCellDraft(
      overlay != null ? overlay : formatCustomExcelCellDisplay(row.cells?.[column.key]),
    );
  };

  const cancelManualRowCellEdit = (
    row: ClientOperationsManualRegistryRow,
    column: ClientOperationsRegistryColumn,
  ) => {
    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';
    const identity = makeManualRowCellIdentity(row.row_key, column.key, periodKey);
    const overlayPk = manualDraftOverlayKey(periodKey, row.row_key, column.key);
    if (identity) {
      const key = customCellSaveKey(identity);
      clearCustomCellDebounce(key);
      customCellSlotsRef.current.delete(key);
      customCellMetaRef.current.delete(key);
    }
    setManualDraftOverlay((prev) => {
      if (!(overlayPk in prev)) return prev;
      const next = { ...prev };
      delete next[overlayPk];
      return next;
    });
    setEditingCellKey(null);
  };

  const flushDirtyBeforePeriodChange = (nextPeriodKey: string) => {
    // Kick dirty/in-flight saves for their bound periods; do NOT block tab switch.
    const keys = new Set<string>([
      ...customCellSlotsRef.current.keys(),
      ...customCellDebounceTimersRef.current.keys(),
      ...customCellMetaRef.current.keys(),
    ]);
    for (const key of keys) clearCustomCellDebounce(key);
    for (const key of keys) void flushCustomCellKey(key);
    setEditingCellKey(null);
    setCellDraft('');
    setManualDraftOverlay({});
    if (dropOptimisticCheckboxesForOtherPeriod(optimisticChecksRef.current, nextPeriodKey)) {
      setOptimisticChecks(new Map(optimisticChecksRef.current));
    }
    if (shouldClearActiveCellOnPeriodChange()) {
      setFocusedCell(null);
    }
    onPeriodChange?.(nextPeriodKey);
  };

  const paintCellManualStatus = (
    row: ClientOperationsRegistryRow,
    columnKey: string,
    options?: { skipUndoPush?: boolean },
  ): boolean => {
    if (!canEdit || !onRegistryCommand || !statusPaintMode) return false;
    if (columnKey === 'folder' || columnKey === 'client_name') return false;
    const cap = row.manual_cell_statuses?.[columnKey];
    if (!cap) return false;
    const nextStatus: ManualStatusPaintIntent =
      statusPaintMode === 'clear' ? null : statusPaintMode;
    if (statusPaintMode === 'clear' && !cap.allowed_statuses.includes('clear')) return false;
    if (statusPaintMode !== 'clear' && !cap.allowed_statuses.includes(statusPaintMode)) return false;

    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';
    const paintKey = manualStatusPaintKey(row.client_id, columnKey, periodKey);
    const previousCap = { ...cap };
    const previousStatus = (cap.status ?? null) as ManualStatusPaintIntent;
    rememberManualStatusPaintIntent(statusPaintSlotsRef.current, paintKey, nextStatus);
    statusOverlayGenRef.current += 1;
    setManualStatusOverlay(
      statusOverlaysRef.current,
      paintKey,
      nextStatus,
      statusOverlayGenRef.current,
    );
    onInvalidateStaleLoads?.();

    if (!options?.skipUndoPush && !skipUndoPushRef.current && previousStatus !== nextStatus) {
      const organizationId = widthScope?.organizationId?.trim() ?? '';
      if (organizationId && periodKey) {
        setCoUndoStack((history) =>
          pushClientOperationsUndoEntry(history, {
            kind: 'manual_status',
            organizationId,
            periodKey,
            clientId: row.client_id,
            columnKey,
            previousStatus,
            newStatus: nextStatus,
          }),
        );
      }
    }

    // Optimistic local paint from latest rows (presentation only) until aggregate returns.
    onRowsChange(
      rowsRef.current.map((r) => {
        if (r.client_id !== row.client_id) return r;
        const current = r.manual_cell_statuses ?? {};
        const existing = current[columnKey] ?? {
          status: null,
          presentation_token: null,
          allowed_statuses: cap.allowed_statuses,
          operational_square_count: cap.operational_square_count,
        };
        return {
          ...r,
          manual_cell_statuses: {
            ...current,
            [columnKey]: {
              ...existing,
              status: nextStatus,
              presentation_token: nextStatus,
              allowed_statuses:
                nextStatus == null
                  ? existing.allowed_statuses.filter((s) => s !== 'clear')
                  : Array.from(new Set([...existing.allowed_statuses, 'clear' as const])),
            },
          },
        };
      }),
    );

    const executePaint = async (start: ManualStatusPaintStart): Promise<void> => {
      try {
        const data = await onRegistryCommand(
          {
            command: 'set_client_operations_cell_manual_status',
            client_id: row.client_id,
            column_key: columnKey,
            operational_period_key: periodKey || null,
            status: start.status,
          },
          { applyAggregate: false },
        );
        const { startNext, applyAggregateRecommended } = completeManualStatusPaintSuccess(
          statusPaintSlotsRef.current,
          start.key,
          start.status,
        );
        if (applyAggregateRecommended) {
          const viewed = query?.operational_period_key ?? period?.selected_period_key ?? null;
          const responsePeriod =
            (data as { period?: { selected_period_key?: string }; query?: { operational_period_key?: string } })
              ?.period?.selected_period_key ??
            (data as { query?: { operational_period_key?: string } })?.query?.operational_period_key ??
            periodKey;
          if (String(responsePeriod ?? '') === String(viewed ?? '')) {
            onInvalidateStaleLoads?.();
            applyAggregateReconciled(data);
          }
        }
        if (startNext) await executePaint(startNext);
      } catch (error) {
        completeManualStatusPaintFailure(statusPaintSlotsRef.current, start.key);
        // Rollback optimistic paint for this cell.
        setManualStatusOverlay(
          statusOverlaysRef.current,
          paintKey,
          previousStatus,
          ++statusOverlayGenRef.current,
        );
        onRowsChange(
          rowsRef.current.map((r) => {
            if (r.client_id !== row.client_id) return r;
            const current = r.manual_cell_statuses ?? {};
            return {
              ...r,
              manual_cell_statuses: {
                ...current,
                [columnKey]: previousCap,
              },
            };
          }),
        );
        setCommandError(error instanceof Error ? error.message : t('clientOperations.updateStatusFailed'));
        onReloadRegistry?.();
      }
    };

    const start = tryStartManualStatusPaint(statusPaintSlotsRef.current, paintKey);
    if (start) void executePaint(start);
    return true;
  };

  const restoreManualStatusFromUndo = async (entry: Extract<CoUndoEntry, { kind: 'manual_status' }>) => {
    if (!onRegistryCommand) return;
    const paintKey = manualStatusPaintKey(entry.clientId, entry.columnKey, entry.periodKey);
    const restoreStatus = entry.previousStatus;
    rememberManualStatusPaintIntent(statusPaintSlotsRef.current, paintKey, restoreStatus);
    statusOverlayGenRef.current += 1;
    setManualStatusOverlay(
      statusOverlaysRef.current,
      paintKey,
      restoreStatus,
      statusOverlayGenRef.current,
    );
    onInvalidateStaleLoads?.();
    onRowsChange(
      rowsRef.current.map((r) => {
        if (r.client_id !== entry.clientId) return r;
        const current = r.manual_cell_statuses ?? {};
        const existing = current[entry.columnKey] ?? {
          status: null,
          presentation_token: null,
          allowed_statuses: ['ready', 'sent_for_approval', 'completed', 'clear'] as Array<
            'ready' | 'sent_for_approval' | 'completed' | 'clear'
          >,
          operational_square_count: 0,
        };
        return {
          ...r,
          manual_cell_statuses: {
            ...current,
            [entry.columnKey]: {
              ...existing,
              status: restoreStatus,
              presentation_token: restoreStatus,
              allowed_statuses:
                restoreStatus == null
                  ? existing.allowed_statuses.filter((s) => s !== 'clear')
                  : Array.from(new Set([...existing.allowed_statuses, 'clear' as const])),
            },
          },
        };
      }),
    );

    const executePaint = async (start: ManualStatusPaintStart): Promise<void> => {
      try {
        const data = await onRegistryCommand(
          {
            command: 'set_client_operations_cell_manual_status',
            client_id: entry.clientId,
            column_key: entry.columnKey,
            operational_period_key: entry.periodKey || null,
            status: start.status,
          },
          { applyAggregate: false },
        );
        const { startNext, applyAggregateRecommended } = completeManualStatusPaintSuccess(
          statusPaintSlotsRef.current,
          start.key,
          start.status,
        );
        if (applyAggregateRecommended) {
          const viewed = viewedPeriodKeyRef.current;
          const responsePeriod =
            (data as { period?: { selected_period_key?: string }; query?: { operational_period_key?: string } })
              ?.period?.selected_period_key ??
            (data as { query?: { operational_period_key?: string } })?.query?.operational_period_key ??
            entry.periodKey;
          if (String(responsePeriod ?? '') === String(viewed ?? '')) {
            onInvalidateStaleLoads?.();
            applyAggregateReconciled(data);
          }
        }
        if (startNext) await executePaint(startNext);
      } catch (error) {
        completeManualStatusPaintFailure(statusPaintSlotsRef.current, start.key);
        setCommandError(error instanceof Error ? error.message : t('clientOperations.clearStatusFailed'));
        onReloadRegistry?.();
      }
    };

    const start = tryStartManualStatusPaint(statusPaintSlotsRef.current, paintKey);
    if (start) await executePaint(start);
  };

  const restoreCustomCellFromUndo = async (entry: Extract<CoUndoEntry, { kind: 'custom_cell' }>) => {
    if (!onRegistryCommand) return;
    skipUndoPushRef.current = true;
    try {
      const data = await onRegistryCommand({
        command: 'set_client_operations_custom_column_value',
        client_id: entry.clientId,
        column_id: entry.columnId,
        value: entry.previousValue,
        operational_period_key: entry.periodKey,
      });
      const viewed = viewedPeriodKeyRef.current;
      if (String(entry.periodKey) === String(viewed ?? '')) {
        onInvalidateStaleLoads?.();
        applyAggregateReconciled(data);
      }
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : t('clientOperations.clearValueFailed'));
      onReloadRegistry?.();
    } finally {
      skipUndoPushRef.current = false;
    }
  };

  const undoLastAction = () => {
    const { entry, stack } = popClientOperationsUndoEntry(coUndoStack);
    if (!entry) return;
    setCoUndoStack(stack);
    if (entry.kind === 'presentation') {
      undoPresentationOnly(entry.previous as Record<string, CellPresentation>);
      return;
    }
    if (entry.kind === 'manual_status') {
      void restoreManualStatusFromUndo(entry);
      return;
    }
    if (entry.kind === 'custom_cell') {
      void restoreCustomCellFromUndo(entry);
      return;
    }
    if (entry.kind === 'column_visibility') {
      const restored = new Set(entry.previousHiddenKeys);
      setHiddenColumns(restored);
      persistHiddenColumns(restored);
      return;
    }
    if (entry.kind === 'column_width') {
      const restoredWidths = { ...columnWidths, [entry.columnKey]: entry.previousWidth };
      setColumnWidths(restoredWidths);
      if (widthScope?.userId && widthScope.organizationId) {
        saveClientOperationsColumnWidths(widthScope.userId, widthScope.organizationId, restoredWidths);
      }
    }
  };

  const handlePrint = () => {
    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? null;
    const printColumns: ClientOperationsPrintColumn[] = visibleColumns
      .filter((c) => c.cell_kind !== 'folder' && c.key !== 'folder')
      .map((c) => ({ key: c.key, label: c.label, cell_kind: c.cell_kind }));
    const printRows: ClientOperationsPrintRow[] = rows.map((r) => ({
      client_id: r.client_id,
      client_name: r.client_name,
      cells: r.cells as Record<string, string | null | undefined>,
      pcn_display: r.pcn_display,
      notes_cell_text_he: r.notes_cell_text_he,
      operational_notes_count: r.operational_notes_count,
      material_brought_flag: r.material_brought_flag,
      material_brought_cell: r.material_brought_cell,
      material_cells: r.material_cells
        ? {
            vat: r.material_cells.vat,
            income_tax_advance: r.material_cells.income_tax_advance,
            payroll: r.material_cells.payroll,
          }
        : undefined,
      national_insurance_deductions_cell: r.national_insurance_deductions_cell,
      income_tax_deductions_cell: r.income_tax_deductions_cell,
      annual_report_cell: r.annual_report_cell,
      capital_declaration_cell: r.capital_declaration_cell,
      manual_cell_statuses: r.manual_cell_statuses,
    }));
    const printableManualRows = selectPrintableManualRows(manualRows);
    const printManualRows: ClientOperationsPrintRow[] = printableManualRows.map((r) => ({
      client_id: r.row_key,
      client_name: r.cells?.client_name ?? null,
      cells: r.cells as Record<string, string | null | undefined>,
    }));
    const printableKeys = selectPrintableColumnKeys({
      columns: printColumns,
      rows: [...printRows, ...printManualRows],
    });
    const printableCols = visibleColumns.filter((c) => printableKeys.includes(c.key));
    const periodHeading =
      formatClientOperationsPeriodHeading(periodKey) || t('clientOperations.periodFallback');

    const tableHeaders = printableCols.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('');
    const clientTableRows = rows
      .map((r) => {
        const cells = printableCols
          .map((col) => {
            const statusToken = r.manual_cell_statuses?.[col.key]?.presentation_token ?? null;
            const statusClass = statusToken ? ` is-manual-status-${statusToken}` : '';
            const value = escapeHtml(displayForColumn(r, col, t));
            return `<td class="${statusClass}">${value}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    const manualTableRows = printableManualRows
      .map((r) => {
        const cells = printableCols
          .map((col) => {
            const cellPres = r.cell_presentation?.[col.key];
            const raw =
              cellPres?.cell_kind === 'folder'
                ? ''
                : formatCustomExcelCellDisplay(r.cells?.[col.key]);
            return `<td>${escapeHtml(raw)}</td>`;
          })
          .join('');
        return `<tr data-row-kind="manual">${cells}</tr>`;
      })
      .join('');
    const tableRows = `${clientTableRows}${manualTableRows}`;

    const printDir = lang === 'he' ? 'rtl' : 'ltr';
    const printWin = window.open('', '_blank', 'width=1200,height=850');
    if (!printWin) return;
    printWin.document.write(`<!DOCTYPE html>
<html dir="${printDir}" lang="${lang}">
<head>
<meta charset="UTF-8">
<title>${t('clientOperations.moduleTitle')} — ${periodHeading}</title>
<style>
  @page { size: landscape; margin: 1cm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; direction: ${printDir}; margin: 0; }
  h1 { font-size: 13px; font-weight: 700; margin: 0 0 6px; color: #123756; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: right; white-space: nowrap; font-size: 11px; vertical-align: middle; }
  th { background: #f4f6f8; font-weight: 700; color: #123756; }
  .is-manual-status-ready { background: #ffd43b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .is-manual-status-sent_for_approval { background: #3478e8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .is-manual-status-completed { background: #35d77a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print { @page { size: landscape; } }
</style>
</head>
<body>
<h1>${t('clientOperations.moduleTitle')} — ${periodHeading}</h1>
<table>
<thead><tr>${tableHeaders}</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</body>
</html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => {
      printWin.print();
      printWin.close();
    }, 400);
  };

  const cancelCustomCellEdit = (
    row: ClientOperationsRegistryRow,
    column: ClientOperationsRegistryColumn,
  ) => {
    const periodKey = query?.operational_period_key ?? period?.selected_period_key ?? '';
    const identity = makeCustomCellIdentity(row.client_id, column, periodKey);
    if (identity) {
      const key = customCellSaveKey(identity);
      clearCustomCellDebounce(key);
      customCellSlotsRef.current.delete(key);
      customCellMetaRef.current.delete(key);
    }
    setEditingCellKey(null);
  };

  const editCustomCell = async (row: ClientOperationsRegistryRow, column: ClientOperationsRegistryColumn) => {
    if (!canEdit || !column.editable || !column.custom_column_id || !onRegistryCommand) return;
    const current = displayForColumn(row, column, t);
    const value = window.prompt(column.label.trim() || t('clientOperations.value'), current);
    if (value === null) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'set_client_operations_custom_column_value',
        client_id: row.client_id,
        column_id: column.custom_column_id,
        value,
        operational_period_key: query?.operational_period_key ?? period?.selected_period_key ?? null,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : t('clientOperations.saveValueFailed'));
    }
  };

  const [columnSettingsTarget, setColumnSettingsTarget] = useState<ClientOperationsRegistryColumn | null>(null);
  const [settingsSelectedPeriods, setSettingsSelectedPeriods] = useState<string[]>([]);
  const [settingsAutoFuture, setSettingsAutoFuture] = useState(false);
  const [settingsLegacyBaseline, setSettingsLegacyBaseline] = useState<string>('');
  const [periodSetupSelection, setPeriodSetupSelection] = useState<string[]>([]);
  const [periodSetupSelectAll, setPeriodSetupSelectAll] = useState(false);

  useEffect(() => {
    if (!userColumnPeriodSetup?.needed || !userColumnPeriodSetup.eligible_columns.length) return;
    const pre = userColumnPeriodSetup.eligible_columns.filter((c) => c.preselected).map((c) => c.column_id);
    setPeriodSetupSelection(pre);
    setPeriodSetupSelectAll(pre.length === userColumnPeriodSetup.eligible_columns.length && pre.length > 0);
  }, [userColumnPeriodSetup]);

  const openColumnSettings = (column: ClientOperationsRegistryColumn) => {
    setColumnSettingsTarget(column);
    setSettingsSelectedPeriods([...(column.visible_period_keys ?? [])]);
    setSettingsAutoFuture(Boolean(column.auto_extend_to_future));
    setSettingsLegacyBaseline(column.legacy_baseline_period_key ?? period?.selected_period_key ?? '');
  };

  const saveColumnSettings = async () => {
    if (!columnSettingsTarget?.custom_column_id || !onRegistryCommand) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'set_client_operations_custom_column_period_settings',
        column_id: columnSettingsTarget.custom_column_id,
        operational_period_key: query?.operational_period_key ?? period?.selected_period_key ?? null,
        selected_periods: settingsSelectedPeriods,
        auto_extend_to_future: settingsAutoFuture,
        legacy_baseline_period_key: columnSettingsTarget.legacy_baseline_required
          ? settingsLegacyBaseline || null
          : null,
      });
      setColumnSettingsTarget(null);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : t('clientOperations.saveColumnSettingsFailed'));
    }
  };

  const confirmPeriodSetup = async () => {
    if (!userColumnPeriodSetup?.needed || !onRegistryCommand) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'initialize_client_operations_user_columns_for_period',
        operational_period_key: userColumnPeriodSetup.operational_period_key,
        column_ids: periodSetupSelection,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : t('clientOperations.initPeriodColumnsFailed'));
    }
  };

  const targetPeriodKeyForCopy =
    period?.selected_period_key ?? query?.operational_period_key ?? '';
  const sourcePeriodsForCopy = useMemo(
    () =>
      sourcePeriodsForUserPeriodDataCopy(userPeriodDataCopySourcePeriods, targetPeriodKeyForCopy),
    [userPeriodDataCopySourcePeriods, targetPeriodKeyForCopy],
  );

  const collectTargetConflictSignals = useCallback(() => {
    const customKeys = columns.filter((c) => c.cell_kind === 'custom').map((c) => c.key);
    const customCellTexts = rows.flatMap((row) =>
      customKeys.map((key) => String(row.cells?.[key] ?? '')),
    );
    const manualCellTexts = manualRows.flatMap((row) =>
      Object.entries(row.cells ?? {})
        .filter(([key]) => key !== 'folder')
        .map(([, value]) => String(value ?? '')),
    );
    return { customCellTexts, manualCellTexts };
  }, [columns, rows, manualRows]);

  const executePeriodDataCopy = useCallback(
    async (sourcePeriodKey: string, mode: UserPeriodDataCopyMode) => {
      if (!canEdit || !onRegistryCommand || !targetPeriodKeyForCopy) return;
      setPeriodCopyBusy(true);
      setCommandError('');
      setPeriodCopySourceOpen(false);
      setPeriodCopySelectedSource(null);
      try {
        await onRegistryCommand(
          buildCopyUserPeriodDataCommandBody({
            sourcePeriodKey,
            targetPeriodKey: targetPeriodKeyForCopy,
            mode,
            query: {
              q: query?.q ?? null,
              sort_by: query?.sort_by ?? null,
              sort_dir: query?.sort_dir ?? null,
              filter_operational_reporting: query?.filter_operational_reporting ?? null,
              filter_material: query?.filter_material ?? null,
              filter_payroll: query?.filter_payroll ?? null,
              filter_reporting_type: query?.filter_reporting_type ?? null,
              filter_business_type: query?.filter_business_type ?? null,
              filter_handler: query?.filter_handler ?? null,
              operational_period_key: targetPeriodKeyForCopy,
            },
          }),
        );
        setPeriodCopyDialog(null);
        setPeriodCopyFeedback(
          fillI18n(t('clientOperations.copiedFromTo'), {
            source: formatClientOperationsOperationalPeriodTabLabel(sourcePeriodKey),
            target: formatClientOperationsOperationalPeriodTabLabel(targetPeriodKeyForCopy),
          }),
        );
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : t('clientOperations.copyMonthFailed'));
      } finally {
        setPeriodCopyBusy(false);
      }
    },
    [canEdit, onRegistryCommand, query, targetPeriodKeyForCopy],
  );

  const onSelectCopySourcePeriod = useCallback(
    (sourcePeriodKey: string) => {
      if (!canEdit || !targetPeriodKeyForCopy || sourcePeriodKey === targetPeriodKeyForCopy) return;
      const hasConflict = targetPeriodHasConflictingUserEnteredData(collectTargetConflictSignals());
      setPeriodCopySourceOpen(false);
      setPeriodCopySelectedSource(null);
      if (hasConflict) {
        setPeriodCopyDialog({ sourcePeriodKey, mode: 'empty_only' });
        return;
      }
      void executePeriodDataCopy(sourcePeriodKey, 'empty_only');
    },
    [canEdit, collectTargetConflictSignals, executePeriodDataCopy, targetPeriodKeyForCopy],
  );

  const onConfirmPeriodCopySource = useCallback(() => {
    if (!periodCopySelectedSource) return;
    onSelectCopySourcePeriod(periodCopySelectedSource);
  }, [onSelectCopySourcePeriod, periodCopySelectedSource]);

  const closePeriodCopySourceModal = useCallback(() => {
    setPeriodCopySourceOpen(false);
    setPeriodCopySelectedSource(null);
  }, []);

  const onGridContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!canEdit || !onRegistryCommand) return;
      event.preventDefault();
      event.stopPropagation();
      setPeriodCopyFeedback(null);
      setPeriodCopyDialog(null);
      setPeriodCopySelectedSource(null);
      setPeriodCopySourceOpen(true);
    },
    [canEdit, onRegistryCommand],
  );

  useEffect(() => {
    if (!periodCopySourceOpen && !periodCopyDialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (periodCopyDialog) {
        setPeriodCopyDialog(null);
        return;
      }
      closePeriodCopySourceModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closePeriodCopySourceModal, periodCopyDialog, periodCopySourceOpen]);

  useEffect(() => {
    if (!periodCopyFeedback) return;
    const timer = window.setTimeout(() => setPeriodCopyFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [periodCopyFeedback]);

  const localizeRegistryCommandError = (error: unknown, fallback: string) => {
    if (error instanceof ApiError) {
      return localizeClientOperationsRegistryCommandError(
        { code: error.code, message: error.message },
        t,
        fallback,
      );
    }
    if (error instanceof Error && error.message) {
      const code = (error as Error & { code?: string }).code;
      return localizeClientOperationsRegistryCommandError({ code, message: error.message }, t, fallback);
    }
    return fallback;
  };

  const runMarkCommand = async (
    markKey: string,
    body: Record<string, unknown>,
    fallback: string,
    optimistic?: { periodKey: string; value: boolean },
  ) => {
    if (!canStartOptimisticCheckboxCommand(pendingMarkKeysRef.current, markKey)) return;
    if (pendingMarkKeysRef.current.has(markKey)) return;
    pendingMarkKeysRef.current.add(markKey);
    setPendingMarkKeys(new Set(pendingMarkKeysRef.current));
    setCommandError('');
    let seq: number | null = null;
    if (optimistic) {
      const entry = beginOptimisticCheckbox(optimisticChecksRef.current, {
        markKey,
        periodKey: optimistic.periodKey,
        value: optimistic.value,
      });
      if (entry) {
        seq = entry.seq;
        setOptimisticChecks(new Map(optimisticChecksRef.current));
        onInvalidateStaleLoads?.();
      }
    }
    try {
      await onRegistryCommand?.(body);
      if (
        seq != null &&
        shouldClearOptimisticCheckboxAfterSuccess({
          entry: optimisticChecksRef.current.get(markKey),
          seq,
        })
      ) {
        optimisticChecksRef.current.delete(markKey);
        setOptimisticChecks(new Map(optimisticChecksRef.current));
      }
    } catch (error) {
      if (seq != null && revertOptimisticCheckbox(optimisticChecksRef.current, markKey, seq)) {
        setOptimisticChecks(new Map(optimisticChecksRef.current));
      }
      setCommandError(localizeRegistryCommandError(error, fallback));
    } finally {
      pendingMarkKeysRef.current.delete(markKey);
      setPendingMarkKeys(new Set(pendingMarkKeysRef.current));
    }
  };

  const commitCustomHeaderRename = async (column: ClientOperationsRegistryColumn, label: string) => {
    if (!canEdit || !column.custom_column_id || !onRegistryCommand) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'rename_client_operations_custom_column',
        column_id: column.custom_column_id,
        label,
      });
      setEditingHeaderColumnId(null);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : t('clientOperations.renameColumnFailed'));
    }
  };
  const toggleMaterialStream = async (
    row: ClientOperationsRegistryRow,
    stream: 'vat' | 'income_tax_advance' | 'payroll',
  ) => {
    if (statusPaintMode) return;
    if (!canEdit || !onRegistryCommand) return;
    const cells = row.material_cells;
    const cell =
      stream === 'vat'
        ? cells?.vat ?? row.material_brought_cell
        : stream === 'income_tax_advance'
          ? cells?.income_tax_advance
          : cells?.payroll;
    if (!cell?.editable) return;
    const command =
      stream === 'vat'
        ? 'set_material_brought'
        : stream === 'income_tax_advance'
          ? 'set_income_tax_advance_material_brought'
          : 'set_payroll_material_brought';
    const periodKey = viewedCheckboxPeriodKey;
    const markKey = checkboxOptimisticMarkKey(row.client_id, `material:${stream}`, periodKey);
    if (pendingMarkKeysRef.current.has(markKey)) return;
    const aggregateChecked =
      stream === 'vat' ? Boolean(cell.value ?? row.material_brought_flag) : Boolean(cell.value);
    const current = resolveOptimisticCheckboxChecked({
      aggregateChecked,
      entry: optimisticChecksRef.current.get(markKey),
      viewedPeriodKey: periodKey,
    });
    const next = !current;
    await runMarkCommand(
      markKey,
      {
        command,
        client_id: row.client_id,
        value: next,
        operational_period_key: periodKey || null,
        query,
      },
      t('clientOperations.registry.errors.saveFailed'),
      { periodKey, value: next },
    );
  };
  const toggleNiDeductionsItem = async (
    row: ClientOperationsRegistryRow,
    formKey: '102' | '100' | '126',
  ) => {
    if (statusPaintMode) return;
    if (!canEdit || !onRegistryCommand) return;
    const cell = row.national_insurance_deductions_cell;
    const item = cell?.items[formKey];
    if (!item?.editable) return;
    const periodKey = viewedCheckboxPeriodKey;
    if (formKey === '126') {
      if (item.completed) return;
      const markKey = checkboxOptimisticMarkKey(row.client_id, 'ni:126', periodKey);
      if (pendingMarkKeysRef.current.has(markKey)) return;
      await runMarkCommand(
        markKey,
        {
          command: 'complete_ni_deductions_126_cycle',
          client_id: row.client_id,
          operational_period_key: periodKey || null,
          query,
        },
        t('clientOperations.registry.errors.saveFailed'),
        { periodKey, value: true },
      );
      return;
    }
    const markKey = checkboxOptimisticMarkKey(row.client_id, `ni:${formKey}`, periodKey);
    if (pendingMarkKeysRef.current.has(markKey)) return;
    const current = resolveOptimisticCheckboxChecked({
      aggregateChecked: Boolean(item.completed),
      entry: optimisticChecksRef.current.get(markKey),
      viewedPeriodKey: periodKey,
    });
    const next = !current;
    await runMarkCommand(
      markKey,
      {
        command: formKey === '102' ? 'set_ni_deductions_reported_102' : 'set_ni_deductions_reported_100',
        client_id: row.client_id,
        value: next,
        operational_period_key: periodKey || null,
        query,
      },
      t('clientOperations.registry.errors.saveFailed'),
      { periodKey, value: next },
    );
  };
  const toggleIncomeTaxDeductions = async (row: ClientOperationsRegistryRow) => {
    if (statusPaintMode) return;
    if (!canEdit || !onRegistryCommand) return;
    const cell = row.income_tax_deductions_cell;
    if (!cell?.editable) return;
    const periodKey = viewedCheckboxPeriodKey;
    const markKey = checkboxOptimisticMarkKey(row.client_id, 'itd', periodKey);
    if (pendingMarkKeysRef.current.has(markKey)) return;
    const current = resolveOptimisticCheckboxChecked({
      aggregateChecked: Boolean(cell.completed),
      entry: optimisticChecksRef.current.get(markKey),
      viewedPeriodKey: periodKey,
    });
    const next = !current;
    await runMarkCommand(
      markKey,
      {
        command: 'set_income_tax_deductions_reported',
        client_id: row.client_id,
        value: next,
        operational_period_key: periodKey || null,
        query,
      },
      t('clientOperations.registry.errors.saveFailed'),
      { periodKey, value: next },
    );
  };
  const openReportingPaymentModal = (
    row: ClientOperationsRegistryRow,
    columnKey: string,
    mode: 'file_with_payment' | 'update_payment',
  ) => {
    const reportingCell = row.reporting?.cells?.[columnKey];
    const modal = reportingCell?.payment_modal;
    if (!reportingCell?.obligation_id || !modal) return;
    setPaymentModal({
      mode,
      row,
      columnKey,
      obligationId: reportingCell.obligation_id,
      canonicalId: reportingCell.canonical_id,
      titleKey: modal.title_key,
      options: modal.options,
      confirmKey: modal.confirm_key,
      cancelKey: modal.cancel_key,
      selected: null,
    });
  };
  const toggleReportingFiled = async (
    row: ClientOperationsRegistryRow,
    columnKey: string,
  ) => {
    if (statusPaintMode) return;
    if (!canEdit || !onRegistryCommand) return;
    const reportingCell = row.reporting?.cells?.[columnKey];
    if (!reportingCell?.obligation_id) return;
    const actions = reportingCell.allowed_actions ?? [];
    if (actions.includes('confirm_filing') && reportingCell.payment_question_visible && reportingCell.payment_modal) {
      openReportingPaymentModal(row, columnKey, 'file_with_payment');
      return;
    }
    const markSubmitted = actions.includes('confirm_filing') || reportingCell.can_mark_submitted;
    const markNotSubmitted = actions.includes('unfile') || reportingCell.can_mark_not_submitted;
    if (!markSubmitted && !markNotSubmitted) return;
    await runMarkCommand(
      `${row.client_id}:reporting:${columnKey}`,
      {
        command: markSubmitted
          ? 'mark_client_operations_obligation_reported'
          : 'mark_client_operations_obligation_not_reported',
        client_id: row.client_id,
        obligation_id: reportingCell.obligation_id,
        operational_period_key: query?.operational_period_key ?? null,
        query,
      },
      t('clientOperations.registry.errors.saveFailed'),
    );
  };
  const confirmReportingPaymentModal = async () => {
    if (!paymentModal?.selected || !onRegistryCommand) return;
    const command =
      paymentModal.mode === 'update_payment'
        ? 'confirm_client_operations_obligation_tax_payment'
        : 'confirm_client_operations_obligation_filed_with_payment';
    const markKey = `${paymentModal.row.client_id}:reporting:${paymentModal.columnKey}`;
    setPaymentModal(null);
    await runMarkCommand(
      markKey,
      {
        command,
        client_id: paymentModal.row.client_id,
        obligation_id: paymentModal.obligationId,
        canonical_id: paymentModal.canonicalId,
        payment_classification: paymentModal.selected,
        operational_period_key: query?.operational_period_key ?? null,
        query,
      },
      t('clientOperations.registry.errors.saveFailed'),
    );
  };
  const openFilingDetailModal = (row: ClientOperationsRegistryRow, columnKey: string) => {
    const detail = row.reporting?.cells?.[columnKey]?.filing_detail;
    if (!detail?.openable) return;
    setFilingFeedback(null);
    setEvidenceFeedback(null);
    setFilingModal({ row, columnKey });
  };
  const readEvidenceFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] ?? '' : '');
      };
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
  const runFilingAction = async (action: 'report' | 'report_and_pay' | 'paid') => {
    if (!filingModal || !canEdit || !onRegistryCommand) return;
    if (!canStartFilingAction(filingActionLockRef.current || evidenceLockRef.current)) return;
    const liveRow = rows.find((row) => row.client_id === filingModal.row.client_id) ?? filingModal.row;
    const reportingCell = liveRow.reporting?.cells?.[filingModal.columnKey];
    const detail = reportingCell?.filing_detail;
    if (!reportingCell?.obligation_id || !detail) return;
    const allowed =
      action === 'report'
        ? detail.can_report
        : action === 'report_and_pay'
          ? detail.can_report_and_pay
          : detail.can_mark_paid;
    if (!allowed) return;
    const clientId = liveRow.client_id;
    const columnKey = filingModal.columnKey;
    const markKey = `${clientId}:reporting:${columnKey}`;
    if (pendingMarkKeysRef.current.has(markKey)) return;
    pendingMarkKeysRef.current.add(markKey);
    filingActionLockRef.current = true;
    setPendingMarkKeys(new Set(pendingMarkKeysRef.current));
    setFilingActionPending(true);
    setFilingFeedback(null);
    setCommandError('');
    const period = query?.operational_period_key ?? null;
    const body =
      action === 'report'
        ? {
            command: 'mark_client_operations_obligation_reported',
            client_id: clientId,
            obligation_id: reportingCell.obligation_id,
            canonical_id: reportingCell.canonical_id,
            operational_period_key: period,
            query,
          }
        : {
            command:
              action === 'report_and_pay'
                ? 'confirm_client_operations_obligation_filed_with_payment'
                : 'confirm_client_operations_obligation_tax_payment',
            client_id: clientId,
            obligation_id: reportingCell.obligation_id,
            canonical_id: reportingCell.canonical_id,
            payment_classification: 'paid_in_full',
            operational_period_key: period,
            query,
          };
    try {
      const aggregate = await onRegistryCommand(body, { requireApplied: true });
      if (
        !filingAggregateConfirmsAction({
          action,
          clientId,
          columnKey,
          aggregate: aggregate as {
            rows?: Array<{
              client_id?: string;
              reporting?: {
                cells?: Record<string, { filing_detail?: { chrome?: string | null } | null } | null> | null;
              } | null;
            }>;
          },
        })
      ) {
        setFilingFeedback({
          tone: 'err',
          text: t('clientOperations.registry.reporting.filing.notConfirmed'),
        });
        return;
      }
      setFilingFeedback({
        tone: 'ok',
        text: t(
          action === 'report'
            ? 'clientOperations.registry.reporting.filing.reported'
            : action === 'report_and_pay'
              ? 'clientOperations.registry.reporting.filing.reportedAndPaid'
              : 'clientOperations.registry.reporting.filing.paidRecorded',
        ),
      });
    } catch (error) {
      setFilingFeedback({
        tone: 'err',
        text: localizeRegistryCommandError(error, t('clientOperations.registry.reporting.filing.notConfirmed')),
      });
    } finally {
      pendingMarkKeysRef.current.delete(markKey);
      setPendingMarkKeys(new Set(pendingMarkKeysRef.current));
      filingActionLockRef.current = false;
      setFilingActionPending(false);
    }
  };
  const attachFilingEvidence = async (list: FileList | null) => {
    if (!list?.length || !filingModal || !canEdit || !onRegistryCommand) return;
    if (evidenceLockRef.current || filingActionLockRef.current) return;
    const liveRow = rows.find((row) => row.client_id === filingModal.row.client_id) ?? filingModal.row;
    const reportingCell = liveRow.reporting?.cells?.[filingModal.columnKey];
    if (!reportingCell?.obligation_id) return;
    const files = Array.from(list);
    evidenceLockRef.current = true;
    setEvidencePending(true);
    setEvidenceFeedback(null);
    setCommandError('');
    try {
      for (const file of files) {
        const base64 = await readEvidenceFile(file);
        await onRegistryCommand({
          command: 'attach_client_operations_filing_evidence',
          client_id: liveRow.client_id,
          obligation_id: reportingCell.obligation_id,
          evidence_kind: filingEvidenceKind,
          operational_period_key: query?.operational_period_key ?? null,
          file_base64: base64,
          file_name: file.name,
          mime_type: file.type || null,
        });
      }
      setEvidenceFeedback({
        tone: 'ok',
        text: t('clientOperations.registry.reporting.filing.documentSaved'),
      });
    } catch (error) {
      setEvidenceFeedback({
        tone: 'err',
        text: localizeRegistryCommandError(error, t('clientOperations.registry.errors.saveFailed')),
      });
    } finally {
      evidenceLockRef.current = false;
      setEvidencePending(false);
    }
  };
  const attachNiEvidence = async (list: FileList | null) => {
    if (!list?.length || !niEvidencePrompt || !canEdit || !onRegistryCommand) return;
    if (evidenceLockRef.current || filingActionLockRef.current) return;
    const files = Array.from(list);
    const clientId = niEvidencePrompt.clientId;
    const evidenceKind = filingEvidenceKind;
    evidenceLockRef.current = true;
    setEvidencePending(true);
    setEvidenceFeedback(null);
    setCommandError('');
    try {
      for (const file of files) {
        const base64 = await readEvidenceFile(file);
        await onRegistryCommand({
          command: 'attach_client_operations_filing_evidence',
          client_id: clientId,
          filing_target: 'national_insurance_deductions',
          evidence_kind: evidenceKind,
          operational_period_key: query?.operational_period_key ?? null,
          file_base64: base64,
          file_name: file.name,
          mime_type: file.type || null,
        });
      }
      setEvidenceFeedback({
        tone: 'ok',
        text: t('clientOperations.registry.reporting.filing.documentSaved'),
      });
    } catch (error) {
      setEvidenceFeedback({
        tone: 'err',
        text: localizeRegistryCommandError(error, t('clientOperations.registry.errors.saveFailed')),
      });
    } finally {
      evidenceLockRef.current = false;
      setEvidencePending(false);
    }
  };
  const openSelfEmployedNiModal = (row: ClientOperationsRegistryRow) => {
    const ops = row.national_insurance_operations;
    if (!ops?.openable) return;
    setNiModal({
      row,
      handlingMethod: ops.handling_method,
      confirmMonthHandled: false,
    });
  };
  const confirmSelfEmployedNiModal = async () => {
    if (!niModal || !onRegistryCommand) return;
    const ops = niModal.row.national_insurance_operations;
    const method = niModal.handlingMethod;
    if (!ops || !method) {
      setNiModal(null);
      return;
    }
    const methodChanged = method !== ops.handling_method;
    const persistInherited =
      ops.handling_method_source === 'inherited' ||
      ops.handling_method_source === 'standing_until' ||
      ops.january_confirmation_required;
    const resolve = Boolean(
      method === 'manual_monthly' && niModal.confirmMonthHandled && ops.can_confirm_month_handled,
    );
    setNiModal(null);
    if (!methodChanged && !persistInherited && !resolve) return;
    await runMarkCommand(
      `${niModal.row.client_id}:ni-self`,
      {
        command: 'save_client_operations_self_employed_ni',
        client_id: niModal.row.client_id,
        handling_method: method,
        confirm_month_handled: resolve,
        operational_period_key: query?.operational_period_key ?? null,
        query,
      },
      t('clientOperations.registry.errors.saveFailed'),
    );
  };
  const setOperationalTargetDate = async (
    row: ClientOperationsRegistryRow,
    columnKey: 'annual_report' | 'capital_declaration',
    value: string | null,
  ) => {
    if (statusPaintMode) return;
    if (!canEdit || !onRegistryCommand) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command:
          columnKey === 'annual_report'
            ? 'set_annual_report_operational_target_date'
            : 'set_capital_declaration_operational_target_date',
        client_id: row.client_id,
        operational_period_key: query?.operational_period_key ?? null,
        operational_target_date: value,
        query,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : t('clientOperations.saveDueDateFailed'));
    }
  };
  const openCapitalDeclaration = async (row: ClientOperationsRegistryRow) => {
    if (!canEdit || !onRegistryCommand || !row.capital_declaration_cell?.can_open) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'open_capital_declaration_instance',
        client_id: row.client_id,
        operational_period_key: query?.operational_period_key ?? null,
        query,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : t('clientOperations.openCapitalDeclarationFailed'));
    }
  };
  const createColumn = async () => {
    if (!addColumnLabel.trim() || !onRegistryCommand) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'create_client_operations_custom_column',
        label: addColumnLabel.trim(),
        data_type: addColumnDataType,
      });
      setAddColumnOpen(false);
      setAddColumnLabel('');
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : t('clientOperations.createColumnFailed'));
    }
  };

  const primaryToolbarIds = [
    'undo',
    'redo',
    'search',
    'filter',
    'sort_asc',
    'sort_desc',
    'align_right',
    'align_center',
    'align_left',
    'wrap_text',
    'bold',
    'italic',
    'underline',
    'freeze_columns',
    'add_column',
  ];
  const moreToolbarIds = ['text_color', 'fill_color', 'number_format', 'borders', 'toggle_columns'];

  /**
   * ONE search field. Typing updates suggestions from the current aggregate only.
   * `applyLiveSearch` runs on clear, Enter without a highlight, the icon, or a chosen suggestion.
   */
  const searchBusy = searchPending;
  const searchListId = 'client-operations-search-suggestions';
  const activeSuggestion = searchSuggestionsOpen ? searchSuggestions[searchActiveIndex] : undefined;
  const renderSearchField = (placement: 'toolbar') => (
    <div className={`nx-co-sheet__search nx-co-sheet__search--${placement}`} data-testid="client-operations-search" ref={searchFieldRef}>
      <div className="nx-co-sheet__search-field" aria-busy={searchBusy ? 'true' : undefined}>
        <button
          type="button"
          className="nx-co-sheet__search-icon-btn"
          disabled={!isCap('search')}
          title={capTitle('search') ?? t('clientOperations.search')}
          aria-label={t('clientOperations.search')}
          onClick={() => confirmTypedSearch()}
        >
          <svg className="nx-co-sheet__search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
            <path d="M16.2 16.2 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
        <input
          type="search"
          dir="auto"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={searchSuggestionsOpen}
          aria-controls={searchListId}
          aria-activedescendant={activeSuggestion ? `client-operations-search-option-${activeSuggestion.client_id}` : undefined}
          value={searchDraft}
          disabled={!isCap('search')}
          title={capTitle('search')}
          placeholder={t('clientOperations.searchPlaceholder')}
          aria-label={t('clientOperations.searchClients')}
          onChange={(e) => onSearchDraftChange(e.target.value)}
          onFocus={() => {
            if (searchDraft.trim()) setSearchSuggestionsOpen(true);
          }}
          onKeyDown={onSearchKeyDown}
        />
        <span
          className="nx-co-sheet__search-pending"
          role="status"
          aria-live="polite"
          data-testid="client-operations-search-pending"
          data-pending={searchBusy ? 'true' : 'false'}
        >
          {searchBusy ? (
            <>
              <svg className="nx-co-sheet__search-spinner" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="9" />
              </svg>
              <span className="nx-co-sheet__sr-only">{t('clientOperations.searching')}</span>
            </>
          ) : null}
        </span>
        {searchSuggestionsOpen && searchDraft.trim() ? (
          <div
            id={searchListId}
            className="nx-co-sheet__search-suggestions"
            role="listbox"
            aria-label={t('clientOperations.searchSuggestions')}
            data-testid="client-operations-search-suggestions"
          >
            {searchSuggestions.length === 0 ? (
              <div className="nx-co-sheet__search-empty" role="status">
                {t('clientOperations.searchNoMatches')}
              </div>
            ) : (
              searchSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.client_id}
                  id={`client-operations-search-option-${suggestion.client_id}`}
                  type="button"
                  role="option"
                  aria-selected={index === searchActiveIndex}
                  className={`nx-co-sheet__search-suggestion${index === searchActiveIndex ? ' is-active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    confirmSearchSuggestion(suggestion);
                  }}
                >
                  <span className="nx-co-sheet__search-suggestion-name">{suggestion.client_name}</span>
                  {suggestion.identifier ? (
                    <span className="nx-co-sheet__search-suggestion-id">{suggestion.identifier}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );

  const renderSpreadsheetToolbar = () => {
    const currentPk = focusedCell ? clientOperationsPresentationCellKey(focusedCell) : null;
    const currentCellPres = currentPk ? cellPresentation[currentPk] : undefined;
    // Toolbar always looks active: show cell values when selected, else current tool defaults.
    const currentColor = currentCellPres?.color ?? presentationToolDefaults.color;
    const currentFontSize = currentCellPres?.fontSize ?? presentationToolDefaults.fontSize;
    const currentBold = currentCellPres?.bold ?? presentationToolDefaults.bold;
    const currentItalic = currentCellPres?.italic ?? presentationToolDefaults.italic;
    const currentUnderline = currentCellPres?.underline ?? presentationToolDefaults.underline;
    const currentAlign = currentCellPres?.align ?? presentationToolDefaults.align;
    const currentWrap = currentCellPres?.wrap ?? presentationToolDefaults.wrap;
    const paletteRows = clientOperationsTextColorPaletteRows();

    return (
      <div className="nx-co-sheet__toolbar" role="toolbar" aria-label={t('clientOperations.sheetTools')}>
        {/* ── Undo ── */}
        <div className="nx-co-sheet__toolbar-group">
          <button
            type="button"
            className="nx-co-sheet__btn nx-co-sheet__btn--icon"
            disabled={!isCap('undo') || coUndoStack.length === 0}
            title={capTitle('undo') ?? t('clientOperations.undo')}
            aria-label={t('clientOperations.undo')}
            onClick={undoLastAction}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M9.5 7.5H6.75A4.75 4.75 0 0 0 2 12.25v0A4.75 4.75 0 0 0 6.75 17H14a5 5 0 0 0 5-5" />
              <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M9.5 4.5 6.5 7.5l3 3" />
            </svg>
          </button>
          {/* HIDDEN — redo retained for later restore */}
          <button type="button" className="nx-co-sheet__btn" hidden disabled={!isCap('redo') || redoStack.length === 0} title={capTitle('redo')} onClick={redoPresentation}>{t('clientOperations.redo')}</button>
        </div>

        {/* ── Format: B I U | align | font-size | A-color (always visually active) ── */}
        <div className="nx-co-sheet__toolbar-group nx-co-sheet__toolbar-group--secondary">
          <button
            type="button"
            className={`nx-co-sheet__btn${currentBold ? ' is-active' : ''}`}
            disabled={!isCap('bold')}
            title={capTitle('bold')}
            aria-pressed={currentBold}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => commitPresentationOrToolDefault({ bold: !currentBold })}
          ><strong>B</strong></button>
          <button
            type="button"
            className={`nx-co-sheet__btn${currentItalic ? ' is-active' : ''}`}
            disabled={!isCap('italic')}
            title={capTitle('italic')}
            aria-pressed={currentItalic}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => commitPresentationOrToolDefault({ italic: !currentItalic })}
          ><em>I</em></button>
          <button
            type="button"
            className={`nx-co-sheet__btn${currentUnderline ? ' is-active' : ''}`}
            disabled={!isCap('underline')}
            title={capTitle('underline')}
            aria-pressed={currentUnderline}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => commitPresentationOrToolDefault({ underline: !currentUnderline })}
          ><span style={{ textDecoration: 'underline' }}>U</span></button>

          <button
            type="button"
            className={`nx-co-sheet__btn nx-co-sheet__btn--icon${currentAlign === 'right' ? ' is-active' : ''}`}
            disabled={!isCap('align_right')}
            title={capTitle('align_right') ?? t('clientOperations.alignRight')}
            aria-label={t('clientOperations.alignRight')}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => commitPresentationOrToolDefault({ align: 'right' })}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M20 7H8M20 12H4M20 17H10" /></svg>
          </button>
          <button
            type="button"
            className={`nx-co-sheet__btn nx-co-sheet__btn--icon${currentAlign === 'center' ? ' is-active' : ''}`}
            disabled={!isCap('align_center')}
            title={capTitle('align_center') ?? t('clientOperations.alignCenter')}
            aria-label={t('clientOperations.alignCenter')}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => commitPresentationOrToolDefault({ align: 'center' })}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M18 7H6M20 12H4M17 17H7" /></svg>
          </button>
          <button
            type="button"
            className={`nx-co-sheet__btn nx-co-sheet__btn--icon${currentAlign === 'left' ? ' is-active' : ''}`}
            disabled={!isCap('align_left')}
            title={capTitle('align_left') ?? t('clientOperations.alignLeft')}
            aria-label={t('clientOperations.alignLeft')}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => commitPresentationOrToolDefault({ align: 'left' })}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M4 7h12M4 12h16M4 17h10" /></svg>
          </button>
          {/* HIDDEN — wrap retained */}
          <button type="button" className={`nx-co-sheet__btn${currentWrap ? ' is-active' : ''}`} hidden disabled={!isCap('wrap_text')} title={capTitle('wrap_text')} onClick={() => commitPresentationOrToolDefault({ wrap: !currentWrap })}>{t('clientOperations.wrapText')}</button>

          {/* Font-size selector — always visually active */}
          <select
            data-testid="font-size-control"
            className="nx-co-sheet__font-size-select"
            value={currentFontSize}
            title={t('clientOperations.fontSize')}
            aria-label={t('clientOperations.fontSize')}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onChange={(e) => commitPresentationOrToolDefault({ fontSize: Number(e.target.value) })}
          >
            {CLIENT_OPERATIONS_FONT_SIZES.map((sz) => (
              <option key={sz} value={sz}>{sz}</option>
            ))}
          </select>

          {/* A text-color icon — always visually active */}
          <div className="nx-co-sheet__color-picker-wrap">
            <button
              type="button"
              data-testid="text-color-control"
              className={`nx-co-sheet__btn nx-co-sheet__btn--icon nx-co-sheet__color-a-btn${colorPaletteOpen ? ' is-active' : ''}`}
              disabled={!isCap('text_color')}
              title={t('clientOperations.textColor')}
              aria-label={t('clientOperations.textColor')}
              aria-expanded={colorPaletteOpen}
              onMouseDown={preserveActiveCellOnToolbarMouseDown}
              onClick={() => setColorPaletteOpen((v) => !v)}
            >
              <span
                className="nx-co-sheet__color-a-letter"
                aria-hidden="true"
                style={{ borderBottomColor: currentColor }}
              >A</span>
            </button>
            {colorPaletteOpen && (
              <div className="nx-co-sheet__color-palette" role="dialog" aria-label={t('clientOperations.chooseTextColor')}>
                {([paletteRows.standard, paletteRows.beautiful] as const).map((row, ri) => (
                  <div key={ri} className="nx-co-sheet__color-palette-row">
                    {row.map((swatch) => (
                      <button
                        key={swatch.id}
                        type="button"
                        className="nx-co-sheet__color-swatch"
                        style={{ background: swatch.hex }}
                        title={localizeSystemLabel(t, swatch.label_key, swatch.label_he)}
                        aria-label={localizeSystemLabel(t, swatch.label_key, swatch.label_he)}
                        onMouseDown={preserveActiveCellOnToolbarMouseDown}
                        onClick={() => {
                          commitPresentationOrToolDefault({ color: swatch.hex });
                          setColorPaletteOpen(false);
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Column visibility icon → popover ── */}
        <div className="nx-co-sheet__toolbar-group">
          <div className="nx-co-sheet__col-visibility-wrap">
            <button
              type="button"
              data-testid="column-visibility-control"
              className={`nx-co-sheet__btn nx-co-sheet__btn--icon${columnVisibilityOpen ? ' is-active' : ''}`}
              title={t('clientOperations.showHideColumns')}
              aria-label={t('clientOperations.showHideColumns')}
              aria-expanded={columnVisibilityOpen}
              onClick={() => setColumnVisibilityOpen((v) => !v)}
            >
              {/* Excel-like columns+eye SVG */}
              <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="2" y="5" width="20" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <line x1="8" y1="5" x2="8" y2="19" stroke="currentColor" strokeWidth="1.5" />
                <line x1="16" y1="5" x2="16" y2="19" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 12c2-3 4-4 8-4s6 1 8 4c-2 3-4 4-8 4s-6-1-8-4Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
              </svg>
            </button>
            {columnVisibilityOpen && (
              <div className="nx-co-sheet__col-visibility-popover" role="dialog" aria-label={t('clientOperations.showHideColumns')}>
                {columns.filter((c) => c.cell_kind !== 'folder').map((c) => {
                  const mandatory = isClientOperationsMandatoryVisibleColumn(c.key);
                  return (
                    <label key={c.key} className="nx-co-sheet__col-visibility-item">
                      <input
                        type="checkbox"
                        className="nx-co-sheet__checkbox"
                        checked={!hiddenColumns.has(c.key)}
                        disabled={mandatory}
                        onChange={() => { if (!mandatory) toggleHiddenColumn(c.key); }}
                      />
                      {c.label}
                      {mandatory ? <span className="nx-co-sheet__col-visibility-mandatory">✦</span> : null}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Status paint modes ── */}
        {manualStatusPaintModes.length ? (
          <div className="nx-co-sheet__toolbar-group nx-co-sheet__toolbar-group--status-paint" role="toolbar" aria-label={t('clientOperations.statusPaint')}>
            {manualStatusPaintModes.map((mode) => {
              const statusLabel = localizeSystemLabel(t, mode.label_key, mode.label_he);
              return (
              <button
                key={mode.id}
                type="button"
                className={`nx-co-sheet__status-mode nx-co-sheet__status-mode--${mode.presentation_token}${statusPaintMode === mode.id ? ' is-active' : ''}`}
                disabled={!canEdit}
                aria-pressed={statusPaintMode === mode.id}
                aria-label={statusLabel}
                title={statusLabel}
                onClick={() => setStatusPaintMode((current) => (current === mode.id ? null : mode.id))}
              >
                <span className="nx-co-sheet__status-mode-swatch" aria-hidden="true" />
                <span className="nx-co-sheet__sr-only">{statusLabel}</span>
              </button>
              );
            })}
          </div>
        ) : null}

        <div className="nx-co-sheet__toolbar-group nx-co-sheet__toolbar-group--search">
          {renderSearchField('toolbar')}
        </div>
        {/* HIDDEN for now — keep underlying capabilities/handlers for later restore:
            סינון / מיון ↑ / מיון ↓ / הקפאה */}

        {/* ── Fullscreen ── */}
        <div className="nx-co-sheet__toolbar-group">
          {/* הקפאה hidden from toolbar — freezeOn + sticky CSS implementation retained. */}
          {/* + עמודה hidden — 10 user slots via ensure_client_operations_user_column_slots command. */}
          <button
            type="button"
            className={`nx-co-sheet__btn${fullscreenOpen ? ' is-active' : ''}`}
            disabled={capById.has('fullscreen') && !isCap('fullscreen')}
            title={fullscreenOpen ? t('clientOperations.exitFullscreen') : (capTitle('fullscreen') ?? t('clientOperations.fullscreen'))}
            aria-label={fullscreenOpen ? t('clientOperations.exitFullscreen') : t('clientOperations.fullscreen')}
            aria-pressed={fullscreenOpen}
            onClick={() => setFullscreenOpen((open) => !open)}
          >
            {fullscreenOpen ? t('clientOperations.exitFullscreen') : `⊞ ${t('clientOperations.fullscreen')}`}
          </button>

          {/* Create-client lives on /clients — keep Core command + modal, hide this toolbar button. */}

          {/* ── Print ── */}
          <button
            type="button"
            data-testid="print-control"
            className="nx-co-sheet__btn nx-co-sheet__btn--icon"
            title={t('clientOperations.print')}
            aria-label={t('clientOperations.print')}
            onClick={handlePrint}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="5" y="2" width="14" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 10H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2v-4h14v4h2a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H5Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <rect x="7" y="15" width="10" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="18" cy="13" r="1" fill="currentColor" />
            </svg>
          </button>

          {/* ── עוד (fill/number/borders — text_color removed to toolbar A button) ── */}
          <div className="nx-co-sheet__more">
            <button
              type="button"
              className="nx-co-sheet__btn"
              title={t('clientOperations.moreSheetActions')}
              hidden
              data-testid="co-toolbar-more"
              aria-hidden="true"
              onClick={() => setMoreOpen((v) => !v)}
            >
              {t('clientOperations.more')}
            </button>
            {moreOpen ? (
              <div className="nx-co-sheet__more-menu">
                <label className="nx-co-sheet__btn" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {t('clientOperations.fillColor')}
                  <input
                    className="nx-co-sheet__color"
                    type="color"
                    disabled={!isCap('fill_color')}
                    title={capTitle('fill_color')}
                    onChange={(e) => commitPresentationOrToolDefault({ fill: e.target.value })}
                  />
                </label>
                <label className="nx-co-sheet__btn nx-co-sheet__number-format">
                  {t('clientOperations.numberFormat')}
                  <select
                    value={
                      currentCellPres?.numberFormat
                      ?? presentationToolDefaults.numberFormat
                      ?? 'general'
                    }
                    disabled={!isCap('number_format')}
                    title={capTitle('number_format')}
                    onChange={(e) => commitPresentationOrToolDefault({ numberFormat: e.target.value as CellPresentation['numberFormat'] })}
                  >
                    <option value="general">{t('clientOperations.formatGeneral')}</option>
                    <option value="number">{t('clientOperations.formatNumber')}</option>
                    <option value="currency">{t('clientOperations.formatCurrency')}</option>
                    <option value="percent">{t('clientOperations.formatPercent')}</option>
                    <option value="date">{t('clientOperations.formatDate')}</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={`nx-co-sheet__btn${bordersOn ? ' is-active' : ''}`}
                  disabled={!isCap('borders')}
                  title={capTitle('borders')}
                  onClick={() => setBordersOn((v) => !v)}
                >
                  {t('clientOperations.borders')}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Keep capability ids referenced for tests / future collapse */}
        <span hidden>
          {[...primaryToolbarIds, ...moreToolbarIds].join(',')}
          {capTitle('add_column')}
        </span>
      </div>
    );
  };

  const renderReportingKpis = () => {
    if (!reportingDashboard) return null;
    const activeKpi = query?.filter_reporting_kpi ?? reportingDashboard.active_kpi_filter ?? null;
    return (
      <section className="nx-co-registry__kpis" data-testid="client-operations-reporting-dashboard" aria-label={t('clientOperations.registry.reporting.filterAll')}>
        <div className="nx-co-sheet__reporting-kpis" role="toolbar" aria-label={t('clientOperations.registry.reporting.filterAll')}>
          {reportingDashboard.kpi_cards.map((card) => {
            const selected = activeKpi === card.id;
            return (
              <button
                key={card.id}
                type="button"
                data-testid="client-operations-reporting-kpi"
                data-kpi-id={card.id}
                className={`nx-co-sheet__reporting-kpi is-${card.remaining_tone}${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                aria-label={`${t(card.label_key)} ${card.submitted_count} / ${card.total_count}`}
                onClick={() => {
                  if (!onQueryChange) return;
                  onQueryChange({
                    q: query?.q ?? null,
                    sort_by: query?.sort_by ?? null,
                    sort_dir: query?.sort_dir ?? null,
                    filter_operational_reporting: query?.filter_operational_reporting ?? null,
                    filter_material: query?.filter_material ?? null,
                    filter_payroll: query?.filter_payroll ?? null,
                    filter_reporting_type: query?.filter_reporting_type ?? null,
                    filter_business_type: query?.filter_business_type ?? null,
                    filter_handler: query?.filter_handler ?? null,
                    filter_reporting_kpi: selected ? null : card.id,
                  }, { quiet: true });
                }}
              >
                <span className="nx-co-sheet__reporting-kpi-label">{t(card.label_key)}</span>
                <span className="nx-co-sheet__reporting-kpi-frac">
                  <span className="is-submitted">{card.submitted_count}</span>
                  <span className="is-muted"> / {card.total_count}</span>
                </span>
              </button>
            );
          })}
          {reportingDashboard.payments_outstanding_kpi ? (() => {
            const card = reportingDashboard.payments_outstanding_kpi;
            const selected = activeKpi === card.id;
            const tooltip = card.tooltip_periods.map((p) => p.display_label).join(' · ');
            return (
              <button
                key={card.id}
                type="button"
                data-testid="client-operations-payments-outstanding-kpi"
                data-kpi-id={card.id}
                className={`nx-co-sheet__reporting-kpi is-payment-outstanding${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                aria-label={`${t(card.label_key)} ${card.count}`}
                title={tooltip || t(card.tooltip_key)}
                onClick={() => {
                  if (!onQueryChange) return;
                  onQueryChange({
                    q: query?.q ?? null,
                    sort_by: query?.sort_by ?? null,
                    sort_dir: query?.sort_dir ?? null,
                    filter_operational_reporting: query?.filter_operational_reporting ?? null,
                    filter_material: query?.filter_material ?? null,
                    filter_payroll: query?.filter_payroll ?? null,
                    filter_reporting_type: query?.filter_reporting_type ?? null,
                    filter_business_type: query?.filter_business_type ?? null,
                    filter_handler: query?.filter_handler ?? null,
                    filter_reporting_kpi: selected ? null : card.id,
                  }, { quiet: true });
                }}
              >
                <span className="nx-co-sheet__reporting-kpi-label">{t(card.label_key)}</span>
                <span className="nx-co-sheet__reporting-kpi-frac">
                  <span className="is-payment-outstanding">{card.count}</span>
                </span>
              </button>
            );
          })() : null}
        </div>
      </section>
    );
  };

  const renderPreviousPeriods = () => {
    if (!reportingDashboard) return null;
    const previous = reportingDashboard.previous_periods;
    return (
      <div className="nx-co-registry__previous nx-co-sheet__reporting-previous" data-testid="client-operations-previous-periods-section">
        <button
          type="button"
          className="nx-co-sheet__reporting-previous-btn"
          data-testid="client-operations-previous-periods"
          aria-haspopup="listbox"
          title={previous.periods.map((p) => p.display_label).join(' · ') || undefined}
          disabled={!previous.incomplete_count}
        >
          {t('clientOperations.registry.reporting.previousIncomplete')}
          <strong> {previous.incomplete_count} {t('clientOperations.registry.reporting.previousIncompleteCount')}</strong>
          {previous.overdue_count > 0 ? (
            <span className="is-overdue">
              {' · '}
              {previous.overdue_count} {t('clientOperations.registry.reporting.overduePeriods')}
            </span>
          ) : null}
        </button>
        {previous.periods.length ? (
          <div className="nx-co-sheet__reporting-previous-list" role="listbox" aria-label={t('clientOperations.registry.reporting.previousIncomplete')}>
            {previous.periods.map((item) => (
              <button
                key={item.period_key}
                type="button"
                role="option"
                className={item.overdue ? 'is-overdue' : undefined}
                onClick={() => onPeriodChange?.(item.navigate_period_key)}
              >
                {item.display_label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderRegistrySort = () => {
    if (!reportingDashboard?.sort_options.length) return null;
    const activeSort = query?.sort_by ?? reportingDashboard.active_sort ?? 'priority';
    return (
      <label className="nx-co-sheet__reporting-sort">
        <span>{t('clientOperations.registry.reporting.sortLabel')}</span>
        <select
          value={activeSort === 'client_name' ? 'client_name' : 'priority'}
          disabled={!onQueryChange}
          onChange={(event) => {
            if (!onQueryChange) return;
            onQueryChange({
              q: query?.q ?? null,
              sort_by: event.target.value,
              sort_dir: query?.sort_dir ?? null,
              filter_operational_reporting: query?.filter_operational_reporting ?? null,
              filter_material: query?.filter_material ?? null,
              filter_payroll: query?.filter_payroll ?? null,
              filter_reporting_type: query?.filter_reporting_type ?? null,
              filter_business_type: query?.filter_business_type ?? null,
              filter_handler: query?.filter_handler ?? null,
              filter_reporting_kpi: query?.filter_reporting_kpi ?? null,
            }, { quiet: true });
          }}
        >
          {reportingDashboard.sort_options.map((opt) => (
            <option key={opt.id} value={opt.id}>{t(opt.label_key)}</option>
          ))}
        </select>
      </label>
    );
  };

  const renderFilterBar = () => {
    if (!filters?.definitions?.length) return null;
    // Optimistic selection from query (set immediately in parent onChange).
    // Never wait for filters.active — that snaps the control back until the GET returns.
    const fromQueryOrAll = (value: string | null | undefined) =>
      value && value.trim() ? value.trim() : 'all';
    const selectedById: Record<string, string> = query
      ? {
          operational_reporting: fromQueryOrAll(query.filter_operational_reporting),
          material: fromQueryOrAll(query.filter_material),
          payroll: fromQueryOrAll(query.filter_payroll),
          reporting_type: fromQueryOrAll(query.filter_reporting_type),
          business_type: fromQueryOrAll(query.filter_business_type),
          handler: fromQueryOrAll(query.filter_handler),
        }
      : {
          operational_reporting: filters.active?.operational_reporting ?? 'all',
          material: filters.active?.material ?? 'all',
          payroll: filters.active?.payroll ?? 'all',
          reporting_type: filters.active?.reporting_type ?? 'all',
          business_type: filters.active?.business_type ?? 'all',
          handler: filters.active?.handler ?? 'all',
        };
    const clearAvailable =
      selectedById.operational_reporting !== 'all' ||
      selectedById.material !== 'all' ||
      selectedById.payroll !== 'all' ||
      selectedById.reporting_type !== 'all' ||
      selectedById.business_type !== 'all' ||
      selectedById.handler !== 'all' ||
      filters.clear_action?.available === true;
    return (
      <div
        className="nx-co-sheet__filter-bar"
        role="toolbar"
        aria-label={t('clientOperations.filterAria')}
        data-testid="client-operations-filter-bar"
      >
        <div className="nx-co-sheet__filter-bar-scroll">
          {filters.definitions
            .filter((def) => showHandler || def.id !== 'handler')
            .map((def) => {
            const widthClass =
              def.width_hint === 'wide'
                ? ' nx-co-sheet__filter-control--wide'
                : def.width_hint === 'handler'
                  ? ' nx-co-sheet__filter-control--handler'
                  : '';
            const selected = selectedById[def.id] ?? 'all';
            const isMulti = def.selection_mode === 'multi';
            const controlClass = `nx-co-sheet__filter-control${widthClass}`;
            if (isMulti) {
              return (
                <div key={def.id} className={controlClass} data-filter-id={def.id}>
                  <span className="nx-co-sheet__filter-label">{localizeSystemLabel(t, def.label_key, def.label_he)}</span>
                  <ClientOperationsMultiSelectFilter
                    filterId={def.id}
                    labelHe={localizeSystemLabel(t, def.label_key, def.label_he)}
                    options={def.options.map((opt) => ({
                      ...opt,
                      label_he: localizeSystemLabel(t, opt.label_key, opt.label_he),
                    }))}
                    value={selected}
                    disabled={!onQueryChange}
                    onChange={(nextCsv: string) => applyBusinessFilterChange(def.id, nextCsv)}
                  />
                </div>
              );
            }
            return (
              <label
                key={def.id}
                className={controlClass}
                data-filter-id={def.id}
              >
                <span className="nx-co-sheet__filter-label">{localizeSystemLabel(t, def.label_key, def.label_he)}</span>
                <select
                  className="nx-co-sheet__filter-select"
                  value={selected}
                  disabled={!onQueryChange}
                  title={localizeSystemLabel(t, def.label_key, def.label_he)}
                  aria-label={localizeSystemLabel(t, def.label_key, def.label_he)}
                  onChange={(e) => applyBusinessFilterChange(def.id, e.target.value)}
                >
                  {def.options.map((opt) => (
                    <option key={opt.id} value={opt.id} disabled={opt.enabled === false}>
                      {localizeSystemLabel(t, opt.label_key, opt.label_he)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <button
            type="button"
            className="nx-co-sheet__filter-clear"
            disabled={!onQueryChange || !clearAvailable}
            title={localizeSystemLabel(t, filters.clear_action?.label_key, filters.clear_action?.label_he ?? t('clientOperations.clearFilter'))}
            onClick={clearBusinessFilters}
          >
            {localizeSystemLabel(t, filters.clear_action?.label_key, filters.clear_action?.label_he ?? t('clientOperations.clearFilter'))}
          </button>
        </div>
      </div>
    );
  };

  const renderCellContent = (r: ClientOperationsRegistryRow, col: ClientOperationsRegistryColumn) => {
    if (col.cell_kind === 'folder') {
      return (
        <button
          type="button"
          className={isSpreadsheet ? 'nx-co-sheet__folder-btn' : undefined}
          onClick={() => openClientModal(r)}
          style={
            isSpreadsheet
              ? undefined
              : {
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 18,
                  lineHeight: 1,
                }
          }
          aria-label={`Open client case ${r.client_name ?? ''}`}
        >
          {/* Unified amber folder (shape preserved) — presentation only, same openClientModal path. */}
          {isSpreadsheet ? <ClientOperationsFolderIcon /> : '📁'}
        </button>
      );
    }
    if (col.cell_kind === 'notes') {
      const text = displayForColumn(r, col, t);
      return (
        <button
          type="button"
          className={isSpreadsheet ? 'nx-co-sheet__notes-btn' : undefined}
          onClick={() => openNotesModal(r)}
          style={
            isSpreadsheet
              ? undefined
              : {
                  width: '100%',
                  textAlign: 'start',
                  background: 'rgba(59,130,246,0.06)',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: '8px 10px',
                  cursor: 'pointer',
                  fontSize: 13,
                  lineHeight: 1.35,
                }
          }
        >
          {text}
        </button>
      );
    }
    if (col.cell_kind === 'custom') {
      const value = displayCustomColumnValue(r, col);
      return canEdit && col.editable ? (
        <button
          type="button"
          className={`nx-co-sheet__custom-cell${value ? '' : ' is-blank'}`}
          onDoubleClick={() => void editCustomCell(r, col)}
          title={t('clientOperations.doubleClickToEdit')}
        >
          {value}
        </button>
      ) : (
        value
      );
    }
    if (col.cell_kind === 'operational_date') {
      const operationalCell =
        col.key === 'annual_report'
          ? r.annual_report_cell
          : col.key === 'capital_declaration'
            ? r.capital_declaration_cell
            : null;
      if (!operationalCell?.applicable) {
        const canOpenCapital =
          col.key === 'capital_declaration' && Boolean(r.capital_declaration_cell?.can_open);
        if (!canOpenCapital) {
          return (
            <span className="nx-co-sheet__plain-dash" aria-label={`${col.label} —`}>
              —
            </span>
          );
        }
        return (
          <button
            type="button"
            className="nx-co-sheet__date-open nx-co-sheet__date-field nx-co-sheet__date-field--capital"
            disabled={!canEdit || !onRegistryCommand}
            title={t('clientOperations.openCapitalDeclaration')}
            aria-label={`${t('clientOperations.openCapitalDeclaration')} — ${r.client_name ?? r.client_id}`}
            onClick={(event) => {
              event.stopPropagation();
              void openCapitalDeclaration(r);
            }}
          >
            <span className="nx-co-sheet__date-field-value is-empty">{'\u00a0'}</span>
            <span className="nx-co-sheet__date-field-icon" aria-hidden="true">
              <ClientOperationsCalendarIcon />
            </span>
          </button>
        );
      }
      const value = operationalCell.operational_target_date ?? '';
      const displayValue = displayForColumn(r, col, t);
      const disabled = !canEdit || !col.editable || !operationalCell.editable || !onRegistryCommand;
      const dateInputId = `co-date-${col.key}-${r.client_id}`;
      const dateInputName = `co_${col.key}_operational_target_date`;
      return (
        <label
          className={`nx-co-sheet__date-field${disabled ? ' is-disabled' : ''}${col.key === 'capital_declaration' ? ' nx-co-sheet__date-field--capital' : ''}`}
          htmlFor={dateInputId}
          onClick={(event) => {
            // Prevent row/folder navigation; native input owns the hit target.
            event.stopPropagation();
            if (statusPaintMode) {
              event.preventDefault();
              paintCellManualStatus(r, col.key);
              return;
            }
            // Presentation-only selection — does not change the date domain value.
            selectActiveFormatCell(r.client_id, col);
          }}
          onPointerDown={(event) => {
            // Label chrome is pointer-events:none on children; still stop row selection.
            event.stopPropagation();
            if (statusPaintMode) {
              event.preventDefault();
              paintCellManualStatus(r, col.key);
              return;
            }
            selectActiveFormatCell(r.client_id, col);
          }}
        >
          <span className={`nx-co-sheet__date-field-value${value ? '' : ' is-empty'}`}>
            {value ? displayValue : '\u00a0'}
          </span>
          <span className="nx-co-sheet__date-field-icon" aria-hidden="true">
            <ClientOperationsCalendarIcon />
          </span>
          <input
            id={dateInputId}
            name={dateInputName}
            type="date"
            className="nx-co-sheet__date-field-input"
            value={value}
            disabled={disabled}
            aria-label={`${col.label} — ${r.client_name ?? r.client_id}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (!statusPaintMode) {
                selectActiveFormatCell(r.client_id, col);
              }
              if (disabled) return;
              // Single user-gesture showPicker (progressive). Native indicator still works alone.
              tryShowNativeDatePicker(event.currentTarget);
            }}
            onClick={(event) => {
              // Native path + stop row selection. Do not call showPicker again (avoid double open).
              event.stopPropagation();
              if (!statusPaintMode) {
                selectActiveFormatCell(r.client_id, col);
              }
            }}
            onChange={(event) =>
              void setOperationalTargetDate(
                r,
                col.key === 'annual_report' ? 'annual_report' : 'capital_declaration',
                event.currentTarget.value || null,
              )
            }
          />
        </label>
      );
    }

    if (col.cell_kind === 'checkbox' && col.key === 'material_brought') {
      const periodLabel = query?.operational_period_key ?? '';
      const clientLabel = r.client_name ?? r.client_id;
      const streams: Array<{
        key: 'vat' | 'income_tax_advance' | 'payroll';
        labelHe: string;
        cell: ClientOperationsMaterialCell | undefined;
      }> = [
        {
          key: 'vat',
          labelHe: t('clientOperations.registry.columns.vat'),
          cell: r.material_cells?.vat ?? r.material_brought_cell,
        },
        {
          key: 'income_tax_advance',
          labelHe: t('clientOperations.registry.columns.incomeTaxAdvance'),
          cell: r.material_cells?.income_tax_advance,
        },
        {
          key: 'payroll',
          labelHe: t('clientOperations.registry.columns.payroll'),
          cell: r.material_cells?.payroll,
        },
      ];
      return (
        <div className="nx-co-sheet__material" role="group" aria-label={`${t('clientOperations.material')} — ${clientLabel}`}>
          {streams.map((stream) => {
            // Backend owns configured/due. Not configured → —. Configured+not-due → disabled square.
            const configured = Boolean(
              stream.cell?.configured ?? stream.cell?.applicable,
            );
            if (!configured) {
              return (
                <span
                  key={stream.key}
                  className="nx-co-sheet__material-slot is-na nx-co-sheet__plain-dash"
                  title={`${stream.labelHe} ${t('clientOperations.notConfigured')}`}
                  aria-label={`${t('clientOperations.material')} ${stream.labelHe} — ${clientLabel} — ${periodLabel} — ${t('clientOperations.notConfigured')}`}
                >
                  —
                </span>
              );
            }
            const editable = Boolean(stream.cell?.editable);
            const markKey = checkboxOptimisticMarkKey(r.client_id, `material:${stream.key}`, viewedCheckboxPeriodKey);
            const aggregateChecked = Boolean(
              stream.key === 'vat'
                ? stream.cell?.value ?? r.material_brought_flag
                : stream.cell?.value,
            );
            const checked = resolveOptimisticCheckboxChecked({
              aggregateChecked,
              entry: optimisticChecks.get(markKey),
              viewedPeriodKey: viewedCheckboxPeriodKey,
            });
            const saving = pendingMarkKeys.has(markKey);
            return (
              <label
                key={stream.key}
                className={`nx-co-sheet__material-slot${editable ? '' : ' is-inactive'}${saving ? ' is-saving' : ''}`}
                title={editable ? undefined : `${stream.labelHe} ${t('clientOperations.configuredNoReportThisMonth')}`}
              >
                <input
                  type="checkbox"
                  className="nx-co-sheet__checkbox"
                  checked={checked}
                  disabled={!editable || !canEdit || !col.editable || !onRegistryCommand}
                  aria-busy={saving}
                  aria-label={`${t('clientOperations.material')} ${stream.labelHe} — ${clientLabel} — ${periodLabel}${editable ? '' : t('clientOperations.notRequiredThisMonth')}${saving ? ` — ${t('clientOperations.registry.saving')}` : ''}`}
                  onChange={() => {
                    if (statusPaintMode) return;
                    if (pendingMarkKeysRef.current.has(markKey)) return;
                    void toggleMaterialStream(r, stream.key);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (statusPaintMode) {
                      event.preventDefault();
                      paintCellManualStatus(r, col.key);
                      return;
                    }
                    // Presentation-only selection — does not change checkbox domain value.
                    selectActiveFormatCell(r.client_id, col);
                  }}
                />
              </label>
            );
          })}
        </div>
      );
    }
    if (col.cell_kind === 'checkbox' && col.key === 'national_insurance_deductions') {
      const periodLabel = query?.operational_period_key ?? '';
      const clientLabel = r.client_name ?? r.client_id;
      const niCell = r.national_insurance_deductions_cell;
      const niConfigured = Boolean(niCell?.configured ?? niCell?.applicable);
      if (!niConfigured) {
        return (
          <span className="nx-co-sheet__plain-dash" title={t('clientOperations.noDeductionsFile')} aria-label={`${col.label} —`}>
            —
          </span>
        );
      }
      const forms: Array<{ key: '102' | '100' | '126'; labelHe: string }> = [
        { key: '102', labelHe: '102' },
        { key: '100', labelHe: '100' },
        { key: '126', labelHe: '126' },
      ];
      const attachLabel = t('clientOperations.registry.reporting.filing.attach');
      return (
        <div className="nx-co-sheet__ni-forms" role="group" aria-label={`${t('clientOperations.niDeductionsShort')} — ${clientLabel}`}>
          {niCell?.applicable ? (
            <button
              type="button"
              className="nx-co-sheet__ni-clip"
              title={attachLabel}
              aria-label={attachLabel}
              disabled={!canEdit || !onRegistryCommand}
              onClick={(event) => {
                event.stopPropagation();
                setEvidenceFeedback(null);
                setNiEvidencePrompt({ clientId: r.client_id });
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M16.5 6.5v9.2a4.5 4.5 0 1 1-9 0V6.8a3 3 0 0 1 6 0v8.2a1.5 1.5 0 0 1-3 0V7.2h-1.5v7.8a3 3 0 0 0 6 0V6.8a4.5 4.5 0 0 0-9 0v8.9a6 6 0 0 0 12 0V6.5h-1.5Z" />
              </svg>
            </button>
          ) : null}
          <div className="nx-co-sheet__material">
          {forms.map((form) => {
            const item = niCell!.items[form.key];
            const itemConfigured = Boolean(item?.configured ?? item?.applicable ?? niConfigured);
            if (!itemConfigured) {
              return (
                <span
                  key={form.key}
                  className="nx-co-sheet__material-slot is-na nx-co-sheet__plain-dash"
                  title={`${form.labelHe} ${t('clientOperations.notConfigured')}`}
                  aria-label={`${t('clientOperations.niDeductionsShort')} ${form.labelHe} — ${clientLabel} — ${periodLabel} — ${t('clientOperations.notConfigured')}`}
                >
                  —
                </span>
              );
            }
            const editable = Boolean(item?.editable) && !(form.key === '126' && item?.completed);
            const markKey = checkboxOptimisticMarkKey(r.client_id, `ni:${form.key}`, viewedCheckboxPeriodKey);
            const checked = resolveOptimisticCheckboxChecked({
              aggregateChecked: Boolean(item?.completed),
              entry: optimisticChecks.get(markKey),
              viewedPeriodKey: viewedCheckboxPeriodKey,
            });
            const saving = pendingMarkKeys.has(markKey);
            return (
              <label
                key={form.key}
                className={`nx-co-sheet__material-slot${editable ? '' : ' is-inactive'}${saving ? ' is-saving' : ''}`}
                title={editable ? undefined : `${form.labelHe} ${t('clientOperations.configuredNoReportThisMonth')}`}
              >
                <input
                  type="checkbox"
                  className="nx-co-sheet__checkbox"
                  checked={checked}
                  disabled={!editable || !canEdit || !col.editable || !onRegistryCommand}
                  aria-busy={saving}
                  aria-label={`${t('clientOperations.niDeductionsShort')} ${form.labelHe} — ${clientLabel} — ${periodLabel}${editable ? '' : t('clientOperations.notRequiredThisMonth')}${saving ? ` — ${t('clientOperations.registry.saving')}` : ''}`}
                  onChange={() => {
                    if (statusPaintMode) return;
                    if (pendingMarkKeysRef.current.has(markKey)) return;
                    void toggleNiDeductionsItem(r, form.key);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (statusPaintMode) {
                      event.preventDefault();
                      paintCellManualStatus(r, col.key);
                      return;
                    }
                    // Presentation-only selection — does not change checkbox domain value.
                    selectActiveFormatCell(r.client_id, col);
                  }}
                />
              </label>
            );
          })}
          </div>
        </div>
      );
    }
    if (col.cell_kind === 'checkbox' && col.key === 'income_tax_deductions') {
      const periodLabel = query?.operational_period_key ?? '';
      const clientLabel = r.client_name ?? r.client_id;
      const cell = r.income_tax_deductions_cell;
      if (!cell?.configured) {
        return (
          <span className="nx-co-sheet__plain-dash" title={t('clientOperations.noDeductionsFile')} aria-label={`${col.label} —`}>
            —
          </span>
        );
      }
      const editable = Boolean(cell.editable);
      const markKey = checkboxOptimisticMarkKey(r.client_id, 'itd', viewedCheckboxPeriodKey);
      const checked = resolveOptimisticCheckboxChecked({
        aggregateChecked: Boolean(cell.completed),
        entry: optimisticChecks.get(markKey),
        viewedPeriodKey: viewedCheckboxPeriodKey,
      });
      const saving = pendingMarkKeys.has(markKey);
      return (
        <label
          className={`nx-co-sheet__itd-slot${editable ? '' : ' is-inactive'}${saving ? ' is-saving' : ''}`}
          title={editable ? undefined : t('clientOperations.hasDeductionsFileNoReport')}
        >
          <input
            type="checkbox"
            className="nx-co-sheet__checkbox"
            checked={checked}
            disabled={!editable || !canEdit || !col.editable || !onRegistryCommand}
            aria-busy={saving}
            aria-label={`${col.label} — ${clientLabel} — ${periodLabel}${editable ? '' : t('clientOperations.notRequiredThisMonth')}${saving ? ` — ${t('clientOperations.registry.saving')}` : ''}`}
            onChange={() => {
              if (statusPaintMode) return;
              if (pendingMarkKeysRef.current.has(markKey)) return;
              void toggleIncomeTaxDeductions(r);
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (statusPaintMode) {
                event.preventDefault();
                paintCellManualStatus(r, col.key);
                return;
              }
              // Presentation-only selection — does not change checkbox domain value.
              selectActiveFormatCell(r.client_id, col);
            }}
          />
        </label>
      );
    }
    if (col.cell_kind === 'checkbox') {
      return displayForColumn(r, col, t);
    }
    if (col.key === 'handler') {
      const text = displayForColumn(r, col, t);
      const names = r.assigned_employees?.names ?? [];
      return (
        <span className="nx-co-sheet__handler" title={names.length > 1 ? names.join(' · ') : undefined}>
          {text}
        </span>
      );
    }
    if (col.key === 'national_insurance') {
      const ops = r.national_insurance_operations;
      const text = displayForColumn(r, col, t);
      if (!ops?.openable) {
        return (
          <span className="nx-co-sheet__plain-dash" aria-label={`${col.label} —`}>
            —
          </span>
        );
      }
      return (
        <button
          type="button"
          className={`nx-co-sheet__ni-amount${ops.ni_indicator_alert ? ' is-office-reminder' : ''}`}
          data-testid="client-operations-ni-amount"
          data-office-reminder={ops.office_reminder ? 'true' : 'false'}
          data-january-confirmation={ops.january_confirmation_required ? 'true' : 'false'}
          data-standing-order={ops.standing_order_active ? 'active' : 'inactive'}
          data-handling-method={ops.handling_method ?? 'unresolved'}
          data-handling-source={ops.handling_method_source}
          title={t(ops.standing_order_status_key)}
          onClick={(event) => {
            event.stopPropagation();
            if (statusPaintMode) {
              paintCellManualStatus(r, col.key);
              return;
            }
            openSelfEmployedNiModal(r);
          }}
        >
          {text}
        </button>
      );
    }
    if (col.key === 'client_name') {
      const text = displayForColumn(r, col, t);
      return (
        <button
          type="button"
          className={isSpreadsheet ? 'nx-co-sheet__client-name-btn' : 'nx-co-sheet__client-name-btn'}
          onClick={(e) => {
            e.stopPropagation();
            openQuickProfile(r, e.currentTarget);
          }}
          aria-label={`${t('clientOperations.quickCard')} ${r.client_name ?? ''}`}
        >
          {text}
        </button>
      );
    }
    // Configuration / frequency text comes ready-made from the aggregate.
    // Period "not due this month" must NOT overwrite configured labels with —.
    // (CSS `is-not-applicable` may still dim filing-due semantics separately.)
    const reportingCell = r.reporting?.cells?.[col.key];
    const filingDetail = reportingCell?.filing_detail;
    if (filingDetail) {
      if (!filingDetail.openable || filingDetail.chrome === 'not_applicable') {
        return (
          <span className="nx-co-sheet__plain-dash" aria-label={`${col.label} —`}>
            —
          </span>
        );
      }
      const text = displayForColumn(r, col, t);
      const filed = filingDetail.chrome === 'filed_unpaid' || filingDetail.chrome === 'filed_paid';
      const statusLabel = t(filingDetail.filing_status_key);
      return (
        <button
          type="button"
          className={`nx-co-sheet__frequency-cell is-${filingDetail.chrome}`}
          data-testid="client-operations-frequency-cell"
          data-chrome={filingDetail.chrome}
          title={filed ? `${text} — ${statusLabel}` : t(reportingCell?.tooltip_key || filingDetail.filing_status_key)}
          aria-label={filed ? `${col.label} — ${text} — ${statusLabel}` : undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (statusPaintMode) {
              paintCellManualStatus(r, col.key);
              return;
            }
            openFilingDetailModal(r, col.key);
          }}
        >
          <span className="nx-co-sheet__frequency-label">{text}</span>
          {filed ? <span className={`nx-co-sheet__filing-mark is-${filingDetail.chrome}`} aria-hidden="true" /> : null}
        </button>
      );
    }
    if (reportingCell?.overlay_visible) {
      const text = displayForColumn(r, col, t);
      const markKey = `${r.client_id}:reporting:${col.key}`;
      const saving = pendingMarkKeys.has(markKey);
      const actions = reportingCell.allowed_actions ?? [];
      const canToggle = Boolean(
        (actions.includes('confirm_filing') || actions.includes('unfile')) &&
          canEdit &&
          onRegistryCommand,
      );
      const canUpdatePayment = Boolean(
        actions.includes('update_payment') && canEdit && onRegistryCommand,
      );
      const tooltip = t(reportingCell.tooltip_key || reportingCell.tone_label_key);
      const icon = reportingCell.display_icon ?? 'none';
      return (
        <span className="nx-co-sheet__reporting-cell">
          {reportingCell.display_dash ? (
            <>
              <span className="nx-co-sheet__plain-dash" aria-hidden="true">—</span>
              <span className="nx-co-sheet__sr-only">{t(reportingCell.tone_label_key)}</span>
            </>
          ) : (
            <>
              {icon === 'check' ? (
                <span className="nx-co-sheet__reporting-check" aria-hidden="true">✓</span>
              ) : icon === 'bang_overdue' ? (
                <span className="nx-co-sheet__reporting-overdue" aria-hidden="true">!</span>
              ) : icon === 'bang_payment' ? (
                <button
                  type="button"
                  className="nx-co-sheet__reporting-payment-bang"
                  disabled={!canUpdatePayment || saving}
                  title={tooltip}
                  aria-label={tooltip}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (statusPaintMode || !canUpdatePayment) return;
                    openReportingPaymentModal(r, col.key, 'update_payment');
                  }}
                >
                  !
                </button>
              ) : icon === 'unknown' ? (
                <button
                  type="button"
                  className="nx-co-sheet__reporting-payment-unknown"
                  disabled={!canUpdatePayment || saving}
                  title={tooltip}
                  aria-label={tooltip}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (statusPaintMode || !canUpdatePayment) return;
                    openReportingPaymentModal(r, col.key, 'update_payment');
                  }}
                >
                  ?
                </button>
              ) : null}
              {canToggle ? (
                <label className={`nx-co-sheet__reporting-mark${saving ? ' is-saving' : ''}`}>
                  <input
                    type="checkbox"
                    className="nx-co-sheet__checkbox"
                    checked={reportingCell.submitted}
                    disabled={saving}
                    aria-busy={saving}
                    aria-label={`${t(reportingCell.tone_label_key)} — ${col.label} — ${r.client_name ?? r.client_id}`}
                    title={t(reportingCell.submitted ? 'clientOperations.registry.reporting.markNotSubmitted' : 'clientOperations.registry.reporting.markSubmitted')}
                    onChange={() => {
                      if (statusPaintMode) return;
                      void toggleReportingFiled(r, col.key);
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                </label>
              ) : (
                <span className="nx-co-sheet__sr-only">{t(reportingCell.tone_label_key)}</span>
              )}
              <span>{text}</span>
            </>
          )}
        </span>
      );
    }
    return displayForColumn(r, col, t);
  };

  const renderSpreadsheetTable = () => (
    <div
      ref={sheetCanvasRef}
      className="nx-co-sheet__canvas"
      onContextMenu={onGridContextMenu}
      data-testid="client-operations-grid-surface"
    >
      <table className={`nx-co-sheet__table${freezeOn ? ' is-frozen' : ''}${bordersOn ? '' : ' is-borders-off'}${isResizingColumn ? ' is-resizing' : ''}`}>
        <colgroup>
          {visibleColumns.map((column) => <col key={column.key} style={{ width: widthForColumn(column) }} />)}
        </colgroup>
        <thead><tr>
          {visibleColumns.map((column) => (
            <th key={column.key} data-col={column.key} data-freeze={column.freeze_default ? 'true' : 'false'} style={{ textAlign: column.align }}>
              {column.key === 'material_brought' ? (
                <div className="nx-co-sheet__material-header">
                  <span className="nx-co-sheet__material-header-title">{t('clientOperations.material')}</span>
                  <div className="nx-co-sheet__material-header-subs" aria-hidden="true">
                    <span>{t('clientOperations.registry.columns.vat')}</span>
                    <span>{t('clientOperations.registry.columns.incomeTaxAdvance')}</span>
                    <span>{t('clientOperations.registry.columns.payroll')}</span>
                  </div>
                </div>
              ) : column.key === 'national_insurance_deductions' ? (
                <div className="nx-co-sheet__material-header is-ni-evidence">
                  <span className="nx-co-sheet__material-header-title">{t('clientOperations.niDeductionsShort')}</span>
                  <div className="nx-co-sheet__material-header-subs" aria-hidden="true">
                    <span>102</span>
                    <span>100</span>
                    <span>126</span>
                  </div>
                </div>
              ) : column.cell_kind === 'custom' ? (
                <div className="nx-co-sheet__custom-header">
                  {editingHeaderColumnId === column.custom_column_id ? (
                    <input
                      className="nx-co-sheet__header-edit"
                      value={headerDraft}
                      autoFocus
                      aria-label={t('clientOperations.columnName')}
                      onChange={(event) => setHeaderDraft(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={() => void commitCustomHeaderRename(column, headerDraft)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void commitCustomHeaderRename(column, headerDraft);
                        }
                        if (event.key === 'Escape') {
                          setEditingHeaderColumnId(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`nx-co-sheet__header-label${column.label.trim() ? '' : ' is-blank'}`}
                      disabled={!canEdit || !column.custom_column_id}
                      title={canEdit ? t('clientOperations.clickToRenameColumn') : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!canEdit || !column.custom_column_id) return;
                        setEditingHeaderColumnId(column.custom_column_id);
                        setHeaderDraft(column.label.trim());
                      }}
                    >
                      {column.label.trim() || '\u00A0'}
                    </button>
                  )}
                  {canEdit && column.settings_available !== false ? (
                    <button
                      type="button"
                      className="nx-co-sheet__col-gear"
                      aria-label={t('clientOperations.columnSettings')}
                      title={t('clientOperations.columnSettings')}
                      onMouseDown={(event) => {
                        // Keep rename/resize isolated — gear must not steal header rename focus incorrectly.
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openColumnSettings(column);
                      }}
                    >
                      <svg className="nx-co-sheet__col-gear-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path
                          fill="currentColor"
                          d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.77 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.89 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
              ) : column.cell_kind === 'folder' ? (
                <span className="nx-co-sheet__folder-header" title={column.label}>
                  <ClientOperationsFolderIcon />
                  <span className="nx-co-sheet__sr-only">{column.label}</span>
                </span>
              ) : (
                systemColumnHeaderLabel(column, t)
              )}
              <span className="nx-co-sheet__resize-handle" role="separator" aria-label={`${t('clientOperations.resizeColumn')} ${systemColumnHeaderLabel(column, t)}`} onMouseDown={(event) => beginResize(event, column)} />
            </th>
          ))}
        </tr></thead>
        <tbody>
          {!periodContentPending
            ? rows.map((row) => (
            <tr
              key={row.client_id}
              data-client-id={row.client_id}
              className={[
                selectedRowId === row.client_id ? 'is-selected' : '',
                row.reporting?.row_tone ? `is-reporting-row-${row.reporting.row_tone}` : '',
              ].filter(Boolean).join(' ') || undefined}
              title={row.reporting?.row_tone_label_key ? t(row.reporting.row_tone_label_key) : undefined}
              aria-label={row.reporting?.row_tone_label_key ? `${row.client_name ?? row.client_id} — ${t(row.reporting.row_tone_label_key)}` : undefined}
              onClick={() => setSelectedRowId(row.client_id)}
            >
              {visibleColumns.map((column) => {
                const pk = cellKey(row.client_id, column.key);
                const presentation = cellPresentation[pk];
                const focused =
                  Boolean(focusedCell?.clientId) &&
                  focusedCell?.clientId === row.client_id &&
                  focusedCell.colKey === column.key;
                const manualStatus = row.manual_cell_statuses?.[column.key];
                const statusToken = manualStatus?.presentation_token ?? null;
                const reportingCell = row.reporting?.cells?.[column.key];
                const paintBlocked =
                  Boolean(statusPaintMode) &&
                  column.key !== 'folder' &&
                  column.key !== 'client_name' &&
                  Boolean(manualStatus) &&
                  statusPaintMode !== null &&
                  !(
                    statusPaintMode === 'clear'
                      ? manualStatus!.allowed_statuses.includes('clear')
                      : manualStatus!.allowed_statuses.includes(statusPaintMode)
                  );
                return (
                  <td
                    key={column.key}
                    data-col={column.key}
                    data-freeze={column.freeze_default ? 'true' : 'false'}
                    data-format-selected={focused ? 'true' : 'false'}
                    data-testid={focused ? 'co-active-format-cell' : undefined}
                    className={[
                      focused ? 'is-focused is-format-selected' : '',
                      editingCellKey === pk && column.cell_kind === 'custom' ? 'is-editing-custom' : '',
                      statusToken ? `is-manual-status-${statusToken}` : '',
                      statusPaintMode ? 'is-paint-mode' : '',
                      paintBlocked ? 'is-paint-blocked' : '',
                      obligationApplicable(row, column.key) === false ? 'is-not-applicable' : '',
                      filingCellPresentationClass(reportingCell),
                      column.key === 'national_insurance' &&
                      row.national_insurance_operations?.ni_indicator_alert
                        ? 'is-ni-office-reminder'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
                    title={reportingCell ? t(reportingCell.tooltip_key || reportingCell.tone_label_key) : undefined}
                    onMouseDown={(event) => {
                      // Paint mode owns the gesture via capture click — do not turn into format selection.
                      if (statusPaintMode) return;
                      // Resize / gear / native interactive chrome handle their own events.
                      const target = event.target as HTMLElement | null;
                      if (target?.closest('.nx-co-sheet__resize-handle, .nx-co-sheet__col-gear')) return;
                      selectActiveFormatCell(row.client_id, column);
                    }}
                    onClickCapture={(event) => {
                      if (!statusPaintMode) return;
                      if (column.key === 'folder' || column.key === 'client_name') return;
                      // Paint mode owns the gesture — child controls must not toggle/edit.
                      // Do NOT turn paint clicks into formatting selection (paint has priority).
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedRowId(row.client_id);
                      paintCellManualStatus(row, column.key);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (statusPaintMode) return;
                      selectActiveFormatCell(row.client_id, column);
                      if (column.cell_kind === 'custom' && canEdit && column.editable) {
                        beginCustomCellEdit(row, column);
                      }
                    }}
                    style={{
                      textAlign: presentation?.align ?? column.align,
                      whiteSpace: presentation?.wrap ? 'pre-wrap' : undefined,
                      fontWeight: presentation?.bold ? 700 : undefined,
                      fontStyle: presentation?.italic ? 'italic' : undefined,
                      textDecoration: presentation?.underline ? 'underline' : undefined,
                      color: resolveRegistryCellTextColor(presentation?.color),
                      // Apply explicit font-size only when user has chosen one for this cell.
                      fontSize: presentation?.fontSize != null ? `${presentation.fontSize}px` : undefined,
                      // Manual status owns the cell fill while set.
                      background: statusToken ? undefined : presentation?.fill,
                    }}
                  >
                    {column.cell_kind === 'custom'
                      ? canEdit && column.editable
                        ? editingCellKey === pk
                          ? (
                            <input
                              className="nx-co-sheet__custom-cell-input"
                              value={cellDraft}
                              autoFocus
                              aria-label={column.label.trim() || t('clientOperations.columnValue')}
                              onChange={(event) => {
                                const next = event.target.value;
                                setCellDraft(next);
                                scheduleCustomCellAutosave(row, column, next);
                              }}
                              onClick={(event) => event.stopPropagation()}
                              onBlur={() => void commitCustomCellEdit(row, column, cellDraft)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void commitCustomCellEdit(row, column, cellDraft);
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelCustomCellEdit(row, column);
                                }
                              }}
                            />
                          )
                          : (
                            <span
                              className={`nx-co-sheet__custom-cell${displayCustomColumnValue(row, column) ? '' : ' is-blank'}`}
                            >
                              {formatPresentationValue(
                                displayCustomColumnValue(row, column),
                                column,
                                presentation,
                              )}
                            </span>
                          )
                        : (
                          formatPresentationValue(
                            displayCustomColumnValue(row, column),
                            column,
                            presentation,
                          )
                        )
                      : renderCellContent(row, column)}
                  </td>
                );
              })}
            </tr>
          ))
            : null}
          {!periodContentPending
            ? manualRows.map((row) => (
            <tr
              key={row.row_key}
              data-row-kind="manual"
              data-testid={`co-manual-row-${row.manual_row_slot}`}
              className={selectedRowId === row.row_key ? 'is-selected' : undefined}
              onClick={() => setSelectedRowId(row.row_key)}
            >
              {visibleColumns.map((column) => {
                const pk = cellKey(row.row_key, column.key);
                const viewedPeriodForOverlay =
                  query?.operational_period_key ?? period?.selected_period_key ?? '';
                const overlayPk = manualDraftOverlayKey(
                  viewedPeriodForOverlay,
                  row.row_key,
                  column.key,
                );
                const presentation = cellPresentation[pk];
                const focused =
                  Boolean(focusedCell?.rowKey) &&
                  focusedCell?.rowKey === row.row_key &&
                  focusedCell.colKey === column.key;
                const cellPres = row.cell_presentation?.[column.key];
                const isFolderCell = cellPres?.cell_kind === 'folder';
                const isManualText = cellPres?.cell_kind === 'manual_text';
                const canEditManual = Boolean(canEdit && isManualText && cellPres?.editable);
                const overlayDraft = manualDraftOverlay[overlayPk];
                const displayValue = isFolderCell
                  ? ''
                  : overlayDraft != null
                    ? overlayDraft
                    : formatCustomExcelCellDisplay(row.cells?.[column.key]);
                return (
                  <td
                    key={column.key}
                    data-col={column.key}
                    data-row-kind="manual"
                    data-cell-kind={cellPres?.cell_kind ?? undefined}
                    data-freeze={column.freeze_default ? 'true' : 'false'}
                    data-format-selected={focused ? 'true' : 'false'}
                    data-testid={focused ? 'co-active-format-cell' : undefined}
                    className={[
                      focused ? 'is-focused is-format-selected' : '',
                      editingCellKey === pk && isManualText ? 'is-editing-custom is-editing-manual' : '',
                      statusPaintMode ? 'is-paint-mode' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
                    onMouseDown={(event) => {
                      if (statusPaintMode) return;
                      const target = event.target as HTMLElement | null;
                      if (target?.closest('.nx-co-sheet__resize-handle, .nx-co-sheet__col-gear')) return;
                      if (isFolderCell) return;
                      selectActiveFormatCell(row.row_key, column, { rowKey: row.row_key });
                    }}
                    onClickCapture={(event) => {
                      // Manual rows are NOT eligible for status paint (no fabricated client_id).
                      if (!statusPaintMode) return;
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (statusPaintMode) return;
                      if (isFolderCell) return;
                      selectActiveFormatCell(row.row_key, column, { rowKey: row.row_key });
                      if (canEditManual) beginManualRowCellEdit(row, column);
                    }}
                    style={{
                      textAlign: presentation?.align ?? column.align,
                      whiteSpace: presentation?.wrap ? 'pre-wrap' : undefined,
                      fontWeight: presentation?.bold ? 700 : undefined,
                      fontStyle: presentation?.italic ? 'italic' : undefined,
                      textDecoration: presentation?.underline ? 'underline' : undefined,
                      color: resolveRegistryCellTextColor(presentation?.color),
                      fontSize: presentation?.fontSize != null ? `${presentation.fontSize}px` : undefined,
                      background: presentation?.fill,
                    }}
                  >
                    {isFolderCell ? null : canEditManual ? (
                      editingCellKey === pk ? (
                        <input
                          className="nx-co-sheet__custom-cell-input nx-co-sheet__manual-cell-input"
                          value={cellDraft}
                          autoFocus
                          aria-label={column.label.trim() || t('clientOperations.manualValue')}
                          data-testid={`co-manual-cell-input-${row.manual_row_slot}-${column.key}`}
                          onChange={(event) => {
                            const next = event.target.value;
                            setCellDraft(next);
                            scheduleManualRowCellAutosave(row, column, next);
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={() => void commitManualRowCellEdit(row, column, cellDraft)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              // Optional navigation finish — persistence already started on each keystroke.
                              void commitManualRowCellEdit(row, column, cellDraft);
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelManualRowCellEdit(row, column);
                            }
                          }}
                        />
                      ) : (
                        <span className={`nx-co-sheet__custom-cell${displayValue ? '' : ' is-blank'}`}>
                          {formatPresentationValue(displayValue, column, presentation)}
                        </span>
                      )
                    ) : (
                      formatPresentationValue(displayValue, column, presentation)
                    )}
                  </td>
                );
              })}
            </tr>
          ))
            : null}
          {Array.from({ length: sheetFillerRowCount }, (_, i) => (
            <tr key={`filler-${i}`} data-row-kind="filler" aria-hidden="true" className="nx-co-sheet__filler-row">
              {visibleColumns.map((column) => (
                <td key={column.key} data-col={column.key} data-row-kind="filler" data-freeze={column.freeze_default ? 'true' : 'false'}>
                  {'\u00a0'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {periodContentPending ? (
        <div
          className="nx-co-sheet__period-pending"
          data-testid="client-operations-period-pending"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="nx-co-sheet__period-pending-line" />
          <div className="nx-co-sheet__period-pending-line" />
          <div className="nx-co-sheet__period-pending-line" />
          <p className="nx-co-sheet__period-pending-label">{t('clientOperations.loadingPeriod')}</p>
        </div>
      ) : null}
    </div>
  );

  const modals = (
    <>
      {paymentModal ? (
        <div className="nx-clients-overlay nx-client-create nx-client-create--deep-ocean-glass">
          <div
            className="nx-glass-card nx-clients-modal nx-co-payment-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nx-co-payment-title"
            dir={lang === 'he' ? 'rtl' : 'ltr'}
            data-testid="client-operations-payment-modal"
          >
            <div className="nx-clients-modal__head">
              <h3 id="nx-co-payment-title">{t(paymentModal.titleKey)}</h3>
              <button
                type="button"
                onClick={() => setPaymentModal(null)}
                className="nx-clients-modal__close"
                aria-label={t(paymentModal.cancelKey)}
              >
                ×
              </button>
            </div>
            <form
              className="nx-clients-form"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmReportingPaymentModal();
              }}
              noValidate
            >
              <div className="nx-clients-form__body">
                <fieldset className="nx-co-payment-confirm-options">
                  <legend className="nx-clients-form__label-line">{t(paymentModal.titleKey)}</legend>
                  {paymentModal.options.map((option) => (
                    <label key={option.id} className="nx-co-payment-confirm-option">
                      <input
                        type="radio"
                        name="nx-co-payment-classification"
                        value={option.id}
                        checked={paymentModal.selected === option.id}
                        onChange={() => setPaymentModal((current) => (current ? { ...current, selected: option.id } : current))}
                      />
                      <span>{t(option.label_key)}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
              <div className="nx-clients-form__footer">
                <button
                  type="submit"
                  className="nx-glass-btn nx-glass-btn--purple"
                  disabled={!paymentModal.selected}
                >
                  {t(paymentModal.confirmKey)}
                </button>
                <button
                  type="button"
                  className="nx-glass-btn nx-glass-btn--secondary"
                  onClick={() => setPaymentModal(null)}
                >
                  {t(paymentModal.cancelKey)}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {niEvidencePrompt ? (() => {
        const liveRow = rows.find((row) => row.client_id === niEvidencePrompt.clientId);
        const attachment = liveRow?.reporting?.cells?.national_insurance_deductions?.evidence_attachment;
        if (!attachment) return null;
        return (
          <div className="nx-clients-overlay nx-co-ni-overlay">
            <div
              className="nx-glass-card nx-clients-modal nx-co-ops-modal nx-co-ni-modal nx-co-filing-modal"
              role="dialog"
              aria-modal="true"
              dir={lang === 'he' ? 'rtl' : 'ltr'}
            >
              <div className="nx-clients-modal__head">
                <h3>{t(attachment.filing_label_key)}</h3>
                <button type="button" className="nx-clients-modal__close" disabled={evidencePending} onClick={() => setNiEvidencePrompt(null)} aria-label={t('clientOperations.registry.reporting.filing.cancel')}>×</button>
              </div>
              <div className="nx-clients-form__body nx-co-ni-modal__body">
                <p className="nx-co-filing-modal__notice">
                  {fillI18n(t(attachment.notice_key), {
                    filing: t(attachment.filing_label_key),
                    period: attachment.period_display || attachment.period_key,
                  })}
                </p>
                <div className="nx-co-filing-modal__evidence-row">
                  <button type="button" className="nx-co-filing-modal__clip" aria-label={t('clientOperations.registry.reporting.filing.attach')} disabled={evidencePending} onClick={() => niEvidenceInputRef.current?.click()}>
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                      <path fill="currentColor" d="M16.5 6.5v9.2a4.5 4.5 0 1 1-9 0V6.8a3 3 0 0 1 6 0v8.2a1.5 1.5 0 0 1-3 0V7.2h-1.5v7.8a3 3 0 0 0 6 0V6.8a4.5 4.5 0 0 0-9 0v8.9a6 6 0 0 0 12 0V6.5h-1.5Z" />
                    </svg>
                  </button>
                  <label className="nx-co-filing-modal__kind">
                    <input type="radio" name="ni-evidence-kind" checked={filingEvidenceKind === 'filing'} disabled={evidencePending} onChange={() => setFilingEvidenceKind('filing')} />
                    {t('clientOperations.registry.reporting.filing.evidenceFiling')}
                  </label>
                  <label className="nx-co-filing-modal__kind">
                    <input type="radio" name="ni-evidence-kind" checked={filingEvidenceKind === 'payment'} disabled={evidencePending} onChange={() => setFilingEvidenceKind('payment')} />
                    {t('clientOperations.registry.reporting.filing.evidencePayment')}
                  </label>
                  <input
                    ref={niEvidenceInputRef}
                    type="file"
                    multiple
                    hidden
                    disabled={evidencePending}
                    onChange={(event) => {
                      if (evidenceLockRef.current) {
                        event.target.value = '';
                        return;
                      }
                      void attachNiEvidence(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </div>
                {evidencePending ? (
                  <p className="nx-co-filing-modal__notice" role="status">{t('clientOperations.registry.reporting.filing.uploading')}</p>
                ) : null}
                {evidenceFeedback ? (
                  <p className={`nx-co-filing-modal__notice is-${evidenceFeedback.tone}`} role={evidenceFeedback.tone === 'err' ? 'alert' : 'status'}>
                    {evidenceFeedback.text}
                  </p>
                ) : null}
                {attachment.evidence.length ? (
                  <ul className="nx-co-filing-modal__files">
                    {attachment.evidence.map((item) => (
                      <li key={item.document_id}>{item.file_name || item.document_id}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        );
      })() : null}
      {filingModal ? (() => {
        const liveRow = rows.find((row) => row.client_id === filingModal.row.client_id) ?? filingModal.row;
        const reportingCell = liveRow.reporting?.cells?.[filingModal.columnKey];
        const detail = reportingCell?.filing_detail;
        if (!detail) return null;
        const frequencyText = displayForColumn(
          liveRow,
          { key: filingModal.columnKey, label: '', cell_kind: 'text', value_field: null, visible: true, system: true, editable: false, freeze_default: false, align: 'center' },
          t,
        );
        const canAct = Boolean(canEdit && onRegistryCommand && reportingCell?.obligation_id && !filingActionPending && !evidencePending);
        return (
          <div className="nx-clients-overlay nx-co-ni-overlay">
            <div
              className="nx-glass-card nx-clients-modal nx-co-ops-modal nx-co-ni-modal nx-co-filing-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="nx-co-filing-title"
              dir={lang === 'he' ? 'rtl' : 'ltr'}
              data-testid="client-operations-filing-modal"
              aria-busy={filingActionPending || evidencePending}
            >
              <div className="nx-clients-modal__head">
                <h3 id="nx-co-filing-title">{t(detail.title_key)}</h3>
                <button
                  type="button"
                  onClick={() => setFilingModal(null)}
                  className="nx-clients-modal__close"
                  aria-label={t(detail.cancel_key)}
                  disabled={filingActionPending || evidencePending}
                >
                  ×
                </button>
              </div>
              <form
                className="nx-clients-form"
                onSubmit={(event) => event.preventDefault()}
                noValidate
              >
                <div className="nx-clients-form__body nx-co-ni-modal__body">
                  <div className="nx-co-ni-modal__grid">
                  <section className="nx-co-ni-modal__col" aria-labelledby="nx-co-filing-details">
                  <h4 id="nx-co-filing-details" className="nx-co-ni-modal__col-title">
                    {t('clientOperations.registry.reporting.filing.detailsTitle')}
                  </h4>
                  <dl className="nx-co-ni-modal__facts">
                    <div className="nx-co-ni-modal__row">
                      <dt>{t(detail.client_key)}</dt>
                      <dd>{liveRow.client_name ?? liveRow.client_id}</dd>
                    </div>
                    <div className="nx-co-ni-modal__row">
                      <dt>{t(detail.period_label_key)}</dt>
                      <dd>{detail.period_display || detail.period_key}</dd>
                    </div>
                    <div className="nx-co-ni-modal__row">
                      <dt>{t(detail.frequency_key)}</dt>
                      <dd>{frequencyText}</dd>
                    </div>
                    <div className="nx-co-ni-modal__row">
                      <dt>{t(detail.status_key)}</dt>
                      <dd>{t(detail.filing_status_key)}</dd>
                    </div>
                    <div className="nx-co-ni-modal__row">
                      <dt>{t(detail.filed_on_key)}</dt>
                      <dd>{detail.filed_on_display || t(detail.not_recorded_key)}</dd>
                    </div>
                    {detail.submission_reference ? (
                      <div className="nx-co-ni-modal__row">
                        <dt>{t(detail.reference_key)}</dt>
                        <dd>{detail.submission_reference}</dd>
                      </div>
                    ) : null}
                    {detail.can_record_payment ? (
                      <div className="nx-co-ni-modal__row">
                        <dt>{t(detail.payment_status_key)}</dt>
                        <dd>{t(reportingPaymentStateLabelKey(detail.payment_state))}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {detail.material_warning_key ? (
                    <p className="nx-co-filing-modal__notice" role="status">{t(detail.material_warning_key)}</p>
                  ) : null}
                  </section>
                  <section className="nx-co-ni-modal__col" aria-labelledby="nx-co-filing-actions">
                  <h4 id="nx-co-filing-actions" className="nx-co-ni-modal__col-title">
                    {t('clientOperations.registry.reporting.filing.actionsTitle')}
                  </h4>
                  <div className="nx-co-filing-modal__evidence">
                    <p className="nx-co-filing-modal__notice">
                      {fillI18n(t(detail.attachment_notice_key ?? 'clientOperations.registry.reporting.filing.attachmentNotice'), {
                        filing: t(detail.title_key),
                        period: detail.period_display || detail.period_key,
                      })}
                    </p>
                    <div className="nx-co-filing-modal__evidence-row">
                      <button
                        type="button"
                        className="nx-co-filing-modal__clip"
                        aria-label={t('clientOperations.registry.reporting.filing.attach')}
                        disabled={!canAct}
                        onClick={() => filingEvidenceInputRef.current?.click()}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path fill="currentColor" d="M16.5 6.5v9.2a4.5 4.5 0 1 1-9 0V6.8a3 3 0 0 1 6 0v8.2a1.5 1.5 0 0 1-3 0V7.2h-1.5v7.8a3 3 0 0 0 6 0V6.8a4.5 4.5 0 0 0-9 0v8.9a6 6 0 0 0 12 0V6.5h-1.5Z" />
                        </svg>
                      </button>
                      <label className="nx-co-filing-modal__kind">
                        <input type="radio" name="filing-evidence-kind" checked={filingEvidenceKind === 'filing'} disabled={evidencePending || filingActionPending} onChange={() => setFilingEvidenceKind('filing')} />
                        {t('clientOperations.registry.reporting.filing.evidenceFiling')}
                      </label>
                      <label className="nx-co-filing-modal__kind">
                        <input type="radio" name="filing-evidence-kind" checked={filingEvidenceKind === 'payment'} disabled={evidencePending || filingActionPending} onChange={() => setFilingEvidenceKind('payment')} />
                        {t('clientOperations.registry.reporting.filing.evidencePayment')}
                      </label>
                      <input
                        ref={filingEvidenceInputRef}
                        type="file"
                        multiple
                        hidden
                        disabled={evidencePending || filingActionPending}
                        onChange={(event) => {
                          if (evidenceLockRef.current || filingActionLockRef.current) {
                            event.target.value = '';
                            return;
                          }
                          void attachFilingEvidence(event.target.files);
                          event.target.value = '';
                        }}
                      />
                    </div>
                    {evidencePending ? (
                      <p className="nx-co-filing-modal__notice" role="status">{t('clientOperations.registry.reporting.filing.uploading')}</p>
                    ) : null}
                    {evidenceFeedback ? (
                      <p className={`nx-co-filing-modal__notice is-${evidenceFeedback.tone}`} role={evidenceFeedback.tone === 'err' ? 'alert' : 'status'}>
                        {evidenceFeedback.text}
                      </p>
                    ) : null}
                    {(detail.evidence ?? []).length ? (
                      <ul className="nx-co-filing-modal__files">
                        {(detail.evidence ?? []).map((item) => (
                          <li key={item.document_id}>
                            {item.file_name || item.document_id}
                            {' · '}
                            {t(item.evidence_kind === 'payment'
                              ? 'clientOperations.registry.reporting.filing.evidencePayment'
                              : 'clientOperations.registry.reporting.filing.evidenceFiling')}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  </section>
                  </div>
                </div>
                {filingActionPending || filingFeedback ? (
                  <div
                    className={`nx-co-filing-modal__result is-${filingActionPending ? 'pending' : filingFeedback?.tone}`}
                    role={filingFeedback?.tone === 'err' ? 'alert' : 'status'}
                    aria-live="polite"
                    data-testid="client-operations-filing-result"
                  >
                    <span className="nx-co-filing-modal__result-icon" aria-hidden="true">
                      {filingActionPending ? '…' : filingFeedback?.tone === 'ok' ? '✓' : '!'}
                    </span>
                    <span>
                      {filingActionPending
                        ? t('clientOperations.registry.reporting.filing.saving')
                        : filingFeedback?.text}
                    </span>
                  </div>
                ) : null}
                <div className="nx-clients-form__footer nx-co-ni-modal__footer nx-co-ops-modal__actions">
                  <button
                    type="button"
                    className="nx-glass-btn nx-glass-btn--secondary"
                    data-testid="client-operations-filing-report"
                    disabled={!canAct || !detail.can_report}
                    onClick={() => void runFilingAction('report')}
                  >
                    {t(detail.report_key)}
                  </button>
                  <button
                    type="button"
                    className="nx-glass-btn nx-glass-btn--secondary"
                    data-testid="client-operations-filing-report-paid"
                    disabled={!canAct || !detail.can_report_and_pay}
                    onClick={() => void runFilingAction('report_and_pay')}
                  >
                    {t(detail.report_and_paid_key)}
                  </button>
                  <button
                    type="button"
                    className="nx-glass-btn nx-glass-btn--purple"
                    data-testid="client-operations-filing-paid"
                    disabled={!canAct || !detail.can_mark_paid}
                    onClick={() => void runFilingAction('paid')}
                  >
                    {t(detail.paid_key)}
                  </button>
                  <button
                    type="button"
                    className="nx-glass-btn nx-glass-btn--secondary"
                    disabled={filingActionPending || evidencePending}
                    onClick={() => setFilingModal(null)}
                  >
                    {t(detail.cancel_key)}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })() : null}
      {niModal?.row.national_insurance_operations ? (() => {
        const ops = niModal.row.national_insurance_operations;
        if (!ops) return null;
        const amount = niModal.row.cells?.national_insurance || niModal.row.national_insurance_status || '—';
        const selectedMethod = niModal.handlingMethod;
        const methodChanged = selectedMethod !== ops.handling_method;
        const persistInherited =
          ops.handling_method_source === 'inherited' ||
          ops.handling_method_source === 'standing_until' ||
          ops.january_confirmation_required;
        const resolve = Boolean(
          selectedMethod === 'manual_monthly' &&
            niModal.confirmMonthHandled &&
            ops.can_confirm_month_handled,
        );
        const canSave = Boolean(
          canEdit &&
            onRegistryCommand &&
            ops.can_set_handling_method &&
            selectedMethod &&
            (methodChanged || persistInherited || resolve),
        );
        const monthHandledChecked = Boolean(ops.action_resolved || niModal.confirmMonthHandled);
        return (
          <div className="nx-clients-overlay nx-co-ni-overlay">
            <div
              className="nx-glass-card nx-clients-modal nx-co-ops-modal nx-co-ni-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="nx-co-ni-title"
              dir={lang === 'he' ? 'rtl' : 'ltr'}
              data-testid="client-operations-ni-modal"
            >
              <div className="nx-clients-modal__head">
                <h3 id="nx-co-ni-title">{t(ops.title_key)}</h3>
                <button
                  type="button"
                  onClick={() => setNiModal(null)}
                  className="nx-clients-modal__close"
                  aria-label={t(ops.cancel_key)}
                >
                  ×
                </button>
              </div>
              <form
                className="nx-clients-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmSelfEmployedNiModal();
                }}
                noValidate
              >
                <div className="nx-clients-form__body nx-co-ni-modal__body">
                  <div className="nx-co-ni-modal__grid">
                    <section className="nx-co-ni-modal__col" aria-labelledby="nx-co-ni-client-col">
                      <h4 id="nx-co-ni-client-col" className="nx-co-ni-modal__col-title">
                        {t(ops.client_details_key)}
                      </h4>
                      <dl className="nx-co-ni-modal__facts">
                        <div className="nx-co-ni-modal__row">
                          <dt>{t(ops.client_key)}</dt>
                          <dd>{niModal.row.client_name ?? niModal.row.client_id}</dd>
                        </div>
                        <div className="nx-co-ni-modal__row">
                          <dt>{t(ops.amount_key)}</dt>
                          <dd>{amount}</dd>
                        </div>
                        <div className="nx-co-ni-modal__row">
                          <dt>{t(ops.month_key)}</dt>
                          <dd>{ops.period_display || ops.period_key}</dd>
                        </div>
                        <div className="nx-co-ni-modal__row">
                          <dt>{t(ops.resolution_key)}</dt>
                          <dd>{t(ops.action_status_key)}</dd>
                        </div>
                      </dl>
                    </section>
                    <fieldset className="nx-co-ni-modal__col" aria-labelledby="nx-co-ni-handling-col">
                      <h4 id="nx-co-ni-handling-col" className="nx-co-ni-modal__col-title">
                        {t(ops.handling_title_key)}
                      </h4>
                      <div className="nx-co-ni-modal__options">
                      {ops.handling_options.map((option) => (
                        <label
                          key={option.id}
                          className={`nx-co-ni-modal__option${selectedMethod === option.id ? ' is-selected' : ''}`}
                          data-testid={`client-operations-ni-handling-${option.id}`}
                        >
                          <input
                            type="radio"
                            name="nx-co-ni-handling"
                            value={option.id}
                            checked={selectedMethod === option.id}
                            disabled={!canEdit || !ops.can_set_handling_method}
                            onChange={() =>
                              setNiModal((current) =>
                                current
                                  ? {
                                      ...current,
                                      handlingMethod: option.id,
                                      confirmMonthHandled:
                                        option.id === 'manual_monthly' ? current.confirmMonthHandled : false,
                                    }
                                  : current,
                              )
                            }
                          />
                          <span>{t(option.label_key)}</span>
                        </label>
                      ))}
                      {selectedMethod === 'manual_monthly' ? (
                        <label
                          className="nx-co-ni-modal__month-action"
                          data-testid="client-operations-ni-month-handled"
                        >
                          <input
                            type="checkbox"
                            checked={monthHandledChecked}
                            disabled={!canEdit || ops.action_resolved}
                            onChange={(event) =>
                              setNiModal((current) =>
                                current ? { ...current, confirmMonthHandled: event.target.checked } : current,
                              )
                            }
                          />
                          <span>{t(ops.month_handled_key)}</span>
                        </label>
                      ) : null}
                      </div>
                    </fieldset>
                  </div>
                </div>
                <div className="nx-clients-form__footer nx-co-ni-modal__footer">
                  <button
                    type="submit"
                    className="nx-glass-btn nx-glass-btn--purple"
                    disabled={!canSave}
                  >
                    {t(ops.save_key)}
                  </button>
                  <button
                    type="button"
                    className="nx-glass-btn nx-glass-btn--secondary"
                    onClick={() => setNiModal(null)}
                  >
                    {t(ops.cancel_key)}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })() : null}
      {showCreateClient && canCreateCoreClient ? (
        <div className="nx-clients-overlay nx-client-create nx-client-create--deep-ocean-glass">
          <div
            className="nx-glass-card nx-clients-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nx-co-create-title"
            dir={lang === 'he' ? 'rtl' : 'ltr'}
          >
            <div className="nx-clients-modal__head">
              <h3 id="nx-co-create-title">{t('clients.create.title')}</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateClient(false);
                  resetCreateClientForm();
                }}
                className="nx-clients-modal__close"
                aria-label={t('common.cancel')}
              >
                ×
              </button>
            </div>
            <form onSubmit={submitCreateCoreClient} className="nx-clients-form" noValidate>
              <div className="nx-clients-form__body">
                {createError ? (
                  <div className="nx-client-create__span nx-glass-alert nx-glass-alert--error" role="alert">
                    {createError}
                  </div>
                ) : null}
                <label>
                  <span className="nx-clients-form__label-line">
                    {t('clients.create.taxId')} <AccountRequiredMark />
                  </span>
                  <input
                    ref={createTaxIdRef}
                    type="text"
                    value={createTaxId}
                    onChange={(ev) => {
                      setCreateTaxId(ev.target.value);
                      if (createInvalidField === 'tax_id') setCreateInvalidField(null);
                    }}
                    required
                    aria-invalid={createInvalidField === 'tax_id'}
                    className={`nx-glass-input nx-ltr${createInvalidField === 'tax_id' ? ' is-invalid' : ''}`}
                  />
                </label>
                <label>
                  <span className="nx-clients-form__label-line">
                    {t('clients.create.displayName')} <AccountRequiredMark />
                  </span>
                  <input
                    ref={createNameRef}
                    type="text"
                    value={createName}
                    onChange={(ev) => {
                      setCreateName(ev.target.value);
                      if (createInvalidField === 'display_name') setCreateInvalidField(null);
                    }}
                    required
                    aria-invalid={createInvalidField === 'display_name'}
                    className={`nx-glass-input${createInvalidField === 'display_name' ? ' is-invalid' : ''}`}
                  />
                </label>
                <label>
                  {t('clients.create.type')}
                  <select
                    ref={createTypeRef}
                    value={createType}
                    onChange={(ev) => setCreateType(ev.target.value)}
                    aria-invalid={createInvalidField === 'client_type'}
                    className={`nx-glass-input${createInvalidField === 'client_type' ? ' is-invalid' : ''}`}
                  >
                    <option value="business_customer">{t('clients.type.business_customer')}</option>
                    <option value="individual_customer">{t('clients.type.individual_customer')}</option>
                    <option value="supplier">{t('clients.type.supplier')}</option>
                    <option value="partner">{t('clients.type.partner')}</option>
                    <option value="other">{t('clients.type.other')}</option>
                  </select>
                </label>
                <label>
                  {t('clients.contact.website')}
                  <input type="url" value={createWebsite} onChange={(ev) => setCreateWebsite(ev.target.value)} placeholder="https://" className="nx-glass-input nx-ltr" />
                </label>
                <h4 className="nx-client-create__span">
                  {t('clients.contact.section')}{' '}
                  <AccountRequiredMark />
                  <span className="nx-clients-required-caption"> {t('clients.contact.orRequired')}</span>
                </h4>
                <label>
                  {t('clients.details.phone')}
                  <input
                    ref={createPhoneRef}
                    type="text"
                    value={createPhone}
                    onChange={(ev) => {
                      setCreatePhone(ev.target.value);
                      if (createInvalidField === 'contact') setCreateInvalidField(null);
                    }}
                    placeholder={t('clients.contact.phonePlaceholder')}
                    aria-invalid={createInvalidField === 'contact'}
                    className={`nx-glass-input nx-ltr${createInvalidField === 'contact' ? ' is-invalid' : ''}`}
                  />
                </label>
                <label>
                  {t('clients.details.email')}
                  <input
                    ref={createEmailRef}
                    type="email"
                    value={createEmail}
                    onChange={(ev) => {
                      setCreateEmail(ev.target.value);
                      if (createInvalidField === 'contact') setCreateInvalidField(null);
                    }}
                    placeholder={t('clients.contact.emailPlaceholder')}
                    aria-invalid={createInvalidField === 'contact'}
                    className={`nx-glass-input nx-ltr${createInvalidField === 'contact' ? ' is-invalid' : ''}`}
                  />
                </label>
                <h4 className="nx-client-create__span">{t('clients.address.section')}</h4>
                <label>
                  {t('clients.address.country')}
                  <input type="text" value={createCountry} onChange={(ev) => setCreateCountry(ev.target.value)} placeholder="IL" maxLength={2} className="nx-glass-input nx-ltr" />
                </label>
                <label>
                  {t('clients.address.city')}
                  <input type="text" value={createCity} onChange={(ev) => setCreateCity(ev.target.value)} className="nx-glass-input" />
                </label>
                <label>
                  {t('clients.address.street')}
                  <input type="text" value={createStreet} onChange={(ev) => setCreateStreet(ev.target.value)} className="nx-glass-input" />
                </label>
                <label>
                  {t('clients.address.postalCode')}
                  <input type="text" value={createPostalCode} onChange={(ev) => setCreatePostalCode(ev.target.value)} className="nx-glass-input" />
                </label>
              </div>
              <div className="nx-clients-form__footer">
                <button type="submit" disabled={createSubmitting} className="nx-glass-btn nx-glass-btn--purple">
                  {createSubmitting ? t('common.loading') : t('common.create')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateClient(false);
                    resetCreateClientForm();
                  }}
                  className="nx-glass-btn nx-glass-btn--secondary"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modalOpen && (
        <ClientWorkspaceModal
          open={modalOpen}
          workspace={modalData}
          loading={modalLoading}
          error={modalError}
          onClose={() => setModalOpen(false)}
          onClientProfileSaved={reloadRegistry}
          onTaxSettingsSaved={reloadRegistry}
        />
      )}

      {quickProfileAnchor ? (
        <ClientOperationsClientQuickProfilePopover
          profile={quickProfile}
          anchorEl={quickProfileAnchor}
          loading={quickProfileLoading || quickProfile?.client_id !== quickProfileClientId}
          onClose={closeQuickProfile}
        />
      ) : null}

      {notesModalClientId && (
        <ClientNoteModal
          open
          clientName={notesModalClientName || t('clientOperations.client')}
          noteType={formTypeCode}
          noteText={formBody}
          reminderAt={formReminderLocal}
          onClose={closeNotesModal}
          onSave={() => runSave(false)}
          onTypeChange={(value) => {
            setFormTypeCode(value);
            const t = noteTypes.find((x) => x.code === value);
            if (!t?.allows_reminder) setFormReminderLocal('');
          }}
          onTextChange={setFormBody}
          onReminderAtChange={setFormReminderLocal}
        >
          {notesLoading ? (
            <div className="nx-empty-note">{t('clientOperations.loading')}</div>
          ) : (
            <>
              {notesError && <div className="nx-alert-error">{notesError}</div>}

              {operationalNotes.length === 0 ? (
                <div className="nx-empty-note">{t('clientOperations.noNotesYet')}</div>
              ) : (
                <div className="nx-modal-notes-list">
                  {operationalNotes.map((n) => (
                    <div key={n.id} className="nx-note-card">
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
                        <div className="nx-note-card-meta">
                          {operationalNoteTypeLabel(t, n.type_code, n.type_label_he)}
                          {n.reminder_at
                            ? ` · ${new Date(n.reminder_at).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}`
                            : ''}
                        </div>
                        <div className="nx-note-card-body">{n.body}</div>
                      </div>
                      {canEdit && (
                        <div className="nx-note-card-actions">
                          <button
                            type="button"
                            className="nx-btn nx-btn-ghost"
                            onClick={() => startEditNote(n)}
                          >
                            {t('clientOperations.edit')}
                          </button>
                          <button
                            type="button"
                            className="nx-btn nx-btn-ghost"
                            style={{ color: '#2563eb' }}
                            onClick={() => deleteNote(n.id)}
                          >
                            {t('clientOperations.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {conflict && (
                <div className="nx-conflict-panel">
                  <h3>{localizeSystemLabel(t, conflict.ui.title_key ?? 'clientOperations.notes.conflictTitle', conflict.ui.title_he)}</h3>
                  <p>{localizeSystemLabel(t, conflict.ui.message_key ?? 'clientOperations.notes.conflictMessage', conflict.ui.message_he)}</p>
                  <ul>
                    {conflict.conflicts.map((c, i) => (
                      <li key={i}>
                        <strong>{c.client_display_name ?? t('clientOperations.client')}</strong> —{' '}
                        {operationalNoteTypeLabel(t, c.type_code ?? '', c.type_label_he)}:{' '}
                        {c.body_preview}
                      </li>
                    ))}
                  </ul>
                  <div className="nx-modal-footer" style={{ paddingTop: 0 }}>
                    <button type="button" className="nx-btn nx-btn-primary" onClick={() => runSave(true)}>
                      {localizeSystemLabel(
                        t,
                        conflict.ui.button_create_anyway_key ?? 'clientOperations.notes.createAnyway',
                        conflict.ui.button_create_anyway_he,
                      )}
                    </button>
                    <button type="button" className="nx-btn nx-btn-secondary" onClick={() => setConflict(null)}>
                      {localizeSystemLabel(
                        t,
                        conflict.ui.button_change_time_key ?? 'clientOperations.notes.changeTime',
                        conflict.ui.button_change_time_he,
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </ClientNoteModal>
      )}
    </>
  );

  if (isSpreadsheet) {
    const workspaceSelectorOptions = workspace?.selector_options ?? workspace?.allowed_scopes ?? [];
    const workspaceSelectorVisible =
      Boolean(workspace?.selector_visible) && workspaceSelectorOptions.length > 0;
    const workspaceSelectValue = workspace
      ? encodeClientOperationsWorkspaceOptionValue({
          scope_kind: workspace.scope_kind,
          subject_user_id: workspace.workspace_subject_user_id,
        })
      : 'OFFICE';
    const workspaceSelector = workspaceSelectorVisible ? (
      <div className="nx-co-app-header__workspace" data-testid="client-operations-workspace-selector">
        <label className="nx-co-sheet__sr-only" htmlFor="client-operations-workspace-select">
          {t('clientOperations.workspace')}
        </label>
        <select
          id="client-operations-workspace-select"
          className="nx-co-app-header__workspace-select"
          value={workspaceSelectValue}
          disabled={loading || !onWorkspaceChange}
          onChange={(event) => onWorkspaceChange?.(event.target.value)}
          aria-label={t('clientOperations.workspace')}
        >
          {workspaceSelectorOptions.map((opt) => {
            const value = encodeClientOperationsWorkspaceOptionValue({
              scope_kind: opt.scope_kind,
              subject_user_id: opt.subject_user_id,
            });
            return (
              <option key={value} value={value}>
                {localizeSystemLabel(t, opt.label_key, opt.label_he)}
              </option>
            );
          })}
        </select>
      </div>
    ) : null;

    const headerEndCluster = (
      <div className="nx-co-app-header__end-cluster">
        <button
          type="button"
          className="nx-co-app-header__todo-btn"
          data-testid="client-operations-todo-list-button"
          onClick={() => setTodoBoardOpen(true)}
        >
          {t('clientOperations.todo.list')}
        </button>
        {workspaceSelector}
      </div>
    );

    return (
      <div
        className="nx-co-registry"
        data-testid="client-operations-spreadsheet"
        data-fullscreen={fullscreenOpen ? 'true' : 'false'}
      >
        {headerWorkspaceSlot
          ? createPortal(headerEndCluster, headerWorkspaceSlot)
          : headerEndCluster}
        {headerSearchSlot && !fullscreenOpen
          ? createPortal(renderReportingKpis(), headerSearchSlot)
          : null}
        <div className={`nx-co-sheet${fullscreenOpen ? ' nx-co-sheet--app-fullscreen' : ''}`}>
        {/* Inner sheet title removed — module title renders once in the route header. */}
        {headerSearchSlot && !fullscreenOpen ? null : renderReportingKpis()}
        {renderRegistrySort()}
        {renderSpreadsheetToolbar()}
        {renderFilterBar()}
        {error ? <div className="nx-co-sheet__error">{error}</div> : null}
        {commandError ? (
          <div
            className="nx-co-sheet__command-notice"
            role="status"
            aria-live="polite"
            data-testid="client-operations-command-notice"
          >
            {commandError}
          </div>
        ) : null}
        <div
          className={`nx-co-sheet__workspace${loading || periodContentPending ? ' is-loading' : ''}${
            periodContentPending ? ' is-period-pending' : ''
          }`}
        >
          {loading ? <p className="nx-co-sheet__loading nx-co-sheet__loading--inline">{t('clientOperations.loadingPeriod')}</p> : null}
          {renderSpreadsheetTable()}
        <ClientOperationsPeriodSheetTabs
          availablePeriods={period?.available_periods ?? []}
          selectedPeriodKey={period?.selected_period_key ?? query?.operational_period_key ?? null}
          defaultPeriodKey={period?.default_period_key ?? null}
          disabled={loading}
          onSelectPeriod={(key) => flushDirtyBeforePeriodChange(key)}
          trailing={renderPreviousPeriods()}
        />
        </div>
        {periodCopyFeedback ? (
          <div className="nx-co-sheet__copy-feedback" role="status" aria-live="polite">
            {periodCopyFeedback}
          </div>
        ) : null}
        {periodCopySourceOpen && canEdit
          ? createPortal(
              <div
                className="nx-co-period-copy-backdrop"
                role="presentation"
                data-testid="client-operations-period-copy-source-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) closePeriodCopySourceModal();
                }}
              >
                <div
                  className="nx-co-period-copy-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t('clientOperations.copyFromMonth')}
                  data-testid="client-operations-period-copy-source-modal"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <h2 className="nx-co-period-copy-modal__title">{t('clientOperations.copyFromMonth')}</h2>
                  <p className="nx-co-period-copy-modal__body">{t('clientOperations.copyFromMonthBody')}</p>
                  {sourcePeriodsForCopy.length === 0 ? (
                    <div className="nx-co-period-copy-modal__empty">{t('clientOperations.noMonthsAvailable')}</div>
                  ) : (
                    <div
                      className="nx-co-period-copy-modal__period-list"
                      role="listbox"
                      aria-label={t('clientOperations.chooseSourceMonth')}
                    >
                      {sourcePeriodsForCopy.map((key) => {
                        const selected = periodCopySelectedSource === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={`nx-co-period-copy-modal__period-option${selected ? ' is-selected' : ''}`}
                            disabled={periodCopyBusy}
                            onClick={() => setPeriodCopySelectedSource(key)}
                          >
                            {formatClientOperationsOperationalPeriodTabLabel(key)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="nx-co-period-copy-modal__actions">
                    <button
                      type="button"
                      className="nx-co-period-copy-btn nx-co-period-copy-btn--secondary"
                      disabled={periodCopyBusy}
                      onClick={closePeriodCopySourceModal}
                    >
                      {t('clientOperations.cancel')}
                    </button>
                    <button
                      type="button"
                      className="nx-co-period-copy-btn nx-co-period-copy-btn--primary"
                      disabled={periodCopyBusy || !periodCopySelectedSource}
                      onClick={onConfirmPeriodCopySource}
                    >
                      {t('clientOperations.continue')}
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
        {periodCopyDialog
          ? createPortal(
              <div
                className="nx-co-period-copy-backdrop"
                role="presentation"
                data-testid="client-operations-period-copy-conflict-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setPeriodCopyDialog(null);
                }}
              >
                <div
                  className="nx-co-period-copy-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label={t('clientOperations.copyFromMonthTitle')}
                  data-testid="client-operations-period-copy-dialog"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <h2 className="nx-co-period-copy-modal__title">{t('clientOperations.copyFromMonthConfirmTitle')}</h2>
                  <p className="nx-co-period-copy-modal__body">
                    {fillI18n(t('clientOperations.copyExistingManual'), {
                      month: formatClientOperationsOperationalPeriodTabLabel(targetPeriodKeyForCopy),
                    })}
                  </p>
                  <p className="nx-co-period-copy-modal__body">
                    {fillI18n(t('clientOperations.copyHow'), {
                      source: formatClientOperationsOperationalPeriodTabLabel(periodCopyDialog.sourcePeriodKey),
                    })}
                  </p>
                  <label
                    className={`nx-co-period-copy-modal__radio${periodCopyDialog.mode === 'empty_only' ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="nx-co-period-copy-mode"
                      checked={periodCopyDialog.mode === 'empty_only'}
                      onChange={() =>
                        setPeriodCopyDialog((current) =>
                          current ? { ...current, mode: 'empty_only' } : current,
                        )
                      }
                    />
                    <span>{t('clientOperations.copyEmptyOnly')}</span>
                  </label>
                  <label
                    className={`nx-co-period-copy-modal__radio${periodCopyDialog.mode === 'replace_existing' ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="nx-co-period-copy-mode"
                      checked={periodCopyDialog.mode === 'replace_existing'}
                      onChange={() =>
                        setPeriodCopyDialog((current) =>
                          current ? { ...current, mode: 'replace_existing' } : current,
                        )
                      }
                    />
                    <span>{t('clientOperations.copyReplace')}</span>
                  </label>
                  <div className="nx-co-period-copy-modal__actions">
                    <button
                      type="button"
                      className="nx-co-period-copy-btn nx-co-period-copy-btn--secondary"
                      disabled={periodCopyBusy}
                      onClick={() => setPeriodCopyDialog(null)}
                    >
                      {t('clientOperations.cancel')}
                    </button>
                    <button
                      type="button"
                      className="nx-co-period-copy-btn nx-co-period-copy-btn--primary"
                      disabled={periodCopyBusy}
                      onClick={() =>
                        void executePeriodDataCopy(
                          periodCopyDialog.sourcePeriodKey,
                          periodCopyDialog.mode,
                        )
                      }
                    >
                      {t('clientOperations.copy')}
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
        {userColumnPeriodSetup?.needed && (userColumnPeriodSetup.eligible_columns?.length ?? 0) > 0 && canEdit ? (
          <div className="nx-co-sheet__dialog-backdrop" role="presentation">
            <div className="nx-co-sheet__dialog" role="dialog" aria-modal="true" aria-label={t('clientOperations.periodColumns')}>
              <h2>{`${t('clientOperations.periodColumns')} ${userColumnPeriodSetup.operational_period_key.slice(5)}.${userColumnPeriodSetup.operational_period_key.slice(2, 4)}`}</h2>
              <label className="nx-co-sheet__check">
                <input
                  type="checkbox"
                  checked={periodSetupSelectAll}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setPeriodSetupSelectAll(on);
                    setPeriodSetupSelection(
                      on ? userColumnPeriodSetup.eligible_columns.map((c) => c.column_id) : [],
                    );
                  }}
                />
                {t('clientOperations.all')}
              </label>
              {userColumnPeriodSetup.eligible_columns.map((col) => (
                <label key={col.column_id} className="nx-co-sheet__check">
                  <input
                    type="checkbox"
                    checked={periodSetupSelection.includes(col.column_id)}
                    onChange={(event) => {
                      setPeriodSetupSelection((prev) => {
                        if (event.target.checked) return [...new Set([...prev, col.column_id])];
                        return prev.filter((id) => id !== col.column_id);
                      });
                    }}
                  />
                  {col.label}
                </label>
              ))}
              <div className="nx-co-sheet__dialog-actions">
                <button type="button" className="nx-co-sheet__btn is-active" onClick={() => void confirmPeriodSetup()}>
                  {t('clientOperations.confirm')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {columnSettingsTarget ? (
          <div className="nx-co-sheet__dialog-backdrop" role="presentation">
            <div className="nx-co-sheet__dialog" role="dialog" aria-modal="true" aria-label={t('clientOperations.columnSettings')}>
              <button type="button" className="nx-co-sheet__close" onClick={() => setColumnSettingsTarget(null)} aria-label={t('clientOperations.close')}>×</button>
              <h2>{t('clientOperations.columnSettings')}</h2>
              <p className="nx-co-sheet__dialog-subtitle">{t('clientOperations.columnSettingsSubtitle')}</p>
              {columnSettingsTarget.legacy_baseline_required ? (
                <label>
                  {t('clientOperations.existingDataStartPeriod')}
                  <select
                    value={settingsLegacyBaseline}
                    onChange={(event) => setSettingsLegacyBaseline(event.target.value)}
                  >
                    {(period?.available_periods ?? []).map((key) => (
                      <option key={key} value={key}>
                        {`${key.slice(5)}.${key.slice(2, 4)}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="nx-co-sheet__check">
                <input
                  type="checkbox"
                  checked={settingsAutoFuture}
                  onChange={(event) => setSettingsAutoFuture(event.target.checked)}
                />
                {t('clientOperations.fromCurrentPeriodOn')}
              </label>
              {(period?.available_periods ?? []).map((key) => (
                <label key={key} className="nx-co-sheet__check">
                  <input
                    type="checkbox"
                    checked={settingsSelectedPeriods.includes(key)}
                    onChange={(event) => {
                      setSettingsSelectedPeriods((prev) => {
                        if (event.target.checked) return [...new Set([...prev, key])].sort();
                        return prev.filter((p) => p !== key);
                      });
                    }}
                  />
                  {`${key.slice(5)}.${key.slice(2, 4)}`}
                </label>
              ))}
              <div className="nx-co-sheet__dialog-actions">
                <button type="button" className="nx-co-sheet__btn" onClick={() => setColumnSettingsTarget(null)}>{t('clientOperations.cancel')}</button>
                <button type="button" className="nx-co-sheet__btn is-active" onClick={() => void saveColumnSettings()}>{t('clientOperations.save')}</button>
              </div>
            </div>
          </div>
        ) : null}
        {addColumnOpen ? (
          <div className="nx-co-sheet__dialog-backdrop" role="presentation">
            <div className="nx-co-sheet__dialog" role="dialog" aria-modal="true" aria-label={t('clientOperations.addColumn')}>
              <button type="button" className="nx-co-sheet__close" onClick={() => setAddColumnOpen(false)} aria-label={t('clientOperations.close')}>×</button>
              <h2>{t('clientOperations.addColumn')}</h2>
              <label>{t('clientOperations.columnName')}<input value={addColumnLabel} onChange={(event) => setAddColumnLabel(event.target.value)} autoFocus /></label>
              <label>{t('clientOperations.dataType')}<select value={addColumnDataType} onChange={(event) => setAddColumnDataType(event.target.value as typeof addColumnDataType)}><option value="text">{t('clientOperations.text')}</option><option value="number">{t('clientOperations.formatNumber')}</option><option value="date">{t('clientOperations.formatDate')}</option><option value="boolean">{t('clientOperations.yesNo')}</option></select></label>
              <div className="nx-co-sheet__dialog-actions"><button type="button" className="nx-co-sheet__btn" onClick={() => setAddColumnOpen(false)}>{t('clientOperations.cancel')}</button><button type="button" className="nx-co-sheet__btn is-active" onClick={() => void createColumn()} disabled={!addColumnLabel.trim()}>{t('clientOperations.save')}</button></div>
            </div>
          </div>
        ) : null}
        {modals}
        <ClientOperationsTodoBoardModal
          open={todoBoardOpen}
          onClose={() => setTodoBoardOpen(false)}
          workspaceQuery={{
            workspace_scope: query?.workspace_scope ?? null,
            workspace_subject_user_id: query?.workspace_subject_user_id ?? null,
          }}
          workspaceLabelHe={workspace?.label_he ?? null}
          workspaceLabelKey={workspace?.label_key ?? null}
          canEdit={canEdit}
        />
        </div>
      </div>
    );
  }

  return (
    <div>
      {showPageHeader ? (
        <PageHeader title={t('clientOperations.clientsBrand')} subtitle="Client registry (module v1 skeleton)" />
      ) : null}

      <SectionCard style={{ padding: 20 }}>
        {error && <div style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</div>}
        {loading ? (
          <p style={{ color: '#6b7280' }}>{t('clientOperations.loading')}</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, direction: 'inherit' }}>
                <thead>
                  <tr style={{ background: '#f3f4f6' }}>
                    {visibleColumns.map((c) => (
                      <th
                        key={c.key}
                        style={{
                          padding: c.cell_kind === 'folder' ? '12px 8px' : '12px 16px',
                          textAlign: c.align,
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.client_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      {visibleColumns.map((c) => (
                        <td
                          key={c.key}
                          style={{
                            padding: c.cell_kind === 'folder' ? '12px 8px' : '12px 16px',
                            textAlign: c.align,
                            fontWeight: c.key === 'client_name' || c.key === 'vat_due' ? 600 : undefined,
                            fontFamily:
                              c.key === 'tax_id' || c.key === 'handler' ? 'monospace' : undefined,
                            maxWidth: c.cell_kind === 'notes' ? 280 : undefined,
                            cursor: c.cell_kind === 'notes' ? 'pointer' : undefined,
                            verticalAlign: c.cell_kind === 'notes' ? 'top' : undefined,
                            color: c.cell_kind === 'notes' ? '#374151' : undefined,
                            width: c.cell_kind === 'folder' ? 40 : undefined,
                          }}
                        >
                          {renderCellContent(r, c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length === 0 && (
              <p style={{ padding: 24, color: '#6b7280', textAlign: 'center' }}>No clients found.</p>
            )}
          </>
        )}
      </SectionCard>
      {modals}
    </div>
  );
}
