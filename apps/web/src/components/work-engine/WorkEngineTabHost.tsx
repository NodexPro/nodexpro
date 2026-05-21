/**
 * Work Engine embedded module tab host — single page /work-engine/queue.
 *
 * STRICT:
 *   - Tab availability from backend workspace_tabs only.
 *   - Tab switch via query param only (no /m/* navigation).
 *   - Each enabled tab loads its backend aggregate_route only.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchWorkEngineClientsTabAggregate,
  fetchWorkEngineInvoicesTabAggregate,
  fetchWorkEngineQueueAggregate,
  type AccountantWorkspaceTab,
  type WorkEngineClientsTabAggregate,
  type WorkEngineInvoicesTabAggregate,
  type WorkEngineQueueFiltersInput,
} from '../../api/work-engine';
import { userFacingApiMessage } from '../../api/client';
import { ClientOperationsRegistryView } from '../client-operations/ClientOperationsRegistryView';
import { WorkEngineModuleTabTable } from './WorkEngineModuleTabTable';
import { WorkEngineIncomeDocumentWizardModal } from './WorkEngineIncomeDocumentWizardModal';

const QUEUE_SHELL_FILTERS: WorkEngineQueueFiltersInput = {
  limit: 50,
  offset: 0,
};

export function resolveWorkEngineTabKey(raw: string | null): string {
  if (!raw || raw === 'work' || raw === 'work_engine') return 'work';
  return raw;
}

const WORKSPACE_TAB_ICONS: Record<string, ReactNode> = {
  work_engine: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h6v6H4V6zm10 0h6v6h-6V6zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" fill="currentColor" />
    </svg>
  ),
  work: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h6v6H4V6zm10 0h6v6h-6V6zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" fill="currentColor" />
    </svg>
  ),
  invoices: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 1.5V9h4.5M8 13h8M8 17h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  payroll: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3v18M7 8h10M7 12h8M7 16h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  vat: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h14v10H5V7zm3 3h8M8 14h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  documents: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 4h7l5 5v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  ),
  clients: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM4 19c0-2.2 2.2-4 5-4s5 1.8 5 4M14 19c0-1.5 1.7-3 4-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  bank: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 10h16L12 4 4 10zm2 2v6h3v-6H6zm5 0v6h3v-6h-3zm5 0v6h3v-6h-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 19V9m6 10V5m6 14v-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
};

function workspaceTabIcon(iconKey: string): ReactNode {
  return WORKSPACE_TAB_ICONS[iconKey] ?? WORKSPACE_TAB_ICONS.work_engine;
}

export function WorkEngineWorkspaceTabs(props: {
  tabs: AccountantWorkspaceTab[];
  onSelect: (tab: AccountantWorkspaceTab) => void;
}) {
  const { tabs, onSelect } = props;

  return (
    <nav className="nx-aw-tabs" aria-label="Accountant workspace modules">
      <div className="nx-aw-tabs__scroll" role="tablist">
        {tabs.map((tab) => {
          const showBadge = tab.badge_count !== null;
          const badgeVariant = tab.badge_variant ?? 'neutral';
          const tabClass = [
            'nx-aw-tabs__tab',
            tab.active ? 'nx-aw-tabs__tab--active' : '',
            !tab.enabled ? 'nx-aw-tabs__tab--disabled' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={tab.key}
              type="button"
              className={tabClass}
              role="tab"
              aria-selected={tab.active}
              disabled={!tab.enabled}
              title={!tab.enabled ? tab.disabled_reason ?? undefined : undefined}
              aria-current={tab.active ? 'page' : undefined}
              onClick={() => onSelect(tab)}
            >
              <span className="nx-aw-tabs__icon">{workspaceTabIcon(tab.icon_key)}</span>
              <span className="nx-aw-tabs__body">
                <span className="nx-aw-tabs__label">{tab.label}</span>
                <span className="nx-aw-tabs__subtitle">{tab.subtitle}</span>
              </span>
              {showBadge ? (
                <span
                  className={`nx-aw-tabs__badge nx-aw-tabs__badge--${badgeVariant}`}
                  aria-label={`${tab.badge_count} items`}
                >
                  {tab.badge_count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function WorkEngineDisabledTabPanel(props: {
  tabKey: string;
  workspaceTabs: AccountantWorkspaceTab[] | null;
  onWorkspaceTabs: (tabs: AccountantWorkspaceTab[]) => void;
}) {
  const { tabKey, workspaceTabs, onWorkspaceTabs } = props;
  const [loading, setLoading] = useState(!workspaceTabs);

  useEffect(() => {
    if (workspaceTabs) return;
    let cancelled = false;
    (async () => {
      try {
        const agg = await fetchWorkEngineQueueAggregate(QUEUE_SHELL_FILTERS);
        if (!cancelled && agg.workspace_tabs) onWorkspaceTabs(agg.workspace_tabs);
      } catch {
        /* shell optional */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceTabs, onWorkspaceTabs]);

  const tab = workspaceTabs?.find((t) => t.key === tabKey);
  const reason = tab?.disabled_reason ?? 'Coming soon';

  if (loading && !workspaceTabs) {
    return <p className="nx-we-queue__subtitle">טוען…</p>;
  }

  return (
    <div className="nx-we-module-tab__placeholder" role="status">
      <h2 className="nx-we-queue__title">{tab?.label ?? tabKey}</h2>
      <p className="nx-we-queue__subtitle">{reason}</p>
    </div>
  );
}

