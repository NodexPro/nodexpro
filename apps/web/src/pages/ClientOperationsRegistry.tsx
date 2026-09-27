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
import {
  getPeriodAggregateCache,
  putPeriodAggregateCache,
  selectPeriodPrefetchKeys,
  shouldApplyPeriodAggregateResponse,
  type PeriodAggregateCacheEntry,
} from '../lib/client-operations-period-aggregate-cache.pure';

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
  const [manualStatusPaintModes, setManualStatusPaintModes] = useState<
    NonNullable<RegistryAggregate['manual_status_paint_modes']>
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
  const viewedPeriodKeyRef = useRef<string | null>(null);
  const periodCacheRef = useRef<Map<string, PeriodAggregateCacheEntry<RegistryAggregate>>>(new Map());
  const prefetchInflightRef = useRef<Set<string>>(new Set());
  /** Last backend-authoritative available_periods (not FE-optimistic). */
  const backendAvailablePeriodsRef = useRef<string[]>([]);
  const cacheOrganizationIdRef = useRef<string | null>(null);
  /** Once-per-entry / in-flight guard — never loop ensure on aggregate refresh. */
  const userSlotsEnsureRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const periodSetupEmptyRef = useRef<'idle' | 'pending' | 'done'>('idle');
  const periodSetupKeyRef = useRef<string | null>(null);

  const activeOrganizationId =
    auth.status === 'authenticated' ? (auth.me.activeOrganizationId ?? null) : null;

  useEffect(() => {
    if (cacheOrganizationIdRef.current === activeOrganizationId) return;
    cacheOrganizationIdRef.current = activeOrganizationId;
    periodCacheRef.current.clear();
    prefetchInflightRef.current.clear();
    backendAvailablePeriodsRef.current = [];
    viewedPeriodKeyRef.current = null;
  }, [activeOrganizationId]);

  const applyAggregate = useCallback((data: RegistryAggregate, options?: { forcePeriodKey?: string }) => {
    const responsePeriod =
      data.period?.selected_period_key ?? data.query?.operational_period_key ?? null;
    const viewed = options?.forcePeriodKey ?? viewedPeriodKeyRef.current;
    if (
      responsePeriod &&
      viewed &&
      !shouldApplyPeriodAggregateResponse({
        responsePeriodKey: responsePeriod,
        viewedPeriodKey: viewed,
      })
    ) {
      // Cache late period truth without painting the active sheet.
      putPeriodAggregateCache(periodCacheRef.current, responsePeriod, data);
      return;
    }

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
    if (Array.isArray(data?.manual_status_paint_modes)) {
      setManualStatusPaintModes(data.manual_status_paint_modes);
    }
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
      viewedPeriodKeyRef.current = data.period.selected_period_key;
      putPeriodAggregateCache(periodCacheRef.current, data.period.selected_period_key, data);
      if (Array.isArray(data.period.available_periods)) {
        backendAvailablePeriodsRef.current = data.period.available_periods;
      }
    }
  }, []);

  const prefetchPeriods = useCallback(
    (
      baseQuery: {
        q: string | null;
        sort_by: string | null;
        sort_dir: 'asc' | 'desc' | null;
      },
      selectedPeriodKey: string,
      availablePeriods: string[],
    ) => {
      const keys = selectPeriodPrefetchKeys({ selectedPeriodKey, availablePeriods, max: 4 });
      for (const key of keys) {
        if (getPeriodAggregateCache(periodCacheRef.current, key)) continue;
        if (prefetchInflightRef.current.has(key)) continue;
        prefetchInflightRef.current.add(key);
        void apiJson<RegistryAggregate>(
          moduleClientOperationsRegistry({ ...baseQuery, operational_period_key: key }),
        )
          .then((data) => {
            putPeriodAggregateCache(periodCacheRef.current, key, data);
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
      },
      options?: { quiet?: boolean; preferCache?: boolean },
    ) => {
      const periodKey = nextQuery.operational_period_key ?? null;
      if (periodKey) {
        viewedPeriodKeyRef.current = periodKey;
        setQuery({ ...nextQuery, operational_period_key: periodKey });
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
          const cached = getPeriodAggregateCache(periodCacheRef.current, periodKey);
          if (cached) {
            applyAggregate(cached, { forcePeriodKey: periodKey });
            // Quiet refresh after instant paint.
            options = { ...options, quiet: true };
          }
        }
      } else {
        setQuery({ ...nextQuery, operational_period_key: null });
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
            const responsePeriod =
              data.period?.selected_period_key ?? data.query?.operational_period_key ?? null;
            if (responsePeriod) putPeriodAggregateCache(periodCacheRef.current, responsePeriod, data);
            return;
          }
          applyAggregate(data);
          const selected = data.period?.selected_period_key;
          const available = data.period?.available_periods ?? [];
          if (selected) {
            prefetchPeriods(
              { q: nextQuery.q, sort_by: nextQuery.sort_by, sort_dir: nextQuery.sort_dir },
              selected,
              available,
            );
          }
        })
        .catch((e) => {
          if (e instanceof Error && e.name === 'AbortError') return;
          if (seq !== loadSeqRef.current) return;
          setError(e instanceof Error ? e.message : 'Failed to load');
          // Drop optimistic first-touch tab if backend never confirmed it.
          if (periodKey && !getPeriodAggregateCache(periodCacheRef.current, periodKey)) {
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
          if (seq === loadSeqRef.current && !options?.quiet) setLoading(false);
        });
    },
    [applyAggregate, prefetchPeriods],
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
      // Instant tab + cache paint; quiet network refresh. Dirty cell saves continue in background.
      void loadRegistry(
        {
          q: query.q,
          sort_by: query.sort_by,
          sort_dir: query.sort_dir,
          operational_period_key: operationalPeriodKey,
        },
        { quiet: true, preferCache: true },
      );
    },
    [loadRegistry, query.q, query.sort_by, query.sort_dir],
  );

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
        else {
          const responsePeriod =
            data.period?.selected_period_key ?? data.query?.operational_period_key ?? null;
          if (responsePeriod) putPeriodAggregateCache(periodCacheRef.current, responsePeriod, data);
        }
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
      manualStatusPaintModes={manualStatusPaintModes}
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
