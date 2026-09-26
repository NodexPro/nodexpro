import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { moduleClientOperationsRegistry, moduleClientOperationsRegistryCommands } from '../api/endpoints';
import {
  ClientOperationsRegistryView,
  type ClientOperationsNoteTypeRow,
  type ClientOperationsRegistryColumn,
  type ClientOperationsRegistryRow,
  type ClientOperationsToolbarCapability,
} from '../components/client-operations/ClientOperationsRegistryView';

type RegistryAggregate = {
  title_he?: string;
  rows: ClientOperationsRegistryRow[];
  columns?: ClientOperationsRegistryColumn[];
  note_types?: ClientOperationsNoteTypeRow[];
  toolbar_capabilities?: ClientOperationsToolbarCapability[];
  custom_columns_capability?: { max: number; current: number; can_create: boolean };
  user_column_period_setup?: {
    needed: boolean;
    operational_period_key: string;
    eligible_columns: Array<{ column_id: string; label: string; key: string; preselected: boolean }>;
  } | null;
  columns_needing_legacy_baseline?: Array<{
    column_id: string;
    label: string;
    key: string;
    available_baseline_periods: string[];
  }>;
  query?: {
    q: string | null;
    sort_by: string | null;
    sort_dir: 'asc' | 'desc' | null;
    operational_period_key: string;
  };
  period?: { selected_period_key: string; default_period_key: string; available_periods: string[] };
  allowed_actions?: string[];
};

