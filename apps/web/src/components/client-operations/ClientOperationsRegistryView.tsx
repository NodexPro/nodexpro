import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { apiFetch, apiJson } from '../../api/client';
import {
  moduleClientOperationsCase,
  moduleClientOperationsClientQuickProfile,
  moduleClientOperationsOperationalNotes,
  moduleClientOperationsOperationalNote,
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
  rememberCustomCellDraft,
  shouldApplyCellSaveAggregate,
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
import { ClientOperationsPeriodSheetTabs } from './ClientOperationsPeriodSheetTabs';

export type ClientOperationsMaterialCell = {
  applicable: boolean;
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
  applicable: boolean;
  completed: boolean | null;
};

export type ClientOperationsNiDeductions126Item = ClientOperationsNiDeductionsFormItem & {
  outstanding_count: number;
};

export type ClientOperationsNiDeductionsCell = {
  applicable: boolean;
  items: {
    '102': ClientOperationsNiDeductionsFormItem;
    '100': ClientOperationsNiDeductionsFormItem;
    '126': ClientOperationsNiDeductions126Item;
  };
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
  notes_cell_text_he: string | null;
  operational_notes_count: number;
  vat_due_registry_display_he: string | null;
  /** Ready-to-render display by column key (from aggregate). */
  cells?: Record<string, string>;
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

export type ClientOperationsNoteTypeRow = {
  code: string;
  label_he: string;
  sort_order: number;
  allows_reminder: boolean;
};

export type ClientOperationsRegistryColumn = {
  key: string;
  label: string;
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
  available: boolean;
  reason_he: string | null;
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
  ui: { title_he: string; message_he: string; button_create_anyway_he: string; button_change_time_he: string };
  conflicts: Array<{
    client_display_name: string | null;
    body_preview: string;
    type_label_he: string;
    reminder_at: string;
  }>;
};

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

function displayForColumn(r: ClientOperationsRegistryRow, col: ClientOperationsRegistryColumn): string {
  const value = r.cells?.[col.key];
  // PCN: empty string means not PCN (must not coerce to em-dash).
  if (col.key === 'pcn') {
    if (value != null) return String(value);
    return r.pcn_display ?? '';
  }
  // User Excel columns must stay blank when empty — system columns keep dash semantics.
  if (col.cell_kind === 'custom') return displayCustomColumnValue(r, col);
  if (value == null || value === '') return '—';
  return value;
}

export type ClientOperationsRegistryViewProps = {
  rows: ClientOperationsRegistryRow[];
  onRowsChange: (rows: ClientOperationsRegistryRow[]) => void;
  noteTypes: ClientOperationsNoteTypeRow[];
  loading: boolean;
  error: string;
  canEdit: boolean;
  showPageHeader?: boolean;
  onReloadRegistry?: () => void;
  /** Spreadsheet chrome only on /m/client-operations; embedded keeps prior Work Engine look. */
  variant?: 'spreadsheet' | 'embedded';
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
    presentation_token: 'ready' | 'sent_for_approval' | 'completed' | 'clear';
  }>;
  query?: {
    q: string | null;
    sort_by: string | null;
    sort_dir: 'asc' | 'desc' | null;
    operational_period_key?: string | null;
  };
  onQueryChange?: (
    next: { q: string | null; sort_by: string | null; sort_dir: 'asc' | 'desc' | null },
    options?: { quiet?: boolean },
  ) => void;
  onRegistryCommand?: (
    body: Record<string, unknown>,
    options?: { applyAggregate?: boolean },
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
  onPeriodChange?: (operationalPeriodKey: string) => void;
};

export function ClientOperationsRegistryView(props: ClientOperationsRegistryViewProps) {
  const {
    rows,
    onRowsChange,
    noteTypes,
    loading,
    error,
    canEdit,
    showPageHeader = true,
    onReloadRegistry,
    variant = 'embedded',
    titleHe,
    columns: columnsProp,
    toolbarCapabilities = [],
    customColumnsCapability: _customColumnsCapability,
    userColumnPeriodSetup = null,
    columnsNeedingLegacyBaseline: _columnsNeedingLegacyBaseline = [],
    manualStatusPaintModes = [],
    query,
    onQueryChange,
    onRegistryCommand,
    onApplyAggregate,
    onInvalidateStaleLoads,
    widthScope,
    period,
    onPeriodChange,
  } = props;

  const setRows = onRowsChange;
  const isSpreadsheet = variant === 'spreadsheet';
  const columns = columnsProp ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalData, setModalData] = useState<ClientOperationsCaseResponse | null>(null);
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
  const [searchDraft, setSearchDraft] = useState(query?.q ?? '');
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
  const [editingHeaderColumnId, setEditingHeaderColumnId] = useState<string | null>(null);
  const [headerDraft, setHeaderDraft] = useState('');
  const [editingCellKey, setEditingCellKey] = useState<string | null>(null);
  const [cellDraft, setCellDraft] = useState('');
  const [statusPaintMode, setStatusPaintMode] = useState<
    'ready' | 'sent_for_approval' | 'completed' | 'clear' | null
  >(null);
  const statusPaintSlotsRef = useRef<Map<string, ManualStatusPaintSlot>>(new Map());
  const statusOverlaysRef = useRef<Map<string, ManualStatusOverlay>>(new Map());
  const statusOverlayGenRef = useRef(0);
  const skipUndoPushRef = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestSeqRef = useRef(0);

  useEffect(() => {
    setSearchDraft(query?.q ?? '');
  }, [query?.q]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const applyLiveSearch = useCallback(
    (raw: string) => {
      if (!onQueryChange) return;
      const q = raw.trim() || null;
      if ((query?.q ?? null) === q) return;
      const seq = ++searchRequestSeqRef.current;
      onQueryChange(
        {
          q,
          sort_by: query?.sort_by ?? null,
          sort_dir: query?.sort_dir ?? null,
        },
        { quiet: true },
      );
      void seq;
    },
    [onQueryChange, query?.q, query?.sort_by, query?.sort_dir],
  );

  const onSearchDraftChange = (value: string) => {
    setSearchDraft(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    // Native clear (X) and empty field restore immediately; typing uses a short debounce.
    if (!value.trim()) {
      applyLiveSearch('');
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      applyLiveSearch(value);
    }, 120);
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
    setFocusedCell((current) =>
      reconcileActiveCellAfterRowsChange({
        active: current,
        clientIds,
      }),
    );
  }, [rows]);

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

  const openClientModal = (r: ClientOperationsRegistryRow) => {
    closeQuickProfile();
    setModalOpen(true);
    setModalLoading(true);
    setModalError('');
    setModalData(buildPlaceholderClientCaseFromRegistryRow(r));
    apiJson<ClientOperationsCaseResponse>(moduleClientOperationsCase(r.client_id))
      .then((res) => setModalData(res))
      .catch((e) => setModalError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setModalLoading(false));
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
      };
      const url =
        editingNoteId
          ? moduleClientOperationsOperationalNote(notesModalClientId, editingNoteId)
          : moduleClientOperationsOperationalNotes(notesModalClientId);
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
    if (!window.confirm('למחוק הערה?')) return;
    setNotesError('');
    const res = await apiFetch(moduleClientOperationsOperationalNote(notesModalClientId, noteId), {
      method: 'DELETE',
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
  ) => {
    if (
      !isClientOperationsFormatEligibleColumn({
        columnKey: column.key,
        cellKind: column.cell_kind,
      })
    ) {
      return;
    }
    setSelectedRowId(clientId);
    setFocusedCell({ clientId, colKey: column.key });
  };

  /** Keep active cell while clicking formatting toolbar (avoid input blur races). */
  const preserveActiveCellOnToolbarMouseDown = (event: ReactMouseEvent) => {
    event.preventDefault();
  };

  const applyPresentation = (patch: Partial<CellPresentation>) => {
    if (!focusedCell) return;
    const k = cellKey(focusedCell.clientId, focusedCell.colKey);
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

  const isCap = (id: string) => capById.get(id)?.available === true;
  const capTitle = (id: string) => {
    const c = capById.get(id);
    if (!c) return undefined;
    return c.available ? c.label_he : `${c.label_he}: ${c.reason_he ?? 'לא זמין'}`;
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
      {
        clientId: string;
        column: ClientOperationsRegistryColumn;
        identity: CustomCellSaveIdentity;
      }
    >
  >(new Map());
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
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

  const serverValueForMeta = (meta: {
    clientId: string;
    column: ClientOperationsRegistryColumn;
  }): string => {
    const row = rowsRef.current.find((r) => r.client_id === meta.clientId);
    if (!row) return '';
    return displayForColumn(row, meta.column);
  };

  const clearCustomCellDebounce = (key: string) => {
    const timer = customCellDebounceTimersRef.current.get(key);
    if (timer) {
      clearTimeout(timer);
      customCellDebounceTimersRef.current.delete(key);
    }
  };

  const preserveEditorDraftIfNeeded = (key: string, meta: { clientId: string; column: ClientOperationsRegistryColumn }) => {
    const pk = cellKey(meta.clientId, meta.column.key);
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
      const data = (await onRegistryCommand(
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
        period?: { selected_period_key?: string | null };
        query?: { operational_period_key?: string | null };
      };

      if (
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
      const aggregateRow = Array.isArray(data?.rows)
        ? data.rows.find((r) => r.client_id === start.identity.clientId)
        : undefined;
      const serverValueAfter = aggregateRow ? displayForColumn(aggregateRow, meta.column) : start.value;

      const { startNext } = completeCustomCellSaveSuccess(
        customCellSlotsRef.current,
        start.key,
        start.value,
        serverValueAfter,
      );

      if (
        shouldApplyCellSaveAggregate({
          responsePeriodKey,
          viewedPeriodKey,
        })
      ) {
        applyAggregateReconciled(data);
        preserveEditorDraftIfNeeded(start.key, meta);
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
      setCommandError(error instanceof Error ? error.message : 'שמירת הערך נכשלה');
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
    customCellMetaRef.current.set(key, { clientId: row.client_id, column, identity });
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
    customCellMetaRef.current.set(key, { clientId: row.client_id, column, identity });
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
        setCommandError(error instanceof Error ? error.message : 'עדכון סטטוס נכשל');
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
        setCommandError(error instanceof Error ? error.message : 'ביטול סטטוס נכשל');
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
      setCommandError(error instanceof Error ? error.message : 'ביטול ערך נכשל');
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
    const printableKeys = selectPrintableColumnKeys({ columns: printColumns, rows: printRows });
    const printableCols = visibleColumns.filter((c) => printableKeys.includes(c.key));
    const periodHeading = formatClientOperationsPeriodHeading(periodKey);

    const tableHeaders = printableCols.map((col) => `<th>${escapeHtml(col.label)}</th>`).join('');
    const tableRows = rows
      .map((r) => {
        const cells = printableCols
          .map((col) => {
            const statusToken = r.manual_cell_statuses?.[col.key]?.presentation_token ?? null;
            const statusClass = statusToken ? ` is-manual-status-${statusToken}` : '';
            const value = escapeHtml(displayForColumn(r, col));
            return `<td class="${statusClass}">${value}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    const printWin = window.open('', '_blank', 'width=1200,height=850');
    if (!printWin) return;
    printWin.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<title>תפעול לקוחות — ${periodHeading}</title>
<style>
  @page { size: landscape; margin: 1cm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; direction: rtl; margin: 0; }
  h1 { font-size: 13px; font-weight: 700; margin: 0 0 6px; color: #123756; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: right; white-space: nowrap; font-size: 11px; vertical-align: middle; }
  th { background: #f4f6f8; font-weight: 700; color: #123756; }
  .is-manual-status-ready { background: #fbf4d4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .is-manual-status-sent_for_approval { background: #e8f1fa; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .is-manual-status-completed { background: #e5f4e5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print { @page { size: landscape; } }
</style>
</head>
<body>
<h1>תפעול לקוחות — ${periodHeading}</h1>
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
    const current = displayForColumn(row, column);
    const value = window.prompt(column.label.trim() || 'ערך', current);
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
      setCommandError(error instanceof Error ? error.message : 'שמירת הערך נכשלה');
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
      setCommandError(error instanceof Error ? error.message : 'שמירת הגדרות עמודה נכשלה');
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
      setCommandError(error instanceof Error ? error.message : 'אתחול עמודות לתקופה נכשל');
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
      setCommandError(error instanceof Error ? error.message : 'שינוי שם העמודה נכשל');
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
    if (!cell?.applicable) return;
    const command =
      stream === 'vat'
        ? 'set_material_brought'
        : stream === 'income_tax_advance'
          ? 'set_income_tax_advance_material_brought'
          : 'set_payroll_material_brought';
    const current =
      stream === 'vat'
        ? Boolean(cell.value ?? row.material_brought_flag)
        : Boolean(cell.value);
    setCommandError('');
    try {
      await onRegistryCommand({
        command,
        client_id: row.client_id,
        value: !current,
        operational_period_key: query?.operational_period_key ?? null,
        query,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'שמירת חומר נכשלה');
    }
  };
  const toggleNiDeductionsItem = async (
    row: ClientOperationsRegistryRow,
    formKey: '102' | '100' | '126',
  ) => {
    if (statusPaintMode) return;
    if (!canEdit || !onRegistryCommand) return;
    const cell = row.national_insurance_deductions_cell;
    if (!cell?.applicable) return;
    const item = cell.items[formKey];
    if (!item?.applicable) return;
    setCommandError('');
    try {
      if (formKey === '126') {
        if (item.completed) return;
        await onRegistryCommand({
          command: 'complete_ni_deductions_126_cycle',
          client_id: row.client_id,
          operational_period_key: query?.operational_period_key ?? null,
          query,
        });
        return;
      }
      await onRegistryCommand({
        command: formKey === '102' ? 'set_ni_deductions_reported_102' : 'set_ni_deductions_reported_100',
        client_id: row.client_id,
        value: !Boolean(item.completed),
        operational_period_key: query?.operational_period_key ?? null,
        query,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'שמירת ב״ל ניכויים נכשלה');
    }
  };
  const toggleIncomeTaxDeductions = async (row: ClientOperationsRegistryRow) => {
    if (statusPaintMode) return;
    if (!canEdit || !onRegistryCommand) return;
    const cell = row.income_tax_deductions_cell;
    if (!cell?.configured || !cell.due || !cell.editable || !cell.applicable) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'set_income_tax_deductions_reported',
        client_id: row.client_id,
        value: !Boolean(cell.completed),
        operational_period_key: query?.operational_period_key ?? null,
        query,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'שמירת מ״ה ניכויים נכשלה');
    }
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
      setCommandError(error instanceof Error ? error.message : 'שמירת תאריך יעד נכשלה');
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
      setCommandError(error instanceof Error ? error.message : 'פתיחת הצהרת הון נכשלה');
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
      setCommandError(error instanceof Error ? error.message : 'יצירת העמודה נכשלה');
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

  const renderSpreadsheetToolbar = () => {
    const currentPk = focusedCell ? cellKey(focusedCell.clientId, focusedCell.colKey) : null;
    const currentCellPres = currentPk ? cellPresentation[currentPk] : undefined;
    const currentColor = currentCellPres?.color ?? CLIENT_OPERATIONS_DEFAULT_TEXT_COLOR;
    const paletteRows = clientOperationsTextColorPaletteRows();
    const formatTargetActive = Boolean(focusedCell);
    const formatDisabled = !formatTargetActive;

    return (
      <div className="nx-co-sheet__toolbar" role="toolbar" aria-label="כלי גיליון">
        {/* ── Undo ── */}
        <div className="nx-co-sheet__toolbar-group">
          <button
            type="button"
            className="nx-co-sheet__btn nx-co-sheet__btn--icon"
            disabled={!isCap('undo') || coUndoStack.length === 0}
            title={capTitle('undo') ?? 'בטל'}
            aria-label="בטל"
            onClick={undoLastAction}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M9.5 7.5H6.75A4.75 4.75 0 0 0 2 12.25v0A4.75 4.75 0 0 0 6.75 17H14a5 5 0 0 0 5-5" />
              <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M9.5 4.5 6.5 7.5l3 3" />
            </svg>
          </button>
          {/* HIDDEN — redo retained for later restore */}
          <button type="button" className="nx-co-sheet__btn" hidden disabled={!isCap('redo') || redoStack.length === 0} title={capTitle('redo')} onClick={redoPresentation}>בצע שוב</button>
        </div>

        {/* ── Format: B I U | align | font-size | A-color ── */}
        <div className="nx-co-sheet__toolbar-group nx-co-sheet__toolbar-group--secondary">
          <button
            type="button"
            className="nx-co-sheet__btn"
            disabled={!isCap('bold') || formatDisabled}
            title={capTitle('bold')}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => { if (!focusedCell) return; const cur = cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.bold; applyPresentation({ bold: !cur }); }}
          ><strong>B</strong></button>
          <button
            type="button"
            className="nx-co-sheet__btn"
            disabled={!isCap('italic') || formatDisabled}
            title={capTitle('italic')}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => { if (!focusedCell) return; const cur = cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.italic; applyPresentation({ italic: !cur }); }}
          ><em>I</em></button>
          <button
            type="button"
            className="nx-co-sheet__btn"
            disabled={!isCap('underline') || formatDisabled}
            title={capTitle('underline')}
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => { if (!focusedCell) return; const cur = cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.underline; applyPresentation({ underline: !cur }); }}
          ><span style={{ textDecoration: 'underline' }}>U</span></button>

          <button
            type="button"
            className={`nx-co-sheet__btn nx-co-sheet__btn--icon${currentCellPres?.align === 'right' ? ' is-active' : ''}`}
            disabled={!isCap('align_right') || formatDisabled}
            title={capTitle('align_right') ?? 'יישור ימין'}
            aria-label="יישור ימין"
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => applyPresentation({ align: 'right' })}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M20 7H8M20 12H4M20 17H10" /></svg>
          </button>
          <button
            type="button"
            className={`nx-co-sheet__btn nx-co-sheet__btn--icon${currentCellPres?.align === 'center' ? ' is-active' : ''}`}
            disabled={!isCap('align_center') || formatDisabled}
            title={capTitle('align_center') ?? 'מרכז'}
            aria-label="מרכז"
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => applyPresentation({ align: 'center' })}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M18 7H6M20 12H4M17 17H7" /></svg>
          </button>
          <button
            type="button"
            className={`nx-co-sheet__btn nx-co-sheet__btn--icon${currentCellPres?.align === 'left' ? ' is-active' : ''}`}
            disabled={!isCap('align_left') || formatDisabled}
            title={capTitle('align_left') ?? 'יישור שמאל'}
            aria-label="יישור שמאל"
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onClick={() => applyPresentation({ align: 'left' })}
          >
            <svg className="nx-co-sheet__toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M4 7h12M4 12h16M4 17h10" /></svg>
          </button>
          {/* HIDDEN — wrap retained */}
          <button type="button" className={`nx-co-sheet__btn${focusedCell && cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.wrap ? ' is-active' : ''}`} hidden disabled={!isCap('wrap_text') || formatDisabled} title={capTitle('wrap_text')} onClick={() => { if (!focusedCell) return; const cur = cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.wrap; applyPresentation({ wrap: !cur }); }}>גלישה</button>

          {/* Font-size selector */}
          <select
            data-testid="font-size-control"
            className="nx-co-sheet__font-size-select"
            value={currentCellPres?.fontSize ?? CLIENT_OPERATIONS_DEFAULT_FONT_SIZE}
            disabled={formatDisabled}
            title="גודל גופן"
            aria-label="גודל גופן"
            onMouseDown={preserveActiveCellOnToolbarMouseDown}
            onChange={(e) => applyPresentation({ fontSize: Number(e.target.value) })}
          >
            {CLIENT_OPERATIONS_FONT_SIZES.map((sz) => (
              <option key={sz} value={sz}>{sz}</option>
            ))}
          </select>

          {/* A text-color icon with current-color underline */}
          <div className="nx-co-sheet__color-picker-wrap">
            <button
              type="button"
              data-testid="text-color-control"
              className={`nx-co-sheet__btn nx-co-sheet__btn--icon nx-co-sheet__color-a-btn${colorPaletteOpen ? ' is-active' : ''}`}
              disabled={!isCap('text_color') || formatDisabled}
              title="צבע טקסט"
              aria-label="צבע טקסט"
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
              <div className="nx-co-sheet__color-palette" role="dialog" aria-label="בחירת צבע טקסט">
                {([paletteRows.standard, paletteRows.beautiful] as const).map((row, ri) => (
                  <div key={ri} className="nx-co-sheet__color-palette-row">
                    {row.map((swatch) => (
                      <button
                        key={swatch.id}
                        type="button"
                        className="nx-co-sheet__color-swatch"
                        style={{ background: swatch.hex }}
                        title={swatch.label_he}
                        aria-label={swatch.label_he}
                        onMouseDown={preserveActiveCellOnToolbarMouseDown}
                        onClick={() => {
                          applyPresentation({ color: swatch.hex });
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
              title="הצג / הסתר עמודות"
              aria-label="הצג / הסתר עמודות"
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
              <div className="nx-co-sheet__col-visibility-popover" role="dialog" aria-label="הצג / הסתר עמודות">
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
          <div className="nx-co-sheet__toolbar-group nx-co-sheet__toolbar-group--status-paint" role="toolbar" aria-label="מצב צביעת סטטוס">
            {manualStatusPaintModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`nx-co-sheet__status-mode nx-co-sheet__status-mode--${mode.presentation_token}${statusPaintMode === mode.id ? ' is-active' : ''}`}
                disabled={!canEdit}
                aria-pressed={statusPaintMode === mode.id}
                title={mode.label_he}
                onClick={() => setStatusPaintMode((current) => (current === mode.id ? null : mode.id))}
              >
                <span className="nx-co-sheet__status-mode-swatch" aria-hidden="true" />
                <span>{mode.label_he}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* ── Search ── */}
        <div className="nx-co-sheet__toolbar-group">
          <div className="nx-co-sheet__search">
            <div className="nx-co-sheet__search-field">
              <button
                type="button"
                className="nx-co-sheet__search-icon-btn"
                disabled={!isCap('search')}
                title={capTitle('search') ?? 'חיפוש'}
                aria-label="חיפוש"
                onClick={() => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); applyLiveSearch(searchDraft); }}
              >
                <svg className="nx-co-sheet__search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M16.2 16.2 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </button>
              <input
                type="search"
                value={searchDraft}
                disabled={!isCap('search')}
                title={capTitle('search')}
                placeholder="חיפוש בטבלה…"
                aria-label="חיפוש לקוחות"
                onChange={(e) => onSearchDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isCap('search')) {
                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                    applyLiveSearch(searchDraft);
                  }
                }}
              />
            </div>
          </div>
          {/* HIDDEN for now — keep underlying capabilities/handlers for later restore:
              סינון / מיון ↑ / מיון ↓ / הקפאה */}
        </div>

        {/* ── Fullscreen ── */}
        <div className="nx-co-sheet__toolbar-group">
          {/* הקפאה hidden from toolbar — freezeOn + sticky CSS implementation retained. */}
          {/* + עמודה hidden — 10 user slots via ensure_client_operations_user_column_slots command. */}
          <button
            type="button"
            className={`nx-co-sheet__btn${fullscreenOpen ? ' is-active' : ''}`}
            disabled={capById.has('fullscreen') && !isCap('fullscreen')}
            title={fullscreenOpen ? 'יציאה ממסך מלא' : (capTitle('fullscreen') ?? 'מסך מלא')}
            aria-label={fullscreenOpen ? 'יציאה ממסך מלא' : 'מסך מלא'}
            aria-pressed={fullscreenOpen}
            onClick={() => setFullscreenOpen((open) => !open)}
          >
            {fullscreenOpen ? 'יציאה ממסך מלא' : '⊞ מסך מלא'}
          </button>

          {/* ── Print ── */}
          <button
            type="button"
            data-testid="print-control"
            className="nx-co-sheet__btn nx-co-sheet__btn--icon"
            title="הדפסה"
            aria-label="הדפסה"
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
              title="עוד פעולות גיליון"
              onClick={() => setMoreOpen((v) => !v)}
            >
              עוד…
            </button>
            {moreOpen ? (
              <div className="nx-co-sheet__more-menu">
                <label className="nx-co-sheet__btn" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  צבע רקע
                  <input
                    className="nx-co-sheet__color"
                    type="color"
                    disabled={!isCap('fill_color') || !focusedCell}
                    title={capTitle('fill_color')}
                    onChange={(e) => applyPresentation({ fill: e.target.value })}
                  />
                </label>
                <label className="nx-co-sheet__btn nx-co-sheet__number-format">
                  פורמט מספר
                  <select
                    value={focusedCell ? (cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.numberFormat ?? 'general') : 'general'}
                    disabled={!isCap('number_format') || !focusedCell}
                    onChange={(e) => applyPresentation({ numberFormat: e.target.value as CellPresentation['numberFormat'] })}
                  >
                    <option value="general">כללי</option>
                    <option value="number">מספר</option>
                    <option value="currency">מטבע</option>
                    <option value="percent">אחוז</option>
                    <option value="date">תאריך</option>
                  </select>
                </label>
                <button
                  type="button"
                  className={`nx-co-sheet__btn${bordersOn ? ' is-active' : ''}`}
                  disabled={!isCap('borders')}
                  title={capTitle('borders')}
                  onClick={() => setBordersOn((v) => !v)}
                >
                  גבולות
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
          📁
        </button>
      );
    }
    if (col.cell_kind === 'notes') {
      const text = displayForColumn(r, col);
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
                  textAlign: 'right',
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
          title="לחיצה כפולה לעריכה"
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
        return (
          <span
            className={`nx-co-sheet__date-field is-na${canOpenCapital ? ' is-openable' : ''}`}
            title={canOpenCapital ? 'פתיחת הצהרת הון' : undefined}
          >
            <span className="nx-co-sheet__date-field-value">—</span>
            {canOpenCapital ? (
              <button
                type="button"
                className="nx-co-sheet__date-field-plus"
                disabled={!canEdit || !onRegistryCommand}
                title="פתיחת הצהרת הון"
                aria-label={`פתיחת הצהרת הון — ${r.client_name ?? r.client_id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void openCapitalDeclaration(r);
                }}
              >
                +
              </button>
            ) : null}
          </span>
        );
      }
      const value = operationalCell.operational_target_date ?? '';
      const displayValue = displayForColumn(r, col);
      const disabled = !canEdit || !col.editable || !operationalCell.editable || !onRegistryCommand;
      const dateInputId = `co-date-${col.key}-${r.client_id}`;
      const dateInputName = `co_${col.key}_operational_target_date`;
      return (
        <label
          className={`nx-co-sheet__date-field${disabled ? ' is-disabled' : ''}`}
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
          <span className="nx-co-sheet__date-field-value">{displayValue || '—'}</span>
          <span className="nx-co-sheet__date-field-icon" aria-hidden="true">
            📅
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
          labelHe: 'מע״מ',
          cell: r.material_cells?.vat ?? r.material_brought_cell,
        },
        {
          key: 'income_tax_advance',
          labelHe: 'מה״כ',
          cell: r.material_cells?.income_tax_advance,
        },
        {
          key: 'payroll',
          labelHe: 'שכר',
          cell: r.material_cells?.payroll,
        },
      ];
      return (
        <div className="nx-co-sheet__material" role="group" aria-label={`חומר — ${clientLabel}`}>
          {streams.map((stream) => {
            const applicable = stream.cell?.applicable ?? false;
            if (!applicable) {
              return (
                <span
                  key={stream.key}
                  className="nx-co-sheet__material-slot is-na"
                  title={`${stream.labelHe} לא רלוונטי לתקופה זו`}
                  aria-label={`חומר ${stream.labelHe} — ${clientLabel} — ${periodLabel} — לא רלוונטי`}
                >
                  —
                </span>
              );
            }
            const checked = Boolean(
              stream.key === 'vat'
                ? stream.cell?.value ?? r.material_brought_flag
                : stream.cell?.value,
            );
            return (
              <label key={stream.key} className="nx-co-sheet__material-slot">
                <input
                  type="checkbox"
                  className="nx-co-sheet__checkbox"
                  checked={checked}
                  disabled={!canEdit || !col.editable || !onRegistryCommand}
                  aria-label={`חומר ${stream.labelHe} — ${clientLabel} — ${periodLabel}`}
                  onChange={() => {
                    if (statusPaintMode) return;
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
      if (!niCell?.applicable) {
        return (
          <span className="nx-co-sheet__na" title="לא רלוונטי לתקופה זו" aria-label={`${col.label} לא רלוונטי`}>
            —
          </span>
        );
      }
      const forms: Array<{ key: '102' | '100' | '126'; labelHe: string }> = [
        { key: '102', labelHe: '102' },
        { key: '100', labelHe: '100' },
        { key: '126', labelHe: '126' },
      ];
      return (
        <div className="nx-co-sheet__material" role="group" aria-label={`ב״ל ניכויים — ${clientLabel}`}>
          {forms.map((form) => {
            const item = niCell.items[form.key];
            if (!item?.applicable) {
              return (
                <span
                  key={form.key}
                  className="nx-co-sheet__material-slot is-na"
                  title={`${form.labelHe} לא רלוונטי`}
                  aria-label={`ב״ל ניכויים ${form.labelHe} — ${clientLabel} — ${periodLabel} — לא רלוונטי`}
                >
                  —
                </span>
              );
            }
            const checked = Boolean(item.completed);
            return (
              <label key={form.key} className="nx-co-sheet__material-slot">
                <input
                  type="checkbox"
                  className="nx-co-sheet__checkbox"
                  checked={checked}
                  disabled={!canEdit || !col.editable || !onRegistryCommand || (form.key === '126' && checked)}
                  aria-label={`ב״ל ניכויים ${form.labelHe} — ${clientLabel} — ${periodLabel}`}
                  onChange={() => {
                    if (statusPaintMode) return;
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
      );
    }
    if (col.cell_kind === 'checkbox' && col.key === 'income_tax_deductions') {
      const periodLabel = query?.operational_period_key ?? '';
      const clientLabel = r.client_name ?? r.client_id;
      const cell = r.income_tax_deductions_cell;
      if (!cell?.configured) {
        return (
          <span className="nx-co-sheet__na" title="אין תיק ניכויים" aria-label={`${col.label} —`}>
            —
          </span>
        );
      }
      const active = Boolean(cell.due && cell.editable && cell.applicable);
      const checked = Boolean(cell.completed);
      return (
        <label
          className={`nx-co-sheet__itd-slot${active ? '' : ' is-inactive'}`}
          title={active ? undefined : 'יש תיק ניכויים — אין דיווח בחודש זה'}
        >
          <input
            type="checkbox"
            className="nx-co-sheet__checkbox"
            checked={checked}
            disabled={!active || !canEdit || !col.editable || !onRegistryCommand}
            aria-label={`${col.label} — ${clientLabel} — ${periodLabel}${active ? '' : ' — לא נדרש החודש'}`}
            onChange={() => {
              if (statusPaintMode) return;
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
      return displayForColumn(r, col);
    }
    if (col.key === 'client_name') {
      const text = displayForColumn(r, col);
      return (
        <button
          type="button"
          className={isSpreadsheet ? 'nx-co-sheet__client-name-btn' : 'nx-co-sheet__client-name-btn'}
          onClick={(e) => {
            e.stopPropagation();
            openQuickProfile(r, e.currentTarget);
          }}
          aria-label={`כרטיס מהיר ${r.client_name ?? ''}`}
        >
          {text}
        </button>
      );
    }
    const applicable = obligationApplicable(r, col.key);
    if (applicable === false) {
      return (
        <span className="nx-co-sheet__na" title="לא רלוונטי לתקופה זו" aria-label={`${col.label} לא רלוונטי`}>
          —
        </span>
      );
    }
    return displayForColumn(r, col);
  };

  const renderSpreadsheetTable = () => (
    <div className="nx-co-sheet__canvas">
      <table className={`nx-co-sheet__table${freezeOn ? ' is-frozen' : ''}${bordersOn ? '' : ' is-borders-off'}${isResizingColumn ? ' is-resizing' : ''}`}>
        <colgroup>
          {visibleColumns.map((column) => <col key={column.key} style={{ width: widthForColumn(column) }} />)}
        </colgroup>
        <thead><tr>
          {visibleColumns.map((column) => (
            <th key={column.key} data-col={column.key} data-freeze={column.freeze_default ? 'true' : 'false'} style={{ textAlign: column.align }}>
              {column.key === 'material_brought' ? (
                <div className="nx-co-sheet__material-header">
                  <span className="nx-co-sheet__material-header-title">חומר</span>
                  <div className="nx-co-sheet__material-header-subs" aria-hidden="true">
                    <span>מע״מ</span>
                    <span>מה״כ</span>
                    <span>שכר</span>
                  </div>
                </div>
              ) : column.key === 'national_insurance_deductions' ? (
                <div className="nx-co-sheet__material-header">
                  <span className="nx-co-sheet__material-header-title">ב״ל ניכויים</span>
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
                      aria-label="שם עמודה"
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
                      title={canEdit ? 'לחיצה לשינוי שם העמודה' : undefined}
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
                      aria-label="הגדרות עמודה"
                      title="הגדרות עמודה"
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
              ) : (
                column.label
              )}
              <span className="nx-co-sheet__resize-handle" role="separator" aria-label={`שינוי רוחב ${column.label}`} onMouseDown={(event) => beginResize(event, column)} />
            </th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.client_id} className={selectedRowId === row.client_id ? 'is-selected' : undefined} onClick={() => setSelectedRowId(row.client_id)}>
              {visibleColumns.map((column) => {
                const pk = cellKey(row.client_id, column.key);
                const presentation = cellPresentation[pk];
                const focused = focusedCell?.clientId === row.client_id && focusedCell.colKey === column.key;
                const manualStatus = row.manual_cell_statuses?.[column.key];
                const statusToken = manualStatus?.presentation_token ?? null;
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
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined}
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
                      color: presentation?.color,
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
                              aria-label={column.label.trim() || 'ערך עמודה'}
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
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="nx-co-sheet__empty">לא נמצאו לקוחות.</p> : null}
    </div>
  );

  const modals = (
    <>
      {modalOpen && (
        <ClientWorkspaceModal
          open={modalOpen}
          workspace={modalData}
          loading={modalLoading}
          error={modalError}
          onClose={() => setModalOpen(false)}
          onSaveSuccess={() => {
            setModalOpen(false);
            reloadRegistry();
          }}
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
          clientName={notesModalClientName || 'לקוח'}
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
            <div className="nx-empty-note">אין הערות עדיין</div>
          ) : (
            <>
              {notesError && <div className="nx-alert-error">{notesError}</div>}

              {operationalNotes.length === 0 ? (
                <div className="nx-empty-note">אין הערות עדיין</div>
              ) : (
                <div className="nx-modal-notes-list">
                  {operationalNotes.map((n) => (
                    <div key={n.id} className="nx-note-card">
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                        <div className="nx-note-card-meta">
                          {n.type_label_he}
                          {n.reminder_at
                            ? ` · ${new Date(n.reminder_at).toLocaleString('he-IL', {
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
                            עריכה
                          </button>
                          <button
                            type="button"
                            className="nx-btn nx-btn-ghost"
                            style={{ color: '#2563eb' }}
                            onClick={() => deleteNote(n.id)}
                          >
                            מחיקה
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {conflict && (
                <div className="nx-conflict-panel">
                  <h3>{conflict.ui.title_he}</h3>
                  <p>{conflict.ui.message_he}</p>
                  <ul>
                    {conflict.conflicts.map((c, i) => (
                      <li key={i}>
                        <strong>{c.client_display_name ?? 'לקוח'}</strong> — {c.type_label_he}:{' '}
                        {c.body_preview}
                      </li>
                    ))}
                  </ul>
                  <div className="nx-modal-footer" style={{ paddingTop: 0 }}>
                    <button type="button" className="nx-btn nx-btn-primary" onClick={() => runSave(true)}>
                      {conflict.ui.button_create_anyway_he}
                    </button>
                    <button type="button" className="nx-btn nx-btn-secondary" onClick={() => setConflict(null)}>
                      {conflict.ui.button_change_time_he}
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
    return (
      <div
        className={`nx-co-sheet${fullscreenOpen ? ' nx-co-sheet--app-fullscreen' : ''}`}
        data-testid="client-operations-spreadsheet"
        data-fullscreen={fullscreenOpen ? 'true' : 'false'}
      >
        <h1 className="nx-co-sheet__title">{titleHe ?? 'תפעול לקוחות'}</h1>
        {renderSpreadsheetToolbar()}
        {error ? <div className="nx-co-sheet__error">{error}</div> : null}
        <div className={`nx-co-sheet__workspace${loading ? ' is-loading' : ''}`}>
          {loading ? <p className="nx-co-sheet__loading nx-co-sheet__loading--inline">טוען תקופה…</p> : null}
          {renderSpreadsheetTable()}
        <ClientOperationsPeriodSheetTabs
          availablePeriods={period?.available_periods ?? []}
          selectedPeriodKey={period?.selected_period_key ?? query?.operational_period_key ?? null}
          defaultPeriodKey={period?.default_period_key ?? null}
          disabled={loading}
          onSelectPeriod={(key) => flushDirtyBeforePeriodChange(key)}
        />
        </div>
        {commandError ? <div className="nx-co-sheet__error">{commandError}</div> : null}
        {userColumnPeriodSetup?.needed && (userColumnPeriodSetup.eligible_columns?.length ?? 0) > 0 && canEdit ? (
          <div className="nx-co-sheet__dialog-backdrop" role="presentation">
            <div className="nx-co-sheet__dialog" role="dialog" aria-modal="true" aria-label="עמודות לתקופה">
              <h2>{`עמודות לתקופה ${userColumnPeriodSetup.operational_period_key.slice(5)}.${userColumnPeriodSetup.operational_period_key.slice(2, 4)}`}</h2>
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
                הכל
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
                  אישור
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {columnSettingsTarget ? (
          <div className="nx-co-sheet__dialog-backdrop" role="presentation">
            <div className="nx-co-sheet__dialog" role="dialog" aria-modal="true" aria-label="הגדרות עמודה">
              <button type="button" className="nx-co-sheet__close" onClick={() => setColumnSettingsTarget(null)} aria-label="סגירה">×</button>
              <h2>הגדרות עמודה</h2>
              <p className="nx-co-sheet__dialog-subtitle">הצגה בתקופות</p>
              {columnSettingsTarget.legacy_baseline_required ? (
                <label>
                  תקופת התחלה למידע הקיים
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
                מהתקופה הנוכחית והלאה
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
                <button type="button" className="nx-co-sheet__btn" onClick={() => setColumnSettingsTarget(null)}>ביטול</button>
                <button type="button" className="nx-co-sheet__btn is-active" onClick={() => void saveColumnSettings()}>שמירה</button>
              </div>
            </div>
          </div>
        ) : null}
        {addColumnOpen ? (
          <div className="nx-co-sheet__dialog-backdrop" role="presentation">
            <div className="nx-co-sheet__dialog" role="dialog" aria-modal="true" aria-label="הוספת עמודה">
              <button type="button" className="nx-co-sheet__close" onClick={() => setAddColumnOpen(false)} aria-label="סגירה">×</button>
              <h2>הוספת עמודה</h2>
              <label>שם עמודה<input value={addColumnLabel} onChange={(event) => setAddColumnLabel(event.target.value)} autoFocus /></label>
              <label>סוג נתון<select value={addColumnDataType} onChange={(event) => setAddColumnDataType(event.target.value as typeof addColumnDataType)}><option value="text">טקסט</option><option value="number">מספר</option><option value="date">תאריך</option><option value="boolean">כן / לא</option></select></label>
              <div className="nx-co-sheet__dialog-actions"><button type="button" className="nx-co-sheet__btn" onClick={() => setAddColumnOpen(false)}>ביטול</button><button type="button" className="nx-co-sheet__btn is-active" onClick={() => void createColumn()} disabled={!addColumnLabel.trim()}>שמירה</button></div>
            </div>
          </div>
        ) : null}
        {modals}
      </div>
    );
  }

  return (
    <div>
      {showPageHeader ? (
        <PageHeader title="Nodex לקוחות" subtitle="Client registry (module v1 skeleton)" />
      ) : null}

      <SectionCard style={{ padding: 20 }}>
        {error && <div style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</div>}
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading…</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, direction: 'rtl' }}>
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
