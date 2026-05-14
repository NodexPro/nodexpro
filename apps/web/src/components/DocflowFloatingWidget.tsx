import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../api/client';
import { docflowFloatingWidgetAggregate, docflowOfficeCommands, docflowOfficeTaskCenterAggregate } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';
import './DocflowFloatingWidget.css';

type UnknownRecord = Record<string, unknown>;

type AllowedAction = { command?: string; enabled?: boolean; reason?: string | null };

const REVIEW_ACTION_KEYS = new Set([
  'edit_draft_message',
  'approve_draft_message',
  'send_approved_message',
  'cancel_draft_message',
]);

type PendingDraft = {
  draft_id?: string;
  client_id?: string;
  client_name?: string | null;
  rule_name?: string | null;
  rule_value_key?: string | null;
  message_body?: string;
  message_preview?: string;
  status?: string;
  status_label?: string;
  created_at?: string | null;
  client_display_name?: string | null;
  preview_text?: string;
  generated_at_display?: string;
  generated_at?: string | null;
  command_context?: UnknownRecord;
  allowed_actions?: AllowedAction[];
};

function isRecord(v: unknown): v is UnknownRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function draftAction(d: PendingDraft, command: string): { ok: boolean; reason: string | null } {
  const list = Array.isArray(d.allowed_actions) ? d.allowed_actions : [];
  const hit = list.find((a) => String(a.command ?? '') === command);
  if (!hit) return { ok: false, reason: null };
  return { ok: !!hit.enabled, reason: hit.reason ?? null };
}

function hasDraftAction(d: PendingDraft, command: string): boolean {
  const list = Array.isArray(d.allowed_actions) ? d.allowed_actions : [];
  return list.some((a) => String(a.command ?? '') === command);
}

function hasAnyReviewAction(d: PendingDraft): boolean {
  const list = Array.isArray(d.allowed_actions) ? d.allowed_actions : [];
  return list.some((a) => REVIEW_ACTION_KEYS.has(String(a.command ?? '')));
}

function draftRowKey(d: PendingDraft, idx: number): string {
  const id = String(d.draft_id ?? '').trim();
  if (id) return id;
  const ctx = d.command_context;
  if (isRecord(ctx)) {
    return `${String(ctx.draft_id ?? '')}-${String(ctx.rule_run_id ?? '')}-${idx}`;
  }
  return `row-${idx}`;
}

function reasonCellText(d: PendingDraft): string {
  const preview = String(d.message_preview ?? '').trim();
  if (preview) return preview;
  const pt = String(d.preview_text ?? '').trim();
  if (pt) return pt;
  return String(d.rule_name ?? d.rule_value_key ?? '').trim();
}

/** Presentation only: maps backend `status_label` strings (see `threadStatusLabel` in API) to pill color — no domain logic. */
function taskCenterStatusPillClass(statusLabel: string): string {
  const s = statusLabel.trim();
  if (s === 'Open') return 'docflow-tc-status-pill docflow-tc-status-pill--open';
  if (s === 'Waiting Client') return 'docflow-tc-status-pill docflow-tc-status-pill--waiting-client';
  if (s === 'Waiting Office') return 'docflow-tc-status-pill docflow-tc-status-pill--waiting-office';
  if (s === 'Resolved') return 'docflow-tc-status-pill docflow-tc-status-pill--resolved';
  if (s === 'Archived') return 'docflow-tc-status-pill docflow-tc-status-pill--archived';
  return 'docflow-tc-status-pill docflow-tc-status-pill--default';
}

function taskCenterBulkActionLabel(bulkAction: string): string {
  switch (bulkAction) {
    case 'reminder':
      return 'Reminder';
    case 'assign':
      return 'Assign';
    case 'resolve':
      return 'Resolve';
    case 'archive':
      return 'Archive';
    default:
      return bulkAction;
  }
}

function taskCenterSecondaryActionLabel(command: string): string {
  switch (command) {
    case 'send_docflow_reminder':
      return 'Reminder';
    case 'assign_docflow_thread':
      return 'Assign';
    case 'resolve_docflow_thread':
      return 'Resolve';
    case 'archive_docflow_thread':
      return 'Archive';
    default:
      return command;
  }
}

function threadRowAction(actions: AllowedAction[], command: string): AllowedAction | undefined {
  return actions.find((a) => String(a.command ?? '') === command);
}

const TC_SECONDARY_CMDS = [
  'send_docflow_reminder',
  'assign_docflow_thread',
  'resolve_docflow_thread',
  'archive_docflow_thread',
] as const;

type KpiTone = 'danger' | 'warn' | 'amber' | 'ok' | 'info' | 'purple';

