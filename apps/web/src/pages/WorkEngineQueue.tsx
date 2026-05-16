/**
 * Stage 4 — Work Engine Queue workspace.
 *
 * STRICT rules followed by this file:
 *   - Reads ONLY through GET /api/v1/work-engine/aggregates/queue.
 *   - Writes ONLY through POST /api/v1/work-engine/commands.
 *   - Sends `refresh_aggregate=work_engine_queue_aggregate` with each command
 *     and replaces local aggregate with `response.refreshed.aggregate`.
 *   - NO frontend status mapping, NO module label mapping, NO SLA math,
 *     NO local row mutation, NO frontend allowed_action gating.
 *   - All visible labels come from aggregate fields (`*_label`, etc).
 *   - All filter options come from `aggregate.filters.*`.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  executeWorkEngineQueueCommand,
  fetchWorkEngineQueueAggregate,
  type QueueAllowedActionCommand,
  type QueueOverflowMenuItem,
  type QueueOwnershipCommand,
  type QueueReviewCommand,
  type QueueDetailSection,
  type QueueRowAllowedOverrideKind,
  type ReminderReviewAllowedAction,
  type ReminderReviewBanner as ReminderReviewBannerModel,
  type ReminderReviewQueueRow,
  type WorkEngineEscalationFormField,
  type WorkEngineQueueAggregate,
  type WorkEngineQueueFiltersInput,
  type WorkEngineQueueRow,
  type WorkEngineQueueTableModel,
} from '../api/work-engine';
import { ApiError, userFacingApiMessage } from '../api/client';
import '../styles/nx-work-engine-queue.css';

type FilterState = {
  state: string;
  module_key: string;
  assigned_user_id: string;
  reviewer_user_id: string;
  client_id: string;
  period_key: string;
  queue_bucket: string;
  limit: number;
  offset: number;
};

const INITIAL_FILTERS: FilterState = {
  state: '',
  module_key: '',
  assigned_user_id: '',
  reviewer_user_id: '',
  client_id: '',
  period_key: '',
  queue_bucket: '',
  limit: 50,
  offset: 0,
};

function isWorkItemVersionConflict(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  const code = e.code ?? '';
  return (
    e.status === 409 &&
    (code === 'WORK_ITEM_VERSION_CONFLICT' || code === 'version_conflict_on_update')
  );
}

function filtersToApi(f: FilterState): WorkEngineQueueFiltersInput {
  return {
    state: f.state || null,
    module_key: f.module_key || null,
    assigned_user_id: f.assigned_user_id || null,
    reviewer_user_id: f.reviewer_user_id || null,
    client_id: f.client_id || null,
    period_key: f.period_key || null,
    queue_bucket: f.queue_bucket || null,
    limit: f.limit,
    offset: f.offset,
  };
}

type PendingModal =
  | { kind: 'assign'; row: WorkEngineQueueRow }
  | { kind: 'transfer'; row: WorkEngineQueueRow }
  | { kind: 'change_state'; row: WorkEngineQueueRow; preset_to_state?: string | null }
  | { kind: 'set_deadline'; row: WorkEngineQueueRow }
  | { kind: 'apply_override'; row: WorkEngineQueueRow }
  | { kind: 'archive'; row: WorkEngineQueueRow }
  | { kind: 'reject_review'; row: WorkEngineQueueRow }
  | null;

type EscalationModalState = {
  row: WorkEngineQueueRow;
  item: QueueOverflowMenuItem;
};

export function WorkEngineQueue() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [aggregate, setAggregate] = useState<WorkEngineQueueAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<PendingModal>(null);
  const [detailRow, setDetailRow] = useState<WorkEngineQueueRow | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [reminderReviewOpen, setReminderReviewOpen] = useState(false);
  const [escalationModal, setEscalationModal] = useState<EscalationModalState | null>(null);

  const loadAggregate = useCallback(async (f: FilterState) => {
    setLoading(true);
    setError(null);
    try {
      const agg = await fetchWorkEngineQueueAggregate(filtersToApi(f));
      setAggregate(agg);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAggregate(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = useCallback(() => {
    const next = { ...filters, offset: 0 };
    setFilters(next);
    void loadAggregate(next);
  }, [filters, loadAggregate]);

  const resetFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
    void loadAggregate(INITIAL_FILTERS);
  }, [loadAggregate]);

  const handleCommandResult = useCallback(
    (refreshed: WorkEngineQueueAggregate | Record<string, unknown> | null) => {
      // Backend MUST return the queue aggregate (we asked for it). If it
      // didn't (e.g. backend defaulted to foundation), fall back to a fresh
      // GET so UI never displays stale or stitched truth.
      if (
        refreshed &&
        (refreshed as WorkEngineQueueAggregate).aggregate_key === 'work_engine_queue_aggregate'
      ) {
        setAggregate(refreshed as WorkEngineQueueAggregate);
        return;
      }
      void loadAggregate(filters);
    },
    [filters, loadAggregate],
  );

  const handleCommandFailure = useCallback(
    async (e: unknown) => {
      if (isWorkItemVersionConflict(e)) {
        setError('Item was updated. Refreshing...');
        await loadAggregate(filters);
        return;
      }
      setError(userFacingApiMessage(e));
    },
    [filters, loadAggregate],
  );

  const handleReviewCommand = useCallback(
    async (row: WorkEngineQueueRow, cmd: QueueReviewCommand['command']) => {
      if (cmd === 'reject_work_item') {
        setModal({ kind: 'reject_review', row });
        return;
      }
      setError(null);
      try {
        const resp = await executeWorkEngineQueueCommand({
          command: cmd,
          payload: {
            work_item_id: row.work_item_id,
            expected_version: row.version,
            idempotency_key: crypto.randomUUID(),
          },
          filters: filtersToApi(filters),
        });
        handleCommandResult(resp.refreshed?.aggregate ?? null);
      } catch (e) {
        await handleCommandFailure(e);
      }
    },
    [filters, handleCommandFailure, handleCommandResult],
  );

  const handleOwnershipCommand = useCallback(
    async (row: WorkEngineQueueRow, cmd: QueueOwnershipCommand['command']) => {
      setError(null);
      try {
        const resp = await executeWorkEngineQueueCommand({
          command: cmd,
          payload: {
            work_item_id: row.work_item_id,
            expected_version: row.version,
            idempotency_key: crypto.randomUUID(),
          },
          filters: filtersToApi(filters),
        });
        handleCommandResult(resp.refreshed?.aggregate ?? null);
      } catch (e) {
        await handleCommandFailure(e);
      }
    },
    [filters, handleCommandFailure, handleCommandResult],
  );

  const onPaginate = useCallback(
    (direction: 1 | -1) => {
      if (!aggregate) return;
      const limit = aggregate.pagination.limit;
      const offset = Math.max(0, aggregate.pagination.offset + direction * limit);
      const next = { ...filters, offset, limit };
      setFilters(next);
      void loadAggregate(next);
    },
    [aggregate, filters, loadAggregate],
  );

  const onCloseModal = useCallback(() => setModal(null), []);

  const openReminderReviewModal = useCallback(() => {
    setReminderReviewOpen(true);
    setBannerDismissed(false);
  }, []);

  const runWorkEngineOverflowCommand = useCallback(
    async (
      row: WorkEngineQueueRow,
      item: QueueOverflowMenuItem,
      fieldValues: Record<string, string>,
    ) => {
      setError(null);
      try {
        const resp = await executeWorkEngineQueueCommand({
          command: item.command,
          payload: {
            ...(item.command_payload ?? {}),
            work_item_id: row.work_item_id,
            expected_version: row.version,
            idempotency_key: crypto.randomUUID(),
            ...fieldValues,
          },
          filters: filtersToApi(filters),
        });
        handleCommandResult(resp.refreshed?.aggregate ?? null);
        setEscalationModal(null);
      } catch (e) {
        await handleCommandFailure(e);
        throw e;
      }
    },
    [filters, handleCommandFailure, handleCommandResult],
  );

  const handleWorkEngineOverflowCommand = useCallback(
    async (row: WorkEngineQueueRow, item: QueueOverflowMenuItem) => {
      if (!item.enabled || item.channel !== 'work_engine_command') return;
      if (item.interaction === 'modal' && item.modal_form_key) {
        setEscalationModal({ row, item });
        return;
      }
      await runWorkEngineOverflowCommand(row, item, {});
    },
    [runWorkEngineOverflowCommand],
  );

  if (loading && !aggregate) {
    return (
      <div className="nx-we-queue">
        <h1 className="nx-we-queue__title">Work Engine — Queue</h1>
        <p className="nx-we-queue__subtitle">Loading…</p>
      </div>
    );
  }

  if (!aggregate) {
    return (
      <div className="nx-we-queue">
        <h1 className="nx-we-queue__title">Work Engine — Queue</h1>
        {error && <div className="nx-we-banner-error">{error}</div>}
      </div>
    );
  }

  const cards = aggregate.summary_cards;
  const fOpts = aggregate.filters;
  const rows = aggregate.rows;
  const pagination = aggregate.pagination;
  const pending = aggregate.pending_mapping_section;
  const banner = aggregate.banner;

  return (
    <div className="nx-we-queue">
      <h1 className="nx-we-queue__title">Work Engine — Queue</h1>
      <p className="nx-we-queue__subtitle">
        Backend-driven workflow inbox. All states, labels, and actions are owned by the
        server.
      </p>

      {error && <div className="nx-we-banner-error">{error}</div>}

      {banner?.visible && !bannerDismissed ? (
        <ReminderReviewBanner
          banner={banner}
          onReview={() => openReminderReviewModal()}
          onDismiss={() => setBannerDismissed(true)}
        />
      ) : null}

      <SummaryCards cards={cards} onOpenReminderReview={openReminderReviewModal} />

      <FiltersBar
        filters={filters}
        setFilters={setFilters}
        options={fOpts}
        onApply={applyFilters}
        onReset={resetFilters}
        loading={loading}
      />

      <QueueTable
        table={aggregate.queue_table}
        rows={rows}
        onOpenDetail={(row) => setDetailRow(row)}
        onOverflowAction={(row, cmd) => setModal(buildModalForAction(row, cmd))}
        onWorkEngineCommand={(row, item) => void handleWorkEngineOverflowCommand(row, item)}
        onOwnershipCommand={handleOwnershipCommand}
        onReviewCommand={handleReviewCommand}
      />

      <Pagination
        offset={pagination.offset}
        limit={pagination.limit}
        total={pagination.total_matching}
        returned={pagination.returned}
        onPrev={() => onPaginate(-1)}
        onNext={() => onPaginate(1)}
        disabled={loading}
      />

      <PendingMappingSection pending={pending} />

      {detailRow ? (
        <QueueItemDetailDrawer
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onNavigate={(path) => {
            navigate(path);
            setDetailRow(null);
          }}
          onCommandAction={(row, cmd) => {
            setDetailRow(null);
            setModal(buildModalForAction(row, cmd));
          }}
        />
      ) : null}

      {escalationModal && aggregate?.escalation_workspace ? (
        <EscalationCommandModal
          aggregate={aggregate}
          row={escalationModal.row}
          item={escalationModal.item}
          onClose={() => setEscalationModal(null)}
          onSubmit={async (fieldValues) => {
            await runWorkEngineOverflowCommand(escalationModal.row, escalationModal.item, fieldValues);
          }}
          onCommandFailure={handleCommandFailure}
        />
      ) : null}

      {reminderReviewOpen ? (
        <ReminderReviewWorkspaceModal
          aggregate={aggregate}
          filtersForApi={filtersToApi(filters)}
          onClose={() => setReminderReviewOpen(false)}
          onCompleted={(refreshed) => {
            handleCommandResult(refreshed as WorkEngineQueueAggregate);
          }}
          onCommandFailure={handleCommandFailure}
        />
      ) : null}

      {modal ? (
        <ActionModal
          modal={modal}
          filtersForApi={filtersToApi(filters)}
          aggregate={aggregate}
          onClose={onCloseModal}
          onCompleted={(refreshed) => {
            onCloseModal();
            handleCommandResult(refreshed);
          }}
        />
      ) : null}
    </div>
  );
}

function buildModalForAction(row: WorkEngineQueueRow, cmd: QueueAllowedActionCommand): PendingModal {
  if (cmd === 'assign') return { kind: 'assign', row };
  if (cmd === 'transfer') return { kind: 'transfer', row };
  if (cmd === 'mark_waiting_client') return { kind: 'change_state', row, preset_to_state: 'waiting_client' };
  if (cmd === 'change_state') return { kind: 'change_state', row };
  if (cmd === 'set_deadline') return { kind: 'set_deadline', row };
  if (cmd === 'apply_override') return { kind: 'apply_override', row };
  if (cmd === 'archive') return { kind: 'archive', row };
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────── */

