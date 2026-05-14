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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  executeWorkEngineQueueCommand,
  fetchWorkEngineQueueAggregate,
  type QueueAllowedActionCommand,
  type QueueOwnershipCommand,
  type QueueReviewCommand,
  type QueueDetailSection,
  type QueueRowAllowedOverrideKind,
  type WorkEngineQueueAggregate,
  type WorkEngineQueueFiltersInput,
  type WorkEngineQueueRow,
  type WorkEngineQueueTableModel,
} from '../api/work-engine';
import { userFacingApiMessage } from '../api/client';
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
  | { kind: 'change_state'; row: WorkEngineQueueRow }
  | { kind: 'set_deadline'; row: WorkEngineQueueRow }
  | { kind: 'apply_override'; row: WorkEngineQueueRow }
  | { kind: 'archive'; row: WorkEngineQueueRow }
  | { kind: 'reject_review'; row: WorkEngineQueueRow }
  | null;

export function WorkEngineQueue() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [aggregate, setAggregate] = useState<WorkEngineQueueAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<PendingModal>(null);
  const [detailRow, setDetailRow] = useState<WorkEngineQueueRow | null>(null);

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
        setError(userFacingApiMessage(e));
      }
    },
    [filters, handleCommandResult],
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
        setError(userFacingApiMessage(e));
      }
    },
    [filters, handleCommandResult],
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

  return (
    <div className="nx-we-queue">
      <h1 className="nx-we-queue__title">Work Engine — Queue</h1>
      <p className="nx-we-queue__subtitle">
        Backend-driven workflow inbox. All states, labels, and actions are owned by the
        server.
      </p>

      {error && <div className="nx-we-banner-error">{error}</div>}

      <SummaryCards cards={cards} />

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
  if (cmd === 'change_state') return { kind: 'change_state', row };
  if (cmd === 'set_deadline') return { kind: 'set_deadline', row };
  if (cmd === 'apply_override') return { kind: 'apply_override', row };
  if (cmd === 'archive') return { kind: 'archive', row };
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────── */

function SummaryCards({ cards }: { cards: WorkEngineQueueAggregate['summary_cards'] }) {
  const items: Array<{ key: keyof WorkEngineQueueAggregate['summary_cards']; label: string; tone?: 'alert' | 'warn' }> = [
    { key: 'total_active', label: 'Active' },
    { key: 'assigned_to_me', label: 'Assigned to me' },
    { key: 'unassigned', label: 'Unassigned' },
    { key: 'claimed_by_me', label: 'Claimed by me' },
    { key: 'review_for_me', label: 'Review for me' },
    { key: 'waiting_client', label: 'Waiting client' },
    { key: 'waiting_human', label: 'Waiting office' },
    { key: 'review_pending', label: 'Review pending' },
    { key: 'overdue', label: 'Overdue', tone: 'alert' },
    { key: 'escalated', label: 'Escalated', tone: 'alert' },
    { key: 'pending_mapping', label: 'Pending mapping', tone: 'warn' },
  ];
  return (
    <div className="nx-we-queue__cards">
      {items.map((it) => (
        <div
          key={it.key as string}
          className={`nx-we-card${it.tone ? ` nx-we-card--${it.tone}` : ''}`}
        >
          <div className="nx-we-card__label">{it.label}</div>
          <div className="nx-we-card__value">{cards[it.key]}</div>
        </div>
      ))}
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
          {(options.queue_buckets ?? [{ value: '', label: 'All' }]).map((opt) => (
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

function QueueTable(props: {
  table: WorkEngineQueueTableModel;
  rows: WorkEngineQueueRow[];
  onOpenDetail: (row: WorkEngineQueueRow) => void;
  onOverflowAction: (row: WorkEngineQueueRow, cmd: QueueAllowedActionCommand) => void;
  onOwnershipCommand: (row: WorkEngineQueueRow, cmd: QueueOwnershipCommand['command']) => void;
  onReviewCommand: (row: WorkEngineQueueRow, cmd: QueueReviewCommand['command']) => void;
}) {
  if (props.rows.length === 0) {
    return (
      <div className="nx-we-table-wrap">
        <div className="nx-we-empty">No work items match the current filters.</div>
      </div>
    );
  }
  return (
    <div className="nx-we-table-wrap">
      <table className="nx-we-table">
        <thead>
          <tr>
            {props.table.columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.work_item_id}>
              {props.table.columns.map((col) => (
                <td key={`${row.work_item_id}-${col.key}`}>
                  {col.kind === 'actions' ? (
                    <QueueRowShellActions
                      row={row}
                      onOpenDetail={() => props.onOpenDetail(row)}
                      onOverflowAction={(cmd) => props.onOverflowAction(row, cmd)}
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
  if (colKey === 'state') {
    return <span className="nx-we-state-badge nx-we-state-badge--wide">{raw}</span>;
  }
  if (colKey === 'sla' && row.sla_status && row.sla_status !== 'none') {
    return (
      <span className={`nx-we-sla-badge nx-we-sla-badge--${row.sla_status}`}>{raw}</span>
    );
  }
  return raw;
}

function QueueRowShellActions(props: {
  row: WorkEngineQueueRow;
  onOpenDetail: () => void;
  onOverflowAction: (cmd: QueueAllowedActionCommand) => void;
  onOwnershipCommand: (cmd: QueueOwnershipCommand['command']) => void;
  onReviewCommand: (cmd: QueueReviewCommand['command']) => void;
}) {
  const { row } = props;
  const open = row.queue_shell.open_detail;
  const ownership = row.ownership_commands ?? [];
  const review = row.review_commands ?? [];
  return (
    <div className="nx-we-shell-actions">
      {ownership.map((c) => (
        <button
          key={c.command}
          type="button"
          className="nx-we-btn nx-we-btn--secondary"
          disabled={!c.enabled}
          title={c.reason ?? ''}
          onClick={() => props.onOwnershipCommand(c.command)}
        >
          {c.label}
        </button>
      ))}
      {review.map((c) => (
        <button
          key={c.command}
          type="button"
          className="nx-we-btn nx-we-btn--secondary"
          disabled={!c.enabled}
          title={c.reason ?? ''}
          onClick={() => props.onReviewCommand(c.command)}
        >
          {c.label}
        </button>
      ))}
      <button
        type="button"
        className="nx-we-btn nx-we-btn--primary"
        disabled={!open.enabled}
        title={open.reason ?? ''}
        onClick={() => props.onOpenDetail()}
      >
        {open.label}
      </button>
      <details className="nx-we-overflow">
        <summary className="nx-we-overflow__summary" aria-label="More actions">
          {row.queue_shell.overflow_menu_button_label}
        </summary>
        <div className="nx-we-overflow__menu">
          {row.allowed_actions.map((a) => (
            <button
              key={a.command}
              type="button"
              className="nx-we-overflow__item"
              disabled={!a.enabled}
              title={a.reason ?? ''}
              onClick={() => {
                props.onOverflowAction(a.command);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </details>
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

function ActionModal(props: {
  modal: NonNullable<PendingModal>;
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

  const title = useMemo(() => {
    switch (modal.kind) {
      case 'assign':
        return 'Assign work item';
      case 'change_state':
        return 'Change state';
      case 'set_deadline':
        return 'Set deadline';
      case 'apply_override':
        return 'Apply override';
      case 'archive':
        return 'Archive work item';
      case 'reject_review':
        return 'Reject review';
    }
  }, [modal.kind]);

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
      } else {
        command = 'change_work_state';
        payload = { ...baseCommand, to_state: 'archived', reason_text: reasonText || null };
      }

      const resp = await executeWorkEngineQueueCommand({
        command,
        payload,
        filters: filtersForApi,
      });
      onCompleted(resp.refreshed?.aggregate ?? null);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    assigneeId,
    dueAt,
    filtersForApi,
    modal.kind,
    modal.row,
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
