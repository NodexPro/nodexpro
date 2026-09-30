import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { moduleClientOperationsRegistry, moduleClientOperationsRegistryCommands } from '../api/endpoints';
import {
  ClientOperationsRegistryView,
  type ClientOperationsManualRegistryRow,
  type ClientOperationsNoteTypeRow,
  type ClientOperationsRegistryColumn,
  type ClientOperationsRegistryRow,
  type ClientOperationsToolbarCapability,
} from '../components/client-operations/ClientOperationsRegistryView';
import {
  canRenderPeriodBoundRows,
  getPeriodAggregateCache,
  putPeriodAggregateCache,
  resolveRegistryAggregatePeriodKey,
  selectPeriodPrefetchKeys,
  shouldApplyPeriodAggregateResponse,
  shouldCachePrefetchAggregate,
  shouldPrefetchAdjacentPeriods,
  type ClientOperationsRegistryCacheQuery,
  type PeriodAggregateCacheEntry,
} from '../lib/client-operations-period-aggregate-cache.pure';

type RegistryAggregate = {
  title_he?: string;
  rows: ClientOperationsRegistryRow[];
  /** Backend-owned free-text manual spreadsheet rows (not Core clients). */
  manual_rows?: ClientOperationsManualRegistryRow[];
  columns?: ClientOperationsRegistryColumn[];
  note_types?: ClientOperationsNoteTypeRow[];
  toolbar_capabilities?: ClientOperationsToolbarCapability[];
  custom_columns_capability?: { max: number; current: number; can_create: boolean };
  user_column_period_setup?: {
    needed: boolean;
    operational_period_key: string;
    eligible_columns: Array<{ column_id: string; label: string; key: string; preselected: boolean }>;
  } | null;
  /** Manual rows first-touch — null when viewer or already initialized. */
  manual_rows_period_setup?: {
    needed: boolean;
    operational_period_key: string;
  } | null;
  columns_needing_legacy_baseline?: Array<{
    column_id: string;
    label: string;
    key: string;
    available_baseline_periods: string[];
  }>;
  manual_status_paint_modes?: Array<{
    id: 'ready' | 'sent_for_approval' | 'completed' | 'clear';
    label_he: string;
    presentation_token: 'ready' | 'sent_for_approval' | 'completed' | 'clear';
  }>;
  query?: {
    q: string | null;
    sort_by: string | null;
    sort_dir: 'asc' | 'desc' | null;
    operational_period_key: string;
    filter_operational_reporting?: string | null;
    filter_material?: string | null;
    filter_payroll?: string | null;
    filter_reporting_type?: string | null;
    filter_business_type?: string | null;
    filter_handler?: string | null;
  };
  period?: { selected_period_key: string; default_period_key: string; available_periods: string[] };
  allowed_actions?: string[];
  filters?: {
    definitions: Array<{
      id: string;
      label_he: string;
      width_hint?: 'default' | 'wide' | 'handler';
      options: Array<{ id: string; label_he: string; enabled: boolean }>;
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
    clear_action: { id: string; label_he: string; available: boolean };
  };
};

export function ClientOperationsRegistry() {
  const auth = useAuth();

  const [rows, setRows] = useState<ClientOperationsRegistryRow[]>([]);
  const [manualRows, setManualRows] = useState<ClientOperationsManualRegistryRow[]>([]);
  const [allowedActions, setAllowedActions] = useState<string[]>([]);
  const canEdit = allowedActions.includes('client_operations.edit');
  const [loading, setLoading] = useState(true);
  /**
   * Quiet search/filter aggregate refresh in flight (header search pending indicator).
   * Cleared only by the load generation that is still current — superseded loads never clear it.
   */
  const [queryRefreshPending, setQueryRefreshPending] = useState(false);
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
  const [manualRowsPeriodSetup, setManualRowsPeriodSetup] = useState<
    RegistryAggregate['manual_rows_period_setup']
  >(null);
  const [columnsNeedingLegacyBaseline, setColumnsNeedingLegacyBaseline] = useState<
    NonNullable<RegistryAggregate['columns_needing_legacy_baseline']>
  >([]);
  const [manualStatusPaintModes, setManualStatusPaintModes] = useState<
    NonNullable<RegistryAggregate['manual_status_paint_modes']>
  >([]);
  const [filters, setFilters] = useState<RegistryAggregate['filters']>(undefined);
  const [query, setQuery] = useState<{
    q: string | null;
    sort_by: string | null;
    sort_dir: 'asc' | 'desc' | null;
    operational_period_key: string | null;
    filter_operational_reporting: string | null;
    filter_material: string | null;
    filter_payroll: string | null;
    filter_reporting_type: string | null;
    filter_business_type: string | null;
    filter_handler: string | null;
  }>({
    q: null,
    sort_by: null,
    sort_dir: null,
    operational_period_key: null,
    filter_operational_reporting: null,
    filter_material: null,
    filter_payroll: null,
    filter_reporting_type: null,
    filter_business_type: null,
    filter_handler: null,
  });
  const [period, setPeriod] = useState<{
    selected_period_key: string;
    default_period_key: string;
    available_periods: string[];
  } | null>(null);
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const viewedPeriodKeyRef = useRef<string | null>(null);
  /** Aggregate period currently painted into rows/manualRows (null = transition). */
  const [renderedAggregatePeriodKey, setRenderedAggregatePeriodKey] = useState<string | null>(null);
  const periodCacheRef = useRef<Map<string, PeriodAggregateCacheEntry<RegistryAggregate>>>(new Map());
  const prefetchInflightRef = useRef<Set<string>>(new Set());
  /** Last backend-authoritative available_periods (not FE-optimistic). */
  const backendAvailablePeriodsRef = useRef<string[]>([]);
  const cacheOrganizationIdRef = useRef<string | null>(null);
  /** Once-per-entry / in-flight guard — never loop ensure on aggregate refresh. */
  const userSlotsEnsureRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const periodSetupEmptyRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const periodSetupKeyRef = useRef<string | null>(null);
  const manualRowsSetupRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const manualRowsSetupKeyRef = useRef<string | null>(null);

  const activeOrganizationId =
    auth.status === 'authenticated' ? (auth.me.activeOrganizationId ?? null) : null;

  useEffect(() => {
    if (cacheOrganizationIdRef.current === activeOrganizationId) return;
    cacheOrganizationIdRef.current = activeOrganizationId;
    periodCacheRef.current.clear();
    prefetchInflightRef.current.clear();
    backendAvailablePeriodsRef.current = [];
    viewedPeriodKeyRef.current = null;
    setRenderedAggregatePeriodKey(null);
  }, [activeOrganizationId]);

  const clearPeriodBoundPresentation = useCallback(() => {
    setRows([]);
    setManualRows([]);
    setRenderedAggregatePeriodKey(null);
    setUserColumnPeriodSetup(null);
    setManualRowsPeriodSetup(null);
  }, []);

  const applyAggregate = useCallback(
    (
      data: RegistryAggregate,
      options?: { forcePeriodKey?: string; allowUnresolvedBootstrap?: boolean },
    ) => {
    const responsePeriod = resolveRegistryAggregatePeriodKey(data);
    const viewed = options?.forcePeriodKey ?? viewedPeriodKeyRef.current;
    if (
      !shouldApplyPeriodAggregateResponse({
        responsePeriodKey: responsePeriod,
        viewedPeriodKey: viewed,
        allowUnresolvedBootstrap: options?.allowUnresolvedBootstrap === true,
      })
    ) {
      // Late / wrong / missing period never paints. Cache only when identity is explicit.
      if (responsePeriod) {
        const cacheQuery: ClientOperationsRegistryCacheQuery = {
          q: data.query?.q ?? null,
          filter_operational_reporting: data.query?.filter_operational_reporting ?? null,
          filter_material: data.query?.filter_material ?? null,
          filter_payroll: data.query?.filter_payroll ?? null,
          filter_reporting_type: data.query?.filter_reporting_type ?? null,
          filter_business_type: data.query?.filter_business_type ?? null,
          filter_handler: data.query?.filter_handler ?? null,
        };
        putPeriodAggregateCache(periodCacheRef.current, responsePeriod, data, cacheQuery);
      }
      return false;
    }

    // Atomic: selected/viewed + rendered share the same explicit response period.
    viewedPeriodKeyRef.current = responsePeriod;
    setRows(Array.isArray(data?.rows) ? data.rows : []);
    setManualRows(Array.isArray(data?.manual_rows) ? data.manual_rows : []);
    setRenderedAggregatePeriodKey(responsePeriod);
    setAllowedActions(Array.isArray(data?.allowed_actions) ? data.allowed_actions : []);
    setNoteTypes(Array.isArray(data?.note_types) ? data.note_types : []);
    setColumns(Array.isArray(data?.columns) ? data.columns : []);
    setToolbarCapabilities(Array.isArray(data?.toolbar_capabilities) ? data.toolbar_capabilities : []);
    if (data?.custom_columns_capability) setCustomColumnsCapability(data.custom_columns_capability);
    setUserColumnPeriodSetup(data?.user_column_period_setup ?? null);
    setManualRowsPeriodSetup(data?.manual_rows_period_setup ?? null);
    setColumnsNeedingLegacyBaseline(
      Array.isArray(data?.columns_needing_legacy_baseline) ? data.columns_needing_legacy_baseline : [],
    );
    if (Array.isArray(data?.manual_status_paint_modes)) {
      setManualStatusPaintModes(data.manual_status_paint_modes);
    }
    if (data?.filters) setFilters(data.filters);
    if (typeof data?.title_he === 'string' && data.title_he.trim()) setTitleHe(data.title_he);
    if (data?.query) {
      setQuery({
        q: data.query.q ?? null,
        sort_by: data.query.sort_by ?? null,
        sort_dir: data.query.sort_dir ?? null,
        operational_period_key:
          data.period?.selected_period_key ?? data.query.operational_period_key ?? null,
        filter_operational_reporting: data.query.filter_operational_reporting ?? null,
        filter_material: data.query.filter_material ?? null,
        filter_payroll: data.query.filter_payroll ?? null,
        filter_reporting_type: data.query.filter_reporting_type ?? null,
        filter_business_type: data.query.filter_business_type ?? null,
        filter_handler: data.query.filter_handler ?? null,
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
      viewedPeriodKeyRef.current = data.period.selected_period_key;
      const cacheQuery: ClientOperationsRegistryCacheQuery = {
        q: data.query?.q ?? null,
        filter_operational_reporting: data.query?.filter_operational_reporting ?? null,
        filter_material: data.query?.filter_material ?? null,
        filter_payroll: data.query?.filter_payroll ?? null,
        filter_reporting_type: data.query?.filter_reporting_type ?? null,
        filter_business_type: data.query?.filter_business_type ?? null,
        filter_handler: data.query?.filter_handler ?? null,
      };
      putPeriodAggregateCache(
        periodCacheRef.current,
        data.period.selected_period_key,
        data,
        cacheQuery,
      );
      if (Array.isArray(data.period.available_periods)) {
        backendAvailablePeriodsRef.current = data.period.available_periods;
      }
    }
    return true;
  }, []);

  const prefetchPeriods = useCallback(
    (
      baseQuery: {
        q: string | null;
        sort_by: string | null;
        sort_dir: 'asc' | 'desc' | null;
        filter_operational_reporting?: string | null;
        filter_material?: string | null;
        filter_payroll?: string | null;
        filter_reporting_type?: string | null;
        filter_business_type?: string | null;
        filter_handler?: string | null;
      },
      selectedPeriodKey: string,
      availablePeriods: string[],
    ) => {
      // Active search (`q`) or business filters: never fan-out adjacent-period prefetches
      // (each is a full registry GET). Resumes when q is empty and no filter is active.
      if (!shouldPrefetchAdjacentPeriods(baseQuery)) return;
      const cacheQuery: ClientOperationsRegistryCacheQuery = {
        q: baseQuery.q,
        filter_operational_reporting: baseQuery.filter_operational_reporting ?? null,
        filter_material: baseQuery.filter_material ?? null,
        filter_payroll: baseQuery.filter_payroll ?? null,
        filter_reporting_type: baseQuery.filter_reporting_type ?? null,
        filter_business_type: baseQuery.filter_business_type ?? null,
        filter_handler: baseQuery.filter_handler ?? null,
      };
      const keys = selectPeriodPrefetchKeys({ selectedPeriodKey, availablePeriods, max: 4 });
      for (const key of keys) {
        if (getPeriodAggregateCache(periodCacheRef.current, key, cacheQuery)) continue;
        if (prefetchInflightRef.current.has(key)) continue;
        prefetchInflightRef.current.add(key);
        void apiJson<RegistryAggregate>(
          moduleClientOperationsRegistry({ ...baseQuery, operational_period_key: key }),
        )
          .then((data) => {
            const responsePeriod = resolveRegistryAggregatePeriodKey(data);
            if (
              !shouldCachePrefetchAggregate({
                requestedPeriodKey: key,
                responsePeriodKey: responsePeriod,
              })
            ) {
              return;
            }
            putPeriodAggregateCache(periodCacheRef.current, key, data, cacheQuery);
          })
          .catch(() => {})
          .finally(() => {
            prefetchInflightRef.current.delete(key);
          });
      }
    },
    [],
  );

  const loadRegistry = useCallback(
    (
      nextQuery: {
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
      },
      options?: { quiet?: boolean; preferCache?: boolean },
    ) => {
      const periodKey = nextQuery.operational_period_key ?? null;
      const cacheQuery: ClientOperationsRegistryCacheQuery = {
        q: nextQuery.q ?? null,
        filter_operational_reporting: nextQuery.filter_operational_reporting ?? null,
        filter_material: nextQuery.filter_material ?? null,
        filter_payroll: nextQuery.filter_payroll ?? null,
        filter_reporting_type: nextQuery.filter_reporting_type ?? null,
        filter_business_type: nextQuery.filter_business_type ?? null,
        filter_handler: nextQuery.filter_handler ?? null,
      };
      if (periodKey) {
        viewedPeriodKeyRef.current = periodKey;
        setQuery({
          q: nextQuery.q ?? null,
          sort_by: nextQuery.sort_by ?? null,
          sort_dir: nextQuery.sort_dir ?? null,
          operational_period_key: periodKey,
          filter_operational_reporting: nextQuery.filter_operational_reporting ?? null,
          filter_material: nextQuery.filter_material ?? null,
          filter_payroll: nextQuery.filter_payroll ?? null,
          filter_reporting_type: nextQuery.filter_reporting_type ?? null,
          filter_business_type: nextQuery.filter_business_type ?? null,
          filter_handler: nextQuery.filter_handler ?? null,
        });
        setPeriod((current) => {
          if (!current) {
            return {
              selected_period_key: periodKey,
              default_period_key: periodKey,
              available_periods: [periodKey],
            };
          }
          const available = current.available_periods.includes(periodKey)
            ? current.available_periods
            : [...current.available_periods, periodKey].sort();
          return {
            ...current,
            selected_period_key: periodKey,
            available_periods: available,
          };
        });
        if (options?.preferCache !== false) {
          const cached = getPeriodAggregateCache(periodCacheRef.current, periodKey, cacheQuery);
          if (cached) {
            applyAggregate(cached, { forcePeriodKey: periodKey });
            // Quiet refresh after instant paint.
            options = { ...options, quiet: true };
          } else {
            // Cache miss: never leave previous-period rows under the new tab.
            clearPeriodBoundPresentation();
          }
        }
      } else {
        setQuery({
          q: nextQuery.q ?? null,
          sort_by: nextQuery.sort_by ?? null,
          sort_dir: nextQuery.sort_dir ?? null,
          operational_period_key: null,
          filter_operational_reporting: nextQuery.filter_operational_reporting ?? null,
          filter_material: nextQuery.filter_material ?? null,
          filter_payroll: nextQuery.filter_payroll ?? null,
          filter_reporting_type: nextQuery.filter_reporting_type ?? null,
          filter_business_type: nextQuery.filter_business_type ?? null,
          filter_handler: nextQuery.filter_handler ?? null,
        });
      }

      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      const seq = ++loadSeqRef.current;
      // Period switches / search must not dim; only true cold mount uses loading.
      if (!options?.quiet) setLoading(true);
      setError('');
      return apiJson<RegistryAggregate>(moduleClientOperationsRegistry(nextQuery), {
        signal: ac.signal,
      })
        .then((data) => {
          if (seq !== loadSeqRef.current) {
            // Superseded by a newer load or authoritative mutation (e.g. status paint).
            // Do NOT cache — stale quiet GETs must not poison period cache / wipe paints.
            return;
          }
          const painted = applyAggregate(data, {
            // Fresh entry: operational_period_key was null → viewed unresolved.
            // Backend-selected period is allowed to establish the initial view.
            allowUnresolvedBootstrap: !periodKey,
          });
          if (!painted) return;
          if (seq !== loadSeqRef.current) return;
          const selected = resolveRegistryAggregatePeriodKey(data);
          if (!selected || viewedPeriodKeyRef.current !== selected) return;
          const available = data.period?.available_periods ?? [];
          prefetchPeriods(
            {
              q: nextQuery.q,
              sort_by: nextQuery.sort_by,
              sort_dir: nextQuery.sort_dir,
              filter_operational_reporting: nextQuery.filter_operational_reporting ?? null,
              filter_material: nextQuery.filter_material ?? null,
              filter_payroll: nextQuery.filter_payroll ?? null,
              filter_reporting_type: nextQuery.filter_reporting_type ?? null,
              filter_business_type: nextQuery.filter_business_type ?? null,
              filter_handler: nextQuery.filter_handler ?? null,
            },
            selected,
            available,
          );
        })
        .catch((e) => {
          if (e instanceof Error && e.name === 'AbortError') return;
          if (seq !== loadSeqRef.current) return;
          setError(e instanceof Error ? e.message : 'Failed to load');
          // Drop optimistic first-touch tab if backend never confirmed it.
          if (periodKey && !getPeriodAggregateCache(periodCacheRef.current, periodKey, cacheQuery)) {
            const backendPeriods = backendAvailablePeriodsRef.current;
            setPeriod((current) => {
              if (!current) return current;
              const fallback =
                backendPeriods.find((p) => p !== periodKey) ??
                current.available_periods.find((p) => p !== periodKey) ??
                current.default_period_key;
              return {
                ...current,
                selected_period_key: fallback,
                available_periods: backendPeriods.length
                  ? backendPeriods
                  : current.available_periods.filter((p) => p !== periodKey),
              };
            });
            viewedPeriodKeyRef.current =
              backendPeriods.find((p) => p !== periodKey) ??
              backendPeriods[0] ??
              null;
          }
        })
        .finally(() => {
          if (seq !== loadSeqRef.current) return;
          if (!options?.quiet) setLoading(false);
          // Current generation settled (painted, rejected by period guard, or failed) → search no longer pending.
          setQueryRefreshPending(false);
        });
    },
    [applyAggregate, clearPeriodBoundPresentation, prefetchPeriods],
  );

  const reloadRegistry = useCallback(() => {
    return loadRegistry(query, { quiet: true });
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
      },
      options?: { quiet?: boolean },
    ) => {
      // Immediate quiet aggregate reload. Cache is keyed by period+search+filters —
      // do NOT wipe the whole period cache on every dropdown change.
      // Search-term change → pending indicator inside the search field (filter-only changes do not flag it).
      if ((next.q ?? null) !== (query.q ?? null)) setQueryRefreshPending(true);
      void loadRegistry(
        {
          ...query,
          ...next,
          operational_period_key: query.operational_period_key,
        },
        { quiet: options?.quiet === true, preferCache: false },
      );
    },
    [loadRegistry, query],
  );

  const onPeriodChange = useCallback(
    (operationalPeriodKey: string) => {
      // Instant tab + cache paint (key includes active filters); quiet network refresh.
      void loadRegistry(
        {
          ...query,
          operational_period_key: operationalPeriodKey,
        },
        { quiet: true, preferCache: true },
      );
    },
    [loadRegistry, query],
  );

  /** Invalidate in-flight quiet GETs so older aggregates cannot overwrite newer writes. */
  const invalidateStaleLoads = useCallback(() => {
    loadSeqRef.current += 1;
    // The in-flight quiet GET can no longer paint; the authoritative command aggregate is the truth.
    setQueryRefreshPending(false);
  }, []);

  const onRegistryCommand = useCallback(
    (body: Record<string, unknown>, options?: { applyAggregate?: boolean }) =>
      apiJson<RegistryAggregate>(moduleClientOperationsRegistryCommands(), {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          query: {
            ...query,
            operational_period_key:
              (typeof body.operational_period_key === 'string' && body.operational_period_key) ||
              query.operational_period_key,
          },
        }),
      }).then((data) => {
        if (options?.applyAggregate !== false) applyAggregate(data);
        // Deferred paint/custom-cell responses: do not poison period cache with mid-flight siblings.
        return data;
      }),
    [applyAggregate, query],
  );

  useEffect(() => {
    if (loading) return;
    if (!canEdit) return;
    if (!customColumnsCapability.can_create) return;
    if (userSlotsEnsureRef.current !== 'idle') return;
    userSlotsEnsureRef.current = 'pending';
    void onRegistryCommand({ command: 'ensure_client_operations_user_column_slots' })
      .catch(() => {})
      .finally(() => {
        userSlotsEnsureRef.current = 'done';
      });
  }, [loading, canEdit, customColumnsCapability.can_create, onRegistryCommand]);

  useEffect(() => {
    if (loading) return;
    if (!canEdit) return;
    const setup = userColumnPeriodSetup;
    if (!setup?.needed) return;
    if ((setup.eligible_columns?.length ?? 0) > 0) return;
    const key = setup.operational_period_key;
    if (viewedPeriodKeyRef.current && key !== viewedPeriodKeyRef.current) return;
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

  useEffect(() => {
    if (loading) return;
    if (!canEdit) return;
    const setup = manualRowsPeriodSetup;
    if (!setup?.needed) return;
    const key = setup.operational_period_key;
    if (viewedPeriodKeyRef.current && key !== viewedPeriodKeyRef.current) return;
    if (manualRowsSetupKeyRef.current !== key) {
      manualRowsSetupKeyRef.current = key;
      manualRowsSetupRef.current = 'idle';
    }
    if (manualRowsSetupRef.current !== 'idle') return;
    manualRowsSetupRef.current = 'pending';
    void onRegistryCommand({
      command: 'initialize_client_operations_manual_rows_for_period',
      operational_period_key: key,
    })
      .catch(() => {})
      .finally(() => {
        manualRowsSetupRef.current = 'done';
      });
  }, [loading, canEdit, manualRowsPeriodSetup, onRegistryCommand]);

  if (auth.status !== 'authenticated') return null;

  const selectedPeriodKey =
    period?.selected_period_key ?? query.operational_period_key ?? null;
  const periodContentPending = !canRenderPeriodBoundRows({
    selectedPeriodKey,
    renderedAggregatePeriodKey,
  });

  return (
    <ClientOperationsRegistryView
      rows={rows}
      onRowsChange={setRows}
      manualRows={manualRows}
      noteTypes={noteTypes}
      loading={loading}
      searchPending={queryRefreshPending}
      periodContentPending={periodContentPending}
      renderedAggregatePeriodKey={renderedAggregatePeriodKey}
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
      manualStatusPaintModes={manualStatusPaintModes}
      filters={filters}
      query={query}
      onQueryChange={onQueryChange}
      onRegistryCommand={onRegistryCommand}
      onApplyAggregate={applyAggregate}
      onInvalidateStaleLoads={invalidateStaleLoads}
      period={period}
      onPeriodChange={onPeriodChange}
      widthScope={{
        userId: auth.me.user.id,
        organizationId: auth.me.activeOrganizationId ?? '',
      }}
    />
  );
}
