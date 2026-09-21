import { useCallback, useEffect, useState } from 'react';
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
  query?: { q: string | null; sort_by: string | null; sort_dir: 'asc' | 'desc' | null };
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
  }>({ q: null, sort_by: null, sort_dir: null });

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
      });
    }
  }, []);

  const reloadRegistry = useCallback(
    (nextQuery?: { q: string | null; sort_by: string | null; sort_dir: 'asc' | 'desc' | null }) => {
      const q = nextQuery ?? query;
      return apiJson<RegistryAggregate>(moduleClientOperationsRegistry(q))
        .then((data) => applyAggregate(data))
        .catch(() => {});
    },
    [applyAggregate, query],
  );

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');

    apiJson<RegistryAggregate>(moduleClientOperationsRegistry(query), { signal: ac.signal })
      .then((reg) => {
        if (!cancelled) applyAggregate(reg);
      })
      .catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
    // Initial + query-driven reloads are handled via onQueryChange / reloadRegistry.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; query changes use onQueryChange
  }, [auth.status]);

  const onQueryChange = useCallback(
    (next: { q: string | null; sort_by: string | null; sort_dir: 'asc' | 'desc' | null }) => {
      setQuery(next);
      setLoading(true);
      apiJson<RegistryAggregate>(moduleClientOperationsRegistry(next))
        .then((data) => applyAggregate(data))
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    },
    [applyAggregate],
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
      widthScope={{
        userId: auth.me.user.id,
        organizationId: auth.me.activeOrganizationId ?? '',
      }}
    />
  );
}
