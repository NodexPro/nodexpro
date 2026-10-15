/**
 * Client Operations ToDo board UI (Stage 5B).
 * Overlay over ניהול לקוחות — sticky board + create/edit + archive.
 * Frontend is render-only; workspace comes from Stage 4 CO context.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiJson } from '../../api/client';
import {
  CLIENT_OPERATIONS_TODO_TASK_TEXT_MAX,
  encodeTodoPriorityForSubmit,
  formatTodoPriorityLabelHe,
  groupTodosByPriorityLane,
  TODO_PRIORITY_LANES,
  todoPriorityToLaneId,
} from '../../lib/client-operations-todo-board.pure';
import {
  TODO_CLIENT_PICKER_DEBOUNCE_MS,
  TODO_CLIENT_PICKER_VISIBLE_LIMIT,
  type TodoClientPickerOption,
} from '../../lib/client-operations-todo-client-picker.pure';
import {
  createProgressNoteAutosaver,
  progressNoteSaveStateLabelHe,
  type ProgressNoteAutosaver,
  type ProgressNoteSaveState,
} from '../../lib/client-operations-todo-progress-note-autosave.pure';
import { ClientOperationsTodoClientPicker } from './ClientOperationsTodoClientPicker';
import { ClientOperationsTodoCompleteModal } from './ClientOperationsTodoCompleteModal';
import {
  ClientOperationsTodoNotePopover,
  useDismissOnOutsidePointer,
} from './ClientOperationsTodoNotePopover';
import {
  moduleClientOperationsTodoArchive,
  moduleClientOperationsTodoBoard,
  moduleClientOperationsTodoClientOptions,
  moduleClientOperationsTodoCommands,
  type ClientOperationsTodoWorkspaceQuery,
} from '../../lib/client-operations-todo-url.pure';

export type ClientOperationsTodoCard = {
  id: string;
  /** Backend-ready client presentation; `is_one_time` / `id: null` = one-time client (not a Core client). */
  client: { id: string | null; display_name: string | null; tax_id: string | null; is_one_time: boolean };
  task_text: string;
  priority: 1 | 2 | 3 | 4 | null;
  priority_presentation_token?: string;
  /** שלב טיפול — optional free text from the backend (never a status). */
  progress_note: string | null;
  /** סיבת סגירה — archive column; null for active tasks and tasks closed without a reason. */
  completion_reason: string | null;
  created_at: string;
  created_by?: { user_id: string | null; display_name: string | null };
  completed_at: string | null;
  completed_by?: { user_id: string | null; display_name: string | null };
  allowed_actions: string[];
};

export type ClientOperationsTodoBoardAggregate = {
  title_he?: string;
  workspace?: {
    scope_kind: string;
    label_he: string;
    workspace_subject_user_id: string | null;
    selector_visible?: boolean;
  };
  summary?: { active_total: number; page_size: number };
  pagination?: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_prev: boolean;
    has_next: boolean;
  };
  tasks: ClientOperationsTodoCard[];
  /** Backend-owned input limits for שלב טיפול / סיבת סגירה. */
  field_limits?: { progress_note_max_length: number; completion_reason_max_length: number };
  available_clients_hint?: {
    search_endpoint?: string;
    one_time_client?: { allowed: boolean; name_max_length: number; tax_id_max_length: number };
  };
  allowed_actions?: string[];
  query?: {
    page: number;
    q: string | null;
    workspace_scope: string | null;
    workspace_subject_user_id: string | null;
  };
};

export type ClientOperationsTodoArchiveAggregate = {
  title_he?: string;
  workspace?: { label_he: string };
  summary?: { archive_total: number; page_size: number };
  pagination?: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_prev: boolean;
    has_next: boolean;
  };
  tasks: ClientOperationsTodoCard[];
  allowed_actions?: string[];
  query?: {
    page: number;
    q: string | null;
    filter_priority: string | null;
  };
};

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceQuery: ClientOperationsTodoWorkspaceQuery;
  workspaceLabelHe: string | null;
  canEdit: boolean;
};

function formatDateHe(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('he-IL');
}