function WorkEngineClientsTabPanel(props: {
  onWorkspaceTabs: (tabs: AccountantWorkspaceTab[]) => void;
}) {
  const { onWorkspaceTabs } = props;
  const [aggregate, setAggregate] = useState<WorkEngineClientsTabAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WorkEngineClientsTabAggregate['client_operations_aggregate']['rows']>([]);

  const loadAggregate = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const agg = await fetchWorkEngineClientsTabAggregate();
        setAggregate(agg);
        setRows(agg.client_operations_aggregate.rows ?? []);
        if (agg.workspace_tabs) onWorkspaceTabs(agg.workspace_tabs);
      } catch (e) {
        setError(userFacingApiMessage(e));
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [onWorkspaceTabs],
  );

  useEffect(() => {
    void loadAggregate();
  }, [loadAggregate]);

  const canEdit = aggregate?.allowed_actions.includes('client_operations.edit') ?? false;

  if (loading && !aggregate) {
    return <p className="nx-we-queue__subtitle">טוען לקוחות…</p>;
  }

  if (error && !aggregate) {
    return <div className="nx-we-banner-error">{error}</div>;
  }

  if (!aggregate) return null;

  return (
    <>
      <h1 className="nx-we-queue__title">{aggregate.title}</h1>
      <p className="nx-we-queue__subtitle">{aggregate.description}</p>
      {error ? <div className="nx-we-banner-error">{error}</div> : null}
      <ClientOperationsRegistryView
        rows={rows}
        onRowsChange={setRows}
        noteTypes={aggregate.client_operations_aggregate.note_types}
        loading={loading}
        error={error ?? ''}
        canEdit={canEdit}
        showPageHeader={false}
        onReloadRegistry={() => void loadAggregate({ silent: true })}
      />
    </>
  );
}

