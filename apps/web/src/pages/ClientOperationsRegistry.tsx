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

  const applyAggregate = useCallback((data: RegistryAggregate) => {
    setRows(Array.isArray(data?.rows) ? data.rows : []);
    setAllowedActions(Array.isArray(data?.allowed_actions) ? data.allowed_actions : []);
    setNoteTypes(Array.isArray(data?.note_types) ? data.note_types : []);
    setColumns(Array.isArray(data?.columns) ? data.columns : []);
    setToolbarCapabilities(Array.isArray(data?.toolbar_capabilities) ? data.toolbar_capabilities : []);
    if (data?.custom_columns_capability) setCustomColumnsCapability(data.custom_columns_capability);
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
    (nextQuery: {
      q: string | null;
      sort_by: string | null;
      sort_dir: 'asc' | 'desc' | null;
      operational_period_key?: string | null;
    }) => {
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;
      const seq = ++loadSeqRef.current;
      setQuery({ ...nextQuery, operational_period_key: nextQuery.operational_period_key ?? null });
      setLoading(true);
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
          if (seq === loadSeqRef.current) setLoading(false);
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
    (next: { q: string | null; sort_by: string | null; sort_dir: 'asc' | 'desc' | null }) => {
      void loadRegistry({ ...next, operational_period_key: query.operational_period_key });
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
    (body: Record<string, unknown>) =>
      apiJson<RegistryAggregate>(moduleClientOperationsRegistryCommands(), {
        method: 'POST',
        body: JSON.stringify({ ...body, query }),
      }).then((data) => {
        applyAggregate(data);
        return data;
      }),
    [applyAggregate, query],
  );

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
