import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
  loadClientOperationsColumnWidths,
  saveClientOperationsColumnWidths,
} from '../../lib/client-operations-column-widths.pure';
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

export type ClientOperationsRegistryRow = {
  client_id: string;
  client_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  payroll_flag: boolean | null;
  material_brought_flag: boolean | null;
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
  cell_kind: 'folder' | 'text' | 'notes' | 'custom' | 'checkbox';
  value_field: string | null;
  data_type?: 'text' | 'number' | 'date' | 'boolean';
  custom_column_id?: string;
  default_width_px?: number;
  visible: boolean;
  system: boolean;
  editable: boolean;
  freeze_default: boolean;
  align: 'right' | 'center' | 'left';
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

function cellKey(clientId: string, colKey: string): string {
  return `${clientId}::${colKey}`;
}

function displayForColumn(r: ClientOperationsRegistryRow, col: ClientOperationsRegistryColumn): string {
  const value = r.cells?.[col.key];
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
  query?: { q: string | null; sort_by: string | null; sort_dir: 'asc' | 'desc' | null };
  onQueryChange?: (next: { q: string | null; sort_by: string | null; sort_dir: 'asc' | 'desc' | null }) => void;
  onRegistryCommand?: (body: Record<string, unknown>) => Promise<unknown>;
  onApplyAggregate?: (aggregate: any) => void;
  widthScope?: { userId: string; organizationId: string };
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
    customColumnsCapability,
    query,
    onQueryChange,
    onRegistryCommand,
    onApplyAggregate,
    widthScope,
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
  const [focusedCell, setFocusedCell] = useState<{ clientId: string; colKey: string } | null>(null);
  const [searchDraft, setSearchDraft] = useState(query?.q ?? '');
  const [freezeOn, setFreezeOn] = useState(true);
  const [bordersOn, setBordersOn] = useState(true);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => new Set());
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [cellPresentation, setCellPresentation] = useState<Record<string, CellPresentation>>({});
  const [undoStack, setUndoStack] = useState<PresentationHistory[]>([]);
  const [redoStack, setRedoStack] = useState<PresentationHistory[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [addColumnLabel, setAddColumnLabel] = useState('');
  const [addColumnDataType, setAddColumnDataType] = useState<'text' | 'number' | 'date' | 'boolean'>('text');
  const [commandError, setCommandError] = useState('');

  useEffect(() => {
    setSearchDraft(query?.q ?? '');
  }, [query?.q]);

  useEffect(() => {
    if (!widthScope?.userId || !widthScope.organizationId) {
      setColumnWidths({});
      return;
    }
    setColumnWidths(loadClientOperationsColumnWidths(widthScope.userId, widthScope.organizationId));
  }, [widthScope?.organizationId, widthScope?.userId]);

  useEffect(() => {
    if (!fullscreenOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreenOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
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

  const applyPresentation = (patch: Partial<CellPresentation>) => {
    if (!focusedCell) return;
    const k = cellKey(focusedCell.clientId, focusedCell.colKey);
    setUndoStack((history) => [...history, { presentation: cellPresentation }]);
    setRedoStack([]);
    setCellPresentation((prev) => ({
      ...prev,
      [k]: { ...prev[k], ...patch },
    }));
  };

  const isCap = (id: string) => capById.get(id)?.available === true;
  const capTitle = (id: string) => {
    const c = capById.get(id);
    if (!c) return undefined;
    return c.available ? c.label_he : `${c.label_he}: ${c.reason_he ?? 'לא זמין'}`;
  };
  const canCreateColumn = isCap('add_column') && customColumnsCapability?.can_create !== false;
  const widthForColumn = (col: ClientOperationsRegistryColumn) =>
    columnWidths[col.key] ?? col.default_width_px ?? (col.cell_kind === 'folder' ? 44 : col.cell_kind === 'custom' ? 140 : 110);
  const saveColumnWidth = (key: string, width: number) => {
    const next = { ...columnWidths, [key]: width };
    setColumnWidths(next);
    if (widthScope?.userId && widthScope.organizationId) {
      saveClientOperationsColumnWidths(widthScope.userId, widthScope.organizationId, next);
    }
  };
  const beginResize = (event: ReactMouseEvent, column: ClientOperationsRegistryColumn) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthForColumn(column);
    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = startWidth + (document.dir === 'rtl' ? startX - moveEvent.clientX : moveEvent.clientX - startX);
      setColumnWidths((previous) => ({ ...previous, [column.key]: Math.min(480, Math.max(48, Math.round(nextWidth))) }));
    };
    const onUp = (upEvent: MouseEvent) => {
      const finalWidth = startWidth + (document.dir === 'rtl' ? startX - upEvent.clientX : upEvent.clientX - startX);
      saveColumnWidth(column.key, Math.min(480, Math.max(48, Math.round(finalWidth))));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const undoPresentation = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((history) => [...history, { presentation: cellPresentation }]);
    setCellPresentation(previous.presentation);
    setUndoStack((history) => history.slice(0, -1));
  };
  const redoPresentation = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((history) => [...history, { presentation: cellPresentation }]);
    setCellPresentation(next.presentation);
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
  const editCustomCell = async (row: ClientOperationsRegistryRow, column: ClientOperationsRegistryColumn) => {
    if (!canEdit || !column.editable || !column.custom_column_id || !onRegistryCommand) return;
    const current = displayForColumn(row, column);
    const value = window.prompt(column.label, current === '—' ? '' : current);
    if (value === null) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'set_client_operations_custom_column_value',
        client_id: row.client_id,
        column_id: column.custom_column_id,
        value,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'שמירת הערך נכשלה');
    }
  };
  const toggleMaterialBrought = async (row: ClientOperationsRegistryRow) => {
    if (!canEdit || !onRegistryCommand) return;
    setCommandError('');
    try {
      await onRegistryCommand({
        command: 'set_material_brought',
        client_id: row.client_id,
        value: !Boolean(row.material_brought_flag),
        query,
      });
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'שמירת חומר למע״מ נכשלה');
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

  const renderSpreadsheetToolbar = () => (
    <div className="nx-co-sheet__toolbar" role="toolbar" aria-label="כלי גיליון">
      <div className="nx-co-sheet__toolbar-group">
        <button type="button" className="nx-co-sheet__btn" disabled={!isCap('undo') || undoStack.length === 0} title={capTitle('undo')} onClick={undoPresentation}>
          בטל
        </button>
        <button type="button" className="nx-co-sheet__btn" disabled={!isCap('redo') || redoStack.length === 0} title={capTitle('redo')} onClick={redoPresentation}>
          בצע שוב
        </button>
      </div>

      <div className="nx-co-sheet__toolbar-group">
        <div className="nx-co-sheet__search">
          <input
            type="search"
            value={searchDraft}
            disabled={!isCap('search')}
            title={capTitle('search')}
            placeholder="חיפוש בטבלה…"
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isCap('search') && onQueryChange) {
                onQueryChange({
                  q: searchDraft.trim() || null,
                  sort_by: query?.sort_by ?? null,
                  sort_dir: query?.sort_dir ?? null,
                });
              }
            }}
          />
          <button
            type="button"
            className="nx-co-sheet__btn"
            disabled={!isCap('search')}
            title={capTitle('search')}
            onClick={() =>
              onQueryChange?.({
                q: searchDraft.trim() || null,
                sort_by: query?.sort_by ?? null,
                sort_dir: query?.sort_dir ?? null,
              })
            }
          >
            חפש
          </button>
        </div>
        <button type="button" className="nx-co-sheet__btn" disabled title={capTitle('filter')}>
          סינון
        </button>
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={!isCap('sort_asc') || !focusedCell || focusedCell.colKey === 'folder'}
          title={capTitle('sort_asc')}
          onClick={() =>
            onQueryChange?.({
              q: query?.q ?? null,
              sort_by: focusedCell?.colKey ?? null,
              sort_dir: 'asc',
            })
          }
        >
          מיון ↑
        </button>
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={!isCap('sort_desc') || !focusedCell || focusedCell.colKey === 'folder'}
          title={capTitle('sort_desc')}
          onClick={() =>
            onQueryChange?.({
              q: query?.q ?? null,
              sort_by: focusedCell?.colKey ?? null,
              sort_dir: 'desc',
            })
          }
        >
          מיון ↓
        </button>
      </div>

      <div className="nx-co-sheet__toolbar-group nx-co-sheet__toolbar-group--secondary">
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={!isCap('align_right') || !focusedCell}
          title={capTitle('align_right')}
          onClick={() => applyPresentation({ align: 'right' })}
        >
          יישור ימין
        </button>
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={!isCap('align_center') || !focusedCell}
          title={capTitle('align_center')}
          onClick={() => applyPresentation({ align: 'center' })}
        >
          מרכז
        </button>
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={!isCap('align_left') || !focusedCell}
          title={capTitle('align_left')}
          onClick={() => applyPresentation({ align: 'left' })}
        >
          יישור שמאל
        </button>
        <button
          type="button"
          className={`nx-co-sheet__btn${focusedCell && cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.wrap ? ' is-active' : ''}`}
          disabled={!isCap('wrap_text') || !focusedCell}
          title={capTitle('wrap_text')}
          onClick={() => {
            if (!focusedCell) return;
            const cur = cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.wrap;
            applyPresentation({ wrap: !cur });
          }}
        >
          גלישה
        </button>
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={!isCap('bold') || !focusedCell}
          title={capTitle('bold')}
          onClick={() => {
            if (!focusedCell) return;
            const cur = cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.bold;
            applyPresentation({ bold: !cur });
          }}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={!isCap('italic') || !focusedCell}
          title={capTitle('italic')}
          onClick={() => {
            if (!focusedCell) return;
            const cur = cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.italic;
            applyPresentation({ italic: !cur });
          }}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={!isCap('underline') || !focusedCell}
          title={capTitle('underline')}
          onClick={() => {
            if (!focusedCell) return;
            const cur = cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.underline;
            applyPresentation({ underline: !cur });
          }}
        >
          <span style={{ textDecoration: 'underline' }}>U</span>
        </button>
      </div>

      <div className="nx-co-sheet__toolbar-group">
        <button
          type="button"
          className={`nx-co-sheet__btn${freezeOn ? ' is-active' : ''}`}
          disabled={!isCap('freeze_columns')}
          title={capTitle('freeze_columns')}
          onClick={() => setFreezeOn((v) => !v)}
        >
          הקפאה
        </button>
        <button type="button" className="nx-co-sheet__btn" disabled={!canCreateColumn} title={capTitle('add_column')} onClick={() => setAddColumnOpen(true)}>
          + עמודה
        </button>
        <button
          type="button"
          className="nx-co-sheet__btn"
          disabled={capById.has('fullscreen') && !isCap('fullscreen')}
          title={capTitle('fullscreen') ?? 'מסך מלא'}
          onClick={() => setFullscreenOpen(true)}
        >
          ⊞ מסך מלא
        </button>
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
                צבע טקסט
                <input
                  className="nx-co-sheet__color"
                  type="color"
                  disabled={!isCap('text_color') || !focusedCell}
                  title={capTitle('text_color')}
                  onChange={(e) => applyPresentation({ color: e.target.value })}
                />
              </label>
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
                  value={focusedCell ? cellPresentation[cellKey(focusedCell.clientId, focusedCell.colKey)]?.numberFormat ?? 'general' : 'general'}
                  disabled={!isCap('number_format') || !focusedCell}
                  onChange={(e) => applyPresentation({ numberFormat: e.target.value as CellPresentation['numberFormat'] })}
                >
                  <option value="general">כללי</option><option value="number">מספר</option><option value="currency">מטבע</option><option value="percent">אחוז</option><option value="date">תאריך</option>
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
              <button
                type="button"
                className="nx-co-sheet__btn"
                disabled={!isCap('toggle_columns')}
                title={capTitle('toggle_columns')}
                onClick={() => {
                  setShowColumnPanel((v) => !v);
                  setMoreOpen(false);
                }}
              >
                הצג / הסתר עמודות
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {/* Keep capability ids referenced for tests / future collapse */}
      <span hidden>{[...primaryToolbarIds, ...moreToolbarIds].join(',')}</span>
    </div>
  );

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
      const value = displayForColumn(r, col);
      return canEdit && col.editable ? (
        <button
          type="button"
          className="nx-co-sheet__custom-cell"
          onDoubleClick={() => void editCustomCell(r, col)}
          title="לחיצה כפולה לעריכה"
        >
          {value}
        </button>
      ) : (
        value
      );
    }
    if (col.cell_kind === 'checkbox') {
      const checked = Boolean(r.material_brought_flag);
      return (
        <input
          type="checkbox"
          className="nx-co-sheet__checkbox"
          checked={checked}
          disabled={!canEdit || !col.editable || !onRegistryCommand}
          aria-label={`${col.label} ${r.client_name ?? ''}`}
          onChange={() => void toggleMaterialBrought(r)}
          onClick={(event) => event.stopPropagation()}
        />
      );
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
    return displayForColumn(r, col);
  };

  const renderSpreadsheetTable = () => (
    <div className="nx-co-sheet__canvas">
      <table className={`nx-co-sheet__table${freezeOn ? ' is-frozen' : ''}${bordersOn ? '' : ' is-borders-off'}`}>
        <colgroup>
          {visibleColumns.map((column) => <col key={column.key} style={{ width: widthForColumn(column) }} />)}
        </colgroup>
        <thead><tr>
          {visibleColumns.map((column) => (
            <th key={column.key} data-col={column.key} data-freeze={column.freeze_default ? 'true' : 'false'} style={{ textAlign: column.align }}>
              {column.label}
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
                return (
                  <td
                    key={column.key} data-col={column.key} data-freeze={column.freeze_default ? 'true' : 'false'}
                    className={focused ? 'is-focused' : undefined}
                    onClick={(event) => { event.stopPropagation(); setSelectedRowId(row.client_id); setFocusedCell({ clientId: row.client_id, colKey: column.key }); }}
                    style={{ textAlign: presentation?.align ?? column.align, whiteSpace: presentation?.wrap ? 'pre-wrap' : undefined, fontWeight: presentation?.bold ? 700 : undefined, fontStyle: presentation?.italic ? 'italic' : undefined, textDecoration: presentation?.underline ? 'underline' : undefined, color: presentation?.color, background: presentation?.fill }}
                  >
                    {column.cell_kind === 'custom'
                      ? canEdit && column.editable
                        ? <button type="button" className="nx-co-sheet__custom-cell" onDoubleClick={() => void editCustomCell(row, column)} title="לחיצה כפולה לעריכה">{formatPresentationValue(displayForColumn(row, column), column, presentation)}</button>
                        : formatPresentationValue(displayForColumn(row, column), column, presentation)
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
      <div className="nx-co-sheet" data-testid="client-operations-spreadsheet">
        <h1 className="nx-co-sheet__title">{titleHe ?? 'תפעול לקוחות'}</h1>
        {renderSpreadsheetToolbar()}
        {showColumnPanel ? (
          <div className="nx-co-sheet__columns-panel">
            {columns
              .filter((c) => c.cell_kind !== 'folder')
              .map((c) => (
                <label key={c.key}>
                  <input
                    type="checkbox"
                    checked={!hiddenColumns.has(c.key)}
                    onChange={() => {
                      setHiddenColumns((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.key)) next.delete(c.key);
                        else next.add(c.key);
                        return next;
                      });
                    }}
                  />
                  {c.label}
                </label>
              ))}
          </div>
        ) : null}
        {error ? <div className="nx-co-sheet__error">{error}</div> : null}
        {loading ? (
          <p className="nx-co-sheet__loading">טוען…</p>
        ) : (
          renderSpreadsheetTable()
        )}
        {commandError ? <div className="nx-co-sheet__error">{commandError}</div> : null}
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
        {fullscreenOpen ? (
          <div className="nx-co-sheet__fullscreen" role="dialog" aria-modal="true" aria-label="גיליון במסך מלא">
            <button type="button" className="nx-co-sheet__close" onClick={() => setFullscreenOpen(false)} aria-label="סגירת מסך מלא">×</button>
            <h1 className="nx-co-sheet__title">{titleHe ?? 'תפעול לקוחות'}</h1>
            {renderSpreadsheetToolbar()}
            {renderSpreadsheetTable()}
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