function WorkEngineInvoicesTabPanel(props: {
  onWorkspaceTabs: (tabs: AccountantWorkspaceTab[]) => void;
}) {
  const { onWorkspaceTabs } = props;
  const [aggregate, setAggregate] = useState<WorkEngineInvoicesTabAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardBusy, setWizardBusy] = useState(false);

  const loadAggregate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const agg = await fetchWorkEngineInvoicesTabAggregate();
      setAggregate(agg);
      if (agg.workspace_tabs) onWorkspaceTabs(agg.workspace_tabs);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }, [onWorkspaceTabs]);

  useEffect(() => {
    void loadAggregate();
  }, [loadAggregate]);

  if (loading && !aggregate) {
    return <p className="nx-we-queue__subtitle">טוען חשבוניות…</p>;
  }

  if (error && !aggregate) {
    return <div className="nx-we-banner-error">{error}</div>;
  }

  if (!aggregate) return null;

  const entry = aggregate.document_creation_entrypoint;
  const canOpenWizard =
    entry.allowed && aggregate.allowed_actions.includes(entry.allowed_action);

  return (
    <>
      <div className="nx-we-invoices-tab__header">
        <div>
          <h1 className="nx-we-queue__title">{aggregate.title}</h1>
          <p className="nx-we-queue__subtitle">{aggregate.description}</p>
        </div>
        {canOpenWizard ? (
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={wizardBusy}
            onClick={() => setWizardOpen(true)}
          >
            {entry.button_label}
          </button>
        ) : null}
      </div>
      {error ? <div className="nx-we-banner-error">{error}</div> : null}
      <WorkEngineModuleTabTable table={aggregate.table_model} summary={aggregate.summary} />
      {wizardOpen ? (
        <WorkEngineIncomeDocumentWizardModal
          open={wizardOpen}
          busy={wizardBusy}
          entrypoint={entry}
          onClose={() => setWizardOpen(false)}
          onBusyChange={setWizardBusy}
          onCompleted={() => void loadAggregate()}
        />
      ) : null}
    </>
  );
}

export function WorkEngineTabHost(props: {
  renderWorkTab: (onWorkspaceTabs: (tabs: AccountantWorkspaceTab[]) => void) => ReactNode;
}) {
  const { renderWorkTab } = props;
  const [searchParams, setSearchParams] = useSearchParams();
  const tabKey = resolveWorkEngineTabKey(searchParams.get('tab'));
  const [workspaceTabs, setWorkspaceTabs] = useState<AccountantWorkspaceTab[] | null>(null);

  const handleTabSelect = useCallback(
    (tab: AccountantWorkspaceTab) => {
      if (!tab.enabled || !tab.aggregate_route) return;
      if (tab.key === 'work') {
        setSearchParams({});
      } else {
        setSearchParams({ tab: tab.key });
      }
    },
    [setSearchParams],
  );

  const visibleTabs = (workspaceTabs ?? []).filter((t) => !t.hidden);
  const activeTabDef = visibleTabs.find((t) => t.key === tabKey) ?? null;
  const showWorkQueue = tabKey === 'work';
  const showInvoices = tabKey === 'invoices' && (activeTabDef?.enabled ?? true);
  const showClients = tabKey === 'clients' && (activeTabDef?.enabled ?? true);
  const showDisabled =
    !showWorkQueue &&
    !showInvoices &&
    !showClients &&
    (activeTabDef == null || !activeTabDef.enabled || !activeTabDef.aggregate_route);

  return (
    <div className="nx-we-queue nx-we-queue--with-workspace-tabs">
      {visibleTabs.length > 0 ? (
        <WorkEngineWorkspaceTabs tabs={visibleTabs} onSelect={handleTabSelect} />
      ) : null}

      {showWorkQueue ? renderWorkTab(setWorkspaceTabs) : null}
      {showInvoices ? <WorkEngineInvoicesTabPanel onWorkspaceTabs={setWorkspaceTabs} /> : null}
      {showClients ? <WorkEngineClientsTabPanel onWorkspaceTabs={setWorkspaceTabs} /> : null}
      {showDisabled ? (
        <WorkEngineDisabledTabPanel
          tabKey={tabKey}
          workspaceTabs={workspaceTabs}
          onWorkspaceTabs={setWorkspaceTabs}
        />
      ) : null}
    </div>
  );
}
