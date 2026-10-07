/**
 * Client Operations ToDo board UI (Stage 5B).
 * Overlay over ניהול לקוחות — sticky board + create/edit + archive.
 * Frontend is render-only; workspace comes from Stage 4 CO context.
 */
import {
  useCallback,
  useEffect,
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
} from '../../lib/client-operations-todo-board.pure';
import {
  moduleClientOperationsTodoArchive,
  moduleClientOperationsTodoAssigneeOptions,
  moduleClientOperationsTodoBoard,
  moduleClientOperationsTodoClientOptions,
  moduleClientOperationsTodoCommands,
  type ClientOperationsTodoWorkspaceQuery,
} from '../../lib/client-operations-todo-url.pure';

export type ClientOperationsTodoCard = {
  id: string;
  client: { id: string; display_name: string | null; tax_id: string | null };
  task_text: string;
  priority: 1 | 2 | 3 | 4 | null;
  priority_presentation_token?: string;
  assigned_to: { user_id: string; display_name: string };
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
    filter_assignee: string | null;
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
  workspaceQuery,
  workspaceLabelHe,
  canEdit,
}: Props) {
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

  const onComplete = async (task: ClientOperationsTodoCard) => {
    if (!task.allowed_actions.includes('complete_client_operations_todo')) return;
    setBusyTodoId(task.id);
    setError('');
    try {
      const data = (await runCommand({
        command: 'complete_client_operations_todo',
        todo_id: task.id,
      })) as ClientOperationsTodoBoardAggregate;
      applyBoardAggregate(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בסימון הושלם');
    } finally {
      setBusyTodoId(null);
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
        if (e.target === e.currentTarget && !createOpen && !editTask && !archiveOpen) onClose();
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
          <div className="nx-co-todo-board__topbar-start">
            <h2 className="nx-co-todo-board__title">ToDo List</h2>
            {label ? <span className="nx-co-todo-board__workspace">{label}</span> : null}
            <span className="nx-co-todo-board__count" aria-live="polite">
              {activeTotal} משימות
            </span>
          </div>
          <div className="nx-co-todo-board__topbar-actions">
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
          ) : activeTotal === 0 && !searchQ ? (
            <div className="nx-co-todo-board__empty" data-testid="client-operations-todo-empty">
              <p>אין משימות פתוחות</p>
              {canCreate ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact nx-btn-primary nx-co-todo-btn"
                  onClick={() => setCreateOpen(true)}
                >
                  + משימה חדשה
                </button>
              ) : null}
            </div>
          ) : (
            <div className="nx-co-todo-lanes" data-testid="client-operations-todo-lanes">
              {TODO_PRIORITY_LANES.map((lane) => (
                <section
                  key={lane.id}
                  className={`nx-co-todo-lane nx-co-todo-lane--${lane.accent}`}
                  data-lane={lane.id}
                  aria-label={lane.label_he}
                >
                  <header className="nx-co-todo-lane__header">
                    <span className="nx-co-todo-lane__dot" aria-hidden="true" />
                    <span className="nx-co-todo-lane__label">{lane.label_he}</span>
                    <span className="nx-co-todo-lane__count">{lanes[lane.id].length}</span>
                  </header>
                  <div className="nx-co-todo-lane__cards">
                    {lanes[lane.id].map((task) => (
                      <TodoStickyCard
                        key={task.id}
                        task={task}
                        showAssignee={board?.workspace?.scope_kind === 'OFFICE'}
                        busy={busyTodoId === task.id}
                        onDoubleClick={() => setEditTask(task)}
                        onComplete={() => void onComplete(task)}
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
          workspaceScopeKind={board?.workspace?.scope_kind ?? null}
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
          workspaceScopeKind={board?.workspace?.scope_kind ?? null}
          onClose={() => setEditTask(null)}
          onSaved={(agg) => {
            applyBoardAggregate(agg);
            setEditTask(null);
          }}
          onCompleted={(agg) => {
            applyBoardAggregate(agg);
            setEditTask(null);
          }}
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
                      <th>מטפל</th>
                      <th>נוצר בתאריך</th>
                      <th>הושלם בתאריך</th>
                      <th>הושלם על ידי</th>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(archive?.tasks ?? []).map((t) => (
                      <tr key={t.id}>
                        <td>{t.client.display_name ?? '—'}</td>
                        <td>{t.client.tax_id ?? '—'}</td>
                        <td>{t.task_text}</td>
                        <td>{formatTodoPriorityLabelHe(t.priority)}</td>
                        <td>{t.assigned_to.display_name}</td>
                        <td>{formatDateHe(t.created_at)}</td>
                        <td>{formatDateHe(t.completed_at)}</td>
                        <td>{t.completed_by?.display_name ?? '—'}</td>
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
  showAssignee: boolean;
  busy: boolean;
  onDoubleClick: () => void;
  onComplete: () => void;
}) {
  const { task, showAssignee, busy, onDoubleClick, onComplete } = props;
  const canComplete = task.allowed_actions.includes('complete_client_operations_todo');
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onClick = (e: ReactMouseEvent) => {
    // Distinguish single vs double via timer clear on dblclick.
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
    }, 250);
    e.stopPropagation();
  };

  return (
    <article
      className="nx-co-todo-sticky"
      data-testid="client-operations-todo-card"
      data-todo-id={task.id}
      onClick={onClick}
      onDoubleClick={(e) => {
        e.preventDefault();
        if (clickTimer.current) clearTimeout(clickTimer.current);
        onDoubleClick();
      }}
    >
      <div className="nx-co-todo-sticky__client">{task.client.display_name ?? 'לקוח'}</div>
      <div className="nx-co-todo-sticky__tax">{task.client.tax_id ?? '—'}</div>
      <div className="nx-co-todo-sticky__text">{task.task_text}</div>
      {showAssignee ? (
        <div className="nx-co-todo-sticky__meta">{task.assigned_to.display_name}</div>
      ) : null}
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
    </article>
  );
}

function TodoFormModal(props: {
  mode: 'create' | 'edit';
  task?: ClientOperationsTodoCard;
  workspaceQuery: ClientOperationsTodoWorkspaceQuery;
  workspaceScopeKind: string | null;
  onClose: () => void;
  onSaved: (agg: ClientOperationsTodoBoardAggregate) => void;
  onCompleted?: (agg: ClientOperationsTodoBoardAggregate) => void;
}) {
  const { mode, task, workspaceQuery, workspaceScopeKind, onClose, onSaved, onCompleted } = props;
  const [clientId, setClientId] = useState(task?.client.id ?? '');
  const [clientLabel, setClientLabel] = useState(task?.client.display_name ?? '');
  const [taxId, setTaxId] = useState(task?.client.tax_id ?? '');
  const [clientQ, setClientQ] = useState('');
  const [clientOptions, setClientOptions] = useState<
    Array<{ client_id: string; display_name: string | null; tax_id: string | null }>
  >([]);
  const [assigneeId, setAssigneeId] = useState(task?.assigned_to.user_id ?? '');
  const [assigneeOptions, setAssigneeOptions] = useState<
    Array<{ user_id: string; display_name: string; role_code: string }>
  >([]);
  const [defaultAssignee, setDefaultAssignee] = useState<string | null>(null);
  const [taskText, setTaskText] = useState(task?.task_text ?? '');
  const [priority, setPriority] = useState(
    task?.priority == null ? 'none' : String(task.priority),
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const isOffice = workspaceScopeKind === 'OFFICE';
  const showAssigneeSelect = mode === 'create' ? true : task?.allowed_actions.includes('update_client_operations_todo') === true;

  useEffect(() => {
    if (mode !== 'create') return;
    let cancelled = false;
    const t = setTimeout(() => {
      void apiJson<{
        options: Array<{ client_id: string; display_name: string | null; tax_id: string | null }>;
      }>(
        moduleClientOperationsTodoClientOptions({
          ...workspaceQuery,
          q: clientQ || null,
          limit: 30,
        }),
      )
        .then((res) => {
          if (!cancelled) setClientOptions(res.options ?? []);
        })
        .catch(() => {
          if (!cancelled) setClientOptions([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [clientQ, mode, workspaceQuery]);

  useEffect(() => {
    if (!clientId || !showAssigneeSelect) return;
    let cancelled = false;
    void apiJson<{
      options: Array<{ user_id: string; display_name: string; role_code: string }>;
      default_assignee_user_id: string | null;
    }>(
      moduleClientOperationsTodoAssigneeOptions({
        ...workspaceQuery,
        client_id: clientId,
      }),
    )
      .then((res) => {
        if (cancelled) return;
        setAssigneeOptions(res.options ?? []);
        setDefaultAssignee(res.default_assignee_user_id);
        if (mode === 'create') {
          if (res.default_assignee_user_id) setAssigneeId(res.default_assignee_user_id);
          else if ((res.options ?? []).length === 1) setAssigneeId(res.options[0]!.user_id);
        }
      })
      .catch(() => {
        if (!cancelled) setAssigneeOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, showAssigneeSelect, workspaceQuery, mode]);

  const hideAssigneeField =
    !isOffice &&
    assigneeOptions.length <= 1 &&
    (defaultAssignee != null || assigneeOptions.length === 1);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (mode === 'create') {
        if (!clientId) throw new Error('נא לבחור לקוח');
        const text = taskText.trim();
        if (!text) throw new Error('נא להזין טקסט משימה');
        const body: Record<string, unknown> = {
          command: 'create_client_operations_todo',
          client_id: clientId,
          task_text: text,
          priority: encodeTodoPriorityForSubmit(priority),
        };
        if (isOffice || !hideAssigneeField) {
          if (!assigneeId) throw new Error('נא לבחור מטפל');
          body.assigned_to_user_id = assigneeId;
        } else if (assigneeId) {
          body.assigned_to_user_id = assigneeId;
        }
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
        const data = await apiJson<ClientOperationsTodoBoardAggregate>(
          moduleClientOperationsTodoCommands(),
          {
            method: 'POST',
            body: JSON.stringify({
              command: 'update_client_operations_todo',
              todo_id: task.id,
              task_text: taskText.trim(),
              priority: encodeTodoPriorityForSubmit(priority),
              ...(isOffice && assigneeId ? { assigned_to_user_id: assigneeId } : {}),
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
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <form className="nx-co-todo-form" onSubmit={(e) => void onSubmit(e)} dir="rtl">
        <div className="nx-co-todo-form__header">
          <h3>{mode === 'create' ? 'משימה חדשה' : 'עריכת משימה'}</h3>
          <button type="button" className="nx-co-todo-board__close" onClick={onClose} aria-label="סגור">
            ×
          </button>
        </div>
        <div className="nx-co-todo-form__body">
          {mode === 'create' ? (
            <label className="nx-co-todo-form__field">
              <span>לקוח</span>
              <input
                type="search"
                value={clientLabel || clientQ}
                onChange={(e) => {
                  setClientId('');
                  setTaxId('');
                  setClientLabel('');
                  setClientQ(e.target.value);
                }}
                placeholder="חיפוש לקוח…"
                required
              />
              {!clientId && clientOptions.length > 0 ? (
                <ul className="nx-co-todo-form__suggest" role="listbox">
                  {clientOptions.map((o) => (
                    <li key={o.client_id}>
                      <button
                        type="button"
                        onClick={() => {
                          setClientId(o.client_id);
                          setClientLabel(o.display_name ?? o.client_id);
                          setTaxId(o.tax_id ?? '');
                          setClientQ('');
                          setClientOptions([]);
                        }}
                      >
                        <strong>{o.display_name ?? o.client_id}</strong>
                        <span>{o.tax_id ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
          ) : (
            <label className="nx-co-todo-form__field">
              <span>לקוח</span>
              <input type="text" value={clientLabel} readOnly />
            </label>
          )}
          <label className="nx-co-todo-form__field">
            <span>ת.ז./ח.פ.</span>
            <input type="text" value={taxId} readOnly />
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
            <span>עדיפות</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="none">ללא עדיפות</option>
            </select>
          </label>
          {showAssigneeSelect && !hideAssigneeField ? (
            <label className="nx-co-todo-form__field">
              <span>מטפל</span>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                required={isOffice}
              >
                <option value="">בחירה…</option>
                {assigneeOptions.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.display_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
            onClick={onClose}
            disabled={saving}
          >
            ביטול
          </button>
          <button
            type="submit"
            className="nx-btn nx-btn-taxes-compact nx-btn-primary nx-co-todo-btn"
            disabled={saving}
          >
            שמור
          </button>
          {mode === 'edit' &&
          task?.allowed_actions.includes('complete_client_operations_todo') &&
          onCompleted ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact nx-btn-secondary nx-co-todo-btn"
              disabled={saving}
              onClick={() => {
                void (async () => {
                  setSaving(true);
                  try {
                    const data = await apiJson<ClientOperationsTodoBoardAggregate>(
                      moduleClientOperationsTodoCommands(),
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          command: 'complete_client_operations_todo',
                          todo_id: task.id,
                          query: {
                            workspace_scope: workspaceQuery.workspace_scope,
                            workspace_subject_user_id: workspaceQuery.workspace_subject_user_id,
                          },
                        }),
                      },
                    );
                    onCompleted(data);
                  } catch (e) {
                    setFormError(e instanceof Error ? e.message : 'שגיאה');
                  } finally {
                    setSaving(false);
                  }
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