export function ClientOperationsRegistry() {
  const auth = useAuth();

  const [rows, setRows] = useState<ClientOperationsRegistryRow[]>([]);
  const [allowedActions, setAllowedActions] = useState<string[]>([]);
  const canEdit = allowedActions.includes('client_operations.edit');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteTypes, setNoteTypes] = useState<ClientOperationsNoteTypeRow[]>([]);
  const [columns, setColumns] = useState<ClientOperationsRegistryColumn[]>([]);
  const [toolbarCapabilities, setToolbarCapabilities] = useState<ClientOperationsToolbarCapability[]>(
    [],
  );
  const [titleHe, setTitleHe] = useState('תפעול לקוחות');
  const [customColumnsCapability, setCustomColumnsCapability] = useState({
    max: 0,
    current: 0,
    can_create: false,
  });
  const [userColumnPeriodSetup, setUserColumnPeriodSetup] = useState<RegistryAggregate['user_column_period_setup']>(null);
  const [columnsNeedingLegacyBaseline, setColumnsNeedingLegacyBaseline] = useState<
    NonNullable<RegistryAggregate['columns_needing_legacy_baseline']>
  >([]);
  const [query, setQuery] = useState<{
    q: string | null;
    sort_by: string | null;
    sort_dir: 'asc' | 'desc' | null;
    operational_period_key: string | null;
  }>({ q: null, sort_by: null, sort_dir: null, operational_period_key: null });
  const [period, setPeriod] = useState<{
    selected_period_key: string;
    default_period_key: string;
    available_periods: string[];
  } | null>(null);
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  /** Once-per-entry / in-flight guard — never loop ensure on aggregate refresh. */
  const userSlotsEnsureRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const periodSetupEmptyRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const periodSetupKeyRef = useRef<string | null>(null);

  const applyAggregate = useCallback((data: RegistryAggregate) => {
    setRows(Array.isArray(data?.rows) ? data.rows : []);
    setAllowedActions(Array.isArray(data?.allowed_actions) ? data.allowed_actions : []);
    setNoteTypes(Array.isArray(data?.note_types) ? data.note_types : []);
    setColumns(Array.isArray(data?.columns) ? data.columns : []);
    setToolbarCapabilities(Array.isArray(data?.toolbar_capabilities) ? data.toolbar_capabilities : []);
    if (data?.custom_columns_capability) setCustomColumnsCapability(data.custom_columns_capability);
    setUserColumnPeriodSetup(data?.user_column_period_setup ?? null);
    setColumnsNeedingLegacyBaseline(
      Array.isArray(data?.columns_needing_legacy_baseline) ? data.columns_needing_legacy_baseline : [],
    );
    if (typeof data?.title_he === 'string' && data.title_he.trim()) setTitleHe(data.title_he);
    if (data?.query) {
      setQuery({
        q: data.query.q ?? null,
        sort_by: data.query.sort_by ?? null,
        sort_dir: data.query.sort_dir ?? null,
        operational_period_key:
          data.period?.selected_period_key ?? data.query.operational_period_key ?? null,
      });
    } else if (data.period?.selected_period_key) {
      setQuery((current) => ({ ...current, operational_period_key: data.period!.selected_period_key }));
    }
    if (data.period) {
      setPeriod({
        selected_period_key: data.period.selected_period_key,
        default_period_key: data.period.default_period_key,
        available_periods: Array.isArray(data.period.available_periods)
          ? data.period.available_periods
          : [],
      });
    }
  }, []);

  const loadRegistry = useCallback(
    (
      nextQuery: {
        q: string | null;
        sort_by: string | null;
        sort_dir: 'asc' | 'desc' | null;
        operational_period_key?: string | null;
      },
      options?: { quiet?: boolean },
    ) => {
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      const seq = ++loadSeqRef.current;
      setQuery({ ...nextQuery, operational_period_key: nextQuery.operational_period_key ?? null });
      // Query-only search must not dim/block the grid; period/initial loads still show loading.
      if (!options?.quiet) setLoading(true);
      setError('');
      return apiJson<RegistryAggregate>(moduleClientOperationsRegistry(nextQuery), {
        signal: ac.signal,
      })
        .then((data) => {
          if (seq !== loadSeqRef.current) return;
          applyAggregate(data);
        })
        .catch((e) => {
          if (e instanceof Error && e.name === 'AbortError') return;
          if (seq !== loadSeqRef.current) return;
          setError(e instanceof Error ? e.message : 'Failed to load');
        })
        .finally(() => {
          if (seq === loadSeqRef.current && !options?.quiet) setLoading(false);
        });
    },
    [applyAggregate],
  );

  const reloadRegistry = useCallback(() => {
    return loadRegistry(query);
  }, [loadRegistry, query]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    void loadRegistry(query);
    return () => {
      loadAbortRef.current?.abort();
    };
    // Mount-only initial load; subsequent loads use loadRegistry via handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, [auth.status]);

  const onQueryChange = useCallback(
    (
      next: { q: string | null; sort_by: string | null; sort_dir: 'asc' | 'desc' | null },
      options?: { quiet?: boolean },
    ) => {
      void loadRegistry(
        { ...next, operational_period_key: query.operational_period_key },
        { quiet: options?.quiet === true },
      );
    },
    [loadRegistry, query.operational_period_key],
  );

  const onPeriodChange = useCallback(
    (operationalPeriodKey: string) => {
      void loadRegistry({
        q: query.q,
        sort_by: query.sort_by,
        sort_dir: query.sort_dir,
        operational_period_key: operationalPeriodKey,
      });
    },
    [loadRegistry, query.q, query.sort_by, query.sort_dir],
  );

  const onRegistryCommand = useCallback(
    (body: Record<string, unknown>, options?: { applyAggregate?: boolean }) =>
      apiJson<RegistryAggregate>(moduleClientOperationsRegistryCommands(), {
        method: 'POST',
        body: JSON.stringify({ ...body, query }),
      }).then((data) => {
        // Cell autosave passes applyAggregate:false so View can reject wrong-period /
        // stale in-flight paints before registry truth is replaced.
        if (options?.applyAggregate !== false) applyAggregate(data);
        return data;
      }),
    [applyAggregate, query],
  );

  // Excel 10 user slots: init ONLY via named command when backend capability says so.
  // React to custom_columns_capability.can_create — do not compute missing slots on FE.
  useEffect(() => {
    if (loading) return;
    if (!canEdit) return;
    if (!customColumnsCapability.can_create) return;
    if (userSlotsEnsureRef.current !== 'idle') return;
    userSlotsEnsureRef.current = 'pending';
    void onRegistryCommand({ command: 'ensure_client_operations_user_column_slots' })
      .catch(() => {
        /* no local fabrication; mark done so we do not hammer on every refresh */
      })
      .finally(() => {
        userSlotsEnsureRef.current = 'done';
      });
  }, [loading, canEdit, customColumnsCapability.can_create, onRegistryCommand]);

  // Zero-eligible period setup: named command only (GET never writes). One-shot per period key.
  useEffect(() => {
    if (loading) return;
    if (!canEdit) return;
    const setup = userColumnPeriodSetup;
    if (!setup?.needed) return;
    if ((setup.eligible_columns?.length ?? 0) > 0) return;
    const key = setup.operational_period_key;
    if (periodSetupKeyRef.current !== key) {
      periodSetupKeyRef.current = key;
      periodSetupEmptyRef.current = 'idle';
    }
    if (periodSetupEmptyRef.current !== 'idle') return;
    periodSetupEmptyRef.current = 'pending';
    void onRegistryCommand({
      command: 'initialize_client_operations_user_columns_for_period',
      operational_period_key: key,
      column_ids: [],
    })
      .catch(() => {})
      .finally(() => {
        periodSetupEmptyRef.current = 'done';
      });
  }, [loading, canEdit, userColumnPeriodSetup, onRegistryCommand]);

  if (auth.status !== 'authenticated') return null;

  return (
    <ClientOperationsRegistryView
      rows={rows}
      onRowsChange={setRows}
      noteTypes={noteTypes}
      loading={loading}
      error={error}
      canEdit={canEdit}
      showPageHeader={false}
      onReloadRegistry={() => void reloadRegistry()}
      variant="spreadsheet"
      titleHe={titleHe}
      columns={columns}
      toolbarCapabilities={toolbarCapabilities}
      customColumnsCapability={customColumnsCapability}
      userColumnPeriodSetup={userColumnPeriodSetup}
      columnsNeedingLegacyBaseline={columnsNeedingLegacyBaseline}
      query={query}
      onQueryChange={onQueryChange}
      onRegistryCommand={onRegistryCommand}
      onApplyAggregate={applyAggregate}
      period={period}
      onPeriodChange={onPeriodChange}
      widthScope={{
        userId: auth.me.user.id,
        organizationId: auth.me.activeOrganizationId ?? '',
      }}
    />
  );
}