function SummaryCards(props: {
  cards: WorkEngineQueueAggregate['summary_cards'];
  onOpenReminderReview?: () => void;
}) {
  const { cards, onOpenReminderReview } = props;
  const items: Array<{ key: keyof WorkEngineQueueAggregate['summary_cards']; label: string; tone?: 'alert' | 'warn' }> = [
    { key: 'total_active', label: 'Active' },
    { key: 'assigned_to_me', label: 'Assigned to me' },
    { key: 'unassigned', label: 'Unassigned' },
    { key: 'claimed_by_me', label: 'Claimed by me' },
    { key: 'review_for_me', label: 'Review for me' },
    { key: 'waiting_client', label: 'Waiting client' },
    { key: 'waiting_human', label: 'Waiting office' },
    { key: 'review_pending', label: 'Review pending' },
    { key: 'pending_reminders', label: 'Pending reminders', tone: 'warn' },
    { key: 'overdue', label: 'Overdue', tone: 'alert' },
    { key: 'escalated', label: 'Escalated', tone: 'alert' },
    { key: 'pending_mapping', label: 'Pending mapping', tone: 'warn' },
  ];
  return (
    <div className="nx-we-queue__cards nx-we-queue__cards--premium">
            {items.map((it) => {
        const value = cards[it.key] ?? 0;
        const isReminderCta = it.key === 'pending_reminders' && value > 0 && onOpenReminderReview;
        return (
          <div
            key={it.key as string}
            className={`nx-we-card${it.tone ? ` nx-we-card--${it.tone}` : ''}${isReminderCta ? ' nx-we-card--clickable' : ''}`}
            role={isReminderCta ? 'button' : undefined}
            tabIndex={isReminderCta ? 0 : undefined}
            onClick={isReminderCta ? onOpenReminderReview : undefined}
            onKeyDown={
              isReminderCta
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenReminderReview();
                    }
                  }
                : undefined
            }
          >
            <div className="nx-we-card__label">{it.label}</div>
            <div className="nx-we-card__value">{value}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function FiltersBar(props: {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  options: WorkEngineQueueAggregate['filters'];
  onApply: () => void;
  onReset: () => void;
  loading: boolean;
}) {
  const { filters, setFilters, options } = props;
  const set = (patch: Partial<FilterState>) => setFilters({ ...filters, ...patch });
  return (
    <div className="nx-we-queue__filters">
      <div className="nx-we-field">
        <label htmlFor="we-state">State</label>
        <select
          id="we-state"
          value={filters.state}
          onChange={(e) => set({ state: e.target.value })}
        >
          <option value="">All states</option>
          {options.states.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
              {opt.terminal ? ' (terminal)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="nx-we-field">
        <label htmlFor="we-queue-bucket">Queue view</label>
        <select
          id="we-queue-bucket"
          value={filters.queue_bucket}
          onChange={(e) => set({ queue_bucket: e.target.value })}
        >
          {(options.queue_buckets ?? [{ value: '', label: 'All' }])
            .filter((opt) => opt.value !== 'reminder_review')
            .map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="nx-we-field">
        <label htmlFor="we-module">Module</label>
        <select
          id="we-module"
          value={filters.module_key}
          onChange={(e) => set({ module_key: e.target.value })}
        >
          <option value="">All modules</option>
          {options.modules.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="nx-we-field">
        <label htmlFor="we-assignee">Assignee</label>
        <select
          id="we-assignee"
          value={filters.assigned_user_id}
          onChange={(e) => set({ assigned_user_id: e.target.value })}
        >
          <option value="">All assignees</option>
          {options.assignees.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="nx-we-field">
        <label htmlFor="we-reviewer">Reviewer</label>
        <select
          id="we-reviewer"
          value={filters.reviewer_user_id}
          onChange={(e) => set({ reviewer_user_id: e.target.value })}
        >
          <option value="">All reviewers</option>
          {options.reviewers.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="nx-we-field">
        <label htmlFor="we-period">Period</label>
        <select
          id="we-period"
          value={filters.period_key}
          onChange={(e) => set({ period_key: e.target.value })}
        >
          <option value="">All periods</option>
          {options.period_keys.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="nx-we-field" style={{ minWidth: 230 }}>
        <label htmlFor="we-client">Client (UUID)</label>
        <input
          id="we-client"
          value={filters.client_id}
          placeholder="optional"
          onChange={(e) => set({ client_id: e.target.value })}
        />
      </div>

      <div className="nx-we-field" style={{ minWidth: 90 }}>
        <label htmlFor="we-limit">Page size</label>
        <select
          id="we-limit"
          value={filters.limit}
          onChange={(e) => set({ limit: Number(e.target.value) || 50, offset: 0 })}
        >
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="nx-we-queue__filter-actions">
        <button
          type="button"
          className="nx-we-btn"
          onClick={props.onReset}
          disabled={props.loading}
        >
          Reset
        </button>
        <button
          type="button"
          className="nx-we-btn nx-we-btn--primary"
          onClick={props.onApply}
          disabled={props.loading}
        >
          {props.loading ? 'Loading…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** Presentation-only guard: never render legacy optional columns from stale aggregates. */
const QUEUE_TABLE_EXCLUDED_COLUMN_KEYS = new Set(['due_at', 'sla']);

function visibleQueueTableColumns(table: WorkEngineQueueTableModel): WorkEngineQueueTableModel['columns'] {
  return table.columns.filter((c) => !QUEUE_TABLE_EXCLUDED_COLUMN_KEYS.has(c.key));
}

function QueueTable(props: {
  table: WorkEngineQueueTableModel;
  rows: WorkEngineQueueRow[];
  onOpenDetail: (row: WorkEngineQueueRow) => void;
  onOverflowAction: (row: WorkEngineQueueRow, cmd: QueueAllowedActionCommand) => void;
  onWorkEngineCommand: (row: WorkEngineQueueRow, item: QueueOverflowMenuItem) => void;
  onOwnershipCommand: (row: WorkEngineQueueRow, cmd: QueueOwnershipCommand['command']) => void;
  onReviewCommand: (row: WorkEngineQueueRow, cmd: QueueReviewCommand['command']) => void;
}) {
  const [overflowMenuRowId, setOverflowMenuRowId] = useState<string | null>(null);
  const columns = visibleQueueTableColumns(props.table);

  if (props.rows.length === 0) {
    return (
      <div className="nx-we-table-wrap">
        <div className="nx-we-empty">No work items match the current filters.</div>
      </div>
    );
  }
  return (
    <div className="nx-we-table-wrap">
      <table className={`nx-we-table nx-we-table--cols-${columns.length}`}>
        <colgroup>
          {columns.map((col) => (
            <col
              key={col.key}
              className={`nx-we-col nx-we-col--${col.key}`}
              style={col.width_percent != null ? { width: `${col.width_percent}%` } : undefined}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                data-col-key={col.key}
                className={col.kind === 'actions' ? 'nx-we-th nx-we-th--actions' : 'nx-we-th nx-we-th--data'}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.work_item_id}>
              {columns.map((col) => (
                <td
                  key={`${row.work_item_id}-${col.key}`}
                  className={
                    col.kind === 'actions' ? 'nx-we-td nx-we-td--actions' : 'nx-we-td nx-we-td--data'
                  }
                  data-col-key={col.key}
                >
                  {col.kind === 'actions' ? (
                    <QueueRowShellActions
                      row={row}
                      overflowOpen={overflowMenuRowId === row.work_item_id}
                      onOverflowOpenChange={(open) =>
                        setOverflowMenuRowId(open ? row.work_item_id : null)
                      }
                      onOpenDetail={() => props.onOpenDetail(row)}
                      onOverflowAction={(cmd) => props.onOverflowAction(row, cmd)}
                      onWorkEngineCommand={(item) => props.onWorkEngineCommand(row, item)}
                      onOwnershipCommand={(cmd) => props.onOwnershipCommand(row, cmd)}
                      onReviewCommand={(cmd) => props.onReviewCommand(row, cmd)}
                    />
                  ) : (
                    renderQueueDataCell(row, col.key, col.empty_display)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderQueueDataCell(
  row: WorkEngineQueueRow,
  colKey: string,
  emptyDisplay: 'dash' | 'blank',
): ReactNode {
  const raw = row.queue_cells[colKey] ?? null;
  const isEmpty = raw == null || String(raw).trim() === '';
  if (isEmpty) {
    return emptyDisplay === 'dash' ? <span className="nx-we-muted">—</span> : null;
  }
  const text = String(raw);
  if (colKey === 'state') {
    const title = row.queue_cell_titles?.state?.trim() || text;
    return (
      <span className="nx-we-state-badge" title={title}>
        {text}
      </span>
    );
  }
  if (colKey === 'unread') {
    return (
      <span className="nx-we-unread-badge" title={text}>
        {text}
      </span>
    );
  }
  const cellTitle = row.queue_cell_titles?.[colKey] ?? null;
  if (colKey === 'due') {
    const lines = text.split('\n');
    const title = cellTitle?.trim() ? cellTitle : text;
    return (
      <span className="nx-we-due-cell" title={title}>
        <span className="nx-we-due-cell__primary">{lines[0]}</span>
        {lines[1] ? <span className="nx-we-due-cell__secondary">{lines[1]}</span> : null}
      </span>
    );
  }
  if (colKey === 'claimed') {
    return (
      <span className="nx-we-lock-cell" title={cellTitle?.trim() ? cellTitle : undefined}>
        {text}
      </span>
    );
  }
  const ellip = colKey === 'client' || colKey === 'assignee' || colKey === 'reviewer';
  const cellClass = [
    ellip ? 'nx-we-cell-ellip' : 'nx-we-cell-text',
    colKey === 'last_activity' ? 'nx-we-cell--compact-date' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cellClass} title={ellip ? text : cellTitle?.trim() ? cellTitle : undefined}>
      {text}
    </span>
  );
}

type QueueOverflowMenuProps = {
  menu: WorkEngineQueueRow['queue_shell']['overflow_menu'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickItem: (item: QueueOverflowMenuItem) => void;
};

function QueueOverflowMenu(props: QueueOverflowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [adminOpen, setAdminOpen] = useState(false);

  const entryCount =
    props.menu.sections.reduce((n, s) => n + s.items.length, 0) +
    (props.menu.admin?.items.length ?? 0);
  const hasEntries = entryCount > 0;

  useEffect(() => {
    if (!props.open) setAdminOpen(false);
  }, [props.open]);

  useLayoutEffect(() => {
    if (!props.open) return;
    const place = () => {
      const anchor = triggerRef.current;
      const menu = menuRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const pad = 8;
      const mw = menu?.offsetWidth ?? 260;
      const mh = menu?.offsetHeight ?? 8;
      let top = rect.bottom + 4;
      let left = rect.right - mw;
      if (left < pad) left = pad;
      if (left + mw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - mw - pad);
      if (top + mh > window.innerHeight - pad) top = Math.max(pad, rect.top - mh - 4);
      setPos({ top, left });
    };
    place();
    const id = window.requestAnimationFrame(place);
    return () => window.cancelAnimationFrame(id);
  }, [props.open, entryCount, adminOpen, props.menu.admin]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (adminOpen) setAdminOpen(false);
        else props.onOpenChange(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.open, props.onOpenChange, adminOpen]);

  useEffect(() => {
    if (!props.open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      props.onOpenChange(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [props.open, props.onOpenChange]);

  useEffect(() => {
    if (!props.open) return;
    const onScroll = () => {
      setAdminOpen(false);
      props.onOpenChange(false);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [props.open, props.onOpenChange]);

  const onPick = (item: QueueOverflowMenuItem) => {
    props.onOpenChange(false);
    props.onPickItem(item);
  };

  const menu =
    props.open && hasEntries ? (
      <div
        ref={menuRef}
        className="nx-we-overflow-popover nx-we-overflow-popover--wide"
        role="menu"
        style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 4000 }}
      >
        {props.menu.sections.map((sec, si) => (
          <div key={`sec-${si}`} className="nx-we-overflow-popover__section">
            {sec.section_title ? (
              <div className="nx-we-overflow-popover__section-title">{sec.section_title}</div>
            ) : null}
            {sec.items.map((item, ii) => (
              <button
                key={`${si}-${ii}-${item.channel}-${item.command}`}
                type="button"
                role="menuitem"
                className="nx-we-overflow-popover__item"
                disabled={!item.enabled}
                title={item.reason ?? ''}
                onClick={() => onPick(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
        {props.menu.admin ? (
          <div className="nx-we-overflow-popover__admin-wrap">
            <div className="nx-we-overflow-popover__sep" aria-hidden />
            <div className="nx-we-overflow-popover__section-title">{props.menu.admin.panel_title}</div>
            <button
              type="button"
              className="nx-we-overflow-popover__item nx-we-overflow-popover__item--submenu"
              aria-expanded={adminOpen}
              aria-haspopup="menu"
              onClick={() => setAdminOpen((v) => !v)}
            >
              <span>{props.menu.admin.submenu_trigger_label}</span>
              <span className="nx-we-overflow-popover__chevron" aria-hidden>
                ›
              </span>
            </button>
            {adminOpen ? (
              <div className="nx-we-overflow-popover__admin-flyout" role="menu">
                {props.menu.admin.items.map((item, ii) => (
                  <button
                    key={`adm-${ii}-${item.channel}-${item.command}`}
                    type="button"
                    role="menuitem"
                    className="nx-we-overflow-popover__item"
                    disabled={!item.enabled}
                    title={item.reason ?? ''}
                    onClick={() => {
                      setAdminOpen(false);
                      onPick(item);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="nx-we-overflow-anchor">
      <button
        ref={triggerRef}
        type="button"
        className="nx-we-overflow-trigger"
        aria-haspopup="menu"
        aria-expanded={props.open}
        disabled={!hasEntries}
        title={hasEntries ? 'More actions' : ''}
        onClick={() => hasEntries && props.onOpenChange(!props.open)}
      >
        {props.menu.trigger_label}
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

function dispatchOverflowPick(
  item: QueueOverflowMenuItem,
  handlers: {
    onOverflowAction: (cmd: QueueAllowedActionCommand) => void;
    onWorkEngineCommand: (item: QueueOverflowMenuItem) => void;
    onOwnershipCommand: (cmd: QueueOwnershipCommand['command']) => void;
    onReviewCommand: (cmd: QueueReviewCommand['command']) => void;
  },
) {
  if (item.channel === 'ownership') {
    handlers.onOwnershipCommand(item.command as QueueOwnershipCommand['command']);
    return;
  }
  if (item.channel === 'review') {
    handlers.onReviewCommand(item.command as QueueReviewCommand['command']);
    return;
  }
  if (item.channel === 'work_engine_command') {
    handlers.onWorkEngineCommand(item);
    return;
  }
  handlers.onOverflowAction(item.command as QueueAllowedActionCommand);
}

function QueueRowShellActions(props: {
  row: WorkEngineQueueRow;
  overflowOpen: boolean;
  onOverflowOpenChange: (open: boolean) => void;
  onOpenDetail: () => void;
  onOverflowAction: (cmd: QueueAllowedActionCommand) => void;
  onWorkEngineCommand: (item: QueueOverflowMenuItem) => void;
  onOwnershipCommand: (cmd: QueueOwnershipCommand['command']) => void;
  onReviewCommand: (cmd: QueueReviewCommand['command']) => void;
}) {
  const shell = props.row.queue_shell;
  const open = shell.open_detail;

  return (
    <div className="nx-we-shell-actions">
      <button
        type="button"
        className="nx-we-btn nx-we-btn--primary"
        disabled={!open.enabled}
        title={open.reason ?? ''}
        onClick={() => props.onOpenDetail()}
      >
        {open.label}
      </button>
      {(shell.secondary_actions ?? []).map((c) => (
        <button
          key={`${c.channel}-${c.command}`}
          type="button"
          className="nx-we-btn nx-we-btn--secondary"
          disabled={!c.enabled}
          title={c.reason ?? ''}
          onClick={() =>
            c.channel === 'ownership'
              ? props.onOwnershipCommand(c.command as QueueOwnershipCommand['command'])
              : props.onReviewCommand(c.command as QueueReviewCommand['command'])
          }
        >
          {c.label}
        </button>
      ))}
      <QueueOverflowMenu
        menu={shell.overflow_menu}
        open={props.overflowOpen}
        onOpenChange={props.onOverflowOpenChange}
        onPickItem={(item) =>
          dispatchOverflowPick(item, {
            onOverflowAction: props.onOverflowAction,
            onWorkEngineCommand: props.onWorkEngineCommand,
            onOwnershipCommand: props.onOwnershipCommand,
            onReviewCommand: props.onReviewCommand,
          })
        }
      />
    </div>
  );
}

function QueueItemDetailDrawer(props: {
  row: WorkEngineQueueRow;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onCommandAction: (row: WorkEngineQueueRow, cmd: QueueAllowedActionCommand) => void;
}) {
  const { row } = props;
  const panel = row.detail_panel;
  return (
    <div className="nx-we-drawer-overlay" role="presentation" onClick={props.onClose}>
      <div
        className="nx-we-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-we-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-we-drawer__head">
          <div>
            <h2 id="nx-we-drawer-title" className="nx-we-drawer__title">
              {panel.title}
            </h2>
            {panel.subtitle ? <p className="nx-we-drawer__subtitle">{panel.subtitle}</p> : null}
          </div>
          <button type="button" className="nx-we-btn" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="nx-we-drawer__body">
          {panel.sections.map((section, idx) => (
            <DetailSectionView
              key={`${row.work_item_id}-sec-${idx}`}
              section={section}
              onNavigate={props.onNavigate}
            />
          ))}
        </div>
        <div className="nx-we-drawer__footer">
          {row.allowed_actions.map((a) => (
            <button
              key={a.command}
              type="button"
              className="nx-we-btn"
              disabled={!a.enabled}
              title={a.reason ?? ''}
              onClick={() => props.onCommandAction(row, a.command)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailSectionView(props: {
  section: QueueDetailSection;
  onNavigate: (path: string) => void;
}) {
  const s = props.section;
  if (s.kind === 'kv_block') {
    return (
      <section className="nx-we-drawer-section">
        <h3 className="nx-we-drawer-section__title">{s.title}</h3>
        <dl className="nx-we-drawer-kv">
          {s.rows.map((r, i) => (
            <div key={`${i}-${r.label}`} className="nx-we-drawer-kv__row">
              <dt>{r.label}</dt>
              <dd>{r.value && String(r.value).trim() ? r.value : <span className="nx-we-muted">—</span>}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  if (s.kind === 'static_paragraph') {
    return (
      <section className="nx-we-drawer-section">
        <h3 className="nx-we-drawer-section__title">{s.title}</h3>
        <p className="nx-we-drawer-section__body">{s.body}</p>
      </section>
    );
  }
  return (
    <section className="nx-we-drawer-section">
      <button
        type="button"
        className="nx-we-btn nx-we-btn--primary"
        onClick={() => props.onNavigate(s.path)}
      >
        {s.label}
      </button>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function Pagination(props: {
  offset: number;
  limit: number;
  total: number;
  returned: number;
  onPrev: () => void;
  onNext: () => void;
  disabled: boolean;
}) {
  const from = props.returned > 0 ? props.offset + 1 : 0;
  const to = props.offset + props.returned;
  const hasPrev = props.offset > 0;
  const hasNext = props.offset + props.returned < props.total;
  return (
    <div className="nx-we-pagination">
      <div>
        Showing {from}–{to} of {props.total}
      </div>
      <div className="nx-we-pagination__nav">
        <button
          type="button"
          className="nx-we-btn"
          disabled={!hasPrev || props.disabled}
          onClick={props.onPrev}
        >
          Previous
        </button>
        <button
          type="button"
          className="nx-we-btn"
          disabled={!hasNext || props.disabled}
          onClick={props.onNext}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function PendingMappingSection(props: {
  pending: WorkEngineQueueAggregate['pending_mapping_section'];
}) {
  const { pending } = props;
  return (
    <div className="nx-we-pending">
      <h2 className="nx-we-pending__title">
        Pending mapping
        <span className="nx-we-pending__count">{pending.pending_mapping_count}</span>
      </h2>
      {pending.recent_pending_mappings.length === 0 ? (
        <div className="nx-we-muted">No pending events. Emitters are sending mappable events.</div>
      ) : (
        <div className="nx-we-pending__list">
          {pending.recent_pending_mappings.map((p) => (
            <div key={p.id} className="nx-we-pending__row">
              <div>
                <span className="nx-we-pending__label">Event</span>
                {p.event_type}
              </div>
              <div>
                <span className="nx-we-pending__label">Source</span>
                {p.source_module_label} · {p.source_entity_type}
              </div>
              <div>
                <span className="nx-we-pending__label">Client / period</span>
                {(p.client_name || p.client_id || '—') + ' · ' + (p.period_key || '—')}
              </div>
              <div>
                <span className="nx-we-pending__label">Reason</span>
                {p.pending_reason_label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

type WorkItemPendingModal = NonNullable<PendingModal>;

function ActionModal(props: {
  modal: WorkItemPendingModal;
  filtersForApi: WorkEngineQueueFiltersInput;
  aggregate: WorkEngineQueueAggregate;
  onClose: () => void;
  onCompleted: (refreshed: WorkEngineQueueAggregate | Record<string, unknown> | null) => void;
}) {
  const { modal, aggregate, filtersForApi, onClose, onCompleted } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields — only the minimum each command needs.
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [stateValue, setStateValue] = useState<string>('');
  const [dueAt, setDueAt] = useState<string>('');
  const [reasonText, setReasonText] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState<string>('');
  // Override modal uses row.allowed_override_kinds; start with the first entry
  // the backend offers for this row (or empty string if no override is valid).
  const initialOverrideKind: string =
    modal.kind === 'apply_override'
      ? (modal.row.allowed_override_kinds[0]?.value ?? '')
      : '';
  const [overrideKind, setOverrideKind] = useState<string>(initialOverrideKind);
  const selectedOverride: QueueRowAllowedOverrideKind | undefined =
    modal.kind === 'apply_override'
      ? modal.row.allowed_override_kinds.find((k) => k.value === overrideKind)
      : undefined;

  useEffect(() => {
    if (modal.kind === 'change_state') {
      const pre = modal.preset_to_state;
      const row = modal.row;
      if (pre && row.allowed_transitions.some((t) => t.value === pre)) {
        setStateValue(pre);
      } else {
        setStateValue('');
      }
    } else {
      setStateValue('');
    }
    setAssigneeId('');
  }, [modal]);

  const title = useMemo(() => {
    switch (modal.kind) {
      case 'assign':
        return 'Assign work item';
      case 'transfer':
        return 'Reassign work item';
      case 'change_state':
        return modal.preset_to_state === 'waiting_client'
          ? 'Mark waiting for client'
          : 'Update status';
      case 'set_deadline':
        return 'Set deadline';
      case 'apply_override':
        return 'Apply override';
      case 'archive':
        return 'Archive work item';
      case 'reject_review':
        return 'Reject review';
    }
  }, [modal]);

  const submit = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      const row = modal.row;
      const baseCommand = {
        work_item_id: row.work_item_id,
        expected_version: row.version,
        idempotency_key: crypto.randomUUID(),
      };

      let command: string;
      let payload: Record<string, unknown>;

      if (modal.kind === 'assign') {
        const id = assigneeId.trim();
        if (!id) throw new Error('Assignee is required');
        command = 'assign_work_item';
        payload = { ...baseCommand, assigned_user_id: id };
      } else if (modal.kind === 'transfer') {
        const id = assigneeId.trim();
        if (!id) throw new Error('New assignee is required');
        command = 'transfer_work_item';
        payload = { ...baseCommand, to_assigned_user_id: id };
      } else if (modal.kind === 'change_state') {
        if (row.allowed_transitions.length === 0) {
          throw new Error('No transitions are available for this work item.');
        }
        if (!stateValue) throw new Error('Choose target state');
        command = 'change_work_state';
        payload = { ...baseCommand, to_state: stateValue, reason_text: reasonText || null };
      } else if (modal.kind === 'set_deadline') {
        const iso = dueAt ? new Date(dueAt).toISOString() : null;
        command = 'set_work_deadline';
        payload = { ...baseCommand, due_at: iso };
      } else if (modal.kind === 'apply_override') {
        if (row.allowed_override_kinds.length === 0) {
          throw new Error('No overrides are available for this work item.');
        }
        const choice = row.allowed_override_kinds.find((k) => k.value === overrideKind);
        if (!choice) throw new Error('Choose override kind');
        if (choice.requires_reason && !reasonText.trim()) {
          throw new Error('reason_text is required');
        }
        if (choice.requires_to_state && !stateValue) {
          throw new Error('Choose target state');
        }
        command = 'apply_work_override';
        payload = {
          ...baseCommand,
          override_kind: choice.value,
          reason_text: reasonText.trim() || null,
          to_state: choice.requires_to_state ? stateValue : null,
        };
      } else if (modal.kind === 'reject_review') {
        const rr = rejectionReason.trim();
        if (!rr) throw new Error('Rejection reason is required');
        command = 'reject_work_item';
        payload = {
          ...baseCommand,
          rejection_reason: rr,
        };
      } else if (modal.kind === 'archive') {
        command = 'change_work_state';
        payload = { ...baseCommand, to_state: 'archived', reason_text: reasonText || null };
      } else {
        throw new Error('Unknown modal');
      }

      const resp = await executeWorkEngineQueueCommand({
        command,
        payload,
        filters: filtersForApi,
      });
      onCompleted(resp.refreshed?.aggregate ?? null);
    } catch (e) {
      if (isWorkItemVersionConflict(e)) {
        setError('Item was updated. Refreshing...');
        const refreshed = await fetchWorkEngineQueueAggregate(filtersForApi);
        onCompleted(refreshed);
        return;
      }
      setError(userFacingApiMessage(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    assigneeId,
    dueAt,
    filtersForApi,
    modal,
    onCompleted,
    overrideKind,
    reasonText,
    rejectionReason,
    stateValue,
  ]);

  return (
    <div className="nx-we-modal-overlay" role="dialog" aria-modal="true">
      <div className="nx-we-modal">
        <h3 className="nx-we-modal__title">{title}</h3>
        <div className="nx-we-modal__body">
          <div className="nx-we-modal__hint">
            {modal.row.command_modal_subject_line}
            <br />
            Current state: <strong>{modal.row.work_state_label}</strong> · version{' '}
            <strong>{modal.row.version}</strong>
          </div>

          {modal.kind === 'transfer' && (
            <div className="nx-we-field">
              <label htmlFor="we-modal-transfer-to">New assignee</label>
              <select
                id="we-modal-transfer-to"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">— Choose assignee —</option>
                {aggregate.filters.assignees.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className="nx-we-modal__hint">
                Choices come from the queue aggregate (`filters.assignees`).
              </span>
            </div>
          )}

          {modal.kind === 'assign' && (
            <div className="nx-we-field">
              <label htmlFor="we-modal-assignee">Assignee</label>
              <select
                id="we-modal-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">— Choose assignee —</option>
                {aggregate.filters.assignees.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className="nx-we-modal__hint">
                Choices come from the queue aggregate (`filters.assignees`).
              </span>
            </div>
          )}

          {modal.kind === 'change_state' && (
            modal.row.allowed_transitions.length === 0 ? (
              <div className="nx-we-modal__hint">
                No transitions are available for this work item.
              </div>
            ) : (
              <>
                <div className="nx-we-field">
                  <label htmlFor="we-modal-state">Target state</label>
                  <select
                    id="we-modal-state"
                    value={stateValue}
                    onChange={(e) => setStateValue(e.target.value)}
                  >
                    <option value="">— Choose state —</option>
                    {modal.row.allowed_transitions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                        {opt.terminal ? ' (terminal)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="nx-we-modal__hint">
                    Choices come from the backend state machine (row-scoped).
                  </span>
                </div>
                <div className="nx-we-field">
                  <label htmlFor="we-modal-reason-cs">Reason (optional)</label>
                  <input
                    id="we-modal-reason-cs"
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                  />
                </div>
              </>
            )
          )}

          {modal.kind === 'set_deadline' && (
            <div className="nx-we-field">
              <label htmlFor="we-modal-due">Due at</label>
              <input
                id="we-modal-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
              <span className="nx-we-modal__hint">
                Leave empty to clear the deadline. Backend stores the value and computes SLA;
                this UI never derives deadlines.
              </span>
            </div>
          )}

          {modal.kind === 'apply_override' && (
            modal.row.allowed_override_kinds.length === 0 ? (
              <div className="nx-we-modal__hint">
                No overrides are available for this work item.
              </div>
            ) : (
              <>
                <div className="nx-we-field">
                  <label htmlFor="we-modal-override-kind">Override kind</label>
                  <select
                    id="we-modal-override-kind"
                    value={overrideKind}
                    onChange={(e) => {
                      setOverrideKind(e.target.value);
                      setStateValue('');
                    }}
                  >
                    {modal.row.allowed_override_kinds.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="nx-we-modal__hint">
                    Choices come from the backend override rules (row-scoped).
                  </span>
                </div>
                {selectedOverride?.requires_to_state && (
                  <div className="nx-we-field">
                    <label htmlFor="we-modal-override-state">Target state</label>
                    <select
                      id="we-modal-override-state"
                      value={stateValue}
                      onChange={(e) => setStateValue(e.target.value)}
                    >
                      <option value="">— Choose state —</option>
                      {(selectedOverride.allowed_to_states ?? []).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                          {opt.terminal ? ' (terminal)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="nx-we-field">
                  <label htmlFor="we-modal-reason-ov">
                    Reason {selectedOverride?.requires_reason ? '(required)' : '(optional)'}
                  </label>
                  <input
                    id="we-modal-reason-ov"
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                  />
                </div>
              </>
            )
          )}

          {modal.kind === 'reject_review' && (
            <div className="nx-we-field">
              <label htmlFor="we-modal-reject-reason">Rejection reason (required)</label>
              <textarea
                id="we-modal-reject-reason"
                rows={4}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
              />
            </div>
          )}

          {modal.kind === 'archive' && (
            <>
              <div className="nx-we-modal__hint">
                This will move the work item to <strong>archived</strong>. The backend enforces
                that only items in <strong>done</strong> can be archived via this action.
              </div>
              <div className="nx-we-field">
                <label htmlFor="we-modal-reason-arc">Reason (optional)</label>
                <input
                  id="we-modal-reason-arc"
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                />
              </div>
            </>
          )}

          {error && <div className="nx-we-modal__error">{error}</div>}
        </div>
        <div className="nx-we-modal__footer">
          <button
            type="button"
            className="nx-we-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`nx-we-btn ${modal.kind === 'archive' || modal.kind === 'reject_review' ? 'nx-we-btn--danger' : 'nx-we-btn--primary'}`}
            onClick={submit}
            disabled={
              submitting ||
              ((modal.kind === 'assign' || modal.kind === 'transfer') && !assigneeId.trim()) ||
              (modal.kind === 'change_state' && modal.row.allowed_transitions.length === 0) ||
              (modal.kind === 'apply_override' &&
                modal.row.allowed_override_kinds.length === 0) ||
              (modal.kind === 'reject_review' && !rejectionReason.trim())
            }
          >
            {submitting
              ? 'Saving…'
              : modal.kind === 'archive'
                ? 'Archive'
                : modal.kind === 'reject_review'
                  ? 'Reject'
                  : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReminderReviewBanner(props: {
  banner: ReminderReviewBannerModel;
  onReview: () => void;
  onDismiss: () => void;
}) {
  const { banner } = props;
  const variantClass =
    banner.variant === 'warning'
      ? 'nx-we-reminder-banner--warning'
      : 'nx-we-reminder-banner--brand';
  return (
    <div className={`nx-we-reminder-banner ${variantClass}`} role="status">
      <div className="nx-we-reminder-banner__content">
        <h2 className="nx-we-reminder-banner__title">{banner.title}</h2>
        <p className="nx-we-reminder-banner__subtitle">{banner.subtitle}</p>
      </div>
      <div className="nx-we-reminder-banner__actions">
        <button type="button" className="nx-we-btn nx-we-btn--primary" onClick={props.onReview}>
          {banner.cta_label}
        </button>
        {banner.dismissible ? (
          <button type="button" className="nx-we-btn" onClick={props.onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ReminderReviewTable(props: {
  table: WorkEngineQueueTableModel;
  rows: ReminderReviewQueueRow[];
  onOpenDetail: (row: ReminderReviewQueueRow) => void;
}) {
  const columns = props.table.columns;
  if (props.rows.length === 0) {
    return (
      <div className="nx-we-table-wrap">
        <div className="nx-we-empty">No reminder candidates require review.</div>
      </div>
    );
  }
  return (
    <div className="nx-we-table-wrap nx-we-reminder-review-table-wrap">
      <table className={`nx-we-table nx-we-table--reminder-review nx-we-table--cols-${columns.length}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.kind === 'actions' ? 'nx-we-th nx-we-th--actions' : 'nx-we-th'}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const open = row.open_detail;
            return (
              <tr
                key={row.reminder_candidate_id}
                className="nx-we-reminder-review-row"
                onClick={() => open.enabled && props.onOpenDetail(row)}
              >
                {columns.map((col) => (
                  <td
                    key={`${row.reminder_candidate_id}-${col.key}`}
                    className={col.kind === 'actions' ? 'nx-we-td nx-we-td--actions' : 'nx-we-td'}
                    onClick={col.kind === 'actions' ? (e) => e.stopPropagation() : undefined}
                  >
                    {col.kind === 'actions' ? (
                      <button
                        type="button"
                        className="nx-we-btn nx-we-btn--compact nx-we-btn--primary"
                        disabled={!open.enabled}
                        title={open.disabled_reason ?? undefined}
                        onClick={() => props.onOpenDetail(row)}
                      >
                        {open.label}
                      </button>
                    ) : (
                      <span
                        className="nx-we-cell-ellip"
                        title={row.queue_cells[col.key as keyof typeof row.queue_cells] ?? undefined}
                      >
                        {row.queue_cells[col.key as keyof typeof row.queue_cells] ?? '—'}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReminderReviewWorkspaceModal(props: {
  aggregate: WorkEngineQueueAggregate;
  filtersForApi: WorkEngineQueueFiltersInput;
  onClose: () => void;
  onCompleted: (refreshed: WorkEngineQueueAggregate | Record<string, unknown> | null) => void;
  onCommandFailure: (e: unknown) => void | Promise<void>;
}) {
  const table =
    props.aggregate.reminder_review_table ?? props.aggregate.queue_table;
  const rows = props.aggregate.reminder_review_rows ?? [];
  const summary = props.aggregate.reminder_review_summary;
  const [selectedRow, setSelectedRow] = useState<ReminderReviewQueueRow | null>(null);
  const [detailMode, setDetailMode] = useState<'view' | 'edit' | 'cancel' | 'snooze'>('view');

  const openDetail = useCallback((row: ReminderReviewQueueRow) => {
    setSelectedRow(row);
    setDetailMode('view');
  }, []);

  const handleDetailCompleted = useCallback(
    (refreshed: WorkEngineQueueAggregate | Record<string, unknown> | null) => {
      props.onCompleted(refreshed);
      setSelectedRow(null);
      setDetailMode('view');
    },
    [props],
  );

  return (
    <div className="nx-we-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="we-reminder-review-title">
      <div className="nx-we-modal nx-we-modal--reminder-review-workspace">
        <div className="nx-we-modal__header-row">
          <h3 id="we-reminder-review-title" className="nx-we-modal__title">
            Reminder Review
          </h3>
          <button type="button" className="nx-we-btn" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="nx-we-modal__body">
          {selectedRow ? (
            <ReminderReviewDetailPane
              row={selectedRow}
              aggregate={props.aggregate}
              initialMode={detailMode}
              filtersForApi={props.filtersForApi}
              onBack={() => {
                setSelectedRow(null);
                setDetailMode('view');
              }}
              onCompleted={handleDetailCompleted}
              onCommandFailure={props.onCommandFailure}
            />
          ) : (
            <>
              {summary ? (
                <p className="nx-we-modal__hint">
                  {summary.pending_count === 1
                    ? '1 reminder requires your review before sending.'
                    : `${summary.pending_count} reminders require your review before sending.`}
                </p>
              ) : null}
              <ReminderReviewTable table={table} rows={rows} onOpenDetail={openDetail} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReminderReviewDetailPane(props: {
  row: ReminderReviewQueueRow;
  aggregate: WorkEngineQueueAggregate;
  initialMode: 'view' | 'edit' | 'cancel' | 'snooze';
  filtersForApi: WorkEngineQueueFiltersInput;
  onBack: () => void;
  onCompleted: (refreshed: WorkEngineQueueAggregate | Record<string, unknown> | null) => void;
  onCommandFailure: (e: unknown) => void | Promise<void>;
}) {
  const { row, aggregate, initialMode, filtersForApi, onBack, onCompleted, onCommandFailure } =
    props;
  const detail = row.reminder_detail_model;
  const [mode, setMode] = useState(initialMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editAction = row.allowed_actions.find((a) => a.action_key === 'edit_reminder_candidate');
  const cancelAction = row.allowed_actions.find((a) => a.action_key === 'cancel_reminder_candidate');
  const snoozeAction = row.allowed_actions.find((a) => a.action_key === 'snooze_reminder_candidate');

  const [subject, setSubject] = useState(detail.message.subject ?? '');
  const [body, setBody] = useState(detail.message.body);
  const [cancelReason, setCancelReason] = useState('');

  const snoozePresetsFromAction = (snoozeAction?.command_payload?.snooze_presets ?? []) as Array<{
    preset_key: string;
    label: string;
  }>;
  const snoozePresets =
    aggregate.snooze_presets && aggregate.snooze_presets.length > 0
      ? aggregate.snooze_presets
      : snoozePresetsFromAction;
  const [snoozePreset, setSnoozePreset] = useState(snoozePresets[0]?.preset_key ?? '1h');

  const runCommand = useCallback(
    async (action: ReminderReviewAllowedAction, extra?: Record<string, unknown>) => {
      setError(null);
      setSubmitting(true);
      try {
        const payload = {
          ...action.command_payload,
          ...extra,
          idempotency_key: crypto.randomUUID(),
        };
        const resp = await executeWorkEngineQueueCommand({
          command: action.command,
          payload,
          filters: filtersForApi,
        });
        onCompleted(resp.refreshed?.aggregate ?? null);
      } catch (e) {
        setError(userFacingApiMessage(e));
        await onCommandFailure(e);
      } finally {
        setSubmitting(false);
      }
    },
    [filtersForApi, onCompleted, onCommandFailure],
  );

  const onActionClick = useCallback(
    (action: ReminderReviewAllowedAction) => {
      if (!action.enabled || submitting) return;
      if (action.action_key === 'edit_reminder_candidate') {
        setMode('edit');
        return;
      }
      if (action.action_key === 'cancel_reminder_candidate') {
        setMode('cancel');
        return;
      }
      if (action.action_key === 'snooze_reminder_candidate') {
        setMode('snooze');
        return;
      }
      if (action.action_key === 'approve_send_reminder') {
        void runCommand(action);
      }
    },
    [runCommand, submitting],
  );

  const submitEdit = useCallback(async () => {
    if (!editAction?.enabled) return;
    await runCommand(editAction, { subject: subject.trim() || null, body: body.trim() });
  }, [body, editAction, runCommand, subject]);

  const submitCancel = useCallback(async () => {
    if (!cancelAction?.enabled) return;
    await runCommand(cancelAction, { reason: cancelReason.trim() || null });
  }, [cancelAction, cancelReason, runCommand]);

  const submitSnooze = useCallback(async () => {
    if (!snoozeAction?.enabled) return;
    await runCommand(snoozeAction, { snooze_preset: snoozePreset });
  }, [runCommand, snoozeAction, snoozePreset]);

  const subModeTitle =
    mode === 'edit'
      ? (editAction?.label ?? 'Edit')
      : mode === 'cancel'
        ? (cancelAction?.label ?? 'Cancel')
        : mode === 'snooze'
          ? (snoozeAction?.label ?? 'Snooze')
          : null;

  return (
    <div className="nx-we-reminder-detail-pane">
      {subModeTitle ? (
        <h4 className="nx-we-reminder-detail-pane__title">{subModeTitle}</h4>
      ) : detail.subtitle ? (
        <p className="nx-we-reminder-detail-pane__subtitle">{detail.subtitle}</p>
      ) : null}
      {error ? <div className="nx-we-banner-error">{error}</div> : null}

      {mode === 'view' ? (
        <>
          <dl className="nx-we-reminder-detail-kv">
            {detail.summary_fields.map((field) => (
              <div key={field.key} className="nx-we-reminder-detail-kv__row">
                <dt>{field.label}</dt>
                <dd>{field.value ?? '—'}</dd>
              </div>
            ))}
          </dl>
          {detail.channel_labels.length > 0 ? (
            <p className="nx-we-modal__hint">Channels: {detail.channel_labels.join(', ')}</p>
          ) : null}
          <div className="nx-we-reminder-detail-message">
            {detail.message.show_subject ? (
              <div className="nx-we-field">
                <label>{detail.message.subject_label}</label>
                <div className="nx-we-reminder-detail-message__readonly">
                  {detail.message.subject ?? '—'}
                </div>
              </div>
            ) : null}
            <div className="nx-we-field">
              <label>{detail.message.body_label}</label>
              <div className="nx-we-reminder-detail-message__readonly nx-we-reminder-detail-message__body">
                {detail.message.body}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {mode === 'edit' ? (
        <>
          {detail.message.show_subject ? (
            <div className="nx-we-field">
              <label htmlFor="we-reminder-detail-subject">{detail.message.subject_label}</label>
              <input
                id="we-reminder-detail-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          ) : null}
          <div className="nx-we-field">
            <label htmlFor="we-reminder-detail-body">{detail.message.body_label}</label>
            <textarea
              id="we-reminder-detail-body"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {detail.channel_labels.length > 0 ? (
            <p className="nx-we-modal__hint">Channels: {detail.channel_labels.join(', ')}</p>
          ) : null}
        </>
      ) : null}

      {mode === 'cancel' ? (
        <div className="nx-we-field">
          <label htmlFor="we-reminder-detail-cancel-reason">Reason (optional)</label>
          <textarea
            id="we-reminder-detail-cancel-reason"
            rows={3}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </div>
      ) : null}

      {mode === 'snooze' ? (
        <div className="nx-we-field">
          <label htmlFor="we-reminder-detail-snooze">Snooze for</label>
          <select
            id="we-reminder-detail-snooze"
            value={snoozePreset}
            onChange={(e) => setSnoozePreset(e.target.value)}
          >
            {snoozePresets.map((p) => (
              <option key={p.preset_key} value={p.preset_key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="nx-we-reminder-detail-actions">
        {mode === 'view' ? (
          <>
            <button type="button" className="nx-we-btn" onClick={onBack} disabled={submitting}>
              Back to list
            </button>
            {row.allowed_actions.map((action) => (
              <button
                key={action.action_key}
                type="button"
                className={`nx-we-btn nx-we-btn--compact${action.action_key === 'approve_send_reminder' ? ' nx-we-btn--primary' : ''}${action.action_key === 'cancel_reminder_candidate' ? ' nx-we-btn--danger' : ''}`}
                disabled={!action.enabled || submitting}
                title={action.disabled_reason ?? undefined}
                onClick={() => onActionClick(action)}
              >
                {action.label}
              </button>
            ))}
          </>
        ) : (
          <>
            <button
              type="button"
              className="nx-we-btn"
              onClick={() => setMode('view')}
              disabled={submitting}
            >
              Back
            </button>
            {mode === 'edit' ? (
              <button
                type="button"
                className="nx-we-btn nx-we-btn--primary"
                onClick={() => void submitEdit()}
                disabled={submitting || !body.trim() || !editAction?.enabled}
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            ) : null}
            {mode === 'cancel' ? (
              <button
                type="button"
                className="nx-we-btn nx-we-btn--danger"
                onClick={() => void submitCancel()}
                disabled={submitting || !cancelAction?.enabled}
              >
                {submitting ? 'Saving…' : (cancelAction?.label ?? 'Cancel')}
              </button>
            ) : null}
            {mode === 'snooze' ? (
              <button
                type="button"
                className="nx-we-btn nx-we-btn--primary"
                onClick={() => void submitSnooze()}
                disabled={submitting || !snoozeAction?.enabled}
              >
                {submitting ? 'Saving…' : (snoozeAction?.label ?? 'Snooze')}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function initialEscalationFieldValues(fields: WorkEngineEscalationFormField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (field.kind === 'select') {
      out[field.key] = field.options[0]?.value ?? '';
    } else {
      out[field.key] = '';
    }
  }
  return out;
}

function EscalationCommandModal(props: {
  aggregate: WorkEngineQueueAggregate;
  row: WorkEngineQueueRow;
  item: QueueOverflowMenuItem;
  onClose: () => void;
  onSubmit: (fieldValues: Record<string, string>) => Promise<void>;
  onCommandFailure: (e: unknown) => void | Promise<void>;
}) {
  const formKey = props.item.modal_form_key;
  const form =
    formKey && props.aggregate.escalation_workspace?.command_forms
      ? props.aggregate.escalation_workspace.command_forms[formKey]
      : undefined;

  const [values, setValues] = useState<Record<string, string>>(() =>
    form ? initialEscalationFieldValues(form.fields) : {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!form || !formKey) {
    return null;
  }

  const subject = props.row.command_modal_subject_line ?? props.row.work_type_label;

  const handleSubmit = async () => {
    setError(null);
    for (const field of form.fields) {
      if (field.required && !String(values[field.key] ?? '').trim()) {
        setError(`${field.label} is required`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload: Record<string, string> = {};
      for (const field of form.fields) {
        const v = String(values[field.key] ?? '').trim();
        if (v || field.required) payload[field.key] = v;
      }
      await props.onSubmit(payload);
    } catch (e) {
      setError(userFacingApiMessage(e));
      await props.onCommandFailure(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="nx-we-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-escalation-modal-title"
    >
      <div className="nx-we-modal nx-we-modal--escalation-workspace">
        <div className="nx-we-modal__header-row">
          <h3 id="we-escalation-modal-title" className="nx-we-modal__title">
            {form.title}
          </h3>
        </div>
        <div className="nx-we-modal__body">
          {subject ? <p className="nx-we-modal__hint">{subject}</p> : null}
          {error ? <div className="nx-we-banner-error">{error}</div> : null}
          <form
            className="nx-we-escalation-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            {form.fields.map((field) => (
              <EscalationFormFieldControl
                key={field.key}
                field={field}
                value={values[field.key] ?? ''}
                disabled={submitting}
                onChange={(next) => setValues((prev) => ({ ...prev, [field.key]: next }))}
              />
            ))}
            <div className="nx-we-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                onClick={props.onClose}
                disabled={submitting}
              >
                {form.cancel_label}
              </button>
              <button
                type="submit"
                className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                disabled={submitting}
              >
                {submitting ? 'Working…' : form.submit_label}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function EscalationFormFieldControl(props: {
  field: WorkEngineEscalationFormField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = `we-escalation-${props.field.key}`;
  if (props.field.kind === 'select') {
    return (
      <label className="nx-we-escalation-form__field" htmlFor={id}>
        <span className="nx-we-escalation-form__label">
          {props.field.label}
          {props.field.required ? ' *' : ''}
        </span>
        <select
          id={id}
          className="nx-we-escalation-form__select"
          value={props.value}
          required={props.field.required}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
        >
          {props.field.options.length === 0 ? (
            <option value="">No eligible users</option>
          ) : (
            props.field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          )}
        </select>
      </label>
    );
  }
  return (
    <label className="nx-we-escalation-form__field" htmlFor={id}>
      <span className="nx-we-escalation-form__label">
        {props.field.label}
        {props.field.required ? ' *' : ''}
      </span>
      <textarea
        id={id}
        className="nx-we-escalation-form__textarea"
        value={props.value}
        required={props.field.required}
        disabled={props.disabled}
        placeholder={props.field.placeholder ?? undefined}
        rows={4}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}