export function ClientOperationsTodoBoardModal({
  open,
  onClose,
  workspaceQuery: workspaceQueryProp,
  workspaceLabelHe,
  canEdit,
}: Props) {
  // The parent passes a fresh object literal on every render. Depending on its identity re-created every
  // callback below and re-ran the open effect (board refetch + closing open forms) on each parent render.
  // Only the two primitives are the workspace identity.
  const wsScope = workspaceQueryProp.workspace_scope ?? null;
  const wsSubject = workspaceQueryProp.workspace_subject_user_id ?? null;
  const workspaceQuery = useMemo<ClientOperationsTodoWorkspaceQuery>(
    () => ({ workspace_scope: wsScope, workspace_subject_user_id: wsSubject }),
    [wsScope, wsSubject],
  );
  const [board, setBoard] = useState<ClientOperationsTodoBoardAggregate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<ClientOperationsTodoCard | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archive, setArchive] = useState<ClientOperationsTodoArchiveAggregate | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [archivePage, setArchivePage] = useState(1);
  const [archiveSearchDraft, setArchiveSearchDraft] = useState('');
  const [archiveSearchQ, setArchiveSearchQ] = useState('');
  const [archivePriority, setArchivePriority] = useState('all');
  const [busyTodoId, setBusyTodoId] = useState<string | null>(null);
  // Completion confirmation (סיום משימה): the ToDo is completed only after an explicit confirmation.
  const [completeTask, setCompleteTask] = useState<ClientOperationsTodoCard | null>(null);
  const [completeReason, setCompleteReason] = useState('');
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeError, setCompleteError] = useState('');

  const boardSeqRef = useRef(0);
  const boardAbortRef = useRef<AbortController | null>(null);
  const archiveSeqRef = useRef(0);
  const archiveAbortRef = useRef<AbortController | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const archiveSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsKey = `${workspaceQuery.workspace_scope ?? ''}\u001f${workspaceQuery.workspace_subject_user_id ?? ''}`;

  const loadBoard = useCallback(
    async (opts: { page: number; q: string; quiet?: boolean }) => {
      boardAbortRef.current?.abort();
      const ac = new AbortController();
      boardAbortRef.current = ac;
      const seq = ++boardSeqRef.current;
      if (!opts.quiet) setLoading(true);
      setError('');
      try {
        const data = await apiJson<ClientOperationsTodoBoardAggregate>(
          moduleClientOperationsTodoBoard({
            ...workspaceQuery,
            page: opts.page,
            q: opts.q || null,
          }),
          { signal: ac.signal },
        );
        if (seq !== boardSeqRef.current) return;
        setBoard(data);
        if (data.pagination?.page) setPage(data.pagination.page);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (seq !== boardSeqRef.current) return;
        setError(e instanceof Error ? e.message : 'שגיאה בטעינת הלוח');
      } finally {
        if (seq === boardSeqRef.current) setLoading(false);
      }
    },
    [workspaceQuery],
  );

  const loadArchive = useCallback(
    async (opts: { page: number; q: string; filter_priority: string }) => {
      archiveAbortRef.current?.abort();
      const ac = new AbortController();
      archiveAbortRef.current = ac;
      const seq = ++archiveSeqRef.current;
      setArchiveLoading(true);
      setArchiveError('');
      try {
        const data = await apiJson<ClientOperationsTodoArchiveAggregate>(
          moduleClientOperationsTodoArchive({
            ...workspaceQuery,
            page: opts.page,
            q: opts.q || null,
            filter_priority: opts.filter_priority === 'all' ? null : opts.filter_priority,
          }),
          { signal: ac.signal },
        );
        if (seq !== archiveSeqRef.current) return;
        setArchive(data);
        if (data.pagination?.page) setArchivePage(data.pagination.page);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (seq !== archiveSeqRef.current) return;
        setArchiveError(e instanceof Error ? e.message : 'שגיאה בטעינת הארכיון');
      } finally {
        if (seq === archiveSeqRef.current) setArchiveLoading(false);
      }
    },
    [workspaceQuery],
  );

  useEffect(() => {
    if (!open) return;
    setPage(1);
    setSearchDraft('');
    setSearchQ('');
    setCreateOpen(false);
    setEditTask(null);
    setCompleteTask(null);
    setArchiveOpen(false);
    void loadBoard({ page: 1, q: '' });
    return () => {
      boardAbortRef.current?.abort();
      archiveAbortRef.current?.abort();
    };
  }, [open, wsKey, loadBoard]);

  useEffect(() => {
    if (!open || !archiveOpen) return;
    void loadArchive({ page: archivePage, q: archiveSearchQ, filter_priority: archivePriority });
  }, [open, archiveOpen, archivePage, archiveSearchQ, archivePriority, loadArchive]);

  useEffect(() => {
    if (!open) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      const next = searchDraft.trim();
      // Nothing new to ask the backend (e.g. the draft was reset on open, or typed back to the applied text).
      if (next === searchQ) return;
      setSearchQ(next);
      setPage(1);
      void loadBoard({ page: 1, q: next, quiet: true });
    }, 280);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchDraft]); // eslint-disable-line react-hooks/exhaustive-deps -- debounce only on draft

  useEffect(() => {
    if (!open || !archiveOpen) return;
    if (archiveSearchTimerRef.current) clearTimeout(archiveSearchTimerRef.current);
    archiveSearchTimerRef.current = setTimeout(() => {
      setArchiveSearchQ(archiveSearchDraft.trim());
      setArchivePage(1);
    }, 280);
    return () => {
      if (archiveSearchTimerRef.current) clearTimeout(archiveSearchTimerRef.current);
    };
  }, [archiveSearchDraft, open, archiveOpen]);

  const applyBoardAggregate = useCallback((data: ClientOperationsTodoBoardAggregate) => {
    setBoard(data);
    if (data.pagination?.page) setPage(data.pagination.page);
    if (data.query?.q != null) {
      setSearchQ(data.query.q);
      setSearchDraft(data.query.q);
    }
  }, []);

  const runCommand = useCallback(
    async (body: Record<string, unknown>) => {
      const data = await apiJson<
        ClientOperationsTodoBoardAggregate | ClientOperationsTodoArchiveAggregate
      >(moduleClientOperationsTodoCommands(), {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          query: {
            workspace_scope: workspaceQuery.workspace_scope,
            workspace_subject_user_id: workspaceQuery.workspace_subject_user_id,
            page,
            q: searchQ || null,
          },
        }),
      });
      return data;
    },
    [workspaceQuery, page, searchQ],
  );

  // The complete action only OPENS the confirmation dialog; nothing is sent until the user confirms.
  const onComplete = (task: ClientOperationsTodoCard) => {
    if (!task.allowed_actions.includes('complete_client_operations_todo')) return;
    setCompleteReason('');
    setCompleteError('');
    setCompleteTask(task);
  };

  const cancelComplete = useCallback(() => {
    setCompleteTask(null);
    setCompleteReason('');
    setCompleteError('');
  }, []);

  const confirmComplete = async () => {
    const task = completeTask;
    if (!task || completeBusy) return;
    setCompleteBusy(true);
    setCompleteError('');
    try {
      // ONE command: completion + the optional reason are persisted atomically by the backend.
      const data = (await runCommand({
        command: 'complete_client_operations_todo',
        todo_id: task.id,
        completion_reason: completeReason.trim() || null,
      })) as ClientOperationsTodoBoardAggregate;
      applyBoardAggregate(data);
      setCompleteTask(null);
      setCompleteReason('');
      setEditTask(null);
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'שגיאה בסימון הושלם');
    } finally {
      setCompleteBusy(false);
    }
  };

  const onReopen = async (task: ClientOperationsTodoCard) => {
    setBusyTodoId(task.id);
    setArchiveError('');
    try {
      const data = (await runCommand({
        command: 'reopen_client_operations_todo',
        todo_id: task.id,
        return_archive: true,
        board_page: page,
        board_q: searchQ || null,
        query: {
          workspace_scope: workspaceQuery.workspace_scope,
          workspace_subject_user_id: workspaceQuery.workspace_subject_user_id,
          page: archivePage,
          q: archiveSearchQ || null,
          filter_priority: archivePriority === 'all' ? null : archivePriority,
          board_page: page,
          board_q: searchQ || null,
        },
      })) as {
        board?: ClientOperationsTodoBoardAggregate;
        archive?: ClientOperationsTodoArchiveAggregate;
        tasks?: ClientOperationsTodoCard[];
      };
      // Canonical reopen truth: { board, archive } — no corrective GET.
      if (data.board && data.archive) {
        applyBoardAggregate(data.board);
        setArchive(data.archive);
      } else if (data.tasks) {
        setArchive(data as ClientOperationsTodoArchiveAggregate);
      }
    } catch (e) {
      setArchiveError(e instanceof Error ? e.message : 'שגיאה בפתיחה מחדש');
    } finally {
      setBusyTodoId(null);
    }
  };

  const closeArchive = useCallback(() => {
    setArchiveOpen(false);
  }, []);

  const onBoardKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (completeTask) {
      // The confirmation dialog handles its own Escape; this is only a safety net (never completes).
      if (!completeBusy) cancelComplete();
      return;
    }
    if (createOpen) {
      setCreateOpen(false);
      return;
    }
    if (editTask) {
      setEditTask(null);
      return;
    }
    if (archiveOpen) {
      closeArchive();
      return;
    }
    onClose();
  };

  if (!open) return null;

  const lanes = groupTodosByPriorityLane(board?.tasks ?? []);
  const allowed = board?.allowed_actions ?? [];
  const canCreate = canEdit && allowed.includes('create_client_operations_todo');
  const label = board?.workspace?.label_he ?? workspaceLabelHe ?? '';
  const totalPages = board?.pagination?.total_pages ?? 1;
  const activeTotal = board?.summary?.active_total ?? board?.tasks?.length ?? 0;

  return createPortal(
    <div
      className="nx-co-todo-overlay"
      role="presentation"
      data-testid="client-operations-todo-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !createOpen && !editTask && !archiveOpen && !completeTask) onClose();
      }}
      onKeyDown={onBoardKeyDown}
    >
      <div
        className="nx-co-todo-board"
        role="dialog"
        aria-modal="true"
        aria-label="ToDo List"
        data-testid="client-operations-todo-board"
        tabIndex={-1}
      >
        <div className="nx-co-todo-board__topbar">
          <div className="nx-co-todo-board__brand">
            <span className="nx-co-todo-board__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                <path
                  fill="currentColor"
                  d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 1.5V9h4.5L14 4.5zM8 12h8v1.5H8V12zm0 3h8v1.5H8V15z"
                />
              </svg>
            </span>
            <h2 className="nx-co-todo-board__title">ToDo List</h2>
          </div>
          <div className="nx-co-todo-board__topbar-start">
            {label ? <span className="nx-co-todo-board__workspace">{label}</span> : null}
            {canCreate ? (
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact nx-btn-primary nx-co-todo-btn"
                data-testid="client-operations-todo-create"
                onClick={() => setCreateOpen(true)}
              >
                + משימה חדשה
              </button>
            ) : null}
            <input
              className="nx-co-todo-board__search"
              type="search"
              placeholder="חיפוש לקוח / ת.ז. / משימה"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              aria-label="חיפוש בלוח"
              data-testid="client-operations-todo-board-search"
            />
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact nx-btn-secondary nx-co-todo-btn"
              data-testid="client-operations-todo-archive-open"
              onClick={() => {
                setArchiveOpen(true);
                setArchivePage(1);
              }}
            >
              ארכיון
            </button>
          </div>
          <div className="nx-co-todo-board__topbar-end">
            <span className="nx-co-todo-board__count" aria-live="polite">
              {activeTotal}
            </span>
            <div className="nx-co-todo-board__pager">
              <button
                type="button"
                className="nx-co-todo-board__pager-btn"
                disabled={!board?.pagination?.has_prev || loading}
                onClick={() => {
                  const next = Math.max(1, page - 1);
                  setPage(next);
                  void loadBoard({ page: next, q: searchQ, quiet: true });
                }}
                aria-label="עמוד קודם"
              >
                ‹
              </button>
              <span className="nx-co-todo-board__pager-label">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="nx-co-todo-board__pager-btn"
                disabled={!board?.pagination?.has_next || loading}
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  void loadBoard({ page: next, q: searchQ, quiet: true });
                }}
                aria-label="עמוד הבא"
              >
                ›
              </button>
            </div>
          </div>
          <button
            type="button"
            className="nx-co-todo-board__close"
            onClick={onClose}
            aria-label="סגור"
            data-testid="client-operations-todo-board-close"
          >
            ×
          </button>
        </div>

        {error ? (
          <div className="nx-co-todo-board__error" role="alert">
            {error}
          </div>
        ) : null}

        <div className={`nx-co-todo-board__body${loading ? ' is-loading' : ''}`}>
          {loading && !board ? (
            <div className="nx-co-todo-board__skeleton" aria-busy="true">
              <div className="nx-co-todo-board__skeleton-line" />
              <div className="nx-co-todo-board__skeleton-line" />
              <div className="nx-co-todo-board__skeleton-line" />
            </div>
          ) : (
            <div className="nx-co-todo-lanes" data-testid="client-operations-todo-lanes">
              {activeTotal === 0 && !searchQ ? (
                <p className="nx-co-todo-board__empty-note" data-testid="client-operations-todo-empty">
                  אין משימות פתוחות
                </p>
              ) : null}
              {TODO_PRIORITY_LANES.map((lane) => (
                <section
                  key={lane.id}
                  className={`nx-co-todo-lane nx-co-todo-lane--${lane.accent}`}
                  data-lane={lane.id}
                  aria-label={`${lane.visual_number} ${lane.label_he}`}
                >
                  <div className="nx-co-todo-lane__rail">
                    <span className="nx-co-todo-lane__num">{lane.visual_number}</span>
                    <span className="nx-co-todo-lane__label">{lane.label_he}</span>
                  </div>
                  <div className="nx-co-todo-lane__cards">
                    {lanes[lane.id].map((task) => (
                      <TodoStickyCard
                        key={task.id}
                        task={task}
                        accent={lane.accent}
                        busy={busyTodoId === task.id}
                        onDoubleClick={() => setEditTask(task)}
                        onComplete={() => onComplete(task)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {createOpen ? (
        <TodoFormModal
          mode="create"
          workspaceQuery={workspaceQuery}
          oneTimeClient={board?.available_clients_hint?.one_time_client ?? null}
          fieldLimits={board?.field_limits ?? null}
          boardView={{ page, q: searchQ || null }}
          onBoardRefreshed={applyBoardAggregate}
          onClose={() => setCreateOpen(false)}
          onSaved={(agg) => {
            applyBoardAggregate(agg);
            setCreateOpen(false);
          }}
        />
      ) : null}

      {editTask ? (
        <TodoFormModal
          mode="edit"
          task={editTask}
          workspaceQuery={workspaceQuery}
          oneTimeClient={board?.available_clients_hint?.one_time_client ?? null}
          fieldLimits={board?.field_limits ?? null}
          boardView={{ page, q: searchQ || null }}
          onBoardRefreshed={applyBoardAggregate}
          onClose={() => setEditTask(null)}
          onSaved={(agg) => {
            applyBoardAggregate(agg);
            setEditTask(null);
          }}
          onRequestComplete={(t) => onComplete(t)}
        />
      ) : null}

      {completeTask ? (
        <ClientOperationsTodoCompleteModal
          clientLabel={completeTask.client.display_name}
          taskText={completeTask.task_text}
          reason={completeReason}
          onReasonChange={setCompleteReason}
          reasonMaxLength={board?.field_limits?.completion_reason_max_length}
          busy={completeBusy}
          error={completeError}
          onConfirm={() => void confirmComplete()}
          onCancel={cancelComplete}
        />
      ) : null}

      {archiveOpen ? (
        <div
          className="nx-co-todo-archive-overlay"
          role="presentation"
          data-testid="client-operations-todo-archive-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeArchive();
          }}
        >
          <div
            className="nx-co-todo-archive"
            role="dialog"
            aria-modal="true"
            aria-label="ארכיון משימות"
            data-testid="client-operations-todo-archive"
          >
            <div className="nx-co-todo-archive__header">
              <h2 className="nx-co-todo-archive__title">ארכיון משימות</h2>
              <div className="nx-co-todo-archive__tools">
                <input
                  className="nx-co-todo-board__search"
                  type="search"
                  placeholder="חיפוש בארכיון"
                  value={archiveSearchDraft}
                  onChange={(e) => setArchiveSearchDraft(e.target.value)}
                  aria-label="חיפוש בארכיון"
                />
                <select
                  className="nx-co-todo-archive__filter"
                  value={archivePriority}
                  onChange={(e) => {
                    setArchivePriority(e.target.value);
                    setArchivePage(1);
                  }}
                  aria-label="סינון עדיפות"
                >
                  <option value="all">כל העדיפויות</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="none">ללא עדיפות</option>
                </select>
                <button
                  type="button"
                  className="nx-co-todo-board__close"
                  onClick={closeArchive}
                  aria-label="סגור ארכיון"
                  data-testid="client-operations-todo-archive-close"
                >
                  ×
                </button>
              </div>
            </div>
            {archiveError ? (
              <div className="nx-co-todo-board__error" role="alert">
                {archiveError}
              </div>
            ) : null}
            <div className="nx-co-todo-archive__table-wrap">
              {archiveLoading && !archive ? (
                <p className="nx-co-todo-board__empty">טוען ארכיון…</p>
              ) : (
                <table className="nx-co-todo-archive__table">
                  <thead>
                    <tr>
                      <th>לקוח</th>
                      <th>ת.ז./ח.פ.</th>
                      <th>משימה</th>
                      <th>עדיפות</th>
                      <th>נוצר בתאריך</th>
                      <th>הושלם בתאריך</th>
                      <th>הושלם על ידי</th>
                      <th>סיבת סגירה</th>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(archive?.tasks ?? []).map((t) => (
                      <tr key={t.id}>
                        <td>
                          {t.client.display_name ?? '—'}
                          {t.client.is_one_time ? (
                            <span className="nx-co-todo-one-time-tag">חד פעמי</span>
                          ) : null}
                        </td>
                        <td>{t.client.tax_id ?? '—'}</td>
                        <td>{t.task_text}</td>
                        <td>
                          <span className={`nx-co-todo-archive__pri nx-co-todo-archive__pri--${todoPriorityToLaneId(t.priority)}`}>
                            {formatTodoPriorityLabelHe(t.priority)}
                          </span>
                        </td>
                        <td>{formatDateHe(t.created_at)}</td>
                        <td>{formatDateHe(t.completed_at)}</td>
                        <td>{t.completed_by?.display_name ?? '—'}</td>
                        <td
                          className={
                            t.completion_reason
                              ? 'nx-co-todo-archive__reason nx-co-todo-archive__reason--set'
                              : 'nx-co-todo-archive__reason'
                          }
                          data-testid="client-operations-todo-archive-reason"
                        >
                          {t.completion_reason ?? '—'}
                        </td>
                        <td>
                          {t.allowed_actions.includes('reopen_client_operations_todo') ? (
                            <button
                              type="button"
                              className="nx-btn nx-btn-taxes-compact nx-btn-secondary nx-co-todo-btn"
                              disabled={busyTodoId === t.id}
                              onClick={() => void onReopen(t)}
                            >
                              פתח מחדש
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="nx-co-todo-archive__footer">
              <button
                type="button"
                className="nx-co-todo-board__pager-btn"
                disabled={!archive?.pagination?.has_prev}
                onClick={() => setArchivePage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              <span>
                {archive?.pagination?.page ?? 1} / {archive?.pagination?.total_pages ?? 1}
              </span>
              <button
                type="button"
                className="nx-co-todo-board__pager-btn"
                disabled={!archive?.pagination?.has_next}
                onClick={() => setArchivePage((p) => p + 1)}
              >
                ›
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function TodoStickyCard(props: {
  task: ClientOperationsTodoCard;
  accent: 'red' | 'orange' | 'gold' | 'green' | 'blue';
  busy: boolean;
  onDoubleClick: () => void;
  onComplete: () => void;
}) {
  const { task, accent, busy, onDoubleClick, onComplete } = props;
  const canComplete = task.allowed_actions.includes('complete_client_operations_todo');
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const popoverId = useId();
  // שלב טיפול popover: hover, keyboard focus, or tap/click (pinned). Escape dismisses it.
  const note = task.progress_note;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const noteVisible = Boolean(note) && !dismissed && (hovered || focused || pinned);
  const unpin = useCallback(() => setPinned(false), []);
  useDismissOnOutsidePointer(pinned, cardRef, unpin);

  const onClick = (e: ReactMouseEvent) => {
    // Distinguish single vs double via timer clear on dblclick.
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
    }, 250);
    // Tap / click toggles the note popover (touch has no hover).
    if (note) {
      setDismissed(false);
      setPinned((p) => !p);
    }
    e.stopPropagation();
  };

  return (
    <article
      ref={cardRef}
      className={`nx-co-todo-sticky nx-co-todo-sticky--${accent}`}
      data-testid="client-operations-todo-card"
      data-todo-id={task.id}
      data-has-note={note ? 'true' : undefined}
      tabIndex={note ? 0 : undefined}
      aria-describedby={noteVisible ? popoverId : undefined}
      onClick={onClick}
      onMouseEnter={() => {
        setDismissed(false);
        setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        setDismissed(false);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && noteVisible) {
          // Close the popover only — not the board.
          e.stopPropagation();
          setDismissed(true);
          setPinned(false);
        }
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        if (clickTimer.current) clearTimeout(clickTimer.current);
        setPinned(false);
        onDoubleClick();
      }}
    >
      <span className="nx-co-todo-sticky__pip" aria-hidden="true" />
      <div className="nx-co-todo-sticky__client">
        {task.client.display_name ?? 'לקוח'}
        {task.client.is_one_time ? <span className="nx-co-todo-one-time-tag">חד פעמי</span> : null}
      </div>
      <div className="nx-co-todo-sticky__tax">{task.client.tax_id ?? '—'}</div>
      <div className="nx-co-todo-sticky__text">{task.task_text}</div>
      <div className="nx-co-todo-sticky__date">{formatDateHe(task.created_at)}</div>
      {canComplete ? (
        <button
          type="button"
          className="nx-co-todo-sticky__done"
          title="סמן כהושלם"
          aria-label="סמן כהושלם"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onComplete();
          }}
        >
          ✓
        </button>
      ) : null}
      {noteVisible && note ? (
        <ClientOperationsTodoNotePopover id={popoverId} note={note} anchorRef={cardRef} />
      ) : null}
    </article>
  );
}

function TodoFormModal(props: {
  mode: 'create' | 'edit';
  task?: ClientOperationsTodoCard;
  workspaceQuery: ClientOperationsTodoWorkspaceQuery;
  /** Backend-owned one-time client capability (vailable_clients_hint.one_time_client). */
  oneTimeClient: { allowed: boolean; name_max_length: number; tax_id_max_length: number } | null;
  /** Backend-owned input limits (aggregate `field_limits`). */
  fieldLimits: { progress_note_max_length: number; completion_reason_max_length: number } | null;
  /** Board page / search the user is looking at — sent with background saves so the view is not reset. */
  boardView: { page: number; q: string | null };
  /** A background command (progress-note autosave) returned the full refreshed board aggregate. */
  onBoardRefreshed: (agg: ClientOperationsTodoBoardAggregate) => void;
  onClose: () => void;
  onSaved: (agg: ClientOperationsTodoBoardAggregate) => void;
  /** Opens the completion confirmation (the form never completes a ToDo by itself). */
  onRequestComplete?: (task: ClientOperationsTodoCard) => void;
}) {
  const { mode, task, workspaceQuery, oneTimeClient, fieldLimits, boardView, onBoardRefreshed, onClose, onSaved, onRequestComplete } = props;
  const oneTimeAllowed = oneTimeClient?.allowed === true;
  // Edit: the backend tells which kind of client the ToDo has (client.is_one_time) — never inferred here.
  const editingOneTime = mode === 'edit' && task?.client.is_one_time === true;
  const [clientId, setClientId] = useState(task?.client.id ?? '');
  const [clientLabel, setClientLabel] = useState(task?.client.display_name ?? '');
  // One-time client name: chosen via the typed-name option (create) or edited in place (edit).
  const [oneTimeName, setOneTimeName] = useState(editingOneTime ? (task?.client.display_name ?? '') : '');
  const [taxId, setTaxId] = useState(task?.client.tax_id ?? '');
  const [clientQ, setClientQ] = useState('');
  const [clientOptions, setClientOptions] = useState<TodoClientPickerOption[]>([]);
  const [clientOptionsHasMore, setClientOptionsHasMore] = useState(false);
  const [clientOptionsLoading, setClientOptionsLoading] = useState(false);
  const [taskText, setTaskText] = useState(task?.task_text ?? '');
  const [priority, setPriority] = useState(
    task?.priority == null ? 'none' : String(task.priority),
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // שלב טיפול: optional free text. Create sends it with the create command; edit AUTO-SAVES it through the
  // named `update_client_operations_todo_progress_note` command (debounced, serialized, error visible).
  const [progressNote, setProgressNote] = useState(task?.progress_note ?? '');
  const [noteSave, setNoteSave] = useState<ProgressNoteSaveState>({ status: 'idle', error: null });
  const noteStateId = useId();
  const saverRef = useRef<ProgressNoteAutosaver | null>(null);
  const noteSaveCommandRef = useRef<(value: string) => Promise<void>>(async () => undefined);
  noteSaveCommandRef.current = async (value: string) => {
    if (!task) return;
    const data = await apiJson<ClientOperationsTodoBoardAggregate>(moduleClientOperationsTodoCommands(), {
      method: 'POST',
      body: JSON.stringify({
        command: 'update_client_operations_todo_progress_note',
        todo_id: task.id,
        progress_note: value,
        query: {
          workspace_scope: workspaceQuery.workspace_scope,
          workspace_subject_user_id: workspaceQuery.workspace_subject_user_id,
          page: boardView.page,
          q: boardView.q,
        },
      }),
    });
    // Full refreshed aggregate = the truth; the field itself keeps what the user typed (never overwritten).
    onBoardRefreshed(data);
  };
  const taskId = mode === 'edit' ? task?.id : undefined;
  useEffect(() => {
    if (!taskId) return undefined;
    const saver = createProgressNoteAutosaver({
      initialValue: task?.progress_note ?? '',
      save: (value) => noteSaveCommandRef.current(value),
      onState: setNoteSave,
    });
    saverRef.current = saver;
    return () => {
      saverRef.current = null;
      saver.dispose(); // an unsaved value is still delivered
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one saver per edited ToDo
  }, [taskId]);
  const canEditNote =
    mode === 'create' || task?.allowed_actions.includes('update_client_operations_todo_progress_note') === true;
  const noteStateLabel = mode === 'edit' ? progressNoteSaveStateLabelHe(noteSave) : null;

  /** Settle any pending note save before leaving / completing; a second failed attempt lets the user leave. */
  const closeAttemptFailedRef = useRef(false);
  const requestClose = () => {
    void (async () => {
      const ok = (await saverRef.current?.flush()) ?? true;
      if (ok || closeAttemptFailedRef.current) {
        onClose();
        return;
      }
      closeAttemptFailedRef.current = true;
    })();
  };

  useEffect(() => {
    // Nothing to search once an authorized client is chosen (typing over it clears the choice).
    if (mode !== 'create' || clientId || oneTimeName) return;
    let cancelled = false;
    // Backend-authorized, workspace-scoped search (the endpoint the ToDo aggregate declares as
    // `available_clients_hint.search_endpoint`). Opening the form loads the first page immediately;
    // typing re-queries shortly after the last keystroke. The picker narrows the already-loaded
    // options instantly in the meantime (presentation only).
    const delay = clientQ ? TODO_CLIENT_PICKER_DEBOUNCE_MS : 0;
    setClientOptionsLoading(true);
    const t = setTimeout(() => {
      void apiJson<{ options: TodoClientPickerOption[]; has_more?: boolean }>(
        moduleClientOperationsTodoClientOptions({
          ...workspaceQuery,
          q: clientQ || null,
          limit: TODO_CLIENT_PICKER_VISIBLE_LIMIT,
        }),
      )
        .then((res) => {
          if (cancelled) return;
          setClientOptions(res.options ?? []);
          setClientOptionsHasMore(res.has_more === true);
        })
        .catch(() => {
          if (cancelled) return;
          setClientOptions([]);
          setClientOptionsHasMore(false);
        })
        .finally(() => {
          if (!cancelled) setClientOptionsLoading(false);
        });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [clientId, oneTimeName, clientQ, mode, workspaceQuery]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (mode === 'create') {
        // Canonical client wins; otherwise the typed text is a one-time client name. The backend validates the
        // identity (and the client ACL for canonical clients) — this only builds the command payload.
        const typedName = oneTimeName || clientQ.trim();
        if (!clientId && !typedName) throw new Error('נא לבחור לקוח או להקליד שם לקוח');
        const text = taskText.trim();
        if (!text) throw new Error('נא להזין טקסט משימה');
        const body: Record<string, unknown> = {
          command: 'create_client_operations_todo',
          ...(clientId
            ? { client_id: clientId }
            : { external_client_name: typedName, external_client_tax_id: taxId.trim() || null }),
          task_text: text,
          priority: encodeTodoPriorityForSubmit(priority),
          progress_note: progressNote.trim() || null,
        };
        const data = await apiJson<ClientOperationsTodoBoardAggregate>(
          moduleClientOperationsTodoCommands(),
          {
            method: 'POST',
            body: JSON.stringify({
              ...body,
              query: {
                workspace_scope: workspaceQuery.workspace_scope,
                workspace_subject_user_id: workspaceQuery.workspace_subject_user_id,
              },
            }),
          },
        );
        onSaved(data);
      } else if (task) {
        // Settle a pending שלב טיפול save first so the two commands never race.
        if (saverRef.current && !(await saverRef.current.flush())) {
          throw new Error('שגיאה בשמירת שלב טיפול');
        }
        const data = await apiJson<ClientOperationsTodoBoardAggregate>(
          moduleClientOperationsTodoCommands(),
          {
            method: 'POST',
            body: JSON.stringify({
              command: 'update_client_operations_todo',
              todo_id: task.id,
              task_text: taskText.trim(),
              priority: encodeTodoPriorityForSubmit(priority),
              // One-time client fields belong to the ToDo itself and are edited through this same command.
              ...(editingOneTime
                ? { external_client_name: oneTimeName, external_client_tax_id: taxId.trim() || null }
                : {}),
              query: {
                workspace_scope: workspaceQuery.workspace_scope,
                workspace_subject_user_id: workspaceQuery.workspace_subject_user_id,
              },
            }),
          },
        );
        onSaved(data);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="nx-co-todo-form-overlay"
      role="presentation"
      data-testid={`client-operations-todo-${mode}-modal`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          requestClose();
        }
      }}
    >
      <form className="nx-co-todo-form" onSubmit={(e) => void onSubmit(e)} dir="rtl">
        <div className="nx-co-todo-form__header">
          <h3>{mode === 'create' ? 'משימה חדשה' : 'עריכת משימה'}</h3>
          <button type="button" className="nx-co-todo-board__close" onClick={requestClose} aria-label="סגור">
            ×
          </button>
        </div>
        <div className="nx-co-todo-form__body">
          {mode === 'create' ? (
            <ClientOperationsTodoClientPicker
              selectedClientId={clientId}
              selectedLabel={clientLabel}
              oneTimeName={oneTimeName}
              oneTimeAllowed={oneTimeAllowed}
              oneTimeNameMaxLength={oneTimeClient?.name_max_length}
              text={clientQ}
              options={clientOptions}
              loading={clientOptionsLoading}
              hasMore={clientOptionsHasMore}
              onTextChange={setClientQ}
              onClearSelection={() => {
                setClientId('');
                setTaxId('');
                setClientLabel('');
                setOneTimeName('');
                setClientQ('');
              }}
              onSelect={(o) => {
                // The stored value is the canonical client_id the backend sent.
                setClientId(o.client_id);
                setClientLabel(o.display_name ?? o.client_id);
                setOneTimeName('');
                setTaxId(o.tax_id ?? '');
                setClientQ('');
              }}
              onSelectOneTime={(name) => {
                // ONE-TIME client: no client_id, nothing is created in Core — the name stays on the ToDo.
                setClientId('');
                setClientLabel('');
                setOneTimeName(name);
                setClientQ('');
              }}
            />
          ) : editingOneTime ? (
            <label className="nx-co-todo-form__field">
              <span>לקוח (חד פעמי)</span>
              <input
                type="text"
                value={oneTimeName}
                maxLength={oneTimeClient?.name_max_length}
                required
                onChange={(e) => setOneTimeName(e.target.value)}
              />
            </label>
          ) : (
            <label className="nx-co-todo-form__field">
              <span>לקוח</span>
              <input type="text" value={clientLabel} readOnly />
            </label>
          )}
          <label className="nx-co-todo-form__field">
            <span>ת.ז./ח.פ.</span>
            {/* Canonical client: read-only, shown from Core. One-time client: optional manual value. */}
            <input
              type="text"
              value={taxId}
              readOnly={mode === 'create' ? Boolean(clientId) : !editingOneTime}
              maxLength={oneTimeClient?.tax_id_max_length}
              placeholder={mode === 'create' ? (clientId ? undefined : 'אופציונלי') : editingOneTime ? 'אופציונלי' : undefined}
              onChange={(e) => setTaxId(e.target.value)}
            />
          </label>
          <label className="nx-co-todo-form__field">
            <span>משימה</span>
            <textarea
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
              maxLength={CLIENT_OPERATIONS_TODO_TASK_TEXT_MAX}
              rows={4}
              required
            />
          </label>
          <label className="nx-co-todo-form__field">
            <span>שלב טיפול</span>
            <input
              type="text"
              value={progressNote}
              maxLength={fieldLimits?.progress_note_max_length}
              readOnly={!canEditNote}
              placeholder="אופציונלי"
              aria-describedby={noteStateLabel ? noteStateId : undefined}
              data-testid="client-operations-todo-progress-note"
              onChange={(e) => {
                setProgressNote(e.target.value);
                if (mode === 'edit') {
                  closeAttemptFailedRef.current = false;
                  saverRef.current?.change(e.target.value);
                }
              }}
              onBlur={() => {
                if (mode === 'edit') void saverRef.current?.flush();
              }}
            />
            {noteStateLabel ? (
              <span
                id={noteStateId}
                className={`nx-co-todo-form__save-state${noteSave.status === 'error' ? ' is-error' : ''}`}
                role={noteSave.status === 'error' ? 'alert' : 'status'}
                data-testid="client-operations-todo-progress-note-state"
              >
                {noteStateLabel}
              </span>
            ) : null}
          </label>
          <div className="nx-co-todo-form__field">
            <span>עדיפות</span>
            <div className="nx-co-todo-priority" role="radiogroup" aria-label="עדיפות">
              {TODO_PRIORITY_LANES.map((lane) => {
                const token = lane.priority == null ? 'none' : String(lane.priority);
                const selected = priority === token;
                return (
                  <button
                    key={lane.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${lane.visual_number} ${lane.label_he}`}
                    className={`nx-co-todo-priority__btn nx-co-todo-priority__btn--${lane.accent}${selected ? ' is-selected' : ''}`}
                    onClick={() => setPriority(token)}
                  >
                    {lane.visual_number}
                  </button>
                );
              })}
            </div>
          </div>
          {formError ? (
            <div className="nx-co-todo-board__error" role="alert">
              {formError}
            </div>
          ) : null}
        </div>
        <div className="nx-co-todo-form__footer">
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact nx-btn-secondary nx-co-todo-btn"
            onClick={requestClose}
            disabled={saving}
          >
            ביטול
          </button>
          <button
            type="submit"
            className="nx-btn nx-btn-taxes-compact nx-btn-primary nx-co-todo-btn"
            disabled={saving}
          >
            {mode === 'create' ? 'צור משימה' : 'שמור'}
          </button>
          {mode === 'edit' &&
          task?.allowed_actions.includes('complete_client_operations_todo') &&
          onRequestComplete ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact nx-btn-secondary nx-co-todo-btn"
              disabled={saving}
              onClick={() => {
                // Opens the completion dialog (סיום משימה); nothing is completed here. A pending
                // שלב טיפול save is settled first (the command would be rejected on a completed ToDo).
                void (async () => {
                  const ok = (await saverRef.current?.flush()) ?? true;
                  if (!ok) {
                    setFormError('שגיאה בשמירת שלב טיפול');
                    return;
                  }
                  onRequestComplete(task);
                })();
              }}
            >
              סמן כהושלם
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

/** Hebrew message for Stage 5A CLIENT_HANDLER_TODO_CONFLICT. */
export function formatClientHandlerTodoConflictMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'CLIENT_HANDLER_TODO_CONFLICT') return null;
  const count =
    typeof error.details?.conflicting_todo_count === 'number'
      ? error.details.conflicting_todo_count
      : null;
  if (count != null) {
    return `לא ניתן לשנות מטפל בתיק — קיימות ${count} משימות ToDo פעילות שאינן תואמות. יש להשלים או להעביר את המשימות תחילה.`;
  }
  return 'לא ניתן לשנות מטפל בתיק — קיימות משימות ToDo פעילות. יש להשלים או להעביר את המשימות תחילה.';
}