function TaskCenterKpiIcon({ tone }: { tone: KpiTone }) {
  const svgProps = {
    className: 'docflow-kpi-icon-svg',
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true as const,
  };
  switch (tone) {
    case 'danger':
      return (
        <svg {...svgProps}>
          <path
            d="M12 9v4m0 4h.01M10.3 3.2h3.4L21 17H3L10.3 3.2z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'warn':
      return (
        <svg {...svgProps}>
          <path
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'amber':
      return (
        <svg {...svgProps}>
          <path
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'ok':
      return (
        <svg {...svgProps}>
          <path
            d="M9 12h6m-6 4h4M7 4h10l1 4v10a2 2 0 01-2 2H8a2 2 0 01-2-2V8l1-4z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'info':
      return (
        <svg {...svgProps}>
          <path
            d="M3 8l9 5 9-5-9-5-9 5zm0 8l9 5 9-5M3 12l9 5 9-5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'purple':
      return (
        <svg {...svgProps}>
          <path
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-1a4 4 0 014-4h4a4 4 0 014 4v1"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      );
  }
}

export function DocflowFloatingWidget() {
  const navigate = useNavigate();
  const auth = useAuth();
  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [tasksModalOpen, setTasksModalOpen] = useState(false);
  const [taskCenter, setTaskCenter] = useState<UnknownRecord | null>(null);
  const [tcLoadError, setTcLoadError] = useState('');
  const [tcPage, setTcPage] = useState(1);
  const [tcPageSize] = useState(25);
  const [tcSearch, setTcSearch] = useState('');
  const [tcModule, setTcModule] = useState('');
  const [tcThreadType, setTcThreadType] = useState('');
  const [tcThreadStatus, setTcThreadStatus] = useState('');
  const [tcAssigned, setTcAssigned] = useState('');
  const [tcUnreadOnly, setTcUnreadOnly] = useState(false);
  const [tcOverdueOnly, setTcOverdueOnly] = useState(false);
  const [tcDueFrom, setTcDueFrom] = useState('');
  const [tcDueTo, setTcDueTo] = useState('');
  const [tcDraftRule, setTcDraftRule] = useState('all');
  const [assignPick, setAssignPick] = useState<{ threadId: string; clientId: string } | null>(null);
  const [assignUserChoice, setAssignUserChoice] = useState('');
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [cancelConfirmDraft, setCancelConfirmDraft] = useState<PendingDraft | null>(null);

  /** Invalidates in-flight task-center GETs so stale responses cannot overwrite newer aggregate truth. */
  const taskCenterRequestGenRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) {
      setAggregate(null);
      return;
    }
    setLoadError('');
    try {
      const data = (await apiJson(docflowFloatingWidgetAggregate)) as UnknownRecord;
      setAggregate(data);
    } catch (e) {
      setAggregate(null);
      setLoadError(userFacingApiMessage(e));
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const taskCenterCommandExtras = useCallback((): UnknownRecord => {
    return {
      task_center_page: tcPage,
      task_center_page_size: tcPageSize,
      task_center_search: tcSearch.trim() || undefined,
      task_center_module: tcModule.trim() || undefined,
      task_center_thread_type: tcThreadType.trim() || undefined,
      task_center_thread_status: tcThreadStatus.trim() || undefined,
      task_center_assigned_filter: tcAssigned.trim() || undefined,
      task_center_unread_only: tcUnreadOnly,
      task_center_overdue_only: tcOverdueOnly,
      task_center_due_from: tcDueFrom.trim() || undefined,
      task_center_due_to: tcDueTo.trim() || undefined,
      task_center_draft_rule_filter: tcDraftRule !== 'all' ? tcDraftRule : undefined,
    };
  }, [
    tcPage,
    tcPageSize,
    tcSearch,
    tcModule,
    tcThreadType,
    tcThreadStatus,
    tcAssigned,
    tcUnreadOnly,
    tcOverdueOnly,
    tcDueFrom,
    tcDueTo,
    tcDraftRule,
  ]);

  const loadTaskCenter = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!orgId || !tasksModalOpen) return;
    const gen = ++taskCenterRequestGenRef.current;
    setTcLoadError('');
    try {
      const url = docflowOfficeTaskCenterAggregate({
        page: tcPage,
        page_size: tcPageSize,
        search: tcSearch.trim() || null,
        module: tcModule.trim() || null,
        thread_type: tcThreadType.trim() || null,
        thread_status: tcThreadStatus.trim() || null,
        assigned_filter: tcAssigned.trim() || null,
        unread_only: tcUnreadOnly,
        overdue_only: tcOverdueOnly,
        due_from: tcDueFrom.trim() || null,
        due_to: tcDueTo.trim() || null,
        draft_rule_filter: tcDraftRule !== 'all' ? tcDraftRule : null,
      });
      const data = (await apiJson(url, { signal })) as UnknownRecord;
      if (signal?.aborted) return;
      if (gen !== taskCenterRequestGenRef.current) return;
      setTaskCenter(data);
      const pr = data.pagination;
      if (isRecord(pr)) {
        const serverPage = typeof pr.page === 'number' ? pr.page : Number(pr.page) || 1;
        if (serverPage !== tcPage) setTcPage(serverPage);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      if (gen !== taskCenterRequestGenRef.current) return;
      setTaskCenter(null);
      setTcLoadError(userFacingApiMessage(e));
    }
  }, [
    orgId,
    tasksModalOpen,
    tcPage,
    tcPageSize,
    tcSearch,
    tcModule,
    tcThreadType,
    tcThreadStatus,
    tcAssigned,
    tcUnreadOnly,
    tcOverdueOnly,
    tcDueFrom,
    tcDueTo,
    tcDraftRule,
  ]);

  useEffect(() => {
    if (!tasksModalOpen || !orgId) {
      taskCenterRequestGenRef.current += 1;
      setTaskCenter(null);
      setSelectedThreadIds([]);
      return;
    }
    const ac = new AbortController();
    void loadTaskCenter(ac.signal);
    return () => {
      taskCenterRequestGenRef.current += 1;
      ac.abort();
    };
  }, [tasksModalOpen, orgId, loadTaskCenter]);

  const runTaskModalCommand = useCallback(
    async (command: string, ctx: UnknownRecord): Promise<void> => {
      if (!orgId) return;
      setBusy(command);
      setActionError('');
      try {
        const out = (await apiJson(docflowOfficeCommands, {
          method: 'POST',
          body: JSON.stringify({
            command,
            payload: {
              org_id: orgId,
              ...ctx,
              ...taskCenterCommandExtras(),
              refresh_aggregate: 'office_docflow_task_center_aggregate',
            },
          }),
        })) as { refreshed?: { aggregate_key?: string; aggregate?: UnknownRecord } };
        const key = out.refreshed?.aggregate_key;
        const agg = out.refreshed?.aggregate;
        if (key !== 'office_docflow_task_center_aggregate' || !isRecord(agg)) {
          throw new Error('DocFlow task center aggregate missing in command response');
        }
        taskCenterRequestGenRef.current += 1;
        setTaskCenter(agg);
        void load();
      } catch (e) {
        setActionError(userFacingApiMessage(e));
      } finally {
        setBusy('');
      }
    },
    [orgId, taskCenterCommandExtras, load],
  );

  const visibility = String(aggregate?.widget_visibility ?? '');
  const badgeRing = String(aggregate?.badge_ring ?? '');
  const badgeModifierClass =
    badgeRing === 'trial_active'
      ? 'docflow-badge--trial'
      : badgeRing === 'active_paid'
        ? 'docflow-badge--paid'
        : 'docflow-badge--locked';
  const widgetAccess = String(aggregate?.widget_access ?? '');
  const lockedMessage = aggregate?.locked_message != null ? String(aggregate.locked_message) : '';
  const billingCta = aggregate?.billing_cta_label != null ? String(aggregate.billing_cta_label) : 'Go to billing';
  const billingPath = aggregate?.billing_path != null ? String(aggregate.billing_path) : '/billing';
  const countRaw = aggregate?.pending_draft_count;
  const pendingCount = typeof countRaw === 'number' ? countRaw : Number(countRaw) || 0;

  const modalHeaderCountRaw = taskCenter?.pending_draft_count ?? aggregate?.pending_draft_count;
  const modalPendingCount =
    typeof modalHeaderCountRaw === 'number' ? modalHeaderCountRaw : Number(modalHeaderCountRaw) || 0;

  const modalDrafts: PendingDraft[] = useMemo(() => {
    if (!taskCenter) return [];
    const raw = taskCenter.pending_drafts;
    return Array.isArray(raw) ? (raw as PendingDraft[]) : [];
  }, [taskCenter]);

  const draftRuleSelectOptions = useMemo(() => {
    const tc = taskCenter?.task_center;
    if (!isRecord(tc)) return [];
    const raw = tc.draft_rule_options;
    return Array.isArray(raw) ? (raw as { value?: string; label?: string }[]) : [];
  }, [taskCenter]);

  const mh = taskCenter ?? aggregate;
  const modalTrialBadge = mh?.trial_badge_label != null ? String(mh.trial_badge_label) : '';
  const modalTrialDetail = mh?.trial_detail_line != null ? String(mh.trial_detail_line) : '';

  const summaryRec = isRecord(taskCenter?.summary) ? (taskCenter!.summary as UnknownRecord) : null;
  const filtersRec = isRecord(taskCenter?.filters) ? (taskCenter!.filters as UnknownRecord) : null;
  const rowsArr: UnknownRecord[] = Array.isArray(taskCenter?.rows) ? (taskCenter!.rows as UnknownRecord[]) : [];
  const paginationRec = isRecord(taskCenter?.pagination) ? (taskCenter!.pagination as UnknownRecord) : null;
  const tcTotalPages =
    typeof paginationRec?.total_pages === 'number'
      ? paginationRec.total_pages
      : Number(paginationRec?.total_pages) || 0;
  const tcTotalRows =
    typeof paginationRec?.total_rows === 'number'
      ? paginationRec.total_rows
      : Number(paginationRec?.total_rows) || 0;

  const moduleFilterOpts = Array.isArray(filtersRec?.modules)
    ? (filtersRec!.modules as { value?: string; label?: string }[])
    : [];
  const typeFilterOpts = Array.isArray(filtersRec?.thread_types)
    ? (filtersRec!.thread_types as { value?: string; label?: string }[])
    : [];
  const statusFilterOpts = Array.isArray(filtersRec?.statuses)
    ? (filtersRec!.statuses as { value?: string; label?: string }[])
    : [];
  const accountantFilterOpts = Array.isArray(filtersRec?.accountants)
    ? (filtersRec!.accountants as { value?: string; label?: string }[])
    : [];
  const bulkAllowed = Array.isArray(taskCenter?.bulk_allowed_actions)
    ? (taskCenter!.bulk_allowed_actions as { bulk_action?: string; enabled?: boolean }[])
    : [];

  const selectedThreadsOnPage = new Set(
    rowsArr.map((r) => String(r.thread_id ?? '').trim()).filter(Boolean),
  );
  const allRowsSelected =
    selectedThreadsOnPage.size > 0 && [...selectedThreadsOnPage].every((id) => selectedThreadIds.includes(id));

  function toggleSelectAllRows(): void {
    if (allRowsSelected) {
      setSelectedThreadIds((prev) => prev.filter((id) => !selectedThreadsOnPage.has(id)));
    } else {
      setSelectedThreadIds((prev) => [...new Set([...prev, ...selectedThreadsOnPage])]);
    }
  }

  function toggleRowSelected(threadId: string): void {
    setSelectedThreadIds((prev) =>
      prev.includes(threadId) ? prev.filter((id) => id !== threadId) : [...prev, threadId],
    );
  }

  function clearAllTaskFilters(): void {
    setTcSearch('');
    setTcModule('');
    setTcThreadType('');
    setTcThreadStatus('');
    setTcAssigned('');
    setTcUnreadOnly(false);
    setTcOverdueOnly(false);
    setTcDueFrom('');
    setTcDueTo('');
    setTcDraftRule('all');
    setTcPage(1);
  }

  async function runBulk(bulkAction: string): Promise<void> {
    if (!selectedThreadIds.length) return;
    if (bulkAction === 'assign' && !assignUserChoice.trim()) {
      setActionError('Choose an accountant in the assign bar before bulk assign.');
      return;
    }
    const idem = `bulk_${bulkAction}_${Date.now()}`;
    await runTaskModalCommand('bulk_docflow_action', {
      action_type: bulkAction,
      thread_ids: selectedThreadIds,
      assigned_user_id: bulkAction === 'assign' ? assignUserChoice.trim() : undefined,
      idempotency_key: idem,
    });
    setSelectedThreadIds([]);
  }

  const selectedDraft = useMemo(() => {
    if (!selectedDraftId) return null;
    return modalDrafts.find((d) => String(d.draft_id ?? '') === selectedDraftId) ?? null;
  }, [modalDrafts, selectedDraftId]);

  useEffect(() => {
    if (!selectedDraftId) return;
    if (!modalDrafts.some((d) => String(d.draft_id ?? '') === selectedDraftId)) {
      setSelectedDraftId(null);
      setDetailEditing(false);
      setEditBody('');
    }
  }, [modalDrafts, selectedDraftId]);

  useEffect(() => {
    setDetailEditing(false);
    setEditBody('');
  }, [selectedDraftId]);

  useEffect(() => {
    setCancelConfirmDraft(null);
  }, [selectedDraftId]);

  useEffect(() => {
    if (!tasksModalOpen) {
      setCancelConfirmDraft(null);
    }
  }, [tasksModalOpen]);

  useEffect(() => {
    if (!menuOpen && !tasksModalOpen && !cancelConfirmDraft) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (cancelConfirmDraft) {
        setCancelConfirmDraft(null);
        return;
      }
      if (tasksModalOpen) {
        setTasksModalOpen(false);
        return;
      }
      setMenuOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, tasksModalOpen, cancelConfirmDraft]);

  async function runDraftCommand(command: string, d: PendingDraft, extra?: UnknownRecord): Promise<void> {
    const ctx = isRecord(d.command_context) ? d.command_context : {};
    await runTaskModalCommand(command, { ...ctx, ...(extra ?? {}) });
  }

  function closeMenu(): void {
    setMenuOpen(false);
  }

  function closeTasksModal(): void {
    setTasksModalOpen(false);
  }

  function openTasksFromMenu(): void {
    closeMenu();
    setTasksModalOpen(true);
  }

  function goMessenger(): void {
    closeMenu();
    navigate('/m/docflow/messenger');
  }

  function onFabClick(e: MouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    if (tasksModalOpen) {
      if (cancelConfirmDraft) {
        setCancelConfirmDraft(null);
        return;
      }
      closeTasksModal();
      return;
    }
    setMenuOpen((v) => !v);
  }

  if (!orgId || visibility !== 'visible') {
    return null;
  }

  const detailDisplayClient =
    String(selectedDraft?.client_name ?? selectedDraft?.client_display_name ?? '').trim() || '—';
  const detailRuleName = String(selectedDraft?.rule_name ?? selectedDraft?.rule_value_key ?? '').trim() || '—';
  const detailDue =
    String(selectedDraft?.generated_at_display ?? '').trim() ||
    String(selectedDraft?.created_at ?? '').trim().replace('T', ' ').slice(0, 16) ||
    '—';
  const detailStatus =
    String(selectedDraft?.status_label ?? '').trim() || String(selectedDraft?.status ?? '').trim() || '—';

  const cancelConfirmClientName =
    cancelConfirmDraft != null
      ? String(cancelConfirmDraft.client_name ?? cancelConfirmDraft.client_display_name ?? '').trim() || 'this client'
      : '';

  const menuOrModalOpen = menuOpen || tasksModalOpen;

  return (
    <>
      {menuOpen && !tasksModalOpen ? (
        <button
          type="button"
          className="docflow-menu-backdrop"
          aria-label="Close DocFlow menu"
          onMouseDown={(e) => {
            e.preventDefault();
            closeMenu();
          }}
        />
      ) : null}

      {tasksModalOpen ? (
        <button
          type="button"
          className="docflow-tasks-modal-backdrop"
          aria-label="Close DocFlow tasks"
          onMouseDown={(e) => {
            e.preventDefault();
            if (cancelConfirmDraft) {
              setCancelConfirmDraft(null);
              return;
            }
            closeTasksModal();
          }}
        />
      ) : null}

      <div className="nx-docflow-widget-root">
        {menuOpen && !tasksModalOpen ? (
          <div
            className="docflow-bubble-menu"
            role="menu"
            aria-label="DocFlow actions"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="docflow-bubble-menu-title">DocFlow</div>
            <div className="docflow-bubble-menu-subtitle">
              {pendingCount} pending draft{pendingCount === 1 ? '' : 's'}
            </div>
            <button type="button" className="docflow-bubble-menu-btn docflow-bubble-menu-btn-primary" onClick={openTasksFromMenu}>
              Open Tasks
            </button>
            <button type="button" className="docflow-bubble-menu-btn docflow-bubble-menu-btn-secondary" onClick={goMessenger}>
              Open Messenger
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="nx-docflow-widget-fab"
          aria-label="DocFlow"
          aria-expanded={menuOrModalOpen}
          aria-haspopup="true"
          onClick={onFabClick}
        >
          <div className={`docflow-badge ${badgeModifierClass}`}>
            <div className="docflow-text-top">• DocFlow • DocFlow •</div>
            <img src="/docflow-logo.png" className="docflow-logo" alt="" />
            <div className="docflow-text-bottom">• DocFlow •</div>
          </div>
          {pendingCount > 0 ? <span className="nx-docflow-widget-count">{pendingCount > 99 ? '99+' : pendingCount}</span> : null}
        </button>
      </div>

      {tasksModalOpen ? (
        <div className="docflow-tasks-modal-wrap" role="dialog" aria-modal="true" aria-labelledby="docflow-tasks-modal-title">
          <div className="docflow-tasks-modal">
            <div className="docflow-tasks-modal-header">
              <div>
                <div id="docflow-tasks-modal-title" className="docflow-tasks-modal-title">
                  DocFlow Tasks
                </div>
                <div className="docflow-tasks-modal-subtitle docflow-tasks-modal-meta">
                  {modalPendingCount} pending draft{modalPendingCount === 1 ? '' : 's'}
                </div>
                {modalTrialBadge ? (
                  <div className="docflow-task-trial">
                    {modalTrialBadge}
                    {modalTrialDetail ? <div className="docflow-task-trial-detail">{modalTrialDetail}</div> : null}
                  </div>
                ) : null}
              </div>
              <button type="button" className="docflow-task-close" onClick={closeTasksModal} aria-label="Close">
                ×
              </button>
            </div>

            {widgetAccess === 'locked' ? (
              <div className="docflow-task-locked">
                {lockedMessage ? <p className="docflow-task-locked-msg">{lockedMessage}</p> : null}
                <Link
                  className="docflow-btn docflow-btn-send"
                  to={billingPath}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
                >
                  {billingCta}
                </Link>
                <Link
                  to="/m/docflow/messenger"
                  className="docflow-task-messenger-link docflow-task-messenger-link--block"
                  onClick={() => closeTasksModal()}
                >
                  Open Messenger
                </Link>
              </div>
            ) : (
              <div className="docflow-tasks-modal-body docflow-tasks-modal-body--task-center">
                {tcLoadError ? <div className="docflow-task-error docflow-task-error--pad">{tcLoadError}</div> : null}
                {!taskCenter && !tcLoadError ? (
                  <div className="docflow-task-loading">Loading task center…</div>
                ) : null}
                {taskCenter ? (
                  <>
                    <div className="docflow-task-kpi-row">
                      {(
                        [
                          { k: 'overdue_count', label: 'Overdue', tone: 'danger' as const },
                          { k: 'waiting_client_count', label: 'Waiting Client', tone: 'warn' as const },
                          { k: 'needs_review_count', label: 'Needs Review', tone: 'amber' as const },
                          { k: 'pending_drafts_count', label: 'Drafts', tone: 'ok' as const },
                          { k: 'unread_replies_count', label: 'Unread Replies', tone: 'info' as const },
                          { k: 'assigned_to_me_count', label: 'Assigned To Me', tone: 'purple' as const },
                        ] as const
                      ).map((card) => {
                        const v = summaryRec?.[card.k];
                        const n = typeof v === 'number' ? v : Number(v) || 0;
                        return (
                          <div key={card.k} className={`docflow-kpi-card docflow-kpi-card--${card.tone}`}>
                            <div className="docflow-kpi-card-top">
                              <span className={`docflow-kpi-icon docflow-kpi-icon--${card.tone}`} aria-hidden>
                                <TaskCenterKpiIcon tone={card.tone} />
                              </span>
                              <div className="docflow-kpi-label">{card.label}</div>
                            </div>
                            <div className="docflow-kpi-val">{n}</div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="docflow-tc-toolbar">
                      <div className="docflow-tc-toolbar-filters">
                        <input
                          className="docflow-task-search docflow-task-search--grow"
                          type="search"
                          placeholder="Search clients, threads…"
                          value={tcSearch}
                          onChange={(e) => {
                            setTcSearch(e.target.value);
                            setTcPage(1);
                          }}
                          aria-label="Search"
                        />
                        <select
                          className="docflow-task-select docflow-tc-select-compact"
                          value={tcModule}
                          onChange={(e) => {
                            setTcModule(e.target.value);
                            setTcPage(1);
                          }}
                          aria-label="Module"
                        >
                          <option value="">All modules</option>
                          {moduleFilterOpts.map((o) => (
                            <option key={String(o.value)} value={String(o.value ?? '')}>
                              {String(o.label ?? o.value)}
                            </option>
                          ))}
                        </select>
                        <select
                          className="docflow-task-select docflow-tc-select-compact"
                          value={tcThreadType}
                          onChange={(e) => {
                            setTcThreadType(e.target.value);
                            setTcPage(1);
                          }}
                          aria-label="Thread type"
                        >
                          <option value="">All types</option>
                          {typeFilterOpts.map((o) => (
                            <option key={String(o.value)} value={String(o.value ?? '')}>
                              {String(o.label ?? o.value)}
                            </option>
                          ))}
                        </select>
                        <select
                          className="docflow-task-select docflow-tc-select-compact"
                          value={tcThreadStatus}
                          onChange={(e) => {
                            setTcThreadStatus(e.target.value);
                            setTcPage(1);
                          }}
                          aria-label="Thread status"
                        >
                          <option value="">All statuses</option>
                          {statusFilterOpts.map((o) => (
                            <option key={String(o.value)} value={String(o.value ?? '')}>
                              {String(o.label ?? o.value)}
                            </option>
                          ))}
                        </select>
                        <select
                          className="docflow-task-select docflow-tc-select-compact"
                          value={tcAssigned}
                          onChange={(e) => {
                            setTcAssigned(e.target.value);
                            setTcPage(1);
                          }}
                          aria-label="Assigned"
                        >
                          <option value="">All accountants</option>
                          {accountantFilterOpts.map((o) => (
                            <option key={String(o.value)} value={String(o.value ?? '')}>
                              {String(o.label ?? o.value)}
                            </option>
                          ))}
                        </select>
                        <input
                          className="docflow-task-date docflow-tc-date-compact"
                          type="date"
                          value={tcDueFrom}
                          onChange={(e) => {
                            setTcDueFrom(e.target.value);
                            setTcPage(1);
                          }}
                          aria-label="Due from"
                        />
                        <input
                          className="docflow-task-date docflow-tc-date-compact"
                          type="date"
                          value={tcDueTo}
                          onChange={(e) => {
                            setTcDueTo(e.target.value);
                            setTcPage(1);
                          }}
                          aria-label="Due to"
                        />
                        <label className="docflow-task-check docflow-tc-check-compact">
                          <input
                            type="checkbox"
                            checked={tcUnreadOnly}
                            onChange={(e) => {
                              setTcUnreadOnly(e.target.checked);
                              setTcPage(1);
                            }}
                          />
                          <span>Unread only</span>
                        </label>
                        <label className="docflow-task-check docflow-tc-check-compact">
                          <input
                            type="checkbox"
                            checked={tcOverdueOnly}
                            onChange={(e) => {
                              setTcOverdueOnly(e.target.checked);
                              setTcPage(1);
                            }}
                          />
                          <span>Overdue only</span>
                        </label>
                        <button type="button" className="docflow-task-clear-filters" onClick={() => clearAllTaskFilters()}>
                          Clear filters
                        </button>
                      </div>
                      {bulkAllowed.some((b) => b.enabled) ? (
                        <div className="docflow-tc-toolbar-bulk">
                          <span className="docflow-bulk-label">Bulk</span>
                          <select
                            className="docflow-task-select docflow-task-select--narrow docflow-tc-select-compact"
                            value={assignUserChoice}
                            onChange={(e) => setAssignUserChoice(e.target.value)}
                            aria-label="Bulk assign target user"
                          >
                            <option value="">Assign to…</option>
                            {accountantFilterOpts
                              .filter((o) => {
                                const v = String(o.value ?? '');
                                return v && v !== 'me' && v !== 'unassigned';
                              })
                              .map((o) => (
                                <option key={String(o.value)} value={String(o.value ?? '')}>
                                  {String(o.label ?? o.value)}
                                </option>
                              ))}
                          </select>
                          {bulkAllowed
                            .filter((b) => b.enabled && b.bulk_action)
                            .map((b) => (
                              <button
                                key={String(b.bulk_action)}
                                type="button"
                                className="docflow-tc-bulk-btn"
                                disabled={busy.length > 0 || selectedThreadIds.length === 0}
                                onClick={() => void runBulk(String(b.bulk_action))}
                              >
                                {taskCenterBulkActionLabel(String(b.bulk_action))}
                              </button>
                            ))}
                        </div>
                      ) : null}
                    </div>

                    {assignPick ? (
                      <div className="docflow-assign-bar">
                        <span className="docflow-assign-bar-label">Assign thread</span>
                        <select
                          className="docflow-task-select docflow-tc-select-compact"
                          value={assignUserChoice}
                          onChange={(e) => setAssignUserChoice(e.target.value)}
                          aria-label="Assign to"
                        >
                          <option value="">Unassigned</option>
                          {accountantFilterOpts
                            .filter((o) => {
                              const v = String(o.value ?? '');
                              return v && v !== 'me' && v !== 'unassigned';
                            })
                            .map((o) => (
                              <option key={String(o.value)} value={String(o.value ?? '')}>
                                {String(o.label ?? o.value)}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className="docflow-btn docflow-btn-approve docflow-btn-compact"
                          disabled={busy.length > 0}
                          onClick={() =>
                            void runTaskModalCommand('assign_docflow_thread', {
                              thread_id: assignPick.threadId,
                              client_id: assignPick.clientId,
                              assigned_user_id: assignUserChoice.trim() || null,
                            }).then(() => {
                              setAssignPick(null);
                              setAssignUserChoice('');
                            })
                          }
                        >
                          Apply assignment
                        </button>
                        <button
                          type="button"
                          className="docflow-btn docflow-btn-edit docflow-btn-compact"
                          onClick={() => {
                            setAssignPick(null);
                            setAssignUserChoice('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}

                    <div className="docflow-task-center-table-wrap docflow-tc-table-scroll">
                      <table className="docflow-task-table docflow-tc-task-table">
                        <thead className="docflow-task-table-head">
                          <tr>
                            <th className="docflow-task-th-check">
                              <input type="checkbox" checked={allRowsSelected} onChange={() => toggleSelectAllRows()} aria-label="Select all" />
                            </th>
                            <th>Client</th>
                            <th>Module</th>
                            <th>Thread Type</th>
                            <th>Status</th>
                            <th>Due</th>
                            <th>Assigned</th>
                            <th>Last Activity</th>
                            <th>Unread</th>
                            <th className="docflow-task-th-actions">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rowsArr.length === 0 ? (
                            <tr>
                              <td colSpan={10} className="docflow-task-empty-cell">
                                No threads match the current filters.
                              </td>
                            </tr>
                          ) : (
                            rowsArr.map((row, rowIdx) => {
                              const tid = String(row.thread_id ?? '');
                              const cid = String(row.client_id ?? '');
                              const actions = Array.isArray(row.allowed_actions)
                                ? (row.allowed_actions as AllowedAction[])
                                : [];
                              const unread = row.unread_count;
                              const unreadN = typeof unread === 'number' ? unread : Number(unread) || 0;
                              return (
                                <tr key={`tc-${rowIdx}-${tid}-${cid}`}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedThreadIds.includes(tid)}
                                      onChange={() => toggleRowSelected(tid)}
                                      aria-label="Select row"
                                    />
                                  </td>
                                  <td className="docflow-task-td-clip" title={String(row.client_name ?? '')}>
                                    {String(row.client_name ?? '—')}
                                  </td>
                                  <td className="docflow-task-td-clip">
                                    <span className="docflow-tc-module-pill">{String(row.module_label ?? '—')}</span>
                                  </td>
                                  <td className="docflow-task-td-clip docflow-tc-td-muted">{String(row.thread_type_label ?? '—')}</td>
                                  <td className="docflow-task-td-clip">
                                    <span className={taskCenterStatusPillClass(String(row.status_label ?? ''))}>
                                      {String(row.status_label ?? '—')}
                                    </span>
                                  </td>
                                  <td className="docflow-task-td-clip">{String(row.due_label ?? '—')}</td>
                                  <td className="docflow-task-td-clip">{String(row.assigned_label ?? '—')}</td>
                                  <td className="docflow-task-td-clip">{String(row.last_activity_label ?? '—')}</td>
                                  <td className="docflow-tc-td-unread">
                                    {unreadN > 0 ? (
                                      <span className="docflow-unread-badge docflow-tc-unread-badge">{unreadN > 99 ? '99+' : unreadN}</span>
                                    ) : (
                                      <span className="docflow-tc-unread-dash">—</span>
                                    )}
                                  </td>
                                  <td className="docflow-tc-actions-cell">
                                    <div className="docflow-tc-actions-row">
                                      {(() => {
                                        const openA = threadRowAction(actions, 'open_docflow_thread');
                                        if (!openA) return null;
                                        return (
                                          <button
                                            type="button"
                                            className="docflow-tc-btn-open"
                                            disabled={busy.length > 0 || !openA.enabled}
                                            title={openA.reason ?? undefined}
                                            onClick={() => {
                                              if (!openA.enabled) return;
                                              void runTaskModalCommand('open_docflow_thread', { thread_id: tid, client_id: cid }).then(() => {
                                                closeTasksModal();
                                                navigate(
                                                  `/m/docflow/messenger?client_id=${encodeURIComponent(cid)}&thread_id=${encodeURIComponent(tid)}`,
                                                );
                                              });
                                            }}
                                          >
                                            Open
                                          </button>
                                        );
                                      })()}
                                      {TC_SECONDARY_CMDS.some((cmd) => threadRowAction(actions, cmd)) ? (
                                        <details className="docflow-tc-actions-more">
                                          <summary className="docflow-tc-more-summary" aria-label="More actions">
                                            ⋯
                                          </summary>
                                          <ul className="docflow-tc-more-menu" role="menu">
                                            {TC_SECONDARY_CMDS.map((cmd) => {
                                              const act = threadRowAction(actions, cmd);
                                              if (!act) return null;
                                              return (
                                                <li key={cmd} role="presentation">
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="docflow-tc-more-item"
                                                    disabled={busy.length > 0 || !act.enabled}
                                                    title={act.reason ?? undefined}
                                                    onClick={(e) => {
                                                      (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute(
                                                        'open',
                                                      );
                                                      if (!act.enabled) return;
                                                      if (cmd === 'send_docflow_reminder') {
                                                        void runTaskModalCommand(cmd, {
                                                          thread_id: tid,
                                                          client_id: cid,
                                                          idempotency_key: `rem_${tid}_${Date.now()}`,
                                                        });
                                                        return;
                                                      }
                                                      if (cmd === 'assign_docflow_thread') {
                                                        setAssignPick({ threadId: tid, clientId: cid });
                                                        setAssignUserChoice('');
                                                        return;
                                                      }
                                                      if (cmd === 'resolve_docflow_thread') {
                                                        void runTaskModalCommand(cmd, { thread_id: tid, client_id: cid });
                                                        return;
                                                      }
                                                      if (cmd === 'archive_docflow_thread') {
                                                        void runTaskModalCommand(cmd, { thread_id: tid, client_id: cid });
                                                      }
                                                    }}
                                                  >
                                                    {taskCenterSecondaryActionLabel(cmd)}
                                                  </button>
                                                </li>
                                              );
                                            })}
                                          </ul>
                                        </details>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="docflow-task-center-pagination docflow-tc-pagination">
                      <button
                        type="button"
                        className="docflow-btn docflow-btn-edit docflow-btn-compact"
                        disabled={busy.length > 0 || tcPage <= 1}
                        onClick={() => setTcPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </button>
                      <span className="docflow-page-indicator">
                        Page {tcPage}
                        {tcTotalPages ? ` / ${tcTotalPages}` : ''}
                      </span>
                      <button
                        type="button"
                        className="docflow-btn docflow-btn-edit docflow-btn-compact"
                        disabled={busy.length > 0 || (tcTotalPages > 0 && tcPage >= tcTotalPages)}
                        onClick={() => setTcPage((p) => p + 1)}
                      >
                        Next
                      </button>
                      <span className="docflow-page-summary">
                        {(tcPage - 1) * tcPageSize + 1}-{Math.min(tcPage * tcPageSize, tcTotalRows || tcPage * tcPageSize)} of {tcTotalRows}
                      </span>
                    </div>

                    <div className="docflow-task-draft-block docflow-tc-draft-block">
                      <div className="docflow-tc-draft-header">
                        <span className="docflow-tc-draft-heading">Pending drafts</span>
                        <select
                          className="docflow-task-select docflow-tc-select-compact docflow-tc-draft-rule-select"
                          value={tcDraftRule}
                          onChange={(e) => {
                            setTcDraftRule(e.target.value);
                            setTcPage(1);
                          }}
                          aria-label="Draft rule"
                        >
                          {draftRuleSelectOptions.map((o) => (
                            <option key={String(o.value)} value={String(o.value ?? 'all')}>
                              {String(o.label ?? o.value)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {modalPendingCount === 0 || modalDrafts.length === 0 ? (
                        <div className="docflow-tc-draft-empty-card">
                          <div className="docflow-tc-draft-empty-icon" aria-hidden>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path
                                d="M9 12h6m-6 4h4M7 4h10l1 4v10a2 2 0 01-2 2H8a2 2 0 01-2-2V8l1-4z"
                                stroke="#c4b5fd"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                          <div className="docflow-tc-draft-empty-title">No drafts in this view</div>
                          <div className="docflow-tc-draft-empty-muted">Choose another draft rule filter or check back when new drafts arrive.</div>
                        </div>
                      ) : (
                        <div className="docflow-draft-card-list">
                          {modalDrafts.map((d, idx) => {
                            const id = String(d.draft_id ?? '').trim();
                            const client = String(d.client_name ?? d.client_display_name ?? '').trim() || '—';
                            const rule = String(d.rule_name ?? d.rule_value_key ?? '').trim() || '—';
                            const reason = reasonCellText(d) || '—';
                            const statusLabel =
                              String(d.status_label ?? '').trim() || String(d.status ?? '').trim() || '—';
                            const due =
                              String(d.generated_at_display ?? '').trim() ||
                              String(d.created_at ?? '').trim().replace('T', ' ').slice(0, 16) ||
                              '—';
                            const selected = id && selectedDraftId === id;
                            const showReview = hasAnyReviewAction(d);
                            return (
                              <div
                                key={draftRowKey(d, idx)}
                                className={`docflow-draft-card${selected ? ' docflow-draft-card-selected' : ''}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedDraftId(id || null)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSelectedDraftId(id || null);
                                  }
                                }}
                              >
                                <div className="docflow-draft-card-top">
                                  <span className="docflow-draft-card-client">{client}</span>
                                  <span className="docflow-status-pill" title={statusLabel}>
                                    {statusLabel}
                                  </span>
                                </div>
                                <div className="docflow-draft-card-rule">{rule}</div>
                                <div className="docflow-draft-card-reason">{reason}</div>
                                <div className="docflow-draft-card-meta">
                                  <span>{due}</span>
                                  {showReview ? (
                                    <button
                                      type="button"
                                      className="docflow-review-btn"
                                      disabled={busy.length > 0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedDraftId(id || null);
                                      }}
                                    >
                                      Review
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : null}

                {selectedDraft && widgetAccess !== 'locked' ? (
                    <div className="docflow-detail-card">
                      <div className="docflow-detail-meta docflow-detail-meta-compact">
                        <div>
                          <span className="docflow-detail-meta-key">Client</span>
                          <span className="docflow-detail-meta-val">{detailDisplayClient}</span>
                        </div>
                        <div>
                          <span className="docflow-detail-meta-key">Rule</span>
                          <span className="docflow-detail-meta-val">{detailRuleName}</span>
                        </div>
                        <div>
                          <span className="docflow-detail-meta-key">Generated</span>
                          <span className="docflow-detail-meta-val">{detailDue}</span>
                        </div>
                        <div>
                          <span className="docflow-detail-meta-key">Status</span>
                          <span className="docflow-detail-meta-val">{detailStatus}</span>
                        </div>
                      </div>

                      {detailEditing && hasDraftAction(selectedDraft, 'edit_draft_message') ? (
                        <div className="docflow-edit-block">
                          <textarea
                            className="docflow-edit-textarea"
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            disabled={busy.length > 0}
                            aria-label="Edit message body"
                          />
                          <div className="docflow-edit-actions">
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-edit docflow-btn-edit-wide"
                              disabled={busy.length > 0}
                              onClick={() => {
                                setDetailEditing(false);
                                setEditBody(String(selectedDraft.message_body ?? ''));
                              }}
                            >
                              Discard
                            </button>
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-approve docflow-btn-edit-wide"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'edit_draft_message').ok}
                              title={draftAction(selectedDraft, 'edit_draft_message').reason ?? undefined}
                              onClick={() =>
                                void runDraftCommand('edit_draft_message', selectedDraft, {
                                  message_body: editBody,
                                }).then(() => {
                                  setDetailEditing(false);
                                  setEditBody('');
                                })
                              }
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="docflow-message-preview">
                          {String(selectedDraft.message_body ?? '').trim() ||
                            String(selectedDraft.message_preview ?? selectedDraft.preview_text ?? '').trim() ||
                            '—'}
                        </div>
                      )}

                      {!detailEditing ? (
                        <div className="docflow-action-bar">
                          {hasDraftAction(selectedDraft, 'edit_draft_message') ? (
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-edit"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'edit_draft_message').ok}
                              title={draftAction(selectedDraft, 'edit_draft_message').reason ?? undefined}
                              onClick={() => {
                                setDetailEditing(true);
                                setEditBody(String(selectedDraft.message_body ?? ''));
                              }}
                            >
                              Edit
                            </button>
                          ) : null}
                          {hasDraftAction(selectedDraft, 'approve_draft_message') ? (
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-approve"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'approve_draft_message').ok}
                              title={draftAction(selectedDraft, 'approve_draft_message').reason ?? undefined}
                              onClick={() => void runDraftCommand('approve_draft_message', selectedDraft)}
                            >
                              Approve
                            </button>
                          ) : null}
                          {hasDraftAction(selectedDraft, 'send_approved_message') ? (
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-send"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'send_approved_message').ok}
                              title={draftAction(selectedDraft, 'send_approved_message').reason ?? undefined}
                              onClick={() => void runDraftCommand('send_approved_message', selectedDraft)}
                            >
                              Send
                            </button>
                          ) : null}
                          {hasDraftAction(selectedDraft, 'cancel_draft_message') ? (
                            <button
                              type="button"
                              className="docflow-btn docflow-btn-cancel"
                              disabled={busy.length > 0 || !draftAction(selectedDraft, 'cancel_draft_message').ok}
                              title={draftAction(selectedDraft, 'cancel_draft_message').reason ?? undefined}
                              onClick={() => setCancelConfirmDraft(selectedDraft)}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
              </div>
            )}

            {loadError ? <div className="docflow-task-error">{loadError}</div> : null}
            {actionError ? <div className="docflow-task-error">{actionError}</div> : null}
          </div>
        </div>
      ) : null}

      {cancelConfirmDraft && tasksModalOpen ? (
        <>
          <button
            type="button"
            className="docflow-confirm-backdrop"
            aria-label="Close confirmation"
            onMouseDown={(e) => {
              e.preventDefault();
              setCancelConfirmDraft(null);
            }}
          />
          <div
            className="docflow-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="docflow-cancel-confirm-title"
            aria-describedby="docflow-cancel-confirm-desc"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="docflow-cancel-confirm-title" className="docflow-confirm-title">
              Cancel reminder?
            </h2>
            <p id="docflow-cancel-confirm-desc" className="docflow-confirm-text">
              Are you sure you want to cancel this reminder for {cancelConfirmClientName}? After cancellation, this
              reminder will not appear again for this client until the next payroll period/month.
            </p>
            <div className="docflow-confirm-actions">
              <button type="button" className="docflow-btn docflow-btn-edit docflow-confirm-btn-wide" onClick={() => setCancelConfirmDraft(null)}>
                Keep reminder
              </button>
              <button
                type="button"
                className="docflow-btn docflow-btn-cancel docflow-confirm-btn-wide"
                disabled={busy.length > 0 || !draftAction(cancelConfirmDraft, 'cancel_draft_message').ok}
                title={draftAction(cancelConfirmDraft, 'cancel_draft_message').reason ?? undefined}
                onClick={() =>
                  void runDraftCommand('cancel_draft_message', cancelConfirmDraft).then(() => {
                    setCancelConfirmDraft(null);
                  })
                }
              >
                Cancel reminder
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
